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
    const backgroundButton = root.querySelector("[data-live-background]");
    const backgroundDialog = root.querySelector("[data-live-background-dialog]");
    const backgroundCloseButton = root.querySelector("[data-live-background-close]");
    const backgroundOptions = [...root.querySelectorAll("[data-live-background-option]")];
    const backgroundSupport = root.querySelector("[data-live-background-support]");
    const muteAllButton = root.querySelector("[data-live-mute-all]");
    const enableAudioButton = root.querySelector("[data-live-enable-audio]");
    const leaveButton = root.querySelector("[data-live-leave]");
    const panelToggle = root.querySelector("[data-live-panel-toggle]");
    const panelRestore = root.querySelector("[data-live-panel-restore]");
    const restoreCount = root.querySelector("[data-live-restore-count]");
    const sheetHandle = root.querySelector("[data-live-sheet-handle]");
    const meetingSidebar = root.querySelector(".live-meeting-sidebar");
    const audienceControls = !options.controller && meetingSidebar?.querySelector(".audience-meeting-controls");
    let audienceFeedback = null;
    if (audienceControls) {
      // Keep personal media controls available while the mobile people sheet is closed.
      audienceFeedback = document.createElement("p");
      audienceFeedback.className = "audience-control-feedback";
      audienceFeedback.setAttribute("role", "status");
      meetingSidebar.after(audienceFeedback, audienceControls);
    }
    const fullscreenButton = root.querySelector("[data-live-fullscreen]");
    const status = root.querySelector("[data-live-status]");
    const count = root.querySelector("[data-live-count]");
    const tiles = root.querySelector("[data-live-tiles]");
    const screenShareViewer = root.querySelector("[data-live-screen-share-viewer]");
    const screenShareMedia = root.querySelector("[data-live-screen-share-media]");
    const screenShareLabel = root.querySelector("[data-live-screen-share-label]");
    const screenShareMode = root.querySelector("[data-live-screen-share-mode]");
    const presentationViewer = root.querySelector("[data-live-presentation-viewer]");
    const presentationCanvas = root.querySelector("[data-live-presentation-canvas]");
    const presentationMedia = root.querySelector("[data-live-presentation-media]");
    const presentationLabel = root.querySelector("[data-live-presentation-label]");
    const presentationEmpty = root.querySelector("[data-live-presentation-empty]");
    const handButton = root.querySelector("[data-live-hand]");
    const reactionButtons = [...root.querySelectorAll("[data-live-reaction]")];
    const sidebarTabs = [...root.querySelectorAll("[data-live-tab]")];
    const sidebarPanels = [...root.querySelectorAll("[data-live-panel]")];
    if (options.controller && meetingSidebar) {
      // People and chat use the upper flexible area; presenter actions stay below.
      meetingSidebar.append(...[
        root.querySelector(".live-sidebar-tabs"),
        root.querySelector(".live-sidebar-panels"),
        root.querySelector(".live-engagement-bar"),
        root.querySelector(".interactive-control-dock")
      ].filter(Boolean));
    }
    const peopleBadge = root.querySelector("[data-live-people-badge]");
    const chatBadge = root.querySelector("[data-live-chat-badge]");
    const chatMessages = root.querySelector("[data-live-chat-messages]");
    const chatEmpty = root.querySelector("[data-live-chat-empty]");
    const chatForm = root.querySelector("[data-live-chat-form]");
    const chatInput = root.querySelector("[data-live-chat-input]");
    const chatSubmit = chatForm?.querySelector("button[type='submit']");
    const lobby = root.querySelector("[data-live-lobby]");
    const waitingList = root.querySelector("[data-live-waiting-list]");
    const waitingCount = root.querySelector("[data-live-waiting-count]");
    const admitAllButton = root.querySelector("[data-live-admit-all]");
    const shareRequestHeading = root.querySelector("[data-live-share-heading]");
    const shareRequestList = root.querySelector("[data-live-share-list]");
    const shareRequestCount = root.querySelector("[data-live-share-count]");
    const approveSharesButton = root.querySelector("[data-live-approve-shares]");
    const presentationSource = options.presentationSource || {};
    const isController = options.controller === true;
    let room = null;
    let microphoneEnabled = false;
    let cameraEnabled = false;
    let screenShareEnabled = false;
    let joining = false;
    let mountedTracks = new Set();
    let presentationMediaSignature = "";
    let screenShareRenderSignature = "";
    let participantRenderTimer = 0;
    let selectedShareIdentity = "";
    let controllerShareIdentity = "";
    let meetingMuted = false;
    let mutedParticipants = new Set();
    let audioPlaybackBlocked = false;
    let handRaised = false;
    let activeSidebarTab = "people";
    let unreadMessages = 0;
    let raisedHands = new Map();
    let soundContext = null;
    let joinSoundEnabled = localStorage.getItem("presentStudio.joinSoundEnabled") !== "false";
    let joinSoundButton = null;
    let joinNotificationArmed = false;
    let admissionState = isController ? "approved" : "idle";
    let screenShareRequestPending = false;
    let screenShareApproved = false;
    let participantRegistry = new Map();
    let backgroundProcessor = null;
    let backgroundProcessorTrack = null;
    let backgroundProcessorModule = null;
    let backgroundApplyQueue = Promise.resolve();
    let selectedBackground = localStorage.getItem("presentStudio.cameraBackground") || "none";
    if (!backgroundOptions.some(button => button.dataset.liveBackgroundOption === selectedBackground)) selectedBackground = "none";
    const meetingClientId = window.crypto?.randomUUID?.() || `meeting-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const reactionMeta = {
      clap: { emoji: "👏", label: "applauded" },
      party: { emoji: "🥳", label: "celebrated" },
      heart: { emoji: "❤️", label: "sent some love" }
    };

    nameInput.value = options.displayName || "";
    const setStatus = (message, kind = "") => {
      status.textContent = message;
      status.dataset.kind = kind;
      if (audienceFeedback) {
        audienceFeedback.textContent = message;
        audienceFeedback.dataset.kind = kind;
      }
    };
    function participantRole(participant) { try { return JSON.parse(participant.metadata || "{}").role || "viewer"; } catch { return "viewer"; } }
    function publications(participant) { return participant?.trackPublications ? [...participant.trackPublications.values()] : []; }
    function isSource(publication, name) { return publication?.source === livekit.Track?.Source?.[name]; }
    function detachMountedTracks() { mountedTracks.forEach(track => track.detach?.()); mountedTracks.clear(); screenShareRenderSignature = ""; }
    function rememberAttachedTrack(track, element) {
      if (!track || !element) return;
      element._liveTrack = track;
      mountedTracks.add(track);
    }
    function detachNodeTracks(node) {
      node?.querySelectorAll("video, audio").forEach(element => {
        try { element._liveTrack?.detach?.(element); } catch {}
      });
    }
    function participantAudioMuted(identity) { return meetingMuted || mutedParticipants.has(identity); }

    function currentIdentity() { return String(room?.localParticipant?.identity || ""); }
    function currentName() { return String(room?.localParticipant?.name || nameInput.value.trim() || (isController ? "Presenter" : "Guest")).slice(0, 80); }
    function moderationCredentials() {
      return { presentationId: options.presentationId, authToken: options.authToken || "", shareToken: options.shareToken || "" };
    }

    function registerController() {
      if (isController) options.socket?.emit("meeting_controller_register", moderationCredentials());
    }

    function renderLobby(message) {
      if (!isController || !lobby || message?.presentationId !== options.presentationId) return;
      const pending = Array.isArray(message.pending) ? message.pending : [];
      const active = Array.isArray(message.active) ? message.active : [];
      const shareRequests = Array.isArray(message.screenShareRequests) ? message.screenShareRequests : [];
      participantRegistry = new Map(active.filter(item => item.identity).map(item => [String(item.identity), item]));
      const peopleTab = sidebarTabs.find(button => button.dataset.liveTab === "people");
      peopleTab?.classList.toggle("has-pending", pending.length > 0 || shareRequests.length > 0);
      if (peopleTab) peopleTab.title = pending.length || shareRequests.length ? `${pending.length} waiting, ${shareRequests.length} screen share requests` : "";
      lobby.hidden = pending.length === 0 && shareRequests.length === 0;
      waitingCount.textContent = String(pending.length);
      admitAllButton.hidden = pending.length === 0;
      admitAllButton.onclick = () => options.socket?.emit("meeting_admission_decide", {
        ...moderationCredentials(), clientIds: pending.map(item => item.clientId), accepted: true
      });
      waitingList.replaceChildren(...pending.map(item => {
        const row = document.createElement("div");
        row.className = "live-lobby-person";
        const name = document.createElement("span");
        name.textContent = item.name || "Guest";
        const actions = document.createElement("div");
        const deny = document.createElement("button");
        deny.type = "button"; deny.textContent = "Deny"; deny.className = "is-secondary";
        deny.onclick = () => options.socket?.emit("meeting_admission_decide", { ...moderationCredentials(), clientId: item.clientId, accepted: false });
        const admit = document.createElement("button");
        admit.type = "button"; admit.textContent = "Admit";
        admit.onclick = () => options.socket?.emit("meeting_admission_decide", { ...moderationCredentials(), clientId: item.clientId, accepted: true });
        actions.append(deny, admit); row.append(name, actions); return row;
      }));
      shareRequestHeading.hidden = shareRequests.length === 0;
      approveSharesButton.hidden = shareRequests.length === 0;
      approveSharesButton.onclick = () => options.socket?.emit("meeting_screen_share_decide", {
        ...moderationCredentials(), clientIds: shareRequests.map(item => item.clientId), accepted: true
      });
      shareRequestCount.textContent = String(shareRequests.length);
      shareRequestList.replaceChildren(...shareRequests.map(item => {
        const row = document.createElement("div");
        row.className = "live-lobby-person";
        const name = document.createElement("span");
        name.textContent = item.name || "Guest";
        const actions = document.createElement("div");
        const deny = document.createElement("button");
        deny.type = "button"; deny.textContent = "Deny"; deny.className = "is-secondary";
        deny.onclick = () => options.socket?.emit("meeting_screen_share_decide", { ...moderationCredentials(), clientId: item.clientId, accepted: false });
        const allow = document.createElement("button");
        allow.type = "button"; allow.textContent = "Allow";
        allow.onclick = () => options.socket?.emit("meeting_screen_share_decide", { ...moderationCredentials(), clientId: item.clientId, accepted: true });
        actions.append(deny, allow); row.append(name, actions); return row;
      }));
      renderParticipants();
    }

    function setSidebarTab(tab) {
      activeSidebarTab = tab === "chat" ? "chat" : "people";
      sidebarTabs.forEach(button => {
        const active = button.dataset.liveTab === activeSidebarTab;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-selected", String(active));
      });
      sidebarPanels.forEach(panel => {
        const active = panel.dataset.livePanel === activeSidebarTab;
        panel.hidden = !active;
        panel.classList.toggle("is-active", active);
      });
      if (activeSidebarTab === "chat") {
        unreadMessages = 0;
        if (chatBadge) chatBadge.hidden = true;
        requestAnimationFrame(() => { if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight; });
      }
    }

    function appendChatMessage(message) {
      if (!chatMessages || !message?.text) return;
      chatEmpty?.remove();
      const item = document.createElement("article");
      item.className = "live-chat-message";
      const own = message.identity && message.identity === currentIdentity();
      item.classList.toggle("is-own", Boolean(own));
      const heading = document.createElement("header");
      const author = document.createElement("strong");
      author.textContent = own ? "You" : String(message.name || "Guest").slice(0, 80);
      const time = document.createElement("time");
      const sentAt = new Date(Number(message.sentAt) || Date.now());
      time.dateTime = sentAt.toISOString();
      time.textContent = sentAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      heading.append(author, time);
      const body = document.createElement("p");
      body.textContent = String(message.text).slice(0, 500);
      item.append(heading, body);
      chatMessages.append(item);
      while (chatMessages.children.length > 101) chatMessages.children[0].remove();
      chatMessages.scrollTop = chatMessages.scrollHeight;
      if (activeSidebarTab !== "chat" && !own) {
        unreadMessages += 1;
        if (chatBadge) { chatBadge.textContent = unreadMessages > 99 ? "99+" : String(unreadMessages); chatBadge.hidden = false; }
      }
    }

    function reactionLayer() {
      let layer = root.querySelector("[data-live-reaction-layer]");
      if (!layer) {
        layer = document.createElement("div");
        layer.className = "live-reaction-layer";
        layer.dataset.liveReactionLayer = "";
        layer.setAttribute("aria-live", "polite");
        root.append(layer);
      }
      return layer;
    }

    function playReactionSound(type) {
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        soundContext ||= new AudioContextClass();
        soundContext.resume?.();
        const now = soundContext.currentTime;
        const gain = soundContext.createGain();
        gain.connect(soundContext.destination);
        gain.gain.setValueAtTime(.0001, now);
        if (type === "clap") {
          const buffer = soundContext.createBuffer(1, Math.floor(soundContext.sampleRate * .22), soundContext.sampleRate);
          const values = buffer.getChannelData(0);
          for (let i = 0; i < values.length; i += 1) values[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / values.length, 2);
          const source = soundContext.createBufferSource();
          source.buffer = buffer; source.connect(gain);
          gain.gain.exponentialRampToValueAtTime(.18, now + .01);
          gain.gain.exponentialRampToValueAtTime(.0001, now + .22);
          source.start(now);
        } else if (type === "party") {
          const oscillator = soundContext.createOscillator();
          oscillator.type = "sawtooth"; oscillator.connect(gain);
          oscillator.frequency.setValueAtTime(330, now);
          oscillator.frequency.exponentialRampToValueAtTime(740, now + .35);
          gain.gain.exponentialRampToValueAtTime(.13, now + .02);
          gain.gain.exponentialRampToValueAtTime(.0001, now + .45);
          oscillator.start(now); oscillator.stop(now + .46);
        }
      } catch {}
    }

    function unlockReactionAudio() {
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        soundContext ||= new AudioContextClass();
        soundContext.resume?.();
      } catch {}
    }

    function syncJoinSoundButton() {
      if (!joinSoundButton) return;
      joinSoundButton.setAttribute("aria-pressed", String(joinSoundEnabled));
      const labelNode = joinSoundButton.querySelector("[data-live-control-label]");
      if (labelNode) labelNode.textContent = joinSoundEnabled ? "Join sound" : "Join muted";
      const title = joinSoundEnabled
        ? "Participant join sound is on. Select to turn it off"
        : "Participant join sound is off. Select to turn it on";
      joinSoundButton.setAttribute("aria-label", title);
      joinSoundButton.title = title;
    }

    function ensureJoinSoundControl() {
      if (joinSoundButton) return;
      const dock = root.querySelector(".live-media-actions");
      if (!dock) return;

      joinSoundButton = document.createElement("button");
      joinSoundButton.type = "button";
      joinSoundButton.className = "live-control-button is-join-sound";
      joinSoundButton.innerHTML =
        '<span class="live-control-icon" aria-hidden="true">🔔</span>' +
        '<span data-live-control-label>Join sound</span>';

      const leaveControl = dock.querySelector("[data-live-leave]");
      if (leaveControl) dock.insertBefore(joinSoundButton, leaveControl);
      else dock.append(joinSoundButton);

      joinSoundButton.addEventListener("click", () => {
        unlockReactionAudio();
        joinSoundEnabled = !joinSoundEnabled;
        localStorage.setItem("presentStudio.joinSoundEnabled", String(joinSoundEnabled));
        syncJoinSoundButton();
        setStatus(
          joinSoundEnabled ? "Participant join sound enabled" : "Participant join sound muted",
          "success"
        );
      });

      syncJoinSoundButton();
    }

    function playParticipantJoinSound(participant) {
      if (!joinNotificationArmed || !joinSoundEnabled) return;
      if (participant?.identity === currentIdentity()) return;

      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;

        soundContext ||= new AudioContextClass();
        soundContext.resume?.();

        const now = soundContext.currentTime;

        [660, 880].forEach((frequency, index) => {
          const oscillator = soundContext.createOscillator();
          const gain = soundContext.createGain();

          oscillator.type = "sine";
          oscillator.frequency.setValueAtTime(frequency, now);

          const start = now + index * 0.13;
          gain.gain.setValueAtTime(0.0001, start);
          gain.gain.exponentialRampToValueAtTime(0.14, start + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.12);

          oscillator.connect(gain);
          gain.connect(soundContext.destination);

          oscillator.start(start);
          oscillator.stop(start + 0.13);
        });
      } catch {}
    }

    function showReaction(message) {
      const meta = reactionMeta[message?.reaction];
      if (!meta) return;
      const bubble = document.createElement("div");
      bubble.className = "live-reaction-bubble";
      bubble.innerHTML = `<span aria-hidden="true">${meta.emoji}</span><small></small>`;
      bubble.querySelector("small").textContent = `${String(message.name || "Someone").slice(0, 80)} ${meta.label}`;
      reactionLayer().append(bubble);
      playReactionSound(message.reaction);
      window.setTimeout(() => bubble.remove(), 3400);
    }

    async function applyParticipantAudioCommand(message) {
      if (!room || !message || message.presentationId !== options.presentationId) return;
      const target = String(message.targetIdentity || "");
      if (target === "*" && isController) return;
      if (target !== "*" && target !== currentIdentity()) return;
      const enabled = message.muted !== true;
      try {
        await room.localParticipant.setMicrophoneEnabled(enabled);
        syncLocalPublishedState(); syncButtons(true); renderParticipants();
        setStatus(enabled ? "The presenter unmuted your microphone" : "The presenter muted your microphone", "success");
      } catch (error) {
        syncLocalPublishedState(); syncButtons(true);
        setStatus(enabled ? "The presenter requested microphone access. Select Unmute to approve it." : (error.message || "Microphone control failed"), "error");
      }
    }

    function setControlLabel(button, label, accessibleLabel = label) {
      if (!button) return;
      const labelNode = button.querySelector("[data-live-control-label]");
      if (labelNode) labelNode.textContent = label;
      else button.textContent = label;
      button.setAttribute("aria-label", accessibleLabel);
      button.title = accessibleLabel;
    }

    function applyRemoteAudioState() {
      root.querySelectorAll("audio[data-live-audio-participant]").forEach(audio => {
        audio.muted = participantAudioMuted(audio.dataset.liveAudioParticipant);
      });
      if (muteAllButton) {
        setControlLabel(muteAllButton, meetingMuted ? "Unmute all" : "Mute all", meetingMuted ? "Everyone is muted. Select to unmute everyone" : "Everyone can speak. Select to mute everyone");
        muteAllButton.setAttribute("aria-pressed", String(meetingMuted));
      }
    }

    function publishControllerState() {
      if (!isController || !options.socket) return;
      options.socket.emit("meeting_control", {
        presentationId: options.presentationId,
        authToken: options.authToken || "",
        shareToken: options.shareToken || "",
        featuredShareIdentity: controllerShareIdentity,
        meetingMuted,
        mutedParticipants: [...mutedParticipants]
      });
    }

    function applyControllerState(message) {
      if (!message || (message.presentationId && message.presentationId !== options.presentationId)) return;
      controllerShareIdentity = String(message.featuredShareIdentity || "");
      meetingMuted = Boolean(message.meetingMuted);
      mutedParticipants = new Set(Array.isArray(message.mutedParticipants) ? message.mutedParticipants.map(String) : []);
      applyRemoteAudioState();
      renderParticipants();
    }

    function presentationSourceLabel() {
      const value = typeof presentationSource.label === "function" ? presentationSource.label() : presentationSource.label;
      return String(value || "Current presentation output");
    }

    function presentationVisualNodes() {
      return presentationSource.media ? [...presentationSource.media.children].filter(node => ["IMG", "VIDEO", "IFRAME"].includes(node.tagName)) : [];
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
          if (clone.tagName === "IFRAME" && clone.dataset.youtubeId) clone.src = window.SnapKeyYouTube.embedUrl(clone.dataset.youtubeId);
          return clone;
        });
        presentationMedia.replaceChildren(...clones);
        clones.filter(node => node.tagName === "IFRAME" && node.dataset.youtubeId).forEach(frame => window.SnapKeyYouTube.sync(frame, { muted: true, volume: 0 }));
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

    const backgroundPresets = {
      studio: "/assets/meeting-backgrounds/studio.svg",
      office: "/assets/meeting-backgrounds/office.svg",
      warm: "/assets/meeting-backgrounds/warm.svg",
      minimal: "/assets/meeting-backgrounds/minimal.svg",
      loft: "/assets/meeting-backgrounds/loft.svg",
      botanical: "/assets/meeting-backgrounds/botanical.svg",
      aurora: "/assets/meeting-backgrounds/aurora.svg",
      gallery: "/assets/meeting-backgrounds/gallery.svg"
    };

    function syncBackgroundOptions() {
      backgroundOptions.forEach(button => {
        const active = button.dataset.liveBackgroundOption === selectedBackground;
        button.classList.toggle("is-selected", active);
        button.setAttribute("aria-pressed", String(active));
      });
      backgroundButton?.classList.toggle("has-effect", selectedBackground !== "none");
      backgroundButton?.setAttribute("aria-pressed", String(selectedBackground !== "none"));
    }

    function localCameraTrack() {
      return publications(room?.localParticipant).find(publication => isSource(publication, "Camera") && publication.track && !publication.isMuted)?.track || null;
    }

    async function loadBackgroundProcessorModule() {
      if (backgroundProcessorModule) return backgroundProcessorModule;
      backgroundProcessorModule = await import("https://cdn.jsdelivr.net/npm/@livekit/track-processors@0.7.2/+esm");
      if (typeof backgroundProcessorModule.supportsBackgroundProcessors === "function" && !backgroundProcessorModule.supportsBackgroundProcessors()) {
        throw new Error("Camera backgrounds are not supported by this browser");
      }
      return backgroundProcessorModule;
    }

    async function applyCameraBackgroundNow(announce = false) {
      syncBackgroundOptions();
      const cameraTrack = localCameraTrack();
      if (!cameraTrack) {
        if (backgroundSupport) backgroundSupport.textContent = selectedBackground === "none" ? "No camera effect selected." : "Your effect will apply when you turn on the camera.";
        return;
      }
      try {
        if (backgroundSupport) backgroundSupport.textContent = selectedBackground === "none" ? "Removing camera effect…" : "Applying camera effect…";
        if (!backgroundProcessor || backgroundProcessorTrack !== cameraTrack) {
          const processors = await loadBackgroundProcessorModule();
          backgroundProcessor = processors.BackgroundProcessor({ mode: "disabled" });
          await cameraTrack.setProcessor(backgroundProcessor, true);
          backgroundProcessorTrack = cameraTrack;
        }
        if (selectedBackground === "none") await backgroundProcessor.switchTo({ mode: "disabled" });
        else if (selectedBackground === "blur" || selectedBackground === "blur-strong") await backgroundProcessor.switchTo({ mode: "background-blur", blurRadius: selectedBackground === "blur-strong" ? 22 : 12 });
        else await backgroundProcessor.switchTo({ mode: "virtual-background", imagePath: new URL(backgroundPresets[selectedBackground], location.origin).href });
        if (backgroundSupport) backgroundSupport.textContent = selectedBackground === "none" ? "Camera effect is off." : "Camera effect applied.";
        if (announce) setStatus(selectedBackground === "none" ? "Camera background removed" : "Camera background updated", "success");
      } catch (error) {
        backgroundProcessor = null;
        backgroundProcessorTrack = null;
        if (backgroundSupport) backgroundSupport.textContent = error.message || "This camera effect could not be applied.";
        if (announce) setStatus(error.message || "Camera background could not be applied", "error");
      }
    }

    function applySelectedCameraBackground(announce = false) {
      backgroundApplyQueue = backgroundApplyQueue.catch(() => {}).then(() => applyCameraBackgroundNow(announce));
      return backgroundApplyQueue;
    }

    function openBackgroundDialog() {
      syncBackgroundOptions();
      if (backgroundSupport) backgroundSupport.textContent = cameraEnabled ? "Choose an effect to preview it on your camera." : "Choose an effect now; it will apply when your camera starts.";
      backgroundButton?.setAttribute("aria-expanded", "true");
      if (typeof backgroundDialog?.showModal === "function") backgroundDialog.showModal();
      else backgroundDialog?.setAttribute("open", "");
    }

    function closeBackgroundDialog() {
      backgroundButton?.setAttribute("aria-expanded", "false");
      if (typeof backgroundDialog?.close === "function") backgroundDialog.close();
      else backgroundDialog?.removeAttribute("open");
      backgroundButton?.focus();
    }

    syncBackgroundOptions();

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
        rememberAttachedTrack(videoPublication.track, video);
      } else {
        const avatar = document.createElement("span");
        avatar.className = "live-media-avatar";
        avatar.textContent = (participant.name || "Guest").trim().slice(0, 1).toUpperCase() || "G";
        media.append(avatar);
      }
      if (!isLocal) publications(participant).filter(publication => (isSource(publication, "Microphone") || isSource(publication, "ScreenShareAudio")) && publication.track).forEach(publication => {
        const audio = publication.track.attach();
        Object.assign(audio, { autoplay: true, hidden: true, muted: participantAudioMuted(participant.identity) });
        audio.dataset.liveAudioParticipant = participant.identity;
        tile.append(audio);
        rememberAttachedTrack(publication.track, audio);
        audio.play?.().catch(error => {
          if (error?.name !== "NotAllowedError") return;
          audioPlaybackBlocked = true;
          syncAudioRecovery();
          setStatus("Browser blocked meeting audio. Select Enable Audio.", "error");
        });
      });
      const caption = document.createElement("footer");
      const label = document.createElement("strong");
      label.textContent = `${participant.name || "Guest"}${isLocal ? " (You)" : ""}`;
      const state = document.createElement("span");
      const micOn = publications(participant).some(publication => isSource(publication, "Microphone") && !publication.isMuted);
      const micAudible = micOn && !meetingMuted && !mutedParticipants.has(participant.identity);
      state.textContent = `${participantRole(participant) === "presenter" ? "Presenter" : "Audience"} · ${micAudible ? "Mic on" : "Muted"}`;
      caption.append(label, state);
      const raised = raisedHands.get(participant.identity);
      if (raised) {
        const hand = document.createElement("span");
        hand.className = "live-raised-hand";
        hand.textContent = "✋ Hand raised";
        caption.append(hand);
        tile.classList.add("has-raised-hand");
      }
      if (isController && !isLocal) {
        const participantActions = document.createElement("div");
        participantActions.className = "live-participant-actions";
        const mute = document.createElement("button");
        const muted = !micAudible;
        mute.type = "button";
        mute.className = "live-participant-mute";
        mute.innerHTML = muted
          ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"></rect><path d="M5 11a7 7 0 0 0 11.7 5.2M12 18v3M9 21h6M3 3l18 18"></path></svg>'
          : '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"></rect><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"></path></svg>';
        mute.disabled = meetingMuted;
        const muteLabel = meetingMuted ? "Everyone is muted. Turn off Mute all before changing one participant" : muted && !micOn ? `Ask ${participant.name || "participant"} to unmute their microphone` : `${muted ? "Unmute" : "Mute"} ${participant.name || "participant"}`;
        mute.setAttribute("aria-label", muteLabel);
        mute.title = muteLabel;
        mute.setAttribute("aria-pressed", String(muted));
        mute.addEventListener("click", event => {
          event.stopPropagation();
          if (muted) mutedParticipants.delete(participant.identity); else mutedParticipants.add(participant.identity);
          applyRemoteAudioState();
          renderParticipants();
          publishControllerState();
          options.socket?.emit("meeting_participant_audio", {
            presentationId: options.presentationId, authToken: options.authToken || "", shareToken: options.shareToken || "",
            targetIdentity: participant.identity, muted: !muted
          });
        });
        participantActions.append(mute);
        const registryItem = participantRegistry.get(String(participant.identity));
        if (registryItem?.clientId) {
          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "live-participant-remove";
          remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"></circle><path d="M3.5 19c.3-3 2.2-5 5.5-5s5.2 2 5.5 5M16 9l5 5m0-5-5 5"></path></svg>';
          remove.setAttribute("aria-label", `Move ${participant.name || "participant"} to the waiting room`);
          remove.title = `Move ${participant.name || "participant"} to the waiting room`;
          remove.addEventListener("click", event => {
            event.stopPropagation();
            options.socket?.emit("meeting_remove_participant", { ...moderationCredentials(), clientId: registryItem.clientId });
          });
          participantActions.append(remove);
        }
        caption.append(participantActions);
      }
      tile.append(media, caption);
      return tile;
    }

    function renderScreenShares() {
      if (!room) {
        detachNodeTracks(screenShareMedia);
        screenShareMedia.replaceChildren();
        screenShareRenderSignature = "";
        screenShareViewer.hidden = true;
        root.classList.remove("has-screen-share");
        return;
      }
      const sharers = [room.localParticipant, ...room.remoteParticipants.values()];
      const activeShares = [];
      sharers.forEach(participant => publications(participant)
        .filter(publication => isSource(publication, "ScreenShare") && publication.track && !publication.isMuted)
        .forEach(publication => activeShares.push({ participant, track: publication.track })));
      const availableIdentities = new Set(activeShares.map(item => item.participant.identity));
      if (isController && controllerShareIdentity && !availableIdentities.has(controllerShareIdentity)) {
        controllerShareIdentity = "";
        publishControllerState();
      }
      const controllerOverrideActive = availableIdentities.has(controllerShareIdentity);
      const requestedIdentity = controllerShareIdentity || selectedShareIdentity;
      const featuredIdentity = availableIdentities.has(requestedIdentity) ? requestedIdentity : (activeShares[0]?.participant.identity || "");
      if (!availableIdentities.has(selectedShareIdentity)) selectedShareIdentity = featuredIdentity;
      const renderSignature = `${activeShares.map(({ participant, track }) => `${participant.identity}:${track.sid || track.mediaStreamTrack?.id || "share"}`).join("|")}::${featuredIdentity}::${controllerShareIdentity}`;
      const visible = activeShares.length > 0;
      screenShareViewer.hidden = !visible;
      root.classList.toggle("has-screen-share", visible);
      screenShareMedia.classList.toggle("has-multiple", activeShares.length > 1);
      if (visible) screenShareLabel.textContent = activeShares.length === 1 ? `${activeShares[0].participant.name || "Guest"} is sharing` : `${activeShares.length} shared screens`;
      if (screenShareMode) screenShareMode.textContent = controllerOverrideActive
        ? "Controller-selected screen"
        : activeShares.length > 1 ? (isController ? "Choose the screen shown to everyone" : "Select a screen to focus") : "";
      if (renderSignature === screenShareRenderSignature) return;
      screenShareRenderSignature = renderSignature;
      detachNodeTracks(screenShareMedia);
      screenShareMedia.replaceChildren();
      const gallery = document.createElement("div");
      gallery.className = "live-screen-share-gallery";
      gallery.setAttribute("aria-label", "Other shared screens");
      activeShares.forEach(({ participant, track }) => {
        const figure = document.createElement("figure");
        figure.dataset.participantIdentity = participant.identity;
        figure.classList.toggle("is-featured", participant.identity === featuredIdentity);
        const video = track.attach();
        Object.assign(video, { autoplay: true, playsInline: true, muted: participant === room.localParticipant });
        rememberAttachedTrack(track, video);
        const caption = document.createElement("figcaption");
        caption.textContent = `${participant.name || "Guest"}${participant === room.localParticipant ? " (You)" : ""}`;
        const actions = document.createElement("div");
        actions.className = "live-screen-share-actions";
        if (activeShares.length > 1) {
          const select = document.createElement("button");
          select.type = "button";
          const controllerLocked = controllerOverrideActive && !isController;
          const selectLabel = participant.identity === featuredIdentity ? `${participant.name || "Guest"}'s screen is showing` : controllerLocked ? "The controller has selected another screen" : (isController ? `Show ${participant.name || "Guest"}'s screen to everyone` : `Focus ${participant.name || "Guest"}'s screen`);
          select.textContent = participant.identity === featuredIdentity ? "●" : controllerLocked ? "🔒" : "◎";
          select.setAttribute("aria-label", selectLabel);
          select.title = selectLabel;
          select.disabled = participant.identity === featuredIdentity || controllerLocked;
          select.addEventListener("click", () => {
            selectedShareIdentity = participant.identity;
            if (isController) {
              controllerShareIdentity = participant.identity;
              publishControllerState();
            }
            renderParticipants();
          });
          actions.append(select);
        }
        const fullscreen = document.createElement("button");
        fullscreen.type = "button";
        fullscreen.textContent = "⛶";
        fullscreen.setAttribute("aria-label", `View ${participant.name || "Guest"}'s screen fullscreen`);
        fullscreen.title = fullscreen.getAttribute("aria-label");
        fullscreen.addEventListener("click", () => figure.requestFullscreen?.().catch(() => {}));
        actions.append(fullscreen);
        if (isController && participant !== room.localParticipant) {
          const revoke = document.createElement("button");
          revoke.type = "button";
          revoke.className = "is-danger";
          revoke.textContent = "×";
          revoke.setAttribute("aria-label", `Stop ${participant.name || "Guest"}'s screen share`);
          revoke.title = revoke.getAttribute("aria-label");
          revoke.addEventListener("click", () => options.socket?.emit("meeting_screen_share_revoke", {
            ...moderationCredentials(), targetIdentity: participant.identity
          }));
          actions.append(revoke);
        }
        figure.append(video, caption, actions);
        if (participant.identity === featuredIdentity) screenShareMedia.append(figure);
        else gallery.append(figure);
      });
      if (gallery.childElementCount) screenShareMedia.append(gallery);
    }

    function participantRenderSignature(participant, isLocal) {
      const publicationState = publications(participant).map(publication => [
        publication.trackSid || publication.sid || publication.track?.sid || publication.track?.mediaStreamTrack?.id || "track",
        publication.source || "",
        publication.isMuted ? "muted" : "live",
        publication.track ? "attached" : "pending"
      ].join(":")).sort().join("|");
      const registryItem = participantRegistry.get(String(participant.identity));
      return [participant.identity, participant.name, participant.metadata, isLocal, publicationState,
        raisedHands.has(participant.identity), meetingMuted, mutedParticipants.has(participant.identity), registryItem?.clientId || ""].join("::");
    }

    function renderParticipants() {
      if (!room) { count.textContent = "0 connected"; if (restoreCount) restoreCount.textContent = "0"; return; }
      if (isController && mutedParticipants.size) {
        const connectedIdentities = new Set([room.localParticipant.identity, ...[...room.remoteParticipants.values()].map(participant => participant.identity)]);
        const activeMuted = new Set([...mutedParticipants].filter(identity => connectedIdentities.has(identity)));
        if (activeMuted.size !== mutedParticipants.size) {
          mutedParticipants = activeMuted;
          publishControllerState();
        }
      }
      const participants = [{ participant: room.localParticipant, isLocal: true }, ...[...room.remoteParticipants.values()].map(participant => ({ participant, isLocal: false }))];
      const existingTiles = new Map([...tiles.querySelectorAll("[data-participant-identity]")].map(tile => [tile.dataset.participantIdentity, tile]));
      const activeIdentities = new Set();
      participants.forEach(({ participant, isLocal }, index) => {
        const identity = String(participant.identity);
        const signature = participantRenderSignature(participant, isLocal);
        let tile = existingTiles.get(identity);
        if (!tile || tile.dataset.renderSignature !== signature) {
          const replacement = addParticipantTile(participant, isLocal);
          replacement.dataset.renderSignature = signature;
          if (tile) { detachNodeTracks(tile); tile.replaceWith(replacement); }
          else tiles.append(replacement);
          tile = replacement;
        }
        const currentAtIndex = tiles.children[index];
        if (currentAtIndex !== tile) tiles.insertBefore(tile, currentAtIndex || null);
        activeIdentities.add(identity);
      });
      existingTiles.forEach((tile, identity) => {
        if (activeIdentities.has(identity)) return;
        detachNodeTracks(tile);
        tile.remove();
      });
      renderScreenShares();
      const total = room.remoteParticipants.size + 1;
      count.textContent = `${total} connected`;
      if (peopleBadge) peopleBadge.textContent = String(total);
      if (restoreCount) restoreCount.textContent = String(total);
    }

    function scheduleParticipantRender() {
      if (participantRenderTimer) return;
      participantRenderTimer = window.setTimeout(() => {
        participantRenderTimer = 0;
        renderParticipants();
      }, 60);
    }

    function highlightSpeakers(speakers) {
      const active = new Set((speakers || []).map(participant => participant.identity));
      tiles.querySelectorAll("[data-participant-identity]").forEach(tile => tile.classList.toggle("is-speaking", active.has(tile.dataset.participantIdentity)));
    }

    function syncButtons(connected) {
      root.classList.toggle("is-connected", connected);
      if (!connected) setAudienceSidebarHidden(false);
      joinButton.hidden = connected;
      joinButton.disabled = joining || (!isController && admissionState === "waiting");
      joinButton.textContent = !isController && admissionState === "waiting" ? "Waiting for presenter…" : (isController ? "Join audio/video" : "Ask to join meeting");
      nameInput.disabled = connected || joining || (!isController && admissionState === "waiting");
      microphoneButton.disabled = !connected;
      cameraButton.disabled = !connected;
      screenShareButton.disabled = !connected;
      if (backgroundButton) backgroundButton.disabled = !connected;
      if (muteAllButton) muteAllButton.disabled = !connected;
      if (handButton) handButton.disabled = !connected;
      reactionButtons.forEach(button => { button.disabled = !connected; });
      if (chatInput) chatInput.disabled = !connected;
      if (chatSubmit) chatSubmit.disabled = !connected;
      leaveButton.disabled = !connected;
      setControlLabel(microphoneButton, isController ? (microphoneEnabled ? "Mic on" : "Mic off") : (microphoneEnabled ? "Mute" : "Unmute"), microphoneEnabled ? "Microphone is on. Select to mute" : "Microphone is off. Select to unmute");
      setControlLabel(cameraButton, cameraEnabled ? "Camera off" : "Camera on", cameraEnabled ? "Turn camera off" : "Turn camera on");
      if (screenShareEnabled) setControlLabel(screenShareButton, "Stop share", "Stop sharing your screen");
      else if (screenShareRequestPending) setControlLabel(screenShareButton, "Pending", "Screen share request pending");
      else if (screenShareApproved) setControlLabel(screenShareButton, "Start share", "Start approved screen share");
      else setControlLabel(screenShareButton, "Share", isController ? "Share screen" : "Request screen share");
      screenShareButton.disabled = !connected || screenShareRequestPending;
      microphoneButton.setAttribute("aria-pressed", String(microphoneEnabled));
      cameraButton.setAttribute("aria-pressed", String(cameraEnabled));
      screenShareButton.setAttribute("aria-pressed", String(screenShareEnabled));
      applyRemoteAudioState();
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
        panelToggle.setAttribute("aria-label", collapsed ? "Show people panel" : "Hide people panel");
        panelToggle.title = panelToggle.getAttribute("aria-label");
      }
      if (panelRestore) panelRestore.hidden = !collapsed;
      if (moveFocus) (collapsed ? panelRestore : panelToggle)?.focus();
    }

    function syncAudioRecovery() {
      enableAudioButton.hidden = !room || (!audioPlaybackBlocked && room.canPlayAudio !== false);
    }

    async function enableAudio(showSuccess = true) {
      if (!room) return false;
      try {
        let presentationAudioReady = true;
        try { presentationAudioReady = (await options.onEnableAudio?.()) !== false; } catch { presentationAudioReady = false; }
        await room.startAudio();
        const audioResults = await Promise.allSettled([...root.querySelectorAll("audio[data-live-audio-participant]")].map(audio => audio.play()));
        audioPlaybackBlocked = !presentationAudioReady || audioResults.some(result => result.status === "rejected");
        syncAudioRecovery();
        const ready = !audioPlaybackBlocked && room.canPlayAudio !== false;
        if (showSuccess) setStatus(ready ? "Audio enabled" : "Audio is still blocked. Check this tab's sound permission.", ready ? "success" : "error");
        return ready;
      } catch (error) {
        enableAudioButton.hidden = false;
        setStatus(error.message || "Browser blocked audio. Select Enable Audio.", "error");
        return false;
      }
    }

    function bindRoomEvents() {
      const events = livekit.RoomEvent;
      [events.ParticipantDisconnected, events.TrackSubscribed, events.TrackUnsubscribed,
        events.TrackPublished, events.TrackUnpublished, events.TrackMuted, events.TrackUnmuted]
        .filter(Boolean).forEach(eventName => room.on(eventName, scheduleParticipantRender));

      if (events.ParticipantConnected) {
        room.on(events.ParticipantConnected, participant => {
          scheduleParticipantRender();
          playParticipantJoinSound(participant);
        });
      }
      room.on(events.LocalTrackPublished, () => { syncLocalPublishedState(); syncButtons(true); scheduleParticipantRender(); });
      room.on(events.LocalTrackUnpublished, publication => {
        const stoppedScreenShare = isSource(publication, "ScreenShare") || isSource(publication, "ScreenShareAudio");
        if (isSource(publication, "Camera")) { backgroundProcessor = null; backgroundProcessorTrack = null; }
        syncLocalPublishedState(); syncButtons(true); scheduleParticipantRender();
        if (stoppedScreenShare && !screenShareEnabled) setStatus("Screen sharing stopped");
      });
      room.on(events.ActiveSpeakersChanged, highlightSpeakers);
      if (events.AudioPlaybackStatusChanged) room.on(events.AudioPlaybackStatusChanged, syncAudioRecovery);
      room.on(events.Reconnecting, () => setStatus("Reconnecting…"));
      room.on(events.Reconnected, () => { syncLocalPublishedState(); syncButtons(true); renderParticipants(); syncAudioRecovery(); setStatus("Connected", "success"); });
      room.on(events.Disconnected, () => {
        joinNotificationArmed = false;
        microphoneEnabled = false; cameraEnabled = false; screenShareEnabled = false; audioPlaybackBlocked = false; detachMountedTracks(); room = null;
        backgroundProcessor = null; backgroundProcessorTrack = null;
        tiles.replaceChildren(); screenShareMedia.replaceChildren(); screenShareViewer.hidden = true; enableAudioButton.hidden = true;
        root.classList.remove("has-screen-share"); count.textContent = "0 connected"; setStatus("Left the live room"); syncButtons(false);
      });
    }

    let admissionValidating = false;
    async function requestAdmission() {
      if (joining || room || admissionState === "waiting" || admissionValidating) return;
      const name = nameInput.value.trim();
      if (!name) { setStatus("Enter your name before asking to join", "error"); nameInput.focus(); return; }
      admissionValidating = true;
      joinButton.disabled = true;
      try { await options.onValidateAdmission?.(); }
      catch (error) { setStatus(error.message || "Check your meeting access code and try again.", "error"); return; }
      finally { admissionValidating = false; if (admissionState !== "waiting") joinButton.disabled = false; }
      admissionState = "waiting";
      setStatus("Waiting for the presenter to admit you…");
      syncButtons(false);
      emitAdmissionRequest();
    }

    function emitAdmissionRequest() {
      options.socket?.emit("meeting_admission_request", {
        presentationId: options.presentationId, clientId: meetingClientId, name: nameInput.value.trim()
      });
    }

    async function join(approved = false) {
      if (!isController && approved !== true) { requestAdmission(); return; }
      if (joining || room) return;
      if (!livekit?.Room) { setStatus("Audio/video library could not be loaded", "error"); return; }
      if (!api?.getLiveMediaToken) { setStatus("This page is out of date. Refresh it and try again.", "error"); return; }
      // Run presentation audio playback directly inside the user gesture. This
      // also unlocks the document's audio playback before the async room join.
      try { options.onEnableAudio?.(); } catch {}
      unlockReactionAudio();
      if (options.fullscreenTarget && options.fullscreenOnJoin !== false && !document.fullscreenElement) options.fullscreenTarget.requestFullscreen?.().catch(() => {});
      joining = true; joinButton.disabled = true; nameInput.disabled = true; setStatus("Joining…");
      try {
        room = new livekit.Room({ adaptiveStream: true, dynacast: true });
        bindRoomEvents();
        // startAudio must run while the click's user activation is still valid.
        // Keep the promise and check it again after the asynchronous room connect.
        let audioUnlock = Promise.resolve(false);
        try { audioUnlock = Promise.resolve(room.startAudio()).then(() => true).catch(() => false); } catch {}
        const credentials = await api.getLiveMediaToken(options.presentationId, {
          displayName: nameInput.value.trim(), shareToken: options.shareToken || "", screenAccessCode: options.getScreenAccessCode?.() || options.screenAccessCode || undefined,
          clientId: meetingClientId
        });
        await room.connect(credentials.url, credentials.token, { autoSubscribe: true });
        const gestureUnlocked = await audioUnlock;
        const connectedAudioReady = await enableAudio(false);
        const audioReady = connectedAudioReady || (gestureUnlocked && !audioPlaybackBlocked && room.canPlayAudio !== false);
        admissionState = "approved";
        if (!isController) options.socket?.emit("meeting_participant_joined", {
          presentationId: options.presentationId, clientId: meetingClientId,
          identity: room.localParticipant.identity, name: credentials.participantName
        });
        setStatus(audioReady ? `Connected as ${credentials.participantName}` : `Connected as ${credentials.participantName} · audio needs permission`, audioReady ? "success" : "error");
        syncButtons(true); renderParticipants();
        joinNotificationArmed = true;
        if (!isController) setAudienceSidebarHidden(false);
      } catch (error) {
        room?.disconnect(); room = null;
        if (!isController) admissionState = "idle";
        setStatus(error.message || "Could not join audio/video", "error"); syncButtons(false);
      } finally {
        joining = false; syncButtons(Boolean(room));
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
      try {
        await room.localParticipant.setCameraEnabled(!cameraEnabled);
        syncLocalPublishedState();
        if (cameraEnabled && selectedBackground !== "none") await applySelectedCameraBackground(false);
        syncButtons(true); renderParticipants();
      }
      catch (error) { syncLocalPublishedState(); setStatus(error.message || "Camera permission was not granted", "error"); syncButtons(true); }
    }

    async function toggleScreenShare() {
      if (!room) return;
      const enable = !screenShareEnabled;
      if (enable && typeof navigator.mediaDevices?.getDisplayMedia !== "function") {
        setStatus("This browser cannot capture your screen. You can share your camera here, or use a desktop browser to share a screen.", "error");
        return;
      }
      if (enable && !isController && !screenShareApproved) {
        screenShareRequestPending = true;
        setStatus("Waiting for the presenter to allow screen sharing…");
        syncButtons(true);
        options.socket?.emit("meeting_screen_share_request", {
          presentationId: options.presentationId, clientId: meetingClientId,
          identity: currentIdentity(), name: currentName()
        });
        return;
      }
      if (enable) screenShareApproved = false;
      screenShareButton.disabled = true;
      try {
        await room.localParticipant.setScreenShareEnabled(enable);
        screenShareRequestPending = false;
        syncLocalPublishedState(); syncButtons(true); renderParticipants();
        setStatus(screenShareEnabled ? "Screen sharing started" : "Screen sharing stopped", "success");
      } catch (error) {
        screenShareRequestPending = false;
        syncLocalPublishedState(); syncButtons(true);
        const cancelled = error?.name === "NotAllowedError" || /cancel|permission|denied/i.test(error?.message || "");
        setStatus(cancelled ? "Screen sharing was cancelled or blocked by browser permission" : (error.message || "Screen sharing could not start"), "error");
      }
    }

    async function leave({ requeue = false } = {}) {
      const activeRoom = room;
      if (!activeRoom) return;
      if (!isController && !requeue) options.socket?.emit("meeting_participant_left", { presentationId: options.presentationId, clientId: meetingClientId });
      if (handRaised) options.socket?.emit("meeting_hand", { presentationId: options.presentationId, identity: currentIdentity(), name: currentName(), raised: false });
      await Promise.allSettled([
        activeRoom.localParticipant.setMicrophoneEnabled(false),
        activeRoom.localParticipant.setCameraEnabled(false),
        activeRoom.localParticipant.setScreenShareEnabled(false)
      ]);
      detachMountedTracks();
      activeRoom.disconnect();
    }

    async function recoverMeetingAfterBackground() {
      if (!room || document.visibilityState !== "visible") return;

      try {
        await room.startAudio();
        audioPlaybackBlocked = false;
      } catch {
        audioPlaybackBlocked = room?.canPlayAudio === false;
      }

      syncLocalPublishedState();
      syncButtons(true);
      renderParticipants();
      syncAudioRecovery();
    }

    joinButton.addEventListener("click", join);
    nameInput.addEventListener("keydown", event => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      joinButton.click();
    });
    microphoneButton.addEventListener("click", toggleMicrophone);
    cameraButton.addEventListener("click", toggleCamera);
    screenShareButton.addEventListener("click", toggleScreenShare);
    backgroundButton?.addEventListener("click", openBackgroundDialog);
    backgroundCloseButton?.addEventListener("click", closeBackgroundDialog);
    backgroundDialog?.addEventListener("close", () => backgroundButton?.setAttribute("aria-expanded", "false"));
    backgroundDialog?.addEventListener("click", event => { if (event.target === backgroundDialog) closeBackgroundDialog(); });
    backgroundOptions.forEach(button => button.addEventListener("click", async () => {
      selectedBackground = button.dataset.liveBackgroundOption || "none";
      localStorage.setItem("presentStudio.cameraBackground", selectedBackground);
      syncBackgroundOptions();
      await applySelectedCameraBackground(true);
    }));
    muteAllButton?.addEventListener("click", () => {
      meetingMuted = !meetingMuted;
      applyRemoteAudioState();
      publishControllerState();
      options.socket?.emit("meeting_participant_audio", {
        presentationId: options.presentationId, authToken: options.authToken || "", shareToken: options.shareToken || "",
        targetIdentity: "*", muted: meetingMuted
      });
    });
    handButton?.addEventListener("click", () => {
      if (!room) return;
      handRaised = !handRaised;
      handButton.setAttribute("aria-pressed", String(handRaised));
      handButton.lastElementChild.textContent = handRaised ? "Lower hand" : "Raise hand";
      options.socket?.emit("meeting_hand", { presentationId: options.presentationId, identity: currentIdentity(), name: currentName(), raised: handRaised });
    });
    reactionButtons.forEach(button => button.addEventListener("click", () => {
      if (!room) return;
      unlockReactionAudio();
      options.socket?.emit("meeting_reaction", { presentationId: options.presentationId, identity: currentIdentity(), name: currentName(), reaction: button.dataset.liveReaction });
    }));
    sidebarTabs.forEach(button => button.addEventListener("click", () => setSidebarTab(button.dataset.liveTab)));
    chatForm?.addEventListener("submit", event => {
      event.preventDefault();
      const text = chatInput.value.trim();
      if (!room || !text) return;
      options.socket?.emit("meeting_chat", { presentationId: options.presentationId, identity: currentIdentity(), name: currentName(), text });
      chatInput.value = "";
      chatInput.focus();
    });
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
    if (sheetHandle && !isController) {
      let startY = null;
      sheetHandle.addEventListener("pointerdown", event => {
        startY = event.clientY;
        sheetHandle.setPointerCapture?.(event.pointerId);
      });
      sheetHandle.addEventListener("pointerup", event => {
        if (startY === null) return;
        const distance = event.clientY - startY;
        startY = null;
        if (distance > 36) setAudienceSidebarHidden(true, true);
        else if (distance < -36) setAudienceSidebarHidden(false, true);
        else setAudienceSidebarHidden(!root.classList.contains("is-sidebar-hidden"), true);
      });
      sheetHandle.addEventListener("pointercancel", () => { startY = null; });
      sheetHandle.addEventListener("click", event => {
        if (event.detail === 0) setAudienceSidebarHidden(!root.classList.contains("is-sidebar-hidden"), true);
      });
      sheetHandle.addEventListener("keydown", event => {
        if (event.key === "ArrowDown") { event.preventDefault(); setAudienceSidebarHidden(true, true); }
        if (event.key === "ArrowUp") { event.preventDefault(); setAudienceSidebarHidden(false, true); }
      });
    }
    options.socket?.on("meeting_control_state", applyControllerState);
    options.socket?.on("meeting_participant_audio_command", applyParticipantAudioCommand);
    options.socket?.on("meeting_chat_message", message => { if (message?.presentationId === options.presentationId) appendChatMessage(message); });
    options.socket?.on("meeting_reaction_event", message => { if (message?.presentationId === options.presentationId) showReaction(message); });
    options.socket?.on("meeting_hand_state", message => {
      if (message?.presentationId !== options.presentationId || !message.identity) return;
      if (message.raised) raisedHands.set(String(message.identity), String(message.name || "Guest")); else raisedHands.delete(String(message.identity));
      renderParticipants();
    });
    options.socket?.on("meeting_lobby_state", renderLobby);
    options.socket?.on("meeting_admission_decision", message => {
      if (isController || message?.presentationId !== options.presentationId || message.clientId !== meetingClientId) return;
      if (message.accepted) {
        admissionState = "approved";
        setStatus("The presenter admitted you. Joining…", "success");
        join(true);
      } else {
        admissionState = "idle";
        setStatus("The presenter did not admit this request. You can ask again.", "error");
        syncButtons(false);
      }
    });
    options.socket?.on("meeting_removed_by_controller", async message => {
      if (isController || message?.presentationId !== options.presentationId || message.clientId !== meetingClientId) return;
      admissionState = "waiting";
      screenShareRequestPending = false;
      screenShareApproved = false;
      await leave({ requeue: true });
      setStatus("The presenter moved you to the waiting room.");
      syncButtons(false);
    });
    options.socket?.on("meeting_screen_share_decision", message => {
      if (isController || message?.presentationId !== options.presentationId || message.clientId !== meetingClientId) return;
      screenShareRequestPending = false;
      if (message.accepted) {
        screenShareApproved = true;
        setStatus("Screen sharing approved. Select Start Approved Share.", "success");
        syncButtons(true);
      } else {
        setStatus("The presenter declined the screen sharing request.", "error");
        syncButtons(true);
      }
    });
    options.socket?.on("meeting_screen_share_revoke_command", async message => {
      if (!room || message?.presentationId !== options.presentationId || message.targetIdentity !== currentIdentity()) return;
      screenShareApproved = false;
      if (room.localParticipant.isScreenShareEnabled) await room.localParticipant.setScreenShareEnabled(false).catch(() => {});
      syncLocalPublishedState(); syncButtons(true); renderParticipants();
      setStatus("The presenter stopped your screen share.");
    });
    options.socket?.on("connect", () => {
      if (isController) registerController();
      else if (admissionState === "waiting") emitAdmissionRequest();
    });
    if (options.socket?.connected) registerController();

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        recoverMeetingAfterBackground().catch(() => {});
      }
    });

    window.addEventListener("pageshow", () => {
      recoverMeetingAfterBackground().catch(() => {});
    });

    ensureJoinSoundControl();
    syncButtons(false);
    setSidebarTab("people");
    return { join, leave };
  }

  window.SnapKeyLiveMedia = { create };
})();
