const api = window.PresentStudioApi;
const params = new URLSearchParams(location.search);
const presentationId = params.get("id") || "pres_demo";
const shareToken = params.get("token") || "";
const authToken = localStorage.getItem("presentStudio.accessToken") || "";
const socket = window.io ? window.io({ reconnection: true, reconnectionAttempts: 5, reconnectionDelay: 700 }) : null;
let canvas;
const $ = (id) => document.getElementById(id);
let presentation; let permission = "viewer"; let currentSlideIndex = 0; let autoplayTimer; let mediaTimer; let mediaIndex = 0; let autoplayRunning = false; let audioEnabled = false; let screenAccessCode = ""; let liveMediaSession = null; let liveState = null; let currentOutputLabel = "";
function activeSlide() { return presentation.slides[currentSlideIndex]; }
function playback() { return presentation.slides[0]?.canvas?.presentation_playback || { mode: "manual", interval_ms: 5000, slide_ids: [], media_mode: "all", media_cycle: "all", media_interval_ms: 5000, loop_videos: true }; }
function setVisible(element, visible) { if (element) element.hidden = !visible; }
function setStatus(message) { $("presentStatus").textContent = message; }
function textObject(item) { return new fabric.Textbox(item.text || "", { left: (item.x || 0) * 12.8, top: (item.y || 0) * 7.2, width: (item.width || 40) * 12.8, fontSize: item.fontSize || 42, fontWeight: item.fontWeight || "500", fontStyle: item.fontStyle || "normal", fontFamily: item.fontFamily || "Arial", fill: item.color || "#171717", textAlign: item.textAlign || "left", selectable: false, evented: false }); }
function mediaItems(slide) {
  const config = playback();
  const legacy = (slide.canvas?.elements || []).filter(item => ["image", "video"].includes(item.type));
  const fabricVideos = (slide.canvas?.fabric?.objects || []).filter(item => item.mediaType === "video").map(item => ({
    type: "video", src: item.src, full_bleed: item.full_bleed,
    x: ((item.left || 0) / 1280) * 100, y: ((item.top || 0) / 720) * 100,
    width: (((item.width || 0) * (item.scaleX || 1)) / 1280) * 100,
    height: (((item.height || 0) * (item.scaleY || 1)) / 720) * 100,
    loop: item.loop, muted: item.muted, fit: item.fit || "contain"
  }));
  return [...legacy, ...fabricVideos].filter(item => config.media_mode === "all" || config.media_mode === `${item.type}s`);
}
function mediaMuted(authoredMuted = false) { return Boolean(authoredMuted || !audioEnabled || liveState?.muted); }
function startPresentationMedia(media) { media.play().catch(() => { media.muted = true; if (permission === "presenter") audioEnabled = false; syncAudioButton(); media.play().catch(() => {}); }); }
function renderMedia(slide) {
  const layer = $("presentMedia");
  layer.replaceChildren();
  const config = playback();
  let items = mediaItems(slide);
  if (items.length > 1 && config.media_cycle === "sequential") items = [items[mediaIndex % items.length]];
  if (items.length > 1 && config.media_cycle === "random") items = [items[Math.floor(Math.random() * items.length)]];
  items.forEach(item => {
    const node = document.createElement(item.type === "video" ? "video" : "img");
    node.src = item.src;
    node.className = `slide-media ${item.full_bleed ? "full-bleed" : ""}`;
    node.style.left = `${item.x || 0}%`;
    node.style.top = `${item.y || 0}%`;
    node.style.width = `${item.width || 100}%`;
    node.style.height = `${item.height || 100}%`;
    node.style.objectFit = item.fit || "contain";
    if (item.type === "video") {
      node.dataset.authoredMuted = String(item.muted === true);
      Object.assign(node, { autoplay: true, muted: mediaMuted(item.muted === true), loop: config.loop_videos !== false && item.loop !== false, playsInline: true, controls: permission === "presenter" && !item.full_bleed });
    }
    layer.append(node);
    if (item.type === "video") startPresentationMedia(node);
  });
  const track = slide.canvas?.audio;
  if (track?.src) {
    const audio = document.createElement("audio");
    audio.src = track.src;
    audio.dataset.slideMusic = "true";
    Object.assign(audio, { autoplay: true, muted: mediaMuted(), loop: Boolean(track.loop), playsInline: true });
    layer.append(audio);
    startPresentationMedia(audio);
  }
  const hasAudio = items.some(item => item.type === "video") || Boolean(track?.src);
  setVisible($("audioToggle"), hasAudio);
  syncAudioButton();
}
function syncAudioButton() { const button = $("audioToggle"); if (!button) return; button.textContent = audioEnabled ? "🔊 Mute audio" : "🔇 Enable audio"; button.setAttribute("aria-label", audioEnabled ? "Mute presentation audio" : "Enable presentation audio"); }
async function enablePresentationAudio() {
  audioEnabled = true;
  const attempts = [...document.querySelectorAll("#presentMedia video, #presentMedia audio")].map(media => {
    media.muted = mediaMuted(media.dataset.authoredMuted === "true");
    return media.play();
  });
  syncAudioButton();
  const results = await Promise.allSettled(attempts);
  return results.every(result => result.status === "fulfilled");
}
function toggleAudio() { audioEnabled = !audioEnabled; document.querySelectorAll("#presentMedia video, #presentMedia audio").forEach(media => { media.muted = mediaMuted(media.dataset.authoredMuted === "true"); if (audioEnabled) media.play().catch(() => { audioEnabled = false; media.muted = true; syncAudioButton(); }); }); syncAudioButton(); }
function annotationCanvases() { return [...document.querySelectorAll("[data-audience-annotation-canvas]")]; }
function annotationTextLayers() { return [...document.querySelectorAll("[data-audience-annotation-text]")]; }
function drawAudienceAnnotation(points = [], color = "#ffd54a", size = 7) {
  if (points.length < 2) return;
  annotationCanvases().forEach(target => {
    const context = target.getContext("2d");
    context.save();
    context.strokeStyle = color;
    context.lineWidth = Number(size) || 7;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    points.forEach((point, index) => {
      const x = Math.max(0, Math.min(1, Number(point.x) || 0)) * target.width;
      const y = Math.max(0, Math.min(1, Number(point.y) || 0)) * target.height;
      if (index) context.lineTo(x, y); else context.moveTo(x, y);
    });
    context.stroke();
    context.restore();
  });
}
function addAudienceAnnotationText(payload = {}) {
  if (!payload.text) return;
  annotationTextLayers().forEach(target => {
    const label = document.createElement("span");
    label.textContent = String(payload.text).slice(0, 180);
    label.style.left = `${Math.max(0, Math.min(1, Number(payload.point?.x) || 0)) * 100}%`;
    label.style.top = `${Math.max(0, Math.min(1, Number(payload.point?.y) || 0)) * 100}%`;
    label.style.setProperty("--annotation-color", payload.color || "#ffd54a");
    label.style.setProperty("--annotation-size", `${Math.max(18, (Number(payload.size) || 7) * 3.8)}px`);
    target.append(label);
  });
}
function clearAudienceAnnotations() {
  annotationCanvases().forEach(target => target.getContext("2d").clearRect(0, 0, target.width, target.height));
  annotationTextLayers().forEach(target => target.replaceChildren());
}
function applyAudienceViewport(payload = {}) {
  const zoom = Math.max(.5, Math.min(3, Number(payload.zoom) || 1));
  const x = Math.max(-1200, Math.min(1200, Number(payload.x) || 0));
  const y = Math.max(-900, Math.min(900, Number(payload.y) || 0));
  document.querySelectorAll("#presentFrame, .live-presentation-feed-frame").forEach(view => {
    view.style.setProperty("--audience-zoom", String(zoom));
    view.style.setProperty("--audience-pan-x", `${x}px`);
    view.style.setProperty("--audience-pan-y", `${y}px`);
  });
}
function handleAudienceAnnotation(event = {}) {
  if (event.presentationId !== presentation?.id) return;
  if (event.type === "draw") drawAudienceAnnotation(event.payload?.points, event.payload?.color, event.payload?.size);
  if (event.type === "text") addAudienceAnnotationText(event.payload);
  if (event.type === "clear") clearAudienceAnnotations();
  if (event.type === "viewport") applyAudienceViewport(event.payload);
}
function animate(slide) { const frame = $("presentFrame"); const config = slide.canvas?.transition || { type: "fade", duration_ms: 500 }; frame.style.setProperty("--transition-duration", `${config.duration_ms || 500}ms`); frame.classList.remove("transition-fade", "transition-fade-left", "transition-fade-right", "transition-fade-up", "transition-fade-down", "transition-slide", "transition-push-left", "transition-push-right", "transition-push-up", "transition-push-down", "transition-morph", "transition-morph-left", "transition-morph-right", "transition-morph-up", "transition-morph-down", "transition-zoom"); if (config.type && config.type !== "none") requestAnimationFrame(() => { frame.classList.add(`transition-${config.type}`); setTimeout(() => frame.classList.remove(`transition-${config.type}`), config.duration_ms || 500); }); }
function animateObjects() { canvas.getObjects().forEach(object => { const type = object.animation || "none"; if (type === "none") return; const duration = Math.max(100, Math.min(5000, Number(object.animationDuration) || 600)); const delay = Math.max(0, Math.min(5000, Number(object.animationDelay) || 0)); const finalState = { opacity: object.opacity ?? 1, left: object.left || 0, top: object.top || 0, scaleX: object.scaleX || 1, scaleY: object.scaleY || 1 }; const startState = {}; if (type === "fade") Object.assign(startState, { opacity: 0 }); if (type === "zoom") Object.assign(startState, { opacity: 0, scaleX: finalState.scaleX * 0.78, scaleY: finalState.scaleY * 0.78 }); if (type === "fly") Object.assign(startState, { opacity: 0, left: finalState.left - 140 }); if (type === "rise") Object.assign(startState, { opacity: 0, top: finalState.top + 90 }); if (type === "wipe") Object.assign(startState, { opacity: 0, scaleX: finalState.scaleX * 0.08 }); object.set(startState); setTimeout(() => { Object.entries(finalState).forEach(([key, value]) => object.animate(key, value, { duration, easing: fabric.util.ease.easeOutCubic, onChange: canvas.renderAll.bind(canvas), onComplete: () => { object.set(finalState); canvas.requestRenderAll(); } })); }, delay); }); }
function setMediaCycle() { clearInterval(mediaTimer); mediaIndex = 0; if (permission !== "presenter") return; const config = playback(); if (["sequential", "random"].includes(config.media_cycle) && mediaItems(activeSlide()).length > 1) mediaTimer = setInterval(() => { mediaIndex += 1; renderMedia(activeSlide()); }, Number(config.media_interval_ms) || 5000); }
function sanitizeFabricScene(scene) { (scene.objects || []).forEach(object => { if (object.textBaseline === "alphabetical") object.textBaseline = "alphabetic"; }); return scene; }
function renderSlide() {
  const slide = activeSlide();
  const data = slide.canvas || {};
  $("presentFrame").dataset.slideId = slide.id;
  $("presentCanvas").hidden = false;
  $("presentFrame").dataset.kind = "slide";
  $("presentFrame").dataset.mediaId = "";
  currentOutputLabel = slide.title || presentation.title;
  canvas.clear();
  canvas.backgroundColor = data.background || "#f8f4ea";
  const done = () => { canvas.getObjects().forEach(object => { object.selectable = false; object.evented = false; }); canvas.renderAll(); animateObjects(); };
  if (data.fabric) {
    const scene = sanitizeFabricScene(JSON.parse(JSON.stringify(data.fabric)));
    scene.objects = (scene.objects || []).filter(object => object.mediaType !== "video");
    canvas.loadFromJSON(scene, done);
  } else {
    (data.elements || []).filter(item => item.type === "text").forEach(item => canvas.add(textObject(item)));
    done();
  }
  renderMedia(slide);
  setMediaCycle();
  animate(slide);
  $("slideCounter").textContent = `${currentSlideIndex + 1} / ${presentation.slides.length}`;
  setStatus(`${presentation.title} · ${permission === "presenter" ? "Live presenter" : "Live audience"}`);
}

