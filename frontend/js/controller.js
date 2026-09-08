(async function () {
  const api = window.PresentStudioApi;
  const params = new URLSearchParams(location.search);
  const presentationId = params.get("id") || "pres_demo";
  const shareToken = params.get("token") || "";
  const authToken = localStorage.getItem("presentStudio.accessToken") || "";
  const socket = window.io ? window.io() : null;
  const $ = (selector) => document.querySelector(selector);
  let presentation;
  let targets = [];
  let loopTimer;
  let activeTargetId = "";
  let teachTool = "pen";
  let teachZoom = 1;
  let teachPan = { x: 0, y: 0 };
  let teachPointer = null;

  function escapeHtml(value) { return String(value || "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char])); }
  function toast(message) { const node = $("#toast"); node.textContent = message; node.classList.add("show"); clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove("show"), 2600); }
  function credentials() { return { presentationId, authToken, shareToken }; }
  function setConnectionStatus(label) { $("#connectionStatus").innerHTML = `<i></i> ${label}`; }
  function teachPayload(type, payload = {}) { socket?.emit("annotation_event", { ...credentials(), type, payload }); }

  function collectTargets() {
    const result = [];
    presentation.slides.forEach((slide, slideIndex) => {
      const objects = slide.canvas?.fabric?.objects || [];
      const firstImage = objects.find(object => object.mediaType === "image");
      result.push({ id: `slide:${slide.id}`, kind: "slide", slideId: slide.id, mediaId: "", title: slide.title || `Slide ${slideIndex + 1}`, src: firstImage?.src || "", audioSrc: "" });
      const track = slide.canvas?.audio;
      if (track?.src) result.push({ id: `audio:${slide.id}:${track.id || "track"}`, kind: "audio", slideId: slide.id, mediaId: track.id || "track", title: track.name || `${slide.title || `Slide ${slideIndex + 1}`} · Music`, src: track.src, audioSrc: track.src });
      objects.forEach((object, mediaIndex) => {
        if (!object.mediaType || !["image", "video"].includes(object.mediaType) || !object.src) return;
        result.push({
          id: `${object.mediaType}:${slide.id}:${object.id || mediaIndex}`,
          kind: object.mediaType,
          slideId: slide.id,
          mediaId: object.id || String(mediaIndex),
          title: object.audioName || `${slide.title || `Slide ${slideIndex + 1}`} · ${object.mediaType === "image" ? "Image" : "Video"} ${mediaIndex + 1}`,
          src: object.src,
          audioSrc: object.audioSrc || ""
        });
      });
    });
    return result;
  }

  function cardMarkup(target) {
    const visual = target.kind === "audio" ? '<span class="controller-slide-number">♫</span>' : target.src ? (target.kind === "video" ? `<video src="${escapeHtml(target.src)}" muted preload="metadata"></video><span class="controller-play-mark">▶</span>` : `<img src="${escapeHtml(target.src)}" alt="">`) : `<span class="controller-slide-number">${escapeHtml(target.title.slice(0, 2))}</span>`;
    return `<button class="controller-target-card" type="button" data-target-id="${escapeHtml(target.id)}"><span class="controller-target-thumb">${visual}</span><span><strong>${escapeHtml(target.title)}</strong><small>${target.kind}${target.audioSrc ? " · linked audio" : ""}</small></span></button>`;
  }

  function renderTargets(kind, containerSelector, countSelector) {
    const items = targets.filter(target => target.kind === kind);
    $(countSelector).textContent = `${items.length} item${items.length === 1 ? "" : "s"}`;
    $(containerSelector).innerHTML = items.length ? items.map(cardMarkup).join("") : `<p class="controller-empty">No ${kind}s in this presentation.</p>`;
  }

  function renderLoopList(kind, selector) {
    const items = targets.filter(target => target.kind === kind);
    $(selector).innerHTML = items.map(target => `<label><input type="checkbox" value="${escapeHtml(target.id)}" checked><span>${escapeHtml(target.title)}</span></label>`).join("");
  }

  function bindTargetCards() {
    document.querySelectorAll("[data-target-id]").forEach(button => button.addEventListener("click", () => selectTarget(targets.find(target => target.id === button.dataset.targetId))));
  }

  function renderControllerTargets() {
    targets = collectTargets();
    $("#controllerTitle").textContent = presentation.title;
    renderTargets("slide", "#slideTargets", "#slideTargetCount");
    renderTargets("image", "#imageTargets", "#imageTargetCount");
    renderTargets("video", "#videoTargets", "#videoTargetCount");
    renderTargets("audio", "#audioTargets", "#audioTargetCount");
    renderLoopList("image", "#imageLoopList");
    renderLoopList("video", "#videoLoopList");
    bindTargetCards();
    if (activeTargetId) document.querySelector(`[data-target-id="${CSS.escape(activeTargetId)}"]`)?.classList.add("active");
  }

  async function persistSlide(target) {
    if (target.kind !== "slide") return;
    try {
      await api.setLiveSlide(presentationId, target.slideId, shareToken);
    } catch (error) {
      toast(error.message || "Could not update the live screen.");
    }
  }

  function selectTarget(target) {
    if (!target) return;
    activeTargetId = target.id;
    if (target.kind === "slide") socket?.emit("slide_changed", { ...credentials(), slideId: target.slideId });
    else socket?.emit("media_selected", { ...credentials(), slideId: target.slideId, mediaId: target.mediaId, kind: target.kind });
    persistSlide(target);
    document.querySelectorAll(".controller-target-card").forEach(card => card.classList.toggle("active", card.dataset.targetId === target.id));
    renderTeachingBackdrop(target);
    $("#previewTitle").textContent = target.title;
    $("#previewStage").innerHTML = target.kind === "audio" ? `<audio src="${escapeHtml(target.src)}" controls autoplay></audio>` : target.src ? (target.kind === "video" ? `<video src="${escapeHtml(target.src)}" muted autoplay loop></video>` : `<img src="${escapeHtml(target.src)}" alt="">`) : `<span>${escapeHtml(target.title)}</span>`;
  }

  function selectedLoopTargets(kind, selector) {
    const ids = [...document.querySelectorAll(`${selector} input:checked`)].map(input => input.value);
    return ids.map(id => targets.find(target => target.id === id)).filter(target => target?.kind === kind);
  }

  function startLoop(kind, selector) {
    const items = selectedLoopTargets(kind, selector);
    if (!items.length) return toast(`Select at least one ${kind}.`);
    clearInterval(loopTimer);
    let index = 0;
    selectTarget(items[index]);
    $("#loopStatus").textContent = `${kind === "image" ? "Image" : "Video"} loop running · ${items.length} selected`;
    loopTimer = setInterval(() => { index = (index + 1) % items.length; selectTarget(items[index]); }, Number($("#loopInterval").value) || 8000);
  }

  function stopLoop() { clearInterval(loopTimer); loopTimer = null; $("#loopStatus").textContent = "No loop running"; }

  function teachingCanvasPoint(event) {
    const stage = $("#teachingStage");
    const bounds = stage.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height))
    };
  }

  function drawTeachingPath(points, color, size) {
    if (points.length < 2) return;
    const canvas = $("#teachingCanvas");
    const context = canvas.getContext("2d");
    context.save();
    context.strokeStyle = color;
    context.lineWidth = size;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    points.forEach((point, index) => {
      const x = point.x * canvas.width;
      const y = point.y * canvas.height;
      if (index) context.lineTo(x, y);
      else context.moveTo(x, y);
    });
    context.stroke();
    context.restore();
  }

  function addTeachingText(text, point, color, size) {
    const label = document.createElement("span");
    label.textContent = text;
    label.style.left = `${point.x * 100}%`;
    label.style.top = `${point.y * 100}%`;
    label.style.setProperty("--annotation-color", color);
    label.style.setProperty("--annotation-size", `${Math.max(18, size * 3.8)}px`);
    $("#teachingTextLayer").append(label);
  }

  function renderTeachingBackdrop(target) {
    const backdrop = $("#teachingBackdrop");
    if (!backdrop || !target) return;
    if (target.kind === "video" && target.src) backdrop.innerHTML = `<video src="${escapeHtml(target.src)}" muted autoplay loop playsinline></video>`;
    else if (target.src) backdrop.innerHTML = `<img src="${escapeHtml(target.src)}" alt="">`;
    else backdrop.innerHTML = `<span>${escapeHtml(target.title || "Live screen")}</span>`;
  }

  function clearTeachingAnnotations(send = true) {
    $("#teachingCanvas").getContext("2d").clearRect(0, 0, 1280, 720);
    $("#teachingTextLayer").replaceChildren();
    if (send) teachPayload("clear");
  }

  function applyTeachingViewport(send = true) {
    const stage = $("#teachingStage");
    stage.style.transform = `translate(${teachPan.x}px, ${teachPan.y}px) scale(${teachZoom})`;
    $("#teachZoomValue").textContent = `${Math.round(teachZoom * 100)}%`;
    if (send) teachPayload("viewport", { zoom: teachZoom, x: teachPan.x, y: teachPan.y });
  }

  function setTeachTool(tool) {
    teachTool = tool;
    document.querySelectorAll("[data-teach-tool]").forEach(button => button.classList.toggle("is-active", button.dataset.teachTool === tool));
    $("#teachingStageWrap").classList.toggle("is-panning", tool === "pan");
  }

  function openTeachingMode() {
    $("#teachingRemote").hidden = false;
    applyTeachingViewport(false);
    $("#teachingRemote").requestFullscreen?.().catch(() => {});
  }

  function closeTeachingMode() {
    if (document.fullscreenElement === $("#teachingRemote")) document.exitFullscreen().catch(() => {});
    $("#teachingRemote").hidden = true;
  }

  function bindTeachingMode() {
    const stageWrap = $("#teachingStageWrap");
    const color = () => $("#teachColor").value || "#ffd54a";
    const size = () => Number($("#teachSize").value) || 7;
    document.querySelectorAll("[data-teach-tool]").forEach(button => button.onclick = () => setTeachTool(button.dataset.teachTool));
    $("#teachMode").onclick = openTeachingMode;
    $("#teachClose").onclick = closeTeachingMode;
    $("#teachClear").onclick = () => clearTeachingAnnotations(true);
    $("#teachZoomOut").onclick = () => { teachZoom = Math.max(0.5, teachZoom - 0.1); applyTeachingViewport(); };
    $("#teachZoomIn").onclick = () => { teachZoom = Math.min(3, teachZoom + 0.1); applyTeachingViewport(); };
    $("#teachResetView").onclick = () => { teachZoom = 1; teachPan = { x: 0, y: 0 }; applyTeachingViewport(); };
    stageWrap.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const point = teachingCanvasPoint(event);
      if (teachTool === "text") {
        const value = prompt("Text to show on the live screen");
        if (!value?.trim()) return;
        const payload = { text: value.trim().slice(0, 180), point, color: color(), size: size() };
        addTeachingText(payload.text, payload.point, payload.color, payload.size);
        teachPayload("text", payload);
        return;
      }
      teachPointer = { id: event.pointerId, startX: event.clientX, startY: event.clientY, pan: { ...teachPan }, points: [point] };
      stageWrap.setPointerCapture(event.pointerId);
      stageWrap.classList.toggle("is-grabbing", teachTool === "pan");
      event.preventDefault();
    });
    stageWrap.addEventListener("pointermove", (event) => {
      if (!teachPointer || teachPointer.id !== event.pointerId) return;
      if (teachTool === "pan") {
        teachPan = { x: teachPointer.pan.x + event.clientX - teachPointer.startX, y: teachPointer.pan.y + event.clientY - teachPointer.startY };
        applyTeachingViewport();
        return;
      }
      const point = teachingCanvasPoint(event);
      const previous = teachPointer.points.at(-1);
      teachPointer.points.push(point);
      drawTeachingPath([previous, point], color(), size());
    });
    const finishPointer = (event) => {
      if (!teachPointer || teachPointer.id !== event.pointerId) return;
      if (teachTool === "pen" && teachPointer.points.length > 1) teachPayload("draw", { points: teachPointer.points, color: color(), size: size() });
      teachPointer = null;
      stageWrap.classList.remove("is-grabbing");
    };
    stageWrap.addEventListener("pointerup", finishPointer);
    stageWrap.addEventListener("pointercancel", finishPointer);
  }

  try {
    const result = await api.getPresentation(presentationId, shareToken);
    if (result.permission !== "presenter") throw new Error("A trusted presenter link is required for this controller.");
    presentation = result.presentation;
    $("#backToEditor").href = `/builder.html?id=${encodeURIComponent(presentation.id)}`;
    renderControllerTargets();
    bindTeachingMode();
    $("#startImageLoop").onclick = () => startLoop("image", "#imageLoopList");
    $("#startVideoLoop").onclick = () => startLoop("video", "#videoLoopList");
    $("#stopLoop").onclick = stopLoop;
    $("#pauseMedia").onclick = () => socket?.emit("media_control", { ...credentials(), action: "toggle" });
    $("#replayMedia").onclick = () => socket?.emit("media_control", { ...credentials(), action: "replay" });
    $("#stopMedia").onclick = () => { stopLoop(); socket?.emit("media_control", { ...credentials(), action: "stop" }); $("#previewTitle").textContent = "Screen cleared"; $("#previewStage").innerHTML = "<span>Black screen</span>"; };
    $("#openScreen").onclick = async () => {
      if (shareToken) {
        window.open(`/screen.html?id=${encodeURIComponent(presentation.id)}&token=${encodeURIComponent(shareToken)}`, "_blank", "noopener");
        return;
      }
      try {
        const link = await api.createShareLink(presentation.id, "viewer");
        window.open(link.url, "_blank", "noopener");
      } catch (error) {
        toast(error.message || "Could not open the presentation screen.");
      }
    };
    if (!socket) setConnectionStatus("Sync ready");
    const joinRoom = () => { setConnectionStatus("Live"); socket?.emit("join_presentation", { presentationId }); };
    socket?.on("connect", joinRoom);
    if (socket?.connected) joinRoom();
    socket?.on("connect_error", () => setConnectionStatus("Sync backup"));
    socket?.on("disconnect", () => setConnectionStatus("Sync backup"));
    socket?.on("presenter_rejected", event => toast(event.message || "Presenter permission required."));
    socket?.on("active_slide_changed", event => {
      const target = targets.find(item => item.kind === "slide" && item.slideId === event.slideId);
      if (!target) return;
      activeTargetId = target.id;
      document.querySelectorAll(".controller-target-card").forEach(card => card.classList.toggle("active", card.dataset.targetId === target.id));
      renderTeachingBackdrop(target);
      $("#previewTitle").textContent = target.title;
      $("#previewStage").innerHTML = target.src ? `<img src="${escapeHtml(target.src)}" alt="">` : `<span>${escapeHtml(target.title)}</span>`;
    });
    socket?.on("presentation_updated", event => {
      if (event.presentationId !== presentationId || !event.presentation) return;
      presentation = event.presentation;
      if (event.activeSlideId) activeTargetId = `slide:${event.activeSlideId}`;
      renderControllerTargets();
    });
    socket?.on("presentation_deleted", event => {
      if (event.presentationId !== presentationId) return;
      stopLoop();
      $("#controllerTitle").textContent = "Presentation deleted";
      $("#previewStage").textContent = "This presentation is no longer available.";
      document.querySelectorAll("button").forEach(button => { if (button.id !== "backToEditor") button.disabled = true; });
    });
  } catch (error) {
    $("#controllerTitle").textContent = "Controller unavailable";
    $("#previewStage").textContent = error.message;
  }
})();
