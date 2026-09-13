(async function () {
  const api = window.PresentStudioApi;
  const params = new URLSearchParams(location.search);
  const presentationId = params.get("id") || "pres_demo";
  const shareToken = params.get("token") || "";
  const socket = window.io ? window.io({ reconnection: true }) : null;
  const mediaLayer = document.getElementById("outputMedia");
  const canvasWrap = document.getElementById("outputCanvasWrap");
  const stage = document.getElementById("outputStage");
  const audioGate = document.getElementById("audioGate");
  const codeGate = document.getElementById("codeGate");
  const codeForm = document.getElementById("codeForm");
  const codeInput = document.getElementById("screenCode");
  const codeStatus = document.getElementById("codeStatus");
  const annotationLayer = document.getElementById("liveAnnotationLayer");
  const annotationCanvas = document.getElementById("liveAnnotationCanvas");
  const annotationText = document.getElementById("liveAnnotationText");
  let presentation;
  let canvas;
  let audioUnlocked = false;
  let activeMedia = null;
  let linkedAudio = null;
  let currentState = null;

  function stopMedia() {
    if (activeMedia?.pause) activeMedia.pause();
    if (linkedAudio) linkedAudio.pause();
    activeMedia = null;
    linkedAudio = null;
  }

  function transition() {
    stage.classList.remove("output-enter");
    void stage.offsetWidth;
    stage.classList.add("output-enter");
  }

  function slideById(id) { return presentation.slides.find(slide => slide.id === id); }
  function objectById(slide, id, kind) {
    const objects = slide?.canvas?.fabric?.objects || [];
    return objects.find((object, index) => object.mediaType === kind && String(object.id || index) === String(id));
  }

  function playLinkedAudio(src, loop = false) {
    if (!src) return;
    linkedAudio = new Audio(src);
    linkedAudio.volume = 1;
    linkedAudio.loop = loop;
    linkedAudio.muted = !audioUnlocked || Boolean(currentState?.muted);
    linkedAudio.hidden = true;
    linkedAudio.dataset.slideMusic = "true";
    mediaLayer.append(linkedAudio);
    activeMedia = linkedAudio;
    linkedAudio.play().catch(() => {});
  }

  function legacyOutputText(item) {
    return new fabric.Textbox(item.text || "", {
      left: (item.x || 0) * 12.8,
      top: (item.y || 0) * 7.2,
      width: (item.width || 40) * 12.8,
      fontSize: item.fontSize || 42,
      fontWeight: item.fontWeight || "500",
      fontStyle: item.fontStyle || "normal",
      fontFamily: item.fontFamily || "Arial",
      fill: item.color || "#171717",
      textAlign: item.textAlign || "left",
      selectable: false,
      evented: false
    });
  }

  function addPositionedOutputMedia(item) {
    if (!item?.src) return;
    const node = document.createElement(item.type === "video" ? "video" : "img");
    node.src = item.src;
    node.className = "live-output-positioned-video";
    Object.assign(node.style, {
      left: `${item.full_bleed ? 0 : Number(item.x || 0)}%`,
      top: `${item.full_bleed ? 0 : Number(item.y || 0)}%`,
      width: `${item.full_bleed ? 100 : Number(item.width || 100)}%`,
      height: `${item.full_bleed ? 100 : Number(item.height || 100)}%`,
      objectFit: item.fit || (item.full_bleed ? "fill" : "contain")
    });
    if (node.tagName === "VIDEO") {
      Object.assign(node, { autoplay: true, playsInline: true, loop: item.loop !== false, muted: !audioUnlocked || Boolean(currentState?.muted) });
      activeMedia = node;
      node.play().catch(() => { node.muted = true; node.play().catch(() => {}); });
    }
    mediaLayer.append(node);
  }

  function renderDirectMedia(slide, mediaId, kind) {
    if (kind === "audio") {
      stopMedia();
      canvasWrap.hidden = true;
      mediaLayer.replaceChildren();
      const track = slide.canvas?.audio;
      if (track?.src) playLinkedAudio(track.src, Boolean(track.loop));
      stage.dataset.slideId = slide.id;
      stage.dataset.kind = kind;
      stage.dataset.mediaId = mediaId || "";
      stage.dataset.presentationTitle = presentation.title;
      transition();
      return;
    }
    const object = objectById(slide, mediaId, kind);
    if (!object?.src) return renderSlide(slide);
    stopMedia();
    canvasWrap.hidden = true;
    mediaLayer.replaceChildren();
    const node = document.createElement(kind === "video" ? "video" : "img");
    node.src = object.src;
    node.className = "live-output-item";
    if (kind === "video") {
      Object.assign(node, { autoplay: true, playsInline: true, loop: object.loop !== false, muted: !audioUnlocked || Boolean(currentState?.muted) });
      activeMedia = node;
      node.play().catch(() => { node.muted = true; node.play().catch(() => {}); });
    } else {
      playLinkedAudio(object.audioSrc);
      activeMedia = linkedAudio;
    }
    mediaLayer.append(node);
    stage.dataset.slideId = slide.id;
    stage.dataset.kind = kind;
    stage.dataset.mediaId = mediaId || "";
    stage.dataset.presentationTitle = presentation.title;
    transition();
  }

  function renderSlide(slide) {
    if (!slide) return;
    stage.dataset.slideId = slide.id;
    stage.dataset.kind = "slide";
    stage.dataset.mediaId = "";
    stage.dataset.presentationTitle = presentation.title;
    stopMedia();
    mediaLayer.replaceChildren();
    canvasWrap.hidden = false;
    const data = slide.canvas || {};
    canvas.clear();
    canvas.backgroundColor = data.background || "#f8f4ea";
    if (data.fabric) {
      const scene = JSON.parse(JSON.stringify(data.fabric));
      const videos = (scene.objects || []).filter(object => object.mediaType === "video" && object.src);
      scene.objects = (scene.objects || []).filter(object => object.mediaType !== "video");
      canvas.loadFromJSON(scene, () => { canvas.getObjects().forEach(object => { object.selectable = false; object.evented = false; }); canvas.renderAll(); });
      videos.forEach(object => {
        const video = document.createElement("video");
        video.src = object.src;
        video.className = "live-output-positioned-video";
        video.style.left = `${object.full_bleed ? 0 : ((object.left || 0) / 1280) * 100}%`;
        video.style.top = `${object.full_bleed ? 0 : ((object.top || 0) / 720) * 100}%`;
        video.style.width = `${object.full_bleed ? 100 : (((object.width || 0) * (object.scaleX || 1)) / 1280) * 100}%`;
        video.style.height = `${object.full_bleed ? 100 : (((object.height || 0) * (object.scaleY || 1)) / 720) * 100}%`;
        video.style.objectFit = object.fit || (object.full_bleed ? "fill" : "contain");
        Object.assign(video, { autoplay: true, playsInline: true, loop: object.loop !== false, muted: !audioUnlocked || Boolean(currentState?.muted) });
        mediaLayer.append(video);
        activeMedia = video;
        video.play().catch(() => { video.muted = true; video.play().catch(() => {}); });
      });
      const slideAudioSrc = data.audio?.src;
      playLinkedAudio(slideAudioSrc);
    } else {
      const elements = data.elements || [];
      elements.filter(item => item.type === "text").forEach(item => canvas.add(legacyOutputText(item)));
      elements.filter(item => ["image", "video"].includes(item.type)).forEach(addPositionedOutputMedia);
      canvas.renderAll();
      playLinkedAudio(data.audio?.src);
    }
    transition();
  }

  function joinRoom() { socket?.emit("join_presentation", { presentationId }); }

  function handlePresentationUpdate(event) {
    if (event.presentationId !== presentationId || !event.presentation) return;
    presentation = event.presentation;
    applyPresentationState(event.liveState || currentState || { slideId: event.activeSlideId }, true);
  }

  function control(action, position) {
    const mediaItems = [...mediaLayer.querySelectorAll("video,audio")];
    if (action === "stop") { stopMedia(); mediaLayer.replaceChildren(); canvasWrap.hidden = true; stage.classList.remove("output-enter"); return; }
    if (!mediaItems.length) return;
    mediaItems.forEach(media => {
      if (["play", "pause"].includes(action) && Number.isFinite(Number(position))) {
        try { if (Math.abs(media.currentTime - Number(position)) > 0.2) media.currentTime = Math.max(0, Number(position)); } catch {}
      }
      if (action === "play") media.play().catch(() => {});
      if (action === "pause") media.pause();
      if (action === "toggle") media.paused ? media.play().catch(() => {}) : media.pause();
      if (action === "replay") { try { media.currentTime = 0; } catch {} media.play().catch(() => {}); }
    });
  }

  function drawAnnotationPath(points = [], color = "#ffd54a", size = 7) {
    if (!annotationCanvas || points.length < 2) return;
    const context = annotationCanvas.getContext("2d");
    context.save();
    context.strokeStyle = color;
    context.lineWidth = Number(size) || 7;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    points.forEach((point, index) => {
      const x = Number(point.x) * annotationCanvas.width;
      const y = Number(point.y) * annotationCanvas.height;
      if (index) context.lineTo(x, y);
      else context.moveTo(x, y);
    });
    context.stroke();
    context.restore();
  }

  function addAnnotationText(payload) {
    if (!annotationText || !payload?.text) return;
    const label = document.createElement("span");
    label.textContent = String(payload.text).slice(0, 180);
    label.style.left = `${Math.max(0, Math.min(1, Number(payload.point?.x) || 0)) * 100}%`;
    label.style.top = `${Math.max(0, Math.min(1, Number(payload.point?.y) || 0)) * 100}%`;
    label.style.setProperty("--annotation-color", payload.color || "#ffd54a");
    label.style.setProperty("--annotation-size", `${Math.max(18, (Number(payload.size) || 7) * 3.8)}px`);
    annotationText.append(label);
  }

  function clearAnnotations() {
    annotationCanvas?.getContext("2d").clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);
    annotationText?.replaceChildren();
  }

  function applyLiveViewport(payload = {}) {
    const zoom = Math.max(0.5, Math.min(3, Number(payload.zoom) || 1));
    const x = Math.max(-1200, Math.min(1200, Number(payload.x) || 0));
    const y = Math.max(-900, Math.min(900, Number(payload.y) || 0));
    stage.style.setProperty("--live-zoom", String(zoom));
    stage.style.setProperty("--live-pan-x", `${x}px`);
    stage.style.setProperty("--live-pan-y", `${y}px`);
  }

  function handleAnnotation(event) {
    if (event.presentationId !== presentationId) return;
    if (event.type === "draw") drawAnnotationPath(event.payload?.points, event.payload?.color, event.payload?.size);
    if (event.type === "text") addAnnotationText(event.payload);
    if (event.type === "clear") clearAnnotations();
    if (event.type === "viewport") applyLiveViewport(event.payload);
  }

  audioGate.hidden = true;

  document.getElementById("enableScreen").addEventListener("click", async () => {
    audioUnlocked = true;
    audioGate.hidden = true;
    if (currentState) applyPresentationState(currentState, true);
    try { await document.documentElement.requestFullscreen?.(); } catch {}
  });

  codeInput?.addEventListener("input", () => {
    codeInput.value = codeInput.value.replace(/\D/g, "").slice(0, 4);
  });

  async function loadScreen(screenCode = "") {
    const [result, live] = await Promise.all([api.getScreenPresentation(presentationId, shareToken, screenCode), api.getLiveSession(presentationId)]);
    presentation = result.presentation;
    canvas = new fabric.StaticCanvas("outputCanvas", { width: 1280, height: 720, selection: false });
    if (presentation.slides.length) applyPresentationState(live, true);
    socket?.on("connect", joinRoom);
    if (socket?.connected) joinRoom();
    socket?.on("presentation_state", applyPresentationState);
    socket?.on("presentation_updated", handlePresentationUpdate);
    socket?.on("presentation_deleted", event => { if (event.presentationId === presentationId) control("stop"); });
    socket?.on("presentation_annotation", handleAnnotation);
    socket?.on("session_ended", event => { if (!event?.presentationId || event.presentationId === presentationId) control("stop"); });
    setInterval(async () => {
      try {
        const live = await api.getLiveSession(presentationId);
        applyPresentationState(live);
      } catch {}
    }, 2000);
  }

  codeForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const code = codeInput.value.trim();
    if (!/^\d{4}$/.test(code)) {
      codeStatus.textContent = "Enter exactly four digits.";
      codeInput.focus();
      return;
    }
    const button = codeForm.querySelector("button");
    button.disabled = true;
    codeStatus.textContent = "";
    try {
      await api.verifyScreenAccessCode(presentationId, shareToken, code);
      await loadScreen(code);
      codeGate.hidden = true;
      audioGate.hidden = false;
    } catch (error) {
      codeStatus.textContent = error.message || "The code was not accepted.";
      codeInput.select();
    } finally {
      button.disabled = false;
    }
  });

  try {
    const access = await api.getScreenAccessRequirements(presentationId, shareToken);
    if (access.requiresCode) {
      codeGate.hidden = false;
      codeInput.focus();
    } else {
      audioGate.hidden = false;
      await loadScreen();
    }
  } catch (error) {
    mediaLayer.replaceChildren();
    canvasWrap.hidden = true;
    codeGate.hidden = false;
    audioGate.hidden = true;
    codeInput.hidden = true;
    codeForm.querySelector("button").hidden = true;
    codeForm.querySelector("label").textContent = "Screen unavailable";
    codeStatus.textContent = error?.message || "This screen link is invalid or has expired.";
  }

  function normalizedLiveState(state = {}) {
    return { ...state, slideId: state.slideId || state.activeSlideId, kind: state.kind || "slide" };
  }

  function expectedPosition(state) {
    const position = Math.max(0, Number(state.position) || 0);
    if (!state.playing || !Number.isFinite(Number(state.serverTime))) return position;
    return position + Math.max(0, Date.now() - Number(state.serverTime)) / 1000;
  }

  function correctMediaDrift(media, state) {
    const apply = () => {
      const target = expectedPosition(state);
      const drift = target - (Number(media.currentTime) || 0);
      media.muted = !audioUnlocked || Boolean(state.muted);
      if (!state.playing) {
        media.pause();
        media.playbackRate = 1;
        if (Math.abs(drift) > 0.08) try { media.currentTime = target; } catch {}
        return;
      }
      if (Math.abs(drift) > 0.75) {
        try { media.currentTime = target; } catch {}
        media.playbackRate = 1;
      } else if (Math.abs(drift) > 0.12) {
        media.playbackRate = drift > 0 ? 1.04 : 0.96;
      } else {
        media.playbackRate = 1;
      }
      media.play().catch(() => {});
    };
    if (media.readyState >= 1) {
      apply();
      return;
    }
    media._pendingPresentationState = state;
    if (media.dataset.syncMetadataPending) return;
    media.dataset.syncMetadataPending = "true";
    media.addEventListener("loadedmetadata", () => {
      delete media.dataset.syncMetadataPending;
      correctMediaDrift(media, media._pendingPresentationState || state);
    }, { once: true });
  }

  function applyPresentationState(rawState, forceRender = false) {
    const state = normalizedLiveState(rawState);
    if (state.presentationId && state.presentationId !== presentationId) return;
    const slide = slideById(state.slideId);
    if (!slide) return;
    currentState = state;
    if (state.kind === "blank") {
      control("stop");
      stage.dataset.slideId = slide.id;
      stage.dataset.kind = "blank";
      stage.dataset.mediaId = "";
      return;
    }
    const selectionChanged = forceRender
      || stage.dataset.slideId !== slide.id
      || (stage.dataset.kind || "slide") !== state.kind
      || String(stage.dataset.mediaId || "") !== String(state.mediaId || "");
    if (selectionChanged) {
      if (["image", "video", "audio"].includes(state.kind)) renderDirectMedia(slide, state.mediaId, state.kind);
      else renderSlide(slide);
    }
    [...mediaLayer.querySelectorAll("video,audio")].forEach(media => correctMediaDrift(media, state));
  }
})();