function fabricMediaById(slide, mediaId, kind) {
  return (slide.canvas?.fabric?.objects || []).find((item, index) => item.mediaType === kind && String(item.id || index) === String(mediaId));
}

function renderDirectOutput(slide, state) {
  clearInterval(mediaTimer);
  const layer = $("presentMedia");
  layer.replaceChildren();
  canvas.clear();
  $("presentCanvas").hidden = true;
  $("presentFrame").dataset.kind = state.kind;
  $("presentFrame").dataset.mediaId = state.mediaId || "";
  const item = state.kind === "audio" ? slide.canvas?.audio : fabricMediaById(slide, state.mediaId, state.kind);
  currentOutputLabel = item?.audioName || item?.name || `${slide.title || "Slide"} · ${state.kind}`;
  if (state.kind === "audio" && item?.src) {
    const audio = document.createElement("audio");
    audio.src = item.src;
    audio.dataset.slideMusic = "true";
    Object.assign(audio, { autoplay: true, muted: mediaMuted(), loop: Boolean(item.loop), playsInline: true });
    layer.append(audio);
    startPresentationMedia(audio);
  } else if (item?.src) {
    const node = document.createElement(state.kind === "video" ? "video" : "img");
    node.src = item.src;
    node.className = "slide-media full-bleed";
    Object.assign(node.style, { left: "0", top: "0", width: "100%", height: "100%", objectFit: item.fit || "contain" });
    if (state.kind === "video") {
      node.dataset.authoredMuted = String(item.muted === true);
      Object.assign(node, { autoplay: true, muted: mediaMuted(item.muted === true), loop: item.loop !== false, playsInline: true });
    }
    layer.append(node);
    if (state.kind === "video") startPresentationMedia(node);
    if (state.kind === "image" && item.audioSrc) {
      const audio = document.createElement("audio");
      audio.src = item.audioSrc;
      audio.hidden = true;
      Object.assign(audio, { autoplay: true, muted: mediaMuted(), playsInline: true });
      layer.append(audio);
      startPresentationMedia(audio);
    }
  }
  $("slideCounter").textContent = `${currentSlideIndex + 1} / ${presentation.slides.length}`;
}

