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

  function escapeHtml(value) { return String(value || "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char])); }
  function toast(message) { const node = $("#toast"); node.textContent = message; node.classList.add("show"); clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove("show"), 2600); }
  function credentials() { return { presentationId, authToken, shareToken }; }
  function setConnectionStatus(label) { $("#connectionStatus").innerHTML = `<i></i> ${label}`; }

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

  try {
    const result = await api.getPresentation(presentationId, shareToken);
    if (result.permission !== "presenter") throw new Error("A trusted presenter link is required for this controller.");
    presentation = result.presentation;
    $("#backToEditor").href = `/builder.html?id=${encodeURIComponent(presentation.id)}`;
    renderControllerTargets();
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
