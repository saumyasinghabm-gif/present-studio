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
  let loopTimer = null;
  let loopRunning = false;
  let loopGeneration = 0;
  let loopKind = "";
  let activeTargetId = "";
  let previewCanvas;
  let previewRenderVersion = 0;
  let slideThumbnailCanvases = [];
  let slideThumbnailRenderVersion = 0;
  let previewTool = "highlighter";
  let previewToolZoom = 1;
  let previewToolPan = { x: 0, y: 0 };
  let previewToolPointer = null;
  let previewTextPoint = null;
  let previewToolbarTimer;
  let interactiveToolZoom = 1;
  let interactiveToolPan = { x: 0, y: 0 };
  let interactiveToolPointer = null;
  let interactiveTextPoint = null;
  let interactiveToolbarTimer;
  let liveMediaSession = null;
  let notesReturnFocus = null;
  let previewAudioEnabled = true;
  let previewAudioManuallyMuted = false;
  let audienceAudioMuted = false;
  let videoVolume = 1;
  let audioVolume = 1;
  let volumeEmitTimer;
  let restoredMediaState = null;
  let outputBlanked = false;
  let localRecording = null;
  let recordingUiMinimized = false;
  let recordingMiniOpen = false;
  let recordingMiniPosition = null;
  let recordingMiniDragged = false;
  let localRecordingDownloadUrl = "";
  let localRecordingCleanupTimer = 0;
  let localRecordingTempCleanup = null;

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
  function annotationPayload(type, payload = {}) { socket?.emit("annotation_event", { ...credentials(), type, payload }); }

  function recordingMimeType() {
    return [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm"
    ].find(type => window.MediaRecorder?.isTypeSupported?.(type)) || "";
  }

  function recordingFilename(mimeType) {
    const safeTitle = String(presentation?.title || "meeting-recording")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "meeting-recording";
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    return `${safeTitle}-${stamp}.${mimeType.includes("mp4") ? "mp4" : "webm"}`;
  }

  function formatRecordingTime(milliseconds) {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor(totalSeconds % 3600 / 60);
    const seconds = totalSeconds % 60;
    return hours ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function setRecordingFeedback(message = "") {
    const feedback = $("#localRecordingFeedback");
    feedback.textContent = message;
    feedback.hidden = !message;
  }

  function syncRecordingTimer() {
    if (!localRecording) return;
    const pausedNow = localRecording.recorder.state === "paused" ? Date.now() - localRecording.pauseStartedAt : 0;
    const elapsed = Date.now() - localRecording.startedAt - localRecording.pausedDuration - pausedNow;
    const value = formatRecordingTime(elapsed);
    const timer = $("#localRecordingTimer");
    timer.textContent = value;
    timer.dateTime = `PT${Math.max(0, Math.floor(elapsed / 1000))}S`;
    const miniTimer = $("#localRecordingMiniTimer");
    miniTimer.textContent = value;
    miniTimer.dateTime = timer.dateTime;
  }

  function setRecordingUi(active, paused = false) {
    $("#localRecordingTitle").textContent = active ? (paused ? "Recording paused" : "Recording in progress") : "Record meeting locally";
    $("#localRecordingDialog").querySelector(".local-recording-kicker").textContent = active ? "Local recording" : "Saved only on this device";
    $("#localRecordingIntro").hidden = active;
    $("#localRecordingActions").hidden = active;
    $("#localRecordingActive").hidden = !active;
    $("#localRecordingClose").disabled = active;
    $("#localRecordingMinimize").hidden = !active;
    if (!active) recordingUiMinimized = false;
    $("#localRecordingMini").hidden = !active || !recordingUiMinimized;
    const recordButton = $("#controllerRecordButton");
    recordButton.classList.toggle("is-recording", active && !paused);
    recordButton.classList.toggle("is-paused", active && paused);
    recordButton.setAttribute("aria-label", active ? "Open local recording controls" : "Record meeting locally");
    recordButton.querySelector("[data-live-control-label]").textContent = active ? (paused ? "Paused" : "Recording") : "Record";
    if (!active) return;
    $("#localRecordingState").textContent = paused ? "Recording paused" : "Recording";
    $("#localRecordingPause").textContent = paused ? "Resume" : "Pause";
    $("#localRecordingDialog").classList.toggle("is-paused", paused);
    $("#localRecordingMini").classList.toggle("is-paused", paused);
    $("#localRecordingMiniState").textContent = paused ? "Paused" : "Recording";
    $("#localRecordingMiniHint").textContent = paused ? "Recording is paused." : "Recording locally on this device.";
    $("#localRecordingMiniPause").textContent = paused ? "▶" : "‖";
    $("#localRecordingMiniPause").setAttribute("aria-label", paused ? "Resume recording" : "Pause recording");
    $("#localRecordingMiniPause").title = paused ? "Resume recording" : "Pause recording";
  }

  function setRecordingMiniOpen(open) {
    recordingMiniOpen = Boolean(open);
    $("#localRecordingMini").classList.toggle("is-open", recordingMiniOpen);
    $("#localRecordingMiniPanel").hidden = !recordingMiniOpen;
    $("#localRecordingMiniToggle").setAttribute("aria-expanded", String(recordingMiniOpen));
    $("#localRecordingMiniToggle").setAttribute("aria-label", recordingMiniOpen ? "Close recording controls" : "Open recording controls");
  }

  function applyRecordingMiniPosition(x, y) {
    const mini = $("#localRecordingMini");
    const rect = mini.getBoundingClientRect();
    const margin = 8;
    const maxX = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxY = Math.max(margin, window.innerHeight - rect.height - margin);
    const nextX = Math.min(Math.max(margin, x), maxX);
    const nextY = Math.min(Math.max(margin, y), maxY);
    recordingMiniPosition = { x: nextX, y: nextY };
    mini.style.left = `${nextX}px`;
    mini.style.top = `${nextY}px`;
    mini.style.right = "auto";
    mini.style.bottom = "auto";
    mini.classList.toggle("is-near-right", nextX > window.innerWidth / 2);
    mini.classList.toggle("is-near-bottom", nextY > window.innerHeight / 2);
  }

  function syncRecordingMiniPosition() {
    const mini = $("#localRecordingMini");
    if (!mini || mini.hidden) return;
    if (recordingMiniPosition) {
      applyRecordingMiniPosition(recordingMiniPosition.x, recordingMiniPosition.y);
      return;
    }
    requestAnimationFrame(() => {
      const rect = mini.getBoundingClientRect();
      applyRecordingMiniPosition(window.innerWidth - rect.width - 18, window.innerHeight - rect.height - 96);
    });
  }

  function setRecordingMinimized(minimized) {
    if (!localRecording || localRecording.finishing) return;
    const dialog = $("#localRecordingDialog");
    recordingUiMinimized = Boolean(minimized);
    setRecordingUi(true, localRecording.recorder.state === "paused");
    if (recordingUiMinimized) {
      if (dialog.open) dialog.close();
      setRecordingMiniOpen(false);
      syncRecordingMiniPosition();
      $("#localRecordingMiniToggle").focus();
    } else {
      $("#localRecordingMini").hidden = true;
      setRecordingMiniOpen(false);
      if (!dialog.open) dialog.showModal();
      $("#localRecordingPause").focus();
    }
  }

  async function createRecordingSink(mimeType) {
    if (!navigator.storage?.getDirectory) return null;
    try {
      const root = await navigator.storage.getDirectory();
      const extension = mimeType.includes("mp4") ? "mp4" : "webm";
      const id = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const name = `present-studio-recording-${id}.${extension}`;
      const handle = await root.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      return { root, name, handle, writable, writeChain: Promise.resolve() };
    } catch {
      return null;
    }
  }

  function releaseRecordingDownloadUrl(cleanTemporaryFile = false) {
    if (localRecordingCleanupTimer) {
      clearTimeout(localRecordingCleanupTimer);
      localRecordingCleanupTimer = 0;
    }
    if (localRecordingDownloadUrl) {
      URL.revokeObjectURL(localRecordingDownloadUrl);
      localRecordingDownloadUrl = "";
    }
    if (cleanTemporaryFile && localRecordingTempCleanup) {
      localRecordingTempCleanup();
      localRecordingTempCleanup = null;
    }
  }

  function downloadRecording(blob) {
    releaseRecordingDownloadUrl(true);
    localRecordingDownloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = localRecordingDownloadUrl;
    link.download = recordingFilename(blob.type);
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
  }

  async function finishLocalRecording({ download = true } = {}) {
    const session = localRecording;
    if (!session || session.finishing) return;
    session.finishing = true;
    clearInterval(session.timerInterval);
    if (session.recorder.state !== "inactive") session.recorder.stop();
    await session.stopped;
    session.displayStream.getTracks().forEach(track => track.stop());
    session.recordingStream.getTracks().forEach(track => {
      if (!session.displayStream.getTracks().includes(track)) track.stop();
    });
    await session.audioContext?.close().catch(() => {});
    let recordingBlob = null;
    try {
      if (session.sink) {
        await session.sink.writeChain;
        await session.sink.writable.close();
        recordingBlob = await session.sink.handle.getFile();
      } else if (session.chunks.length) {
        recordingBlob = new Blob(session.chunks, { type: session.mimeType });
      }
    } catch (error) {
      download = false;
      if (session.sink?.writable.abort) await session.sink.writable.abort().catch(() => {});
      setRecordingFeedback(error?.message || "The recording could not be finalized on this device.");
    }
    localRecording = null;
    document.body.removeAttribute("data-local-recording");
    setRecordingUi(false);
    setRecordingMiniOpen(false);
    if ($("#localRecordingDialog").open) $("#localRecordingDialog").close();
    if (download && recordingBlob?.size) {
      downloadRecording(recordingBlob, session.mimeType);
      toast("Recording finished. Your local download has started.");
    }
    if (session.sink) {
      localRecordingTempCleanup = () => session.sink.root.removeEntry(session.sink.name).catch(() => {});
      localRecordingCleanupTimer = setTimeout(() => {
        releaseRecordingDownloadUrl(true);
      }, 10 * 60 * 1000);
    }
  }

  async function startLocalRecording() {
    if (localRecording) return;
    setRecordingFeedback("");
    if (!navigator.mediaDevices?.getDisplayMedia || !window.MediaRecorder) {
      setRecordingFeedback("Local recording is not supported in this browser. Use the latest Chrome or Edge.");
      return;
    }
    $("#localRecordingStart").disabled = true;
    $("#localRecordingDialog").close();
    let displayStream;
    try {
      displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "browser", width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 30 } },
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        preferCurrentTab: true,
        selfBrowserSurface: "include",
        surfaceSwitching: "exclude",
        systemAudio: "include"
      });
    } catch (error) {
      $("#localRecordingStart").disabled = false;
      if (error?.name !== "NotAllowedError" && error?.name !== "AbortError") {
        setRecordingFeedback(error?.message || "The browser could not start screen capture.");
        $("#localRecordingDialog").showModal();
      }
      return;
    }

    let setupAudioContext = null;
    let setupSink = null;
    try {
      const audioTracks = displayStream.getAudioTracks();
      const localMicrophoneTrack = liveMediaSession?.getLocalMicrophoneMediaTrack?.();
      let mixedAudioTrack = null;
      if (audioTracks.length || localMicrophoneTrack?.readyState === "live") {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
          setupAudioContext = new AudioContextClass();
          const destination = setupAudioContext.createMediaStreamDestination();
          audioTracks.forEach(track => setupAudioContext.createMediaStreamSource(new MediaStream([track])).connect(destination));
          if (localMicrophoneTrack?.readyState === "live") setupAudioContext.createMediaStreamSource(new MediaStream([localMicrophoneTrack])).connect(destination);
          await setupAudioContext.resume();
          mixedAudioTrack = destination.stream.getAudioTracks()[0] || null;
        }
      }
      const recordingStream = new MediaStream([...displayStream.getVideoTracks(), ...(mixedAudioTrack ? [mixedAudioTrack] : audioTracks)]);
      const mimeType = recordingMimeType();
      const recorder = new MediaRecorder(recordingStream, {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond: 6_000_000,
        audioBitsPerSecond: 128_000
      });
      const chunks = [];
      setupSink = await createRecordingSink(recorder.mimeType || mimeType || "video/webm");
      let resolveStopped;
      const stopped = new Promise(resolve => { resolveStopped = resolve; });
      recorder.addEventListener("dataavailable", event => {
        if (!event.data?.size) return;
        if (setupSink) setupSink.writeChain = setupSink.writeChain.then(() => setupSink.writable.write(event.data));
        else chunks.push(event.data);
      });
      recorder.addEventListener("stop", resolveStopped, { once: true });
      recorder.addEventListener("error", event => {
        setRecordingFeedback(event.error?.message || "Recording stopped because of a browser error.");
        finishLocalRecording();
      }, { once: true });
      localRecording = {
        recorder, chunks, sink: setupSink, mimeType: recorder.mimeType || mimeType || "video/webm", displayStream, recordingStream, audioContext: setupAudioContext, stopped,
        startedAt: Date.now(), pausedDuration: 0, pauseStartedAt: 0, timerInterval: null, finishing: false
      };
      displayStream.getVideoTracks()[0]?.addEventListener("ended", () => finishLocalRecording(), { once: true });
      recorder.start(2000);
      localRecording.timerInterval = setInterval(syncRecordingTimer, 250);
      syncRecordingTimer();
      document.body.dataset.localRecording = "active";
      setRecordingUi(true);
      $("#localRecordingMessage").textContent = audioTracks.length
        ? "Tab audio is included. The recording will download when you stop."
        : localMicrophoneTrack
          ? "Your microphone is included, but shared-tab audio was not enabled."
          : "Video is recording without audio. Restart and enable Share tab audio to capture meeting sound.";
      $("#localRecordingStart").disabled = false;
      $("#localRecordingDialog").showModal();
    } catch (error) {
      displayStream.getTracks().forEach(track => track.stop());
      await setupAudioContext?.close().catch(() => {});
      if (setupSink?.writable.abort) await setupSink.writable.abort().catch(() => {});
      if (setupSink) await setupSink.root.removeEntry(setupSink.name).catch(() => {});
      localRecording = null;
      document.body.removeAttribute("data-local-recording");
      setRecordingUi(false);
      $("#localRecordingStart").disabled = false;
      setRecordingFeedback(error?.message || "The browser could not create the recording.");
      $("#localRecordingDialog").showModal();
    }
  }

  function toggleLocalRecordingPause() {
    if (!localRecording || localRecording.finishing) return;
    if (localRecording.recorder.state === "recording") {
      localRecording.recorder.pause();
      localRecording.pauseStartedAt = Date.now();
      setRecordingUi(true, true);
    } else if (localRecording.recorder.state === "paused") {
      localRecording.pausedDuration += Date.now() - localRecording.pauseStartedAt;
      localRecording.pauseStartedAt = 0;
      localRecording.recorder.resume();
      setRecordingUi(true, false);
    }
    syncRecordingTimer();
  }

  function bindLocalRecording() {
    const dialog = $("#localRecordingDialog");
    const mini = $("#localRecordingMini");
    const miniToggle = $("#localRecordingMiniToggle");
    const open = () => {
      setRecordingFeedback("");
      if (localRecording) recordingUiMinimized = false;
      setRecordingUi(Boolean(localRecording), localRecording?.recorder.state === "paused");
      if (!dialog.open) dialog.showModal();
    };
    $("#controllerRecordButton").addEventListener("click", open);
    $("#localRecordingClose").addEventListener("click", () => dialog.close());
    $("#localRecordingMinimize").addEventListener("click", () => setRecordingMinimized(true));
    $("#localRecordingCancel").addEventListener("click", () => dialog.close());
    $("#localRecordingStart").addEventListener("click", startLocalRecording);
    $("#localRecordingPause").addEventListener("click", toggleLocalRecordingPause);
    $("#localRecordingStop").addEventListener("click", () => finishLocalRecording());
    miniToggle.addEventListener("click", () => {
      if (recordingMiniDragged) {
        recordingMiniDragged = false;
        return;
      }
      setRecordingMiniOpen(!recordingMiniOpen);
    });
    $("#localRecordingMiniClose").addEventListener("click", () => {
      setRecordingMiniOpen(false);
      miniToggle.focus();
    });
    $("#localRecordingMiniPause").addEventListener("click", toggleLocalRecordingPause);
    $("#localRecordingRestore").addEventListener("click", () => setRecordingMinimized(false));
    $("#localRecordingMiniStop").addEventListener("click", () => finishLocalRecording());
    mini.addEventListener("pointerdown", event => {
      if (!localRecording || localRecording.finishing || event.button !== 0) return;
      if (event.target.closest(".local-recording-mini-panel button")) return;
      const startRect = mini.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;
      let moved = false;
      const move = moveEvent => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
        if (!moved) return;
        moveEvent.preventDefault();
        applyRecordingMiniPosition(startRect.left + dx, startRect.top + dy);
      };
      const up = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        recordingMiniDragged = moved;
        if (moved) setTimeout(() => { recordingMiniDragged = false; }, 0);
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up, { once: true });
    });
    window.addEventListener("resize", syncRecordingMiniPosition);
    dialog.addEventListener("cancel", event => { if (localRecording) event.preventDefault(); });
    window.addEventListener("beforeunload", event => {
      if (!localRecording) return;
      event.preventDefault();
      event.returnValue = "";
    });
    window.addEventListener("pagehide", () => releaseRecordingDownloadUrl(true));
  }

  function setControllerTheme(theme, remember = true) {
    const nextTheme = theme === "light" ? "light" : "dark";
    document.body.dataset.controllerTheme = nextTheme;
    document.querySelectorAll("[data-controller-theme-option]").forEach(button => {
      const selected = button.dataset.controllerThemeOption === nextTheme;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
      button.querySelector("b").textContent = selected ? "Selected" : "Use";
    });
    if (remember) try { localStorage.setItem("presentStudio.controllerTheme", nextTheme); } catch {}
  }

  function bindControllerTheme() {
    const settingsButton = $("#controllerSettingsButton");
    const settingsDialog = $("#controllerSettingsDialog");
    let initialTheme = "dark";
    try { initialTheme = localStorage.getItem("presentStudio.controllerTheme") || initialTheme; } catch {}
    setControllerTheme(initialTheme, false);
    document.querySelectorAll("[data-controller-theme-option]").forEach(button => button.addEventListener("click", () => setControllerTheme(button.dataset.controllerThemeOption)));
    settingsButton.addEventListener("click", () => settingsDialog.showModal());
    $("#controllerSettingsClose").addEventListener("click", () => settingsDialog.close());
  }

  function setControllerMode(mode, remember = true) {
    const nextMode = mode === "interactive" ? "interactive" : "control";
    const modeSwitch = $(".controller-mode-switch");
    const editorLink = $("#backToEditor");
    const status = $("#connectionStatus");
    const settingsButton = $("#controllerSettingsButton");
    const links = nextMode === "interactive" ? $("#interactiveWorkspaceLinks") : $("#controllerWorkspaceLinks");
    links.append(modeSwitch, settingsButton, editorLink, status);
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
      if (active) {
        showPreviewToolbar();
      } else {
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

  function drawInteractiveToolPath(points, color, size) {
    if (points.length < 2) return;
    const canvas = $("#interactiveAnnotationCanvas");
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

  function addInteractiveToolText(text, point, color, size) {
    const label = document.createElement("span");
    label.textContent = text;
    label.style.left = `${point.x * 100}%`;
    label.style.top = `${point.y * 100}%`;
    label.style.setProperty("--annotation-color", color);
    label.style.setProperty("--annotation-size", `${Math.max(18, size * 3.8)}px`);
    $("#interactiveAnnotationText").append(label);
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

  function openInteractiveTextEditor(point) {
    interactiveTextPoint = point;
    const editor = $("#interactiveTextEditor");
    const input = $("#interactiveTextInput");
    input.value = "";
    editor.hidden = false;
    requestAnimationFrame(() => input.focus());
  }

  function closeInteractiveTextEditor() {
    interactiveTextPoint = null;
    $("#interactiveTextEditor").hidden = true;
  }

  function clearPreviewToolAnnotations(send = true) {
    const canvas = $("#previewAnnotationCanvas");
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    $("#previewAnnotationText").replaceChildren();
    if (send) annotationPayload("clear");
  }

  function clearInteractiveToolAnnotations(send = true) {
    const canvas = $("#interactiveAnnotationCanvas");
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    $("#interactiveAnnotationText").replaceChildren();
    if (send) annotationPayload("clear");
  }

  function applyPreviewToolViewport(send = true) {
    const visual = $("#controllerPreviewVisual");
    visual.style.setProperty("--preview-zoom", String(previewToolZoom));
    visual.style.setProperty("--preview-pan-x", `${previewToolPan.x}px`);
    visual.style.setProperty("--preview-pan-y", `${previewToolPan.y}px`);
    $("#previewZoomValue").textContent = `${Math.round(previewToolZoom * 100)}%`;
    if (send) annotationPayload("viewport", { zoom: previewToolZoom, x: previewToolPan.x, y: previewToolPan.y });
  }

  function applyInteractiveToolViewport(send = true) {
    const stage = $("#controllerLiveMedia").querySelector(".interactive-main-stage");
    stage.style.setProperty("--audience-zoom", String(interactiveToolZoom));
    stage.style.setProperty("--audience-pan-x", `${interactiveToolPan.x}px`);
    stage.style.setProperty("--audience-pan-y", `${interactiveToolPan.y}px`);
    $("#interactiveZoomValue").textContent = `${Math.round(interactiveToolZoom * 100)}%`;
    if (send) annotationPayload("viewport", { zoom: interactiveToolZoom, x: interactiveToolPan.x, y: interactiveToolPan.y });
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
    const interactiveStage = $("#controllerLiveMedia")?.querySelector(".interactive-main-stage");
    interactiveStage?.classList.toggle("is-preview-highlighting", tool === "highlighter");
    interactiveStage?.classList.toggle("is-preview-panning", tool === "pan");
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
    $("#previewFullscreenNotes").onclick = () => $("#previewNotes").click();
    $("#previewTextCancel").onclick = closePreviewTextEditor;
    $("#previewTextEditor").onsubmit = event => {
      event.preventDefault();
      const value = $("#previewTextInput").value.trim();
      if (!value || !previewTextPoint) return;
      const payload = { text: value.slice(0, 180), point: previewTextPoint, color: color(), size: size() };
      addPreviewToolText(payload.text, payload.point, payload.color, payload.size);
      annotationPayload("text", payload);
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
        annotationPayload("draw", { points: previewToolPointer.points, color: previewHighlighterColor(), size: size() });
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
  function normalizedVolume(value) { const volume = value == null ? NaN : Number(value); return Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1; }
  function applyPreviewVolumes() {
    previewMediaElements().forEach(media => { media.volume = media.tagName === "VIDEO" ? videoVolume : audioVolume; });
    $("#controllerPreviewMedia").querySelectorAll("iframe[data-youtube-id]").forEach(frame => window.SnapKeyYouTube.sync(frame, { volume: videoVolume, muted: !previewAudioEnabled }));
  }

  function interactiveToolPoint(event) {
    const bounds = $("#controllerLiveMedia").querySelector(".live-presentation-feed-frame").getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) return null;
    return {
      x: (event.clientX - bounds.left) / bounds.width,
      y: (event.clientY - bounds.top) / bounds.height
    };
  }

  function showInteractiveToolbar() {
    const stage = $("#controllerLiveMedia").querySelector(".interactive-main-stage");
    const toolbar = $("#interactiveFullscreenTools");
    if (document.fullscreenElement !== stage) return;
    toolbar.classList.add("is-visible");
    clearTimeout(interactiveToolbarTimer);
    interactiveToolbarTimer = setTimeout(() => {
      if (!toolbar.matches(":focus-within")) toolbar.classList.remove("is-visible");
    }, 2400);
  }

  function bindInteractiveFullscreenTools() {
    const stage = $("#controllerLiveMedia").querySelector(".interactive-main-stage");
    const toolbar = $("#interactiveFullscreenTools");
    const color = () => $("#interactiveToolColor").value || "#ffd54a";
    const size = () => Number($("#interactiveToolSize").value) || 18;
    $("#interactiveZoomOut").onclick = () => { interactiveToolZoom = Math.max(.5, interactiveToolZoom - .1); applyInteractiveToolViewport(); };
    $("#interactiveZoomIn").onclick = () => { interactiveToolZoom = Math.min(3, interactiveToolZoom + .1); applyInteractiveToolViewport(); };
    $("#interactiveResetView").onclick = () => { interactiveToolZoom = 1; interactiveToolPan = { x: 0, y: 0 }; applyInteractiveToolViewport(); };
    $("#interactiveClearAnnotations").onclick = () => clearInteractiveToolAnnotations(true);
    $("#interactiveTextCancel").onclick = closeInteractiveTextEditor;
    $("#interactiveTextEditor").onsubmit = event => {
      event.preventDefault();
      const value = $("#interactiveTextInput").value.trim();
      if (!value || !interactiveTextPoint) return;
      const payload = { text: value.slice(0, 180), point: interactiveTextPoint, color: color(), size: size() };
      addInteractiveToolText(payload.text, payload.point, payload.color, payload.size);
      annotationPayload("text", payload);
      closeInteractiveTextEditor();
    };
    toolbar.addEventListener("pointerenter", showInteractiveToolbar);
    toolbar.addEventListener("focusin", showInteractiveToolbar);
    stage.addEventListener("pointerdown", showInteractiveToolbar, { passive: true });
    stage.addEventListener("touchstart", showInteractiveToolbar, { passive: true });
    stage.addEventListener("pointermove", event => {
      if (document.fullscreenElement !== stage) return;
      showInteractiveToolbar();
      if (!interactiveToolPointer || interactiveToolPointer.id !== event.pointerId) return;
      if (previewTool === "pan") {
        interactiveToolPan = {
          x: interactiveToolPointer.pan.x + event.clientX - interactiveToolPointer.startX,
          y: interactiveToolPointer.pan.y + event.clientY - interactiveToolPointer.startY
        };
        applyInteractiveToolViewport();
        return;
      }
      const point = interactiveToolPoint(event);
      if (!point) return;
      const previous = interactiveToolPointer.points.at(-1);
      interactiveToolPointer.points.push(point);
      drawInteractiveToolPath([previous, point], color(), size());
    });
    stage.addEventListener("pointerdown", event => {
      if (document.fullscreenElement !== stage || event.button !== 0 || event.target.closest("#interactiveFullscreenTools, #interactiveTextEditor")) return;
      const point = interactiveToolPoint(event);
      if (previewTool !== "pan" && !point) return;
      if (previewTool === "text") {
        openInteractiveTextEditor(point);
        return;
      }
      interactiveToolPointer = { id: event.pointerId, startX: event.clientX, startY: event.clientY, pan: { ...interactiveToolPan }, points: point ? [point] : [] };
      stage.setPointerCapture(event.pointerId);
      stage.classList.toggle("is-preview-grabbing", previewTool === "pan");
      event.preventDefault();
    });
    const finishPointer = event => {
      if (!interactiveToolPointer || interactiveToolPointer.id !== event.pointerId) return;
      if (previewTool === "highlighter" && interactiveToolPointer.points.length > 1) {
        annotationPayload("draw", { points: interactiveToolPointer.points, color: color(), size: size() });
      }
      interactiveToolPointer = null;
      stage.classList.remove("is-preview-grabbing");
    };
    stage.addEventListener("pointerup", finishPointer);
    stage.addEventListener("pointercancel", finishPointer);
    document.addEventListener("fullscreenchange", () => {
      const active = document.fullscreenElement === stage;
      if (active) showInteractiveToolbar();
      else {
        clearTimeout(interactiveToolbarTimer);
        toolbar.classList.remove("is-visible");
        closeInteractiveTextEditor();
        interactiveToolPointer = null;
        stage.classList.remove("is-preview-grabbing");
      }
    });
    applyInteractiveToolViewport(false);
  }
  function syncVolumeControls() {
    document.querySelectorAll("input[type='range'][data-volume-kind]").forEach(slider => {
      const percent = Math.round((slider.dataset.volumeKind === "audio" ? audioVolume : videoVolume) * 100);
      slider.value = String(percent);
      const output = document.querySelector(`[data-volume-value='${slider.dataset.volumeKind}']`);
      if (output) output.value = `${percent}%`;
    });
  }
  function setPresentationVolume(kind, percent, final = false) {
    const volume = normalizedVolume(Number(percent) / 100);
    if (kind === "master") {
      videoVolume = volume;
      audioVolume = volume;
    } else if (kind === "video") videoVolume = volume;
    else if (kind === "audio") audioVolume = volume;
    else return;
    applyPreviewVolumes();
    syncVolumeControls();
    clearTimeout(volumeEmitTimer);
    if (final) emitControllerState();
    else volumeEmitTimer = setTimeout(emitControllerState, 100);
  }
  function bindVolumeControls() {
    document.querySelectorAll("input[type='range'][data-volume-kind]").forEach(slider => {
      slider.addEventListener("input", () => setPresentationVolume(slider.dataset.volumeKind, slider.value));
      slider.addEventListener("change", () => setPresentationVolume(slider.dataset.volumeKind, slider.value, true));
    });
    syncVolumeControls();
  }
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
    const hasYoutube = Boolean($("#controllerPreviewMedia").querySelector("iframe[data-youtube-id]"));
    pauseButton.disabled = !media && !hasYoutube;
    replayButton.disabled = !media && !hasYoutube;
    audioButton.disabled = !media && !hasYoutube;
    const playing = Boolean(media && !media.paused && !media.ended || !media && hasYoutube && restoredMediaState?.playing);
    pauseButton.querySelector("strong").textContent = playing ? "Pause" : "Play";
    pauseButton.querySelector("[data-control-icon]").textContent = playing ? "Ⅱ" : "▶";
    pauseButton.classList.toggle("is-active", playing);
    pauseButton.setAttribute("aria-pressed", String(playing));
    audioButton.querySelector("strong").textContent = audienceAudioMuted ? "Enable Audio" : "Mute Audio";
    audioButton.querySelector("[data-control-icon]").textContent = audienceAudioMuted ? "🔇" : "🔊";
    audioButton.classList.toggle("is-active", Boolean((media || hasYoutube) && !audienceAudioMuted));
    audioButton.setAttribute("aria-pressed", String(Boolean((media || hasYoutube) && !audienceAudioMuted)));
    audioButton.querySelector("small").textContent = audienceAudioMuted
      ? "Audience and preview muted"
      : previewAudioEnabled ? "Audience and preview audio on" : "Audience audio on · preview muted";
    const timing = $("#previewMediaTiming");
    if (!media) timing.textContent = hasYoutube ? (playing ? "YouTube video · Playing" : "YouTube video · Paused") : "No active media";
    else {
      const duration = Number.isFinite(media.duration) ? ` / ${formatMediaTime(media.duration)}` : "";
      const state = media.ended ? "Ended" : media.paused ? "Paused" : "Playing";
      timing.textContent = `${state} · ${formatMediaTime(media.currentTime)}${duration}`;
    }
  }

  function monitorPreviewMedia(media, autoplay = true) {
    media.muted = !previewAudioEnabled;
    media.volume = media.tagName === "VIDEO" ? videoVolume : audioVolume;
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
      media.volume = media.tagName === "VIDEO" ? videoVolume : audioVolume;
      if (state?.playing) media.play().catch(() => {});
      else media.pause();
      updatePreviewMediaState();
    };
    previewMediaElements().forEach(media => {
      if (media.readyState >= 1) apply(media);
      else media.addEventListener("loadedmetadata", () => apply(media), { once: true });
    });
    $("#controllerPreviewMedia").querySelectorAll("iframe[data-youtube-id]").forEach(frame => window.SnapKeyYouTube.sync(frame, { volume: videoVolume, muted: !previewAudioEnabled, playing: Boolean(state?.playing), position: projectedMediaPosition(state) }));
    applyPreviewVolumes();
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
      muted: audienceAudioMuted,
      videoVolume,
      audioVolume
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
    $("#controllerPreviewMedia").querySelectorAll("iframe[data-youtube-id]").forEach(frame => window.SnapKeyYouTube.sync(frame, { volume: videoVolume, muted: !previewAudioEnabled, playing: action === "stop" || action === "pause" ? false : ["play", "replay"].includes(action) ? true : undefined, position: action === "replay" ? 0 : undefined }));
    updatePreviewMediaState();
  }

  function sendMediaControl(requestedAction) {
    const media = primaryPreviewMedia();
    const youtubeActive = Boolean($("#controllerPreviewMedia").querySelector("iframe[data-youtube-id]"));
    const action = requestedAction === "toggle" ? (media && !media.paused && !media.ended || youtubeActive && restoredMediaState?.playing ? "pause" : "play") : requestedAction;
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
    applyPreviewVolumes();
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
    if (!item?.src && !item?.youtubeId) return;
    const isYoutube = item.type === "youtube" || item.mediaType === "youtube";
    const node = isYoutube ? window.SnapKeyYouTube.frame(item) : document.createElement(item.type === "video" || item.mediaType === "video" ? "video" : "img");
    if (!node) return;
    if (!isYoutube) node.src = item.src;
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
    if (isYoutube) { window.SnapKeyYouTube.sync(node, { volume: videoVolume, muted: !previewAudioEnabled }); updatePreviewMediaState(); }
    return node;
  }

  function addScreenSharePreviewSlot(item, index) {
    const slot = document.createElement("div");
    const left = ((item.left || 0) / 1280) * 100;
    const top = ((item.top || 0) / 720) * 100;
    const width = (((item.width || 0) * (item.scaleX || 1)) / 1280) * 100;
    const height = (((item.height || 0) * (item.scaleY || 1)) / 720) * 100;
    slot.className = "slide-screen-share-slot";
    slot.dataset.slideScreenShare = String(item.id || `screen-share-${index}`);
    slot.setAttribute("aria-label", "Live screen share area");
    Object.assign(slot.style, {
      left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%`,
      transform: item.angle ? `rotate(${Number(item.angle)}deg)` : ""
    });
    slot.innerHTML = '<span aria-hidden="true">▣</span><strong>Live screen share</strong><small>Open Interactive mode and click here</small>';
    $("#controllerPreviewMedia").append(slot);
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
      const videos = (scene.objects || []).filter(object => ["video", "youtube"].includes(object.mediaType) && (object.src || object.youtubeId));
      const screenShares = (scene.objects || []).filter(object => object.mediaType === "screen-share");
      scene.objects = (scene.objects || []).filter(object => !["video", "youtube", "screen-share"].includes(object.mediaType));
      previewCanvas.loadFromJSON(scene, finish);
      videos.forEach(video => addPositionedPreviewMedia(video, true));
      screenShares.forEach(addScreenSharePreviewSlot);
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

  function playVideoLoopItem(items, index, generation) {
    if (!loopRunning || loopKind !== "video" || generation !== loopGeneration) return;
    selectTarget(items[index]);
    const video = primaryPreviewMedia();
    if (video?.tagName !== "VIDEO") {
      stopLoop(false);
      return;
    }
    video.loop = false;
    video.addEventListener("ended", () => {
      if (!loopRunning || loopKind !== "video" || generation !== loopGeneration) return;
      playVideoLoopItem(items, (index + 1) % items.length, generation);
    }, { once: true });
  }

  function startLoop(kind, selector) {
    const items = selectedLoopTargets(kind, selector);
    if (!items.length) return toast(`Select at least one ${kind}.`);
    clearInterval(loopTimer);
    loopTimer = null;
    loopRunning = true;
    loopKind = kind;
    const generation = ++loopGeneration;
    let index = 0;
    $("#loopStatus").textContent = `${kind === "image" ? "Image" : "Video"} loop running · ${items.length} selected`;
    if (kind === "video") {
      playVideoLoopItem(items, index, generation);
      return;
    }
    selectTarget(items[index]);
    loopTimer = setInterval(() => {
      if (!loopRunning || loopKind !== "image" || generation !== loopGeneration) return;
      index = (index + 1) % items.length;
      selectTarget(items[index]);
    }, Number($("#loopInterval").value) || 8000);
  }

  function stopLoop(stopCurrentVideo = true) {
    const shouldStopVideo = stopCurrentVideo && loopRunning && loopKind === "video";
    loopRunning = false;
    loopKind = "";
    loopGeneration += 1;
    clearInterval(loopTimer);
    loopTimer = null;
    if (shouldStopVideo) sendMediaControl("stop");
    $("#loopStatus").textContent = "No loop running";
  }

  bindControllerConsole();
  bindControllerTheme();
  bindLocalRecording();
  bindPreviewDock();
  bindInteractiveFullscreenTools();
  bindControllerNotes();
  bindVolumeControls();

  try {
    if (!window.fabric) throw new Error("The slide preview library could not be loaded.");
    const [result, live] = await Promise.all([
      api.getPresentation(presentationId, shareToken),
      api.getLiveSession(presentationId).catch(() => ({ activeSlideId: "" }))
    ]);
    if (result.permission !== "presenter") throw new Error("A trusted presenter link is required for this controller.");
    presentation = result.presentation;
    const initialVolume = normalizedVolume(live.videoVolume ?? live.audioVolume);
    videoVolume = initialVolume;
    audioVolume = initialVolume;
    syncVolumeControls();
    liveMediaSession = window.SnapKeyLiveMedia?.create({
      root: $("#controllerLiveMedia"),
      presentationId,
      shareToken,
      authToken,
      socket,
      displayName: api.getCachedSession()?.name || "Presenter",
      fullscreenTarget: $("#controllerLiveMedia").querySelector(".interactive-main-stage"),
      fullscreenOnJoin: false,
      controller: true,
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
      if (outputBlanked) showPreviewPlaceholder("Black screen");
      else applyRestoredMediaState({ ...live, slideId: live.activeSlideId });
    }
    $("#startImageLoop").onclick = () => startLoop("image", "#imageLoopList");
    $("#startVideoLoop").onclick = () => startLoop("video", "#videoLoopList");
    $("#stopLoop").onclick = () => stopLoop();
    $("#pauseMedia").onclick = () => sendMediaControl("toggle");
    $("#previewAudio").onclick = togglePreviewAudio;
    $("#replayMedia").onclick = () => sendMediaControl("replay");
    $("#stopMedia").onclick = () => {
      stopLoop(false);
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
    socket?.on("presentation_state", state => {
      if (state.presentationId && state.presentationId !== presentationId) return;
      const stateVolume = normalizedVolume(state.videoVolume ?? state.audioVolume);
      videoVolume = stateVolume;
      audioVolume = stateVolume;
      applyPreviewVolumes();
      syncVolumeControls();
    });
    socket?.on("presentation_updated", event => {
      if (event.presentationId !== presentationId || !event.presentation) return;
      const previousState = controllerStatePayload();
      presentation = event.presentation;
      renderControllerTargets();
      const currentTarget = targets.find(target => target.id === activeTargetId) || targetForLiveState(previousState) || targets.find(target => target.kind === "slide");
      if (currentTarget) {
        activeTargetId = currentTarget.id;
        renderTargetPreview(currentTarget);
        if (outputBlanked) showPreviewPlaceholder("Black screen");
        else if (previousState) applyRestoredMediaState({ ...previousState, serverTime: Date.now() });
        emitControllerState();
      }
    });
    socket?.on("presentation_deleted", event => {
      if (event.presentationId !== presentationId) return;
      stopLoop(false);
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