function expectedMediaPosition(state) {
  const position = Math.max(0, Number(state.position) || 0);
  return state.playing && Number.isFinite(Number(state.serverTime)) ? position + Math.max(0, Date.now() - Number(state.serverTime)) / 1000 : position;
}

function syncMediaToState(media, state) {
  const apply = () => {
    const target = expectedMediaPosition(state);
    const drift = target - (Number(media.currentTime) || 0);
    media.muted = mediaMuted(media.dataset.authoredMuted === "true");
    if (!state.playing) {
      media.pause();
      media.playbackRate = 1;
      if (Math.abs(drift) > .08) try { media.currentTime = target; } catch {}
      return;
    }
    if (Math.abs(drift) > .75) { try { media.currentTime = target; } catch {} media.playbackRate = 1; }
    else if (Math.abs(drift) > .12) media.playbackRate = drift > 0 ? 1.04 : .96;
    else media.playbackRate = 1;
    media.play().catch(() => {});
  };
  if (media.readyState >= 1) return apply();
  media._pendingPresentationState = state;
  if (media.dataset.syncMetadataPending) return;
  media.dataset.syncMetadataPending = "true";
  media.addEventListener("loadedmetadata", () => { delete media.dataset.syncMetadataPending; syncMediaToState(media, media._pendingPresentationState || state); }, { once: true });
}

