(function () {
  "use strict";

  function create(options) {
    const root = options.root;
    if (!root) return null;
    const api = window.PresentStudioApi;
    const livekit = window.LivekitClient;
    const nameInput = root.querySelector("[data-live-name]");
    const joinButton = root.querySelector("[data-live-join]");
    const microphoneButton = root.querySelector("[data-live-microphone]");
    const cameraButton = root.querySelector("[data-live-camera]");
    const screenShareButton = root.querySelector("[data-live-screen-share]");
    const enableAudioButton = root.querySelector("[data-live-enable-audio]");
    const leaveButton = root.querySelector("[data-live-leave]");
    const panelToggle = root.querySelector("[data-live-panel-toggle]");
    const panelRestore = root.querySelector("[data-live-panel-restore]");
    const meetingSidebar = root.querySelector(".live-meeting-sidebar");
    const fullscreenButton = root.querySelector("[data-live-fullscreen]");
    const status = root.querySelector("[data-live-status]");
    const count = root.querySelector("[data-live-count]");
    const tiles = root.querySelector("[data-live-tiles]");
    const screenShareViewer = root.querySelector("[data-live-screen-share-viewer]");
    const screenShareMedia = root.querySelector("[data-live-screen-share-media]");
    const screenShareLabel = root.querySelector("[data-live-screen-share-label]");
    const presentationViewer = root.querySelector("[data-live-presentation-viewer]");
    const presentationCanvas = root.querySelector("[data-live-presentation-canvas]");
    const presentationMedia = root.querySelector("[data-live-presentation-media]");
    const presentationLabel = root.querySelector("[data-live-presentation-label]");
    const presentationEmpty = root.querySelector("[data-live-presentation-empty]");
    const presentationSource = options.presentationSource || {};
    let room = null;
    let microphoneEnabled = false;
    let cameraEnabled = false;
    let screenShareEnabled = false;
    let joining = false;
    let mountedTracks = [];
    let presentationMediaSignature = "";

    nameInput.value = options.displayName || "";
    const setStatus = (message, kind = "") => { status.textContent = message; status.dataset.kind = kind; };
    function participantRole(participant) { try { return JSON.parse(participant.metadata || "{}").role || "viewer"; } catch { return "viewer"; } }
    function publications(participant) { return participant?.trackPublications ? [...participant.trackPublications.values()] : []; }
    function isSource(publication, name) { return publication?.source === livekit.Track?.Source?.[name]; }
    function detachMountedTracks() { mountedTracks.forEach(track => track.detach?.()); mountedTracks = []; }

    function presentationSourceLabel() {
      const value = typeof presentationSource.label === "function" ? presentationSource.label() : presentationSource.label;
      return String(value || "Current presentation output");
    }

    function presentationVisualNodes() {
      return presentationSource.media ? [...presentationSource.media.children].filter(node => ["IMG", "VIDEO"].includes(node.tagName)) : [];
    }

    function syncPresentationMedia(sourceNodes) {
      if (!presentationMedia) return;
      const signature = sourceNodes.map(node => [node.tagName, node.currentSrc || node.src || "", node.className || "", node.getAttribute("style") || ""].join("|" )).join("::");
      if (signature !== presentationMediaSignature) {
        presentationMediaSignature = signature;
        const clones = sourceNodes.map(source => {
          const clone = source.cloneNode(false);
          clone.removeAttribute("controls");
          if (clone.tagName === "VIDEO") Object.assign(clone, { autoplay: true, muted: true, playsInline: true });
          return clone;
        });
        presentationMedia.replaceChildren(...clones);
      }
      const clones = [...presentationMedia.children];
      sourceNodes.forEach((source, index) => {
        const clone = clones[index];
        if (!clone || source.tagName !== "VIDEO") return;
        const sourceTime = Number(source.currentTime);
        if (Number.isFinite(sourceTime) && Math.abs(Number(clone.currentTime) - sourceTime) > .65) {
          try { clone.currentTime = sourceTime; } catch {}
        }
        if (source.paused || source.ended) clone.pause?.();
        else clone.play?.().catch(() => {});
      });
    }

    function syncPresentationViewer() {
      if (!presentationViewer || !presentationCanvas) return;
      const sourceCanvas = presentationSource.canvas;
      const sourceNodes = presentationVisualNodes();
      const canvasVisible = Boolean(sourceCanvas && !sourceCanvas.hidden);
      const context = presentationCanvas.getContext("2d");
      context.clearRect(0, 0, presentationCanvas.width, presentationCanvas.height);
      if (canvasVisible) {
        try { context.drawImage(sourceCanvas, 0, 0, presentationCanvas.width, presentationCanvas.height); } catch {}
      }
      syncPresentationMedia(sourceNodes);
      const hasVisual = canvasVisible || sourceNodes.length > 0;
      presentationViewer.classList.toggle("is-empty", !hasVisual);
      presentationCanvas.hidden = !canvasVisible;
      presentationEmpty.hidden = hasVisual;
      if (presentationLabel) presentationLabel.textContent = presentationSourceLabel();
    }

    const presentationSyncTimer = presentationViewer ? window.setInterval(syncPresentationViewer, 300) : 0;
    syncPresentationViewer();

    function syncLocalPublishedState() {
      microphoneEnabled = Boolean(room?.localParticipant?.isMicrophoneEnabled);
      cameraEnabled = Boolean(room?.localParticipant?.isCameraEnabled);
      screenShareEnabled = Boolean(room?.localParticipant?.isScreenShareEnabled);
    }

    function addParticipantTile(participant, isLocal = false) {
      const tile = document.createElement("article");
      tile.className = "live-media-tile";
      tile.dataset.participantIdentity = participant.identity;
      const media = document.createElement("div");
      media.className = "live-media-tile-video";
      const videoPublication = publications(participant).find(publication => isSource(publication, "Camera") && publication.track && !publication.isMuted);
      if (videoPublication?.track) {
        const video = videoPublication.track.attach();
        Object.assign(video, { autoplay: true, playsInline: true, muted: isLocal });
        media.append(video);
        mountedTracks.push(videoPublication.track);
      } else {
        const avatar = document.createElement("span");
        avatar.className = "live-media-avatar";
        avatar.textContent = (participant.name || "Guest").trim().slice(0, 1).toUpperCase() || "G";
        media.append(avatar);
      }
      if (!isLocal) publications(participant).filter(publication => (isSource(publication, "Microphone") || isSource(publication, "ScreenShareAudio")) && publication.track).forEach(publication => {
        const audio = publication.track.attach();
        Object.assign(audio, { autoplay: true, hidden: true });
        tile.append(audio);
        mountedTracks.push(publication.track);
      });
      const caption = document.createElement("footer");
      const label = document.createElement("strong");
      label.textContent = `${participant.name || "Guest"}${isLocal ? " (You)" : ""}`;
      const state = document.createElement("span");
      const micOn = publications(participant).some(publication => isSource(publication, "Microphone") && !publication.isMuted);
      state.textContent = `${participantRole(participant) === "presenter" ? "Presenter" : "Audience"} · ${micOn ? "Mic on" : "Muted"}`;
      caption.append(label, state);
      tile.append(media, caption);
      tiles.append(tile);
    }

    function renderScreenShares() {
      screenShareMedia.replaceChildren();
      if (!room) {
        screenShareViewer.hidden = true;
        root.classList.remove("has-screen-share");
        return;
      }
      const sharers = [room.localParticipant, ...room.remoteParticipants.values()];
      const activeShares = [];
      sharers.forEach(participant => publications(participant)
        .filter(publication => isSource(publication, "ScreenShare") && publication.track && !publication.isMuted)
        .forEach(publication => activeShares.push({ participant, track: publication.track })));
      activeShares.forEach(({ participant, track }) => {
        const figure = document.createElement("figure");
        const video = track.attach();
        Object.assign(video, { autoplay: true, playsInline: true, muted: participant === room.localParticipant });
        const caption = document.createElement("figcaption");
        caption.textContent = `${participant.name || "Guest"}${participant === room.localParticipant ? " (You)" : ""}`;
        figure.append(video, caption);
        screenShareMedia.append(figure);
        mountedTracks.push(track);
      });
      const visible = activeShares.length > 0;
      screenShareViewer.hidden = !visible;
      root.classList.toggle("has-screen-share", visible);
      if (visible) screenShareLabel.textContent = activeShares.length === 1 ? `${activeShares[0].participant.name || "Guest"} is sharing` : `${activeShares.length} shared screens`;
    }

    function renderParticipants() {
      detachMountedTracks();
      tiles.replaceChildren();
      if (!room) { count.textContent = "0 connected"; return; }
      addParticipantTile(room.localParticipant, true);
      room.remoteParticipants.forEach(participant => addParticipantTile(participant));
      renderScreenShares();
      const total = room.remoteParticipants.size + 1;
      count.textContent = `${total} connected`;
    }

    function highlightSpeakers(speakers) {
      const active = new Set((speakers || []).map(participant => participant.identity));
      tiles.querySelectorAll("[data-participant-identity]").forEach(tile => tile.classList.toggle("is-speaking", active.has(tile.dataset.participantIdentity)));
    }

    function syncButtons(connected) {
      root.classList.toggle("is-connected", connected);
      if (!connected) setAudienceSidebarHidden(false);
      joinButton.hidden = connected;
      nameInput.disabled = connected || joining;
      microphoneButton.disabled = !connected;
      cameraButton.disabled = !connected;
      screenShareButton.disabled = !connected;
      leaveButton.disabled = !connected;
      microphoneButton.textContent = microphoneEnabled ? "Mute microphone" : "Unmute microphone";
      cameraButton.textContent = cameraEnabled ? "Turn camera off" : "Turn camera on";
      screenShareButton.textContent = screenShareEnabled ? "Stop Sharing" : "Share Screen";
      microphoneButton.setAttribute("aria-pressed", String(microphoneEnabled));
      cameraButton.setAttribute("aria-pressed", String(cameraEnabled));
      screenShareButton.setAttribute("aria-pressed", String(screenShareEnabled));
    }

    function setAudienceSidebarHidden(hidden, moveFocus = false) {
      const collapsed = Boolean(hidden);
      root.classList.toggle("is-sidebar-hidden", collapsed);
      if (meetingSidebar) {
        meetingSidebar.inert = collapsed;
        meetingSidebar.setAttribute("aria-hidden", String(collapsed));
      }
      if (panelToggle) {
        panelToggle.setAttribute("aria-expanded", String(!collapsed));
        panelToggle.setAttribute("aria-label", collapsed ? "Show participants and meeting controls" : "Hide participants and meeting controls");
        panelToggle.title = panelToggle.getAttribute("aria-label");
      }
      if (panelRestore) panelRestore.hidden = !collapsed;
      if (moveFocus) (collapsed ? panelRestore : panelToggle)?.focus();
    }

    function syncAudioRecovery() {
      enableAudioButton.hidden = !room || room.canPlayAudio !== false;
    }

    async function enableAudio(showSuccess = true) {
      if (!room) return false;
      try {
        await room.startAudio();
        syncAudioRecovery();
        if (showSuccess) setStatus("Audio enabled", "success");
        return room.canPlayAudio !== false;
      } catch (error) {
        enableAudioButton.hidden = false;
        setStatus(error.message || "Browser blocked audio. Select Enable Audio.", "error");
        return false;
      }
    }

    function bindRoomEvents() {
      const events = livekit.RoomEvent;
      [events.ParticipantConnected, events.ParticipantDisconnected, events.TrackSubscribed, events.TrackUnsubscribed,
        events.TrackPublished, events.TrackUnpublished, events.TrackMuted, events.TrackUnmuted]
        .filter(Boolean).forEach(eventName => room.on(eventName, renderParticipants));
      room.on(events.LocalTrackPublished, () => { syncLocalPublishedState(); syncButtons(true); renderParticipants(); });
      room.on(events.LocalTrackUnpublished, publication => {
        const stoppedScreenShare = isSource(publication, "ScreenShare") || isSource(publication, "ScreenShareAudio");
        syncLocalPublishedState(); syncButtons(true); renderParticipants();
        if (stoppedScreenShare && !screenShareEnabled) setStatus("Screen sharing stopped");
      });
      room.on(events.ActiveSpeakersChanged, highlightSpeakers);
      if (events.AudioPlaybackStatusChanged) room.on(events.AudioPlaybackStatusChanged, syncAudioRecovery);
      room.on(events.Reconnecting, () => setStatus("Reconnecting…"));
      room.on(events.Reconnected, () => { syncLocalPublishedState(); syncButtons(true); renderParticipants(); syncAudioRecovery(); setStatus("Connected", "success"); });
      room.on(events.Disconnected, () => {
        microphoneEnabled = false; cameraEnabled = false; screenShareEnabled = false; detachMountedTracks(); room = null;
        tiles.replaceChildren(); screenShareMedia.replaceChildren(); screenShareViewer.hidden = true; enableAudioButton.hidden = true;
        root.classList.remove("has-screen-share"); count.textContent = "0 connected"; setStatus("Left the live room"); syncButtons(false);
      });
    }

    async function join() {
      if (joining || room) return;
      if (!livekit?.Room) { setStatus("Audio/video library could not be loaded", "error"); return; }
      if (!api?.getLiveMediaToken) { setStatus("This page is out of date. Refresh it and try again.", "error"); return; }
      if (options.fullscreenTarget && options.fullscreenOnJoin !== false && !document.fullscreenElement) options.fullscreenTarget.requestFullscreen?.().catch(() => {});
      joining = true; joinButton.disabled = true; nameInput.disabled = true; setStatus("Joining…");
      try {
        const credentials = await api.getLiveMediaToken(options.presentationId, {
          displayName: nameInput.value.trim(), shareToken: options.shareToken || "", screenAccessCode: options.screenAccessCode || undefined
        });
        room = new livekit.Room({ adaptiveStream: true, dynacast: true });
        bindRoomEvents();
        await room.connect(credentials.url, credentials.token, { autoSubscribe: true });
        const audioReady = await enableAudio(false);
        setStatus(audioReady ? `Connected as ${credentials.participantName}` : `Connected as ${credentials.participantName} · audio needs permission`, audioReady ? "success" : "error");
        syncButtons(true); renderParticipants();
      } catch (error) {
        room?.disconnect(); room = null; setStatus(error.message || "Could not join audio/video", "error"); syncButtons(false);
      } finally {
        joining = false; joinButton.disabled = false; if (!room) nameInput.disabled = false;
      }
    }

    async function toggleMicrophone() {
      if (!room) return;
      microphoneButton.disabled = true;
      try { await room.localParticipant.setMicrophoneEnabled(!microphoneEnabled); syncLocalPublishedState(); syncButtons(true); renderParticipants(); }
      catch (error) { syncLocalPublishedState(); setStatus(error.message || "Microphone permission was not granted", "error"); syncButtons(true); }
    }

    async function toggleCamera() {
      if (!room) return;
      cameraButton.disabled = true;
      try { await room.localParticipant.setCameraEnabled(!cameraEnabled); syncLocalPublishedState(); syncButtons(true); renderParticipants(); }
      catch (error) { syncLocalPublishedState(); setStatus(error.message || "Camera permission was not granted", "error"); syncButtons(true); }
    }

    async function toggleScreenShare() {
      if (!room) return;
      const enable = !screenShareEnabled;
      screenShareButton.disabled = true;
      try {
        await room.localParticipant.setScreenShareEnabled(enable);
        syncLocalPublishedState(); syncButtons(true); renderParticipants();
        setStatus(screenShareEnabled ? "Screen sharing started" : "Screen sharing stopped", "success");
      } catch (error) {
        syncLocalPublishedState(); syncButtons(true);
        const cancelled = error?.name === "NotAllowedError" || /cancel|permission|denied/i.test(error?.message || "");
        setStatus(cancelled ? "Screen sharing was cancelled or blocked by browser permission" : (error.message || "Screen sharing could not start"), "error");
      }
    }

    async function leave() {
      const activeRoom = room;
      if (!activeRoom) return;
      await Promise.allSettled([
        activeRoom.localParticipant.setMicrophoneEnabled(false),
        activeRoom.localParticipant.setCameraEnabled(false),
        activeRoom.localParticipant.setScreenShareEnabled(false)
      ]);
      detachMountedTracks();
      activeRoom.disconnect();
    }

    function leaveOnPageHide() {
      if (presentationSyncTimer) window.clearInterval(presentationSyncTimer);
      const activeRoom = room;
      if (!activeRoom) return;
      activeRoom.localParticipant.setMicrophoneEnabled(false).catch(() => {});
      activeRoom.localParticipant.setCameraEnabled(false).catch(() => {});
      activeRoom.localParticipant.setScreenShareEnabled(false).catch(() => {});
      detachMountedTracks();
      activeRoom.disconnect();
    }
    joinButton.addEventListener("click", join);
    microphoneButton.addEventListener("click", toggleMicrophone);
    cameraButton.addEventListener("click", toggleCamera);
    screenShareButton.addEventListener("click", toggleScreenShare);
    enableAudioButton.addEventListener("click", () => enableAudio(true));
    leaveButton.addEventListener("click", leave);
    fullscreenButton?.addEventListener("click", () => {
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      else options.fullscreenTarget?.requestFullscreen?.().catch(error => setStatus(error.message || "Fullscreen was blocked", "error"));
    });
    document.addEventListener("fullscreenchange", () => {
      if (!fullscreenButton) return;
      const active = document.fullscreenElement === options.fullscreenTarget;
      fullscreenButton.textContent = active ? "×" : "⛶";
      fullscreenButton.setAttribute("aria-label", active ? "Exit fullscreen" : "Enter fullscreen");
      fullscreenButton.title = active ? "Exit fullscreen" : "Enter fullscreen";
    });
    panelToggle?.addEventListener("click", () => setAudienceSidebarHidden(true, true));
    panelRestore?.addEventListener("click", () => setAudienceSidebarHidden(false, true));
    window.addEventListener("pagehide", leaveOnPageHide, { once: true });
    syncButtons(false);
    return { join, leave };
  }

  window.SnapKeyLiveMedia = { create };
})();
