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
  let previewCanvas;
  let previewRenderVersion = 0;
  let slideThumbnailCanvases = [];
  let slideThumbnailRenderVersion = 0;
  let teachTool = "pen";
  let teachZoom = 1;
  let teachPan = { x: 0, y: 0 };
  let teachPointer = null;
  let previewTool = "highlighter";
  let previewToolZoom = 1;
  let previewToolPan = { x: 0, y: 0 };
  let previewToolPointer = null;
  let previewTextPoint = null;
  let previewToolbarTimer;
  let liveMediaSession = null;
  let notesReturnFocus = null;
  let previewAudioEnabled = true;
  let previewAudioManuallyMuted = false;
  let audienceAudioMuted = false;
  let restoredMediaState = null;
  let outputBlanked = false;

  function escapeHtml(value) { return String(value || "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char])); }
  function toast(message) { const node = $("#toast"); node.textContent = message; node.classList.add("show"); clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove("show"), 2600); }
  function secureAppUrl(path) { const url = new URL(path, location.origin); if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) url.protocol = "https:"; return url.href; }
  function credentials() { return { presentationId, authToken, shareToken }; }
  function setConnectionStatus(label) {
    const status = $("#connectionStatus");
    const state = label === "Live" ? "live" : label === "Connecting" ? "connecting" : label.toLowerCase().includes("backup") ? "backup" : "offline";
    status.dataset.state = state;
    status.innerHTML = `<i></i> ${label}`;
  }
  function teachPayload(type, payload = {}) { socket?.emit("annotation_event", { ...credentials(), type, payload }); }

  function setControllerMode(mode, remember = true) {
    const nextMode = mode === "interactive" ? "interactive" : "control";
    document.querySelectorAll("[data-controller-mode-view]").forEach(view => { view.hidden = view.dataset.controllerModeView !== nextMode; });
    document.querySelectorAll("[data-controller-mode-target]").forEach(button => {
      const active = button.dataset.controllerModeTarget === nextMode;
      if (button.matches("[role='tab']")) {
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-selected", String(active));
        button.tabIndex = active ? 0 : -1;
      }
    });
    document.body.dataset.controllerMode = nextMode;
    if (remember) try { sessionStorage.setItem("presentStudio.controllerMode", nextMode); } catch {}
  }

  function setLibraryPanel(panelName, remember = true) {
    const names = ["slides", "images", "videos", "audio", "loops"];
    const nextPanel = names.includes(panelName) ? panelName : "slides";
    document.querySelectorAll("[data-controller-library-panel]").forEach(panel => { panel.hidden = panel.dataset.controllerLibraryPanel !== nextPanel; });
    document.querySelectorAll("[data-controller-library-target]").forEach(button => {
      const active = button.dataset.controllerLibraryTarget === nextPanel;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    const title = { slides: "Slides", images: "Images", videos: "Videos", audio: "Audio", loops: "Media loops" }[nextPanel];
    $("#libraryPanelTitle").textContent = title;
    if (remember) try { sessionStorage.setItem("presentStudio.controllerLibraryPanel", nextPanel); } catch {}
  }

  function setControllerSidebarHidden(hidden, remember = true, moveFocus = false) {
    const layout = $("#controllerConsoleLayout");
    const sidebar = $("#controllerConsoleSidebar");
    const hideButton = $("#controllerSidebarHide");
    const restoreButton = $("#controllerSidebarRestore");
    layout.classList.toggle("is-sidebar-hidden", hidden);
    sidebar.setAttribute("aria-hidden", String(hidden));
    sidebar.inert = hidden;
    restoreButton.hidden = !hidden;
    restoreButton.setAttribute("aria-expanded", String(!hidden));
    hideButton.setAttribute("aria-expanded", String(!hidden));
    if (remember) try { sessionStorage.setItem("presentStudio.controllerSidebarHidden", hidden ? "1" : "0"); } catch {}
    if (moveFocus) (hidden ? restoreButton : hideButton).focus();
  }

  function bindControllerConsole() {
    document.querySelectorAll("[data-controller-mode-target]").forEach(button => button.addEventListener("click", () => setControllerMode(button.dataset.controllerModeTarget)));
    document.querySelectorAll("[data-controller-library-target]").forEach(button => button.addEventListener("click", () => setLibraryPanel(button.dataset.controllerLibraryTarget)));
    document.querySelectorAll("[role='tablist']").forEach(tabList => tabList.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const tabs = [...tabList.querySelectorAll("[role='tab']")];
      const current = Math.max(0, tabs.indexOf(document.activeElement));
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next]?.focus();
      tabs[next]?.click();
      event.preventDefault();
    }));
    let initialMode = "control";
    let initialPanel = "slides";
    let sidebarHidden = false;
    try {
      initialMode = sessionStorage.getItem("presentStudio.controllerMode") || initialMode;
      initialPanel = sessionStorage.getItem("presentStudio.controllerLibraryPanel") || initialPanel;
      sidebarHidden = sessionStorage.getItem("presentStudio.controllerSidebarHidden") === "1";
    } catch {}
    $("#controllerSidebarHide").addEventListener("click", () => setControllerSidebarHidden(true, true, true));
    $("#controllerSidebarRestore").addEventListener("click", () => setControllerSidebarHidden(false, true, true));
    setControllerSidebarHidden(sidebarHidden, false);
    setLibraryPanel(initialPanel, false);
    setControllerMode(initialMode, false);
  }

  function setPreviewDockMinimized(minimized) {
    const panel = $("#controllerPreviewPanel");
    const button = $("#previewMinimize");
    panel.classList.toggle("is-minimized", minimized);
    panel.closest(".controller-console-preview")?.classList.toggle("is-preview-minimized", minimized);
    button.setAttribute("aria-expanded", String(!minimized));
    button.setAttribute("aria-label", minimized ? "Restore preview dock" : "Minimize preview dock");
    button.title = minimized ? "Restore preview dock" : "Minimize preview dock";
    button.querySelector("[data-preview-minimize-icon]").textContent = minimized ? "□" : "—";
    button.querySelector("[data-preview-minimize-label]").textContent = minimized ? "Restore" : "Minimize";
    try { sessionStorage.setItem("presentStudio.controllerPreviewMinimized", minimized ? "1" : "0"); } catch {}
  }

  function bindPreviewDock() {
    const panel = $("#controllerPreviewPanel");
    const stage = $("#previewStage");
    const minimizeButton = $("#previewMinimize");
    const fullscreenButton = $("#previewFullscreen");
    let minimized = false;
    try { minimized = sessionStorage.getItem("presentStudio.controllerPreviewMinimized") === "1"; } catch {}
    setPreviewDockMinimized(minimized);
    minimizeButton.onclick = () => setPreviewDockMinimized(!panel.classList.contains("is-minimized"));
    fullscreenButton.onclick = () => {
      if (document.fullscreenElement === stage) document.exitFullscreen?.().catch(() => {});
      else stage.requestFullscreen?.().catch(error => toast(error.message || "Fullscreen was blocked."));
    };
    document.addEventListener("fullscreenchange", () => {
      const active = document.fullscreenElement === stage;
      fullscreenButton.setAttribute("aria-label", active ? "Exit preview fullscreen" : "Open preview in fullscreen");
      fullscreenButton.title = active ? "Exit preview fullscreen" : "Open preview in fullscreen";
      fullscreenButton.querySelector("[aria-hidden='true']").textContent = active ? "×" : "⛶";
      fullscreenButton.querySelector("[data-preview-fullscreen-label]").textContent = active ? "Exit" : "Fullscreen";
      if (!active) {
        clearTimeout(previewToolbarTimer);
        $("#previewFullscreenTools").classList.remove("is-visible");
        closePreviewTextEditor();
        stage.classList.remove("is-preview-grabbing");
        previewToolPointer = null;
        if (previewToolZoom !== 1 || previewToolPan.x || previewToolPan.y) {
          previewToolZoom = 1;
          previewToolPan = { x: 0, y: 0 };
          applyPreviewToolViewport();
        }
      }
    });
    document.addEventListener("keydown", event => {
      if (document.fullscreenElement !== stage || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      if (event.target.closest?.("input, select, textarea, [contenteditable='true']") || !$("#previewTextEditor").hidden) return;
      selectAdjacentSlide(event.key === "ArrowRight" ? 1 : -1);
      event.preventDefault();
    });
    bindFullscreenPreviewTools();
  }

  function previewHighlighterColor() {
    const value = $("#previewToolColor").value || "#ffd54a";
    const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
    if (!match) return "rgba(255, 213, 74, .38)";
    return `rgba(${parseInt(match[1], 16)}, ${parseInt(match[2], 16)}, ${parseInt(match[3], 16)}, .38)`;
  }

  function previewToolPoint(event) {
    const bounds = $("#controllerPreviewVisual").getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) return null;
    return {
      x: (event.clientX - bounds.left) / bounds.width,
      y: (event.clientY - bounds.top) / bounds.height
    };
  }

  function drawPreviewToolPath(points, color, size) {
    if (points.length < 2) return;
    const canvas = $("#previewAnnotationCanvas");
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

  function addPreviewToolText(text, point, color, size) {
    const label = document.createElement("span");
    label.textContent = text;
    label.style.left = `${point.x * 100}%`;
    label.style.top = `${point.y * 100}%`;
    label.style.setProperty("--annotation-color", color);
    label.style.setProperty("--annotation-size", `${Math.max(18, size * 3.8)}px`);
    $("#previewAnnotationText").append(label);
  }

  function openPreviewTextEditor(point) {
    previewTextPoint = point;
    const editor = $("#previewTextEditor");
    const input = $("#previewTextInput");
    input.value = "";
    editor.hidden = false;
    requestAnimationFrame(() => input.focus());
  }

  function closePreviewTextEditor() {
    previewTextPoint = null;
    $("#previewTextEditor").hidden = true;
  }

  function clearPreviewToolAnnotations(send = true) {
    const canvas = $("#previewAnnotationCanvas");
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    $("#previewAnnotationText").replaceChildren();
    if (send) teachPayload("clear");
  }

  function applyPreviewToolViewport(send = true) {
    const visual = $("#controllerPreviewVisual");
    visual.style.setProperty("--preview-zoom", String(previewToolZoom));
    visual.style.setProperty("--preview-pan-x", `${previewToolPan.x}px`);
    visual.style.setProperty("--preview-pan-y", `${previewToolPan.y}px`);
    $("#previewZoomValue").textContent = `${Math.round(previewToolZoom * 100)}%`;
    if (send) teachPayload("viewport", { zoom: previewToolZoom, x: previewToolPan.x, y: previewToolPan.y });
  }

  function setPreviewTool(tool) {
    previewTool = tool;
    document.querySelectorAll("[data-preview-tool]").forEach(button => {
      const active = button.dataset.previewTool === tool;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    const stage = $("#previewStage");
    stage.classList.toggle("is-preview-highlighting", tool === "highlighter");
    stage.classList.toggle("is-preview-panning", tool === "pan");
  }

  function showPreviewToolbar() {
    const stage = $("#previewStage");
    const toolbar = $("#previewFullscreenTools");
    if (document.fullscreenElement !== stage) return;
    toolbar.classList.add("is-visible");
    clearTimeout(previewToolbarTimer);
    previewToolbarTimer = setTimeout(() => {
      if (!toolbar.matches(":focus-within")) toolbar.classList.remove("is-visible");
    }, 2400);
  }

  function bindFullscreenPreviewTools() {
    const stage = $("#previewStage");
    const toolbar = $("#previewFullscreenTools");
    const color = () => $("#previewToolColor").value || "#ffd54a";
    const size = () => Number($("#previewToolSize").value) || 18;
    document.querySelectorAll("[data-preview-tool]").forEach(button => button.onclick = () => setPreviewTool(button.dataset.previewTool));
    $("#previewZoomOut").onclick = () => { previewToolZoom = Math.max(.5, previewToolZoom - .1); applyPreviewToolViewport(); };
    $("#previewZoomIn").onclick = () => { previewToolZoom = Math.min(3, previewToolZoom + .1); applyPreviewToolViewport(); };
    $("#previewResetView").onclick = () => { previewToolZoom = 1; previewToolPan = { x: 0, y: 0 }; applyPreviewToolViewport(); };
    $("#previewClearAnnotations").onclick = () => clearPreviewToolAnnotations(true);
    $("#previewTextCancel").onclick = closePreviewTextEditor;
    $("#previewTextEditor").onsubmit = event => {
      event.preventDefault();
      const value = $("#previewTextInput").value.trim();
      if (!value || !previewTextPoint) return;
      const payload = { text: value.slice(0, 180), point: previewTextPoint, color: color(), size: size() };
      addPreviewToolText(payload.text, payload.point, payload.color, payload.size);
      teachPayload("text", payload);
      closePreviewTextEditor();
    };
    toolbar.addEventListener("pointerenter", showPreviewToolbar);
    toolbar.addEventListener("focusin", showPreviewToolbar);
    stage.addEventListener("pointerdown", showPreviewToolbar, { passive: true });
    stage.addEventListener("touchstart", showPreviewToolbar, { passive: true });
    stage.addEventListener("pointermove", event => {
      if (document.fullscreenElement !== stage) return;
      showPreviewToolbar();
      if (!previewToolPointer || previewToolPointer.id !== event.pointerId) return;
      if (previewTool === "pan") {
        previewToolPan = {
          x: previewToolPointer.pan.x + event.clientX - previewToolPointer.startX,
          y: previewToolPointer.pan.y + event.clientY - previewToolPointer.startY
        };
        applyPreviewToolViewport();
        return;
      }
      const point = previewToolPoint(event);
      if (!point) return;
      const previous = previewToolPointer.points.at(-1);
      previewToolPointer.points.push(point);
      drawPreviewToolPath([previous, point], previewHighlighterColor(), size());
    });
    stage.addEventListener("pointerdown", event => {
      if (document.fullscreenElement !== stage || event.button !== 0 || event.target.closest("#previewFullscreenTools, #previewTextEditor")) return;
      const point = previewToolPoint(event);
      if (previewTool !== "pan" && !point) return;
      if (previewTool === "text") {
        openPreviewTextEditor(point);
        return;
      }
      previewToolPointer = { id: event.pointerId, startX: event.clientX, startY: event.clientY, pan: { ...previewToolPan }, points: point ? [point] : [] };
      stage.setPointerCapture(event.pointerId);
      stage.classList.toggle("is-preview-grabbing", previewTool === "pan");
      event.preventDefault();
    });
    const finishPointer = event => {
      if (!previewToolPointer || previewToolPointer.id !== event.pointerId) return;
      if (previewTool === "highlighter" && previewToolPointer.points.length > 1) {
        teachPayload("draw", { points: previewToolPointer.points, color: previewHighlighterColor(), size: size() });
      }
      previewToolPointer = null;
      stage.classList.remove("is-preview-grabbing");
    };
    stage.addEventListener("pointerup", finishPointer);
    stage.addEventListener("pointercancel", finishPointer);
    setPreviewTool(previewTool);
    applyPreviewToolViewport(false);
  }

  function slideById(id) { return presentation?.slides?.find(slide => slide.id === id); }

  function openSlideNotes(slideId, trigger = null) {
    const slide = slideById(slideId);
    if (!slide) return toast("Slide notes are unavailable.");
    const panel = $("#controllerNotesPanel");
    const notes = String(slide.canvas?.notes || "").trim();
    if (trigger) notesReturnFocus = trigger;
    panel.dataset.slideId = slide.id;
    $("#controllerNotesTitle").textContent = slide.title || "Untitled slide";
    $("#controllerNotesContent").textContent = notes || "No presenter notes have been added for this slide yet.";
    $("#controllerNotesContent").classList.toggle("is-empty", !notes);
    panel.hidden = false;
    panel.closest(".controller-preview-body")?.classList.add("has-inline-notes");
    $("#previewNotes").setAttribute("aria-pressed", "true");
    if (trigger) $("#controllerNotesContent").focus();
  }

  function closeSlideNotes(restoreFocus = true) {
    const panel = $("#controllerNotesPanel");
    if (panel.hidden) return;
    panel.hidden = true;
    delete panel.dataset.slideId;
    panel.closest(".controller-preview-body")?.classList.remove("has-inline-notes");
    $("#previewNotes").setAttribute("aria-pressed", "false");
    if (restoreFocus) notesReturnFocus?.focus?.();
    notesReturnFocus = null;
  }

  function updatePreviewNotesButton(target) {
    const button = $("#previewNotes");
    const slide = target?.kind === "slide" ? slideById(target.slideId) : null;
    const isSlide = Boolean(slide);
    const hasNotes = Boolean(String(slide?.canvas?.notes || "").trim());
    button.disabled = !isSlide;
    button.dataset.slideId = isSlide ? target.slideId : "";
    button.title = isSlide ? `Open notes for ${target.title}` : "Select a slide to view notes";
    if (hasNotes) openSlideNotes(target.slideId);
    else closeSlideNotes(false);
  }

  function bindControllerNotes() {
    $("#previewNotes").addEventListener("click", event => {
      const slideId = event.currentTarget.dataset.slideId;
      if (!slideId) return;
      if (!$("#controllerNotesPanel").hidden) closeSlideNotes();
      else openSlideNotes(slideId, event.currentTarget);
    });
    $("#closeControllerNotes").addEventListener("click", closeSlideNotes);
    document.addEventListener("keydown", event => { if (event.key === "Escape" && !$("#controllerNotesPanel").hidden) closeSlideNotes(); });
  }

  function previewMediaElements() { return [...$("#controllerPreviewMedia").querySelectorAll("video,audio")]; }
  function primaryPreviewMedia() { return previewMediaElements().at(-1) || null; }
  function formatMediaTime(value) {
    const seconds = Math.max(0, Math.floor(Number(value) || 0));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}` : `${minutes}:${String(remainder).padStart(2, "0")}`;
  }

  function updatePreviewMediaState() {
    const media = primaryPreviewMedia();
    const pauseButton = $("#pauseMedia");
    const replayButton = $("#replayMedia");
    const audioButton = $("#previewAudio");
    pauseButton.disabled = !media;
    replayButton.disabled = !media;
    audioButton.disabled = !media;
    pauseButton.querySelector("strong").textContent = media && !media.paused && !media.ended ? "Pause" : "Play";
    audioButton.querySelector("strong").textContent = audienceAudioMuted ? "Enable Audio" : "Mute Audio";
    audioButton.querySelector("small").textContent = audienceAudioMuted
      ? "Audience and preview muted"
      : previewAudioEnabled ? "Audience and preview audio on" : "Audience audio on · preview muted";
    const timing = $("#previewMediaTiming");
    if (!media) timing.textContent = "No active media";
    else {
      const duration = Number.isFinite(media.duration) ? ` / ${formatMediaTime(media.duration)}` : "";
      const state = media.ended ? "Ended" : media.paused ? "Paused" : "Playing";
      timing.textContent = `${state} · ${formatMediaTime(media.currentTime)}${duration}`;
    }
  }

  function monitorPreviewMedia(media, autoplay = true) {
    media.muted = !previewAudioEnabled;
    ["loadedmetadata", "timeupdate", "play", "pause", "ended", "volumechange"].forEach(eventName => media.addEventListener(eventName, updatePreviewMediaState));
    if (autoplay) media.play().catch(() => {
      media.muted = true;
      previewAudioEnabled = false;
      updatePreviewMediaState();
      media.play().catch(() => {});
    });
    updatePreviewMediaState();
    return media;
  }

  function addPreviewAudio(src) {
    if (!src) return null;
    const audio = document.createElement("audio");
    audio.src = src;
    audio.preload = "auto";
    audio.hidden = true;
    $("#controllerPreviewMedia").append(audio);
    return monitorPreviewMedia(audio);
  }

  function setPreviewMediaPosition(media, position) {
    if (!Number.isFinite(position) || !media.seekable) return;
    try { if (Math.abs(media.currentTime - position) > 0.2) media.currentTime = Math.max(0, position); } catch {}
  }

  function projectedMediaPosition(state) {
    const position = Math.max(0, Number(state?.position) || 0);
    if (!state?.playing || !Number.isFinite(Number(state.serverTime))) return position;
    return position + Math.max(0, Date.now() - Number(state.serverTime)) / 1000;
  }

  function applyRestoredMediaState(state) {
    restoredMediaState = state;
    audienceAudioMuted = Boolean(state?.muted);
    previewAudioEnabled = !audienceAudioMuted;
    previewAudioManuallyMuted = audienceAudioMuted;
    const apply = media => {
      setPreviewMediaPosition(media, projectedMediaPosition(state));
      media.muted = !previewAudioEnabled;
      if (state?.playing) media.play().catch(() => {});
      else media.pause();
      updatePreviewMediaState();
    };
    previewMediaElements().forEach(media => {
      if (media.readyState >= 1) apply(media);
      else media.addEventListener("loadedmetadata", () => apply(media), { once: true });
    });
  }

  function controllerStatePayload() {
    const target = targets.find(item => item.id === activeTargetId);
    if (!target) return null;
    const media = primaryPreviewMedia();
    const fallbackPosition = projectedMediaPosition(restoredMediaState);
    return {
      ...credentials(),
      slideId: target.slideId,
      kind: outputBlanked ? "blank" : target.kind,
      mediaId: outputBlanked ? null : (target.mediaId || null),
      position: media && media.readyState >= 1 ? Number(media.currentTime) || 0 : fallbackPosition,
      playing: !outputBlanked && (media && media.readyState >= 1 ? !media.paused && !media.ended : Boolean(restoredMediaState?.playing)),
      muted: audienceAudioMuted
    };
  }

  function emitControllerState() {
    const state = controllerStatePayload();
    if (state && socket?.connected) socket.emit("controller_state", state);
  }

  function controlPreviewMedia(action, position) {
    const mediaElements = previewMediaElements();
    mediaElements.forEach(media => {
      if (["play", "pause"].includes(action)) setPreviewMediaPosition(media, position);
      if (action === "play") { media.muted = !previewAudioEnabled; media.play().catch(() => {}); }
      if (action === "pause") media.pause();
      if (action === "toggle") media.paused ? media.play().catch(() => {}) : media.pause();
      if (action === "replay") { try { media.currentTime = 0; } catch {} media.muted = !previewAudioEnabled; media.play().catch(() => {}); }
      if (action === "stop") media.pause();
    });
    updatePreviewMediaState();
  }

  function sendMediaControl(requestedAction) {
    const media = primaryPreviewMedia();
    const action = requestedAction === "toggle" ? (media && !media.paused && !media.ended ? "pause" : "play") : requestedAction;
    const position = action === "replay" ? 0 : Number(media?.currentTime) || 0;
    if (["play", "replay"].includes(action) && !previewAudioManuallyMuted) previewAudioEnabled = true;
    restoredMediaState = {
      position,
      playing: ["play", "replay"].includes(action),
      muted: audienceAudioMuted,
      serverTime: Date.now()
    };
    controlPreviewMedia(action, position);
    emitControllerState();
    socket?.emit("media_control", { ...credentials(), action, position, legacyOnly: true });
  }

  function togglePreviewAudio() {
    audienceAudioMuted = !audienceAudioMuted;
    previewAudioEnabled = !audienceAudioMuted;
    previewAudioManuallyMuted = audienceAudioMuted;
    previewMediaElements().forEach(media => {
      media.muted = !previewAudioEnabled;
    });
    if (restoredMediaState) restoredMediaState = { ...restoredMediaState, muted: audienceAudioMuted };
    updatePreviewMediaState();
    emitControllerState();
    socket?.emit("media_control", { ...credentials(), action: "set_audio", muted: audienceAudioMuted, legacyOnly: true });
  }

  function stopPreviewMedia() {
    previewMediaElements().forEach(media => media.pause?.());
    $("#controllerPreviewMedia").replaceChildren();
    updatePreviewMediaState();
  }

  function showPreviewPlaceholder(message = "", background = "#000") {
    previewRenderVersion += 1;
    stopPreviewMedia();
    previewCanvas?.clear();
    const canvasElement = $("#controllerPreviewCanvas");
    const placeholder = $("#controllerPreviewPlaceholder");
    canvasElement.hidden = true;
    $("#previewStage").style.background = background;
    placeholder.textContent = message;
    placeholder.hidden = !message;
  }

  function legacyPreviewText(item) {
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

  function addPositionedPreviewMedia(item, fabricCoordinates = false) {
    if (!item?.src) return;
    const node = document.createElement(item.type === "video" || item.mediaType === "video" ? "video" : "img");
    node.src = item.src;
    const left = fabricCoordinates ? ((item.left || 0) / 1280) * 100 : Number(item.x || 0);
    const top = fabricCoordinates ? ((item.top || 0) / 720) * 100 : Number(item.y || 0);
    const width = fabricCoordinates ? (((item.width || 0) * (item.scaleX || 1)) / 1280) * 100 : Number(item.width || 100);
    const height = fabricCoordinates ? (((item.height || 0) * (item.scaleY || 1)) / 720) * 100 : Number(item.height || 100);
    Object.assign(node.style, {
      left: `${item.full_bleed ? 0 : left}%`,
      top: `${item.full_bleed ? 0 : top}%`,
      width: `${item.full_bleed ? 100 : width}%`,
      height: `${item.full_bleed ? 100 : height}%`,
      objectFit: item.fit || (item.full_bleed ? "fill" : "contain")
    });
    if (node.tagName === "VIDEO") {
      Object.assign(node, { autoplay: true, loop: item.loop !== false, playsInline: true });
    }
    $("#controllerPreviewMedia").append(node);
    if (node.tagName === "VIDEO") monitorPreviewMedia(node);
    return node;
  }

  function renderSlidePreview(slide) {
    if (!slide || !previewCanvas) return showPreviewPlaceholder("Slide unavailable");
    const version = ++previewRenderVersion;
    const data = slide.canvas || {};
    stopPreviewMedia();
    $("#controllerPreviewPlaceholder").hidden = true;
    $("#controllerPreviewCanvas").hidden = false;
    $("#previewStage").style.background = data.background || "#f8f4ea";
    previewCanvas.clear();
    previewCanvas.backgroundColor = data.background || "#f8f4ea";

    const finish = () => {
      if (version !== previewRenderVersion) return;
      previewCanvas.getObjects().forEach(object => { object.selectable = false; object.evented = false; });
      previewCanvas.backgroundColor = data.background || previewCanvas.backgroundColor || "#f8f4ea";
      previewCanvas.renderAll();
    };

    if (data.fabric) {
      const scene = JSON.parse(JSON.stringify(data.fabric));
      const videos = (scene.objects || []).filter(object => object.mediaType === "video" && object.src);
      scene.objects = (scene.objects || []).filter(object => object.mediaType !== "video");
      previewCanvas.loadFromJSON(scene, finish);
      videos.forEach(video => addPositionedPreviewMedia(video, true));
    } else {
      const elements = data.elements || [];
      elements.filter(item => item.type === "text").forEach(item => previewCanvas.add(legacyPreviewText(item)));
      elements.filter(item => ["image", "video"].includes(item.type)).forEach(item => addPositionedPreviewMedia(item));
      finish();
    }
    if (data.audio?.src) addPreviewAudio(data.audio.src);
  }

  function renderTargetPreview(target) {
    updatePreviewNotesButton(target);
    if (!target) return showPreviewPlaceholder("Waiting for a selection");
    $("#previewTitle").textContent = target.title;
    if (target.kind === "slide") return renderSlidePreview(slideById(target.slideId));
    showPreviewPlaceholder("");
    const mediaLayer = $("#controllerPreviewMedia");
    if (target.kind === "audio") {
      const audio = document.createElement("audio");
      audio.src = target.src;
      audio.controls = true;
      mediaLayer.append(audio);
      monitorPreviewMedia(audio);
      return;
    }
    if (!target.src) return showPreviewPlaceholder(target.title);
    const node = document.createElement(target.kind === "video" ? "video" : "img");
    node.src = target.src;
    node.className = "controller-preview-direct";
    if (target.kind === "video") Object.assign(node, { autoplay: true, loop: target.loop !== false, playsInline: true });
    mediaLayer.append(node);
    if (target.kind === "video") monitorPreviewMedia(node);
    if (target.kind === "image" && target.audioSrc) addPreviewAudio(target.audioSrc);
  }

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
          audioSrc: object.audioSrc || "",
          loop: object.loop !== false
        });
      });
    });
    return result;
  }

  function targetForLiveState(state) {
    const slideId = state?.slideId || state?.activeSlideId;
    if (!slideId) return null;
    if (state?.kind && !["slide", "blank"].includes(state.kind)) {
      const mediaTarget = targets.find(target => target.slideId === slideId && target.kind === state.kind && String(target.mediaId) === String(state.mediaId));
      if (mediaTarget) return mediaTarget;
    }
    return targets.find(target => target.kind === "slide" && target.slideId === slideId) || null;
  }

  function cardMarkup(target) {
    const visual = target.kind === "slide"
      ? `<canvas width="320" height="180" data-slide-thumbnail="${escapeHtml(target.slideId)}" aria-label="Preview of ${escapeHtml(target.title)}"></canvas>`
      : target.kind === "audio"
        ? '<span class="controller-slide-number">♫</span>'
        : target.src
          ? (target.kind === "video" ? `<video src="${escapeHtml(target.src)}" muted preload="metadata"></video><span class="controller-play-mark">▶</span>` : `<img src="${escapeHtml(target.src)}" alt="">`)
          : `<span class="controller-slide-number">${escapeHtml(target.title.slice(0, 2))}</span>`;
    const card = `<button class="controller-target-card" type="button" data-target-id="${escapeHtml(target.id)}"><span class="controller-target-thumb">${visual}</span><span><strong>${escapeHtml(target.title)}</strong><small>${target.kind}${target.audioSrc ? " · linked audio" : ""}</small></span></button>`;
    if (target.kind !== "slide") return card;
    const hasNotes = Boolean(String(slideById(target.slideId)?.canvas?.notes || "").trim());
    return `<article class="controller-target-item">${card}<button class="controller-target-notes${hasNotes ? " has-notes" : ""}" type="button" data-controller-slide-notes="${escapeHtml(target.slideId)}" aria-label="Open notes for ${escapeHtml(target.title)}"><span aria-hidden="true">▤</span><strong>Notes</strong><small>${hasNotes ? "View speaker notes" : "No notes added"}</small></button></article>`;
  }

  function renderSlideTargetPreviews() {
    const version = ++slideThumbnailRenderVersion;
    slideThumbnailCanvases.forEach(item => item.dispose());
    slideThumbnailCanvases = [];
    document.querySelectorAll("[data-slide-thumbnail]").forEach(canvasElement => {
      const slide = slideById(canvasElement.dataset.slideThumbnail);
      if (!slide) return;
      const data = slide.canvas || {};
      const thumbnail = new fabric.StaticCanvas(canvasElement, {
        width: 320,
        height: 180,
        selection: false,
        renderOnAddRemove: false
      });
      slideThumbnailCanvases.push(thumbnail);
      const finish = () => {
        if (version !== slideThumbnailRenderVersion || !slideThumbnailCanvases.includes(thumbnail)) return;
        thumbnail.getObjects().forEach(object => { object.selectable = false; object.evented = false; });
        thumbnail.backgroundColor = data.background || "#f8f4ea";
        thumbnail.setViewportTransform([0.25, 0, 0, 0.25, 0, 0]);
        thumbnail.renderAll();
      };
      thumbnail.backgroundColor = data.background || "#f8f4ea";
      if (data.fabric) {
        const scene = JSON.parse(JSON.stringify(data.fabric));
        scene.objects = (scene.objects || []).filter(object => object.mediaType !== "video");
        thumbnail.loadFromJSON(scene, finish);
      } else {
        (data.elements || []).filter(item => item.type === "text").forEach(item => thumbnail.add(legacyPreviewText(item)));
        finish();
      }
    });
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
    document.querySelectorAll("[data-controller-slide-notes]").forEach(button => button.addEventListener("click", () => openSlideNotes(button.dataset.controllerSlideNotes, button)));
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
    renderSlideTargetPreviews();
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
    restoredMediaState = null;
    outputBlanked = false;
    document.querySelectorAll(".controller-target-card").forEach(card => card.classList.toggle("active", card.dataset.targetId === target.id));
    renderTeachingBackdrop(target);
    renderTargetPreview(target);
    restoredMediaState = {
      position: 0,
      playing: Boolean(previewMediaElements().length),
      muted: audienceAudioMuted,
      serverTime: Date.now()
    };
    if (socket?.connected) setTimeout(emitControllerState, 0);
    else persistSlide(target);
  }

  function selectAdjacentSlide(direction) {
    const slides = targets.filter(target => target.kind === "slide");
    if (!slides.length) return;
    const active = targets.find(target => target.id === activeTargetId);
    const currentIndex = Math.max(0, slides.findIndex(target => target.id === activeTargetId || target.slideId === active?.slideId));
    const nextIndex = (currentIndex + direction + slides.length) % slides.length;
    selectTarget(slides[nextIndex]);
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

  bindControllerConsole();
  bindPreviewDock();
  bindControllerNotes();

  try {
    if (!window.fabric) throw new Error("The slide preview library could not be loaded.");
    const [result, live] = await Promise.all([
      api.getPresentation(presentationId, shareToken),
      api.getLiveSession(presentationId).catch(() => ({ activeSlideId: "" }))
    ]);
    if (result.permission !== "presenter") throw new Error("A trusted presenter link is required for this controller.");
    presentation = result.presentation;
    liveMediaSession = window.SnapKeyLiveMedia?.create({
      root: $("#controllerLiveMedia"),
      presentationId,
      shareToken,
      displayName: api.getCachedSession()?.name || "Presenter",
      fullscreenTarget: $("#controllerLiveMedia"),
      fullscreenOnJoin: false,
      presentationSource: {
        canvas: $("#controllerPreviewCanvas"),
        media: $("#controllerPreviewMedia"),
        label: () => $("#previewTitle").textContent || presentation.title
      }
    });
    previewCanvas = new fabric.StaticCanvas("controllerPreviewCanvas", { width: 1280, height: 720, selection: false, renderOnAddRemove: false });
    $("#backToEditor").href = `/builder.html?id=${encodeURIComponent(presentation.id)}`;
    renderControllerTargets();
    const initialTarget = targetForLiveState(live) || targets.find(target => target.kind === "slide");
    if (initialTarget) {
      activeTargetId = initialTarget.id;
      document.querySelector(`[data-target-id="${CSS.escape(activeTargetId)}"]`)?.classList.add("active");
      outputBlanked = live.kind === "blank";
      renderTargetPreview(initialTarget);
      renderTeachingBackdrop(initialTarget);
      if (outputBlanked) showPreviewPlaceholder("Black screen");
      else applyRestoredMediaState({ ...live, slideId: live.activeSlideId });
    }
    bindTeachingMode();
    $("#startImageLoop").onclick = () => startLoop("image", "#imageLoopList");
    $("#startVideoLoop").onclick = () => startLoop("video", "#videoLoopList");
    $("#stopLoop").onclick = stopLoop;
    $("#pauseMedia").onclick = () => sendMediaControl("toggle");
    $("#previewAudio").onclick = togglePreviewAudio;
    $("#replayMedia").onclick = () => sendMediaControl("replay");
    $("#stopMedia").onclick = () => {
      stopLoop();
      outputBlanked = true;
      restoredMediaState = null;
      $("#previewTitle").textContent = "Screen cleared";
      showPreviewPlaceholder("Black screen");
      emitControllerState();
      socket?.emit("media_control", { ...credentials(), action: "stop", position: 0, legacyOnly: true });
    };
    $("#openScreen").onclick = async () => {
      if (shareToken) {
        window.open(secureAppUrl(`/screen.html?id=${encodeURIComponent(presentation.id)}&token=${encodeURIComponent(shareToken)}`), "_blank", "noopener");
        return;
      }
      const screenCode = window.prompt("Choose a 4-digit code for the presentation screen.", "");
      if (screenCode === null) return;
      if (!/^\d{4}$/.test(screenCode.trim())) {
        toast("Enter exactly four digits for the screen code.");
        return;
      }
      try {
        const link = await api.createShareLink(presentation.id, "viewer", screenCode.trim());
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
    socket?.on("presentation_updated", event => {
      if (event.presentationId !== presentationId || !event.presentation) return;
      const previousState = controllerStatePayload();
      presentation = event.presentation;
      renderControllerTargets();
      const currentTarget = targets.find(target => target.id === activeTargetId) || targetForLiveState(previousState) || targets.find(target => target.kind === "slide");
      if (currentTarget) {
        activeTargetId = currentTarget.id;
        renderTargetPreview(currentTarget);
        renderTeachingBackdrop(currentTarget);
        if (outputBlanked) showPreviewPlaceholder("Black screen");
        else if (previousState) applyRestoredMediaState({ ...previousState, serverTime: Date.now() });
        emitControllerState();
      }
    });
    socket?.on("presentation_deleted", event => {
      if (event.presentationId !== presentationId) return;
      stopLoop();
      liveMediaSession?.leave();
      $("#controllerTitle").textContent = "Presentation deleted";
      showPreviewPlaceholder("This presentation is no longer available.");
      document.querySelectorAll("button").forEach(button => { if (button.id !== "backToEditor") button.disabled = true; });
    });
    setInterval(emitControllerState, 1000);
  } catch (error) {
    $("#controllerTitle").textContent = "Controller unavailable";
    showPreviewPlaceholder(error.message);
  }
})();