function applyPresentationState(rawState, forceRender = false) {
  const state = { ...rawState, slideId: rawState?.slideId || rawState?.activeSlideId, kind: rawState?.kind || "slide" };
  if (state.presentationId && state.presentationId !== presentation.id) return;
  const found = presentation.slides.findIndex(slide => slide.id === state.slideId);
  if (found < 0) return;
  liveState = state;
  currentSlideIndex = found;
  const frame = $("presentFrame");
  if (state.kind === "blank") {
    clearInterval(mediaTimer);
    $("presentMedia").replaceChildren();
    canvas.clear();
    $("presentCanvas").hidden = true;
    frame.dataset.kind = "blank";
    frame.dataset.mediaId = "";
    currentOutputLabel = "Black screen";
    return;
  }
  const changed = forceRender || frame.dataset.slideId !== state.slideId || (frame.dataset.kind || "slide") !== state.kind || String(frame.dataset.mediaId || "") !== String(state.mediaId || "");
  frame.dataset.slideId = state.slideId;
  if (changed) {
    if (["image", "video", "audio"].includes(state.kind)) renderDirectOutput(activeSlide(), state);
    else renderSlide();
  }
  document.querySelectorAll("#presentMedia video, #presentMedia audio").forEach(media => syncMediaToState(media, state));
}
function emitSlide() { socket?.emit("slide_changed", { presentationId: presentation.id, slideId: activeSlide().id, authToken, shareToken }); }
function nextAutoplayIndex() { const config = playback(); if (config.mode === "random") return Math.floor(Math.random() * presentation.slides.length); if (config.mode === "selected") { const selected = presentation.slides.map((slide, index) => config.slide_ids.includes(slide.id) ? index : -1).filter(index => index >= 0); if (selected.length) return selected[(selected.indexOf(currentSlideIndex) + 1 + selected.length) % selected.length]; } return (currentSlideIndex + 1) % presentation.slides.length; }
function go(delta) { if (permission !== "presenter") return; currentSlideIndex = delta === 1 && autoplayRunning ? nextAutoplayIndex() : (currentSlideIndex + delta + presentation.slides.length) % presentation.slides.length; renderSlide(); emitSlide(); }
function setAutoplay(running) { const canAutoplay = permission === "presenter" && playback().mode !== "manual"; autoplayRunning = Boolean(running && canAutoplay); clearInterval(autoplayTimer); if (autoplayRunning) autoplayTimer = setInterval(() => go(1), Number(playback().interval_ms) || 5000); const button = $("autoplayToggle"); button.textContent = autoplayRunning ? "Stop auto play" : canAutoplay ? "Start auto play" : "Auto play: manual"; button.disabled = !canAutoplay; }
function showError(message) { setVisible($("presentLoading"), false); setVisible($("presentStage"), false); setVisible($("presentError"), true); $("errorMessage").textContent = message; }
async function endLive() {
  if (permission !== "presenter") return;
  liveMediaSession?.leave();
  socket?.emit("end_session", { presentationId: presentation.id, authToken, shareToken });
  if (!authToken) return;
  try { await api.endLiveSession(presentation.id); } catch (error) { showError(error.message); }
}
function setupSocket() {
  if (!socket) return;
  const joinRoom = () => socket.emit("join_presentation", { presentationId: presentation.id });
  socket.on("connect", joinRoom);
  socket.on("presentation_state", applyPresentationState);
  socket.on("presentation_annotation", handleAudienceAnnotation);
  socket.on("presentation_updated", event => {
    if (event.presentationId !== presentation.id || !event.presentation) return;
    presentation = event.presentation;
    applyPresentationState(event.liveState || liveState || { slideId: event.activeSlideId }, true);
    setAutoplay(autoplayRunning);
  });
  socket.on("presentation_deleted", event => { if (event.presentationId === presentation.id) { setAutoplay(false); liveMediaSession?.leave(); showError("This presentation has been deleted."); } });
  socket.on("presenter_rejected", event => showError(event.message || "Presenter permission required."));
  socket.on("session_ended", () => { setAutoplay(false); liveMediaSession?.leave(); showError("This live session has ended."); });
  if (socket.connected) joinRoom();
}
async function loadPresentationAccess() {
  if (!shareToken) return api.getPresentation(presentationId);
  const access = await api.getScreenAccessRequirements(presentationId, shareToken);
  if (!access.requiresCode) return api.getPresentation(presentationId, shareToken);
  const enteredCode = window.prompt("Enter the 4-digit presentation access code.", "");
  if (enteredCode === null) throw new Error("The presentation access code is required.");
  screenAccessCode = enteredCode.trim();
  if (!/^\d{4}$/.test(screenAccessCode)) throw new Error("Enter exactly four digits for the presentation access code.");
  return api.getScreenPresentation(presentationId, shareToken, screenAccessCode);
}
async function init() {
  if (!window.fabric) throw new Error("Fabric.js could not be loaded. Check the presentation's network access and reload.");
  canvas = new fabric.StaticCanvas("presentCanvas", { width: 1280, height: 720, selection: false });
  const result = await loadPresentationAccess();
  presentation = result.presentation;
  permission = result.permission || "viewer";
  if (!presentation.slides.length) throw new Error("This presentation has no slides.");
  const live = await api.getLiveSession(presentation.id);
  const presenter = permission === "presenter";
  audioEnabled = presenter;
  document.body.classList.toggle("audience-live-view", !presenter);
  setVisible($("presentControls"), presenter);
  $("presenterBadge").textContent = presenter ? "Presenter Mode" : "Audience View";
  setVisible($("presenterBadge"), presenter);
  setVisible($("presentMeta"), presenter);
  $("previousSlide").onclick = () => go(-1);
  $("nextSlide").onclick = () => go(1);
  $("autoplayToggle").onclick = () => setAutoplay(!autoplayRunning);
  $("audioToggle").onclick = toggleAudio;
  $("endLive").onclick = endLive;
  document.addEventListener("keydown", event => { if (event.key.toLowerCase() === "f" && presenter) $("fullscreenToggle").click(); if (event.key === "ArrowLeft") go(-1); if (event.key === "ArrowRight") go(1); });
  $("fullscreenToggle").onclick = () => document.fullscreenElement ? document.exitFullscreen() : $("presentStage").requestFullscreen();
  applyPresentationState(live, true);
  liveMediaSession = window.SnapKeyLiveMedia?.create({
    root: $("presentLiveMedia"), presentationId, shareToken, authToken, screenAccessCode, socket,
    displayName: api.getCachedSession()?.name || "", fullscreenTarget: presenter ? null : $("presentLiveMedia"), fullscreenOnJoin: false,
    onEnableAudio: enablePresentationAudio,
    presentationSource: { canvas: $("presentCanvas"), media: $("presentMedia"), label: () => currentOutputLabel || activeSlide()?.title || presentation.title }
  });
  setVisible($("presentLoading"), false);
  setVisible($("presentStage"), true);
  setAutoplay(playback().mode !== "manual");
  setupSocket();
}
init().catch(error => showError(error.message));
