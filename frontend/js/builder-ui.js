(() => {
  "use strict";

  const byId = (id) => document.getElementById(id);
  const all = (selector) => [...document.querySelectorAll(selector)];
  const titleInput = byId("presentationTitleInput");
  const saveStatus = byId("saveStatus");
  const notesTray = byId("notesTray");
  const notesEditor = byId("notesEditor");
  const shareModal = byId("shareModal");
  const uploadOverlay = byId("builderUploadOverlay");
  const MAX_MEDIA_UPLOAD_BYTES = 100 * 1024 * 1024;
  const MAX_MEDIA_UPLOAD_LABEL = "100 MB";
  let builderClipboard = null;
  let builderClipboardText = "";
  let zoom = 100;
  let builderUploadRequestId = 0;

  function safeColor(value, fallback = "#171717") {
    return /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(String(value || "")) ? value : fallback;
  }

  function thumbnailObjectMarkup(object, legacy = false) {
    const left = legacy ? Number(object.x || 0) : Number(object.left || 0) / 12.8;
    const top = legacy ? Number(object.y || 0) : Number(object.top || 0) / 7.2;
    const width = legacy ? Number(object.width || 40) : Number(object.width || 40) * Number(object.scaleX || 1) / 12.8;
    const height = legacy ? Number(object.height || 18) : Number(object.height || object.fontSize || 40) * Number(object.scaleY || 1) / 7.2;
    const rotation = Number(object.angle || 0);
    const style = `left:${left}%;top:${top}%;width:${Math.max(2, width)}%;height:${Math.max(2, height)}%;transform:rotate(${rotation}deg);`;
    const mediaType = object.mediaType || object.type;
    if (mediaType === "image" && object.src) {
      return `<span class="slide-thumbnail-object is-image" style="${style}"><img src="${esc(object.src)}" alt=""></span>`;
    }
    if (mediaType === "video" && object.src) {
      return `<span class="slide-thumbnail-object is-video" style="${style}"><video src="${esc(object.src)}" muted preload="metadata" playsinline></video></span>`;
    }
    if (["textbox", "text", "i-text"].includes(object.type)) {
      const fontSize = legacy ? Number(object.fontSize || 32) / 7 : Number(object.fontSize || 32) / 7;
      const font = ["Arial", "Calibri", "Inter", "Verdana", "Tahoma", "Trebuchet MS", "Georgia", "Times New Roman", "Garamond", "Palatino Linotype", "Courier New", "Impact"].includes(object.fontFamily) ? object.fontFamily : "Arial";
      return `<span class="slide-thumbnail-object is-text" style="${style}font-size:${Math.max(5, fontSize)}px;font-family:${font};font-weight:${esc(object.fontWeight || "normal")};color:${safeColor(object.fill || object.color)};text-align:${esc(object.textAlign || "left")};">${esc(object.text || "")}</span>`;
    }
    return `<span class="slide-thumbnail-object" style="${style}background:${safeColor(object.fill, "#f5c842")};border:1px solid ${safeColor(object.stroke, "transparent")};"></span>`;
  }

  renderList = function renderBuilderSlideList() {
    if (!presentation) return;
    byId("slideList").innerHTML = presentation.slides.map((slide, index) => {
      const data = ensure(slide).canvas;
      const fabricObjects = data.fabric?.objects || [];
      const legacyObjects = fabricObjects.length ? [] : (data.elements || []);
      const objects = fabricObjects.map((object) => thumbnailObjectMarkup(object)).join("") + legacyObjects.map((object) => thumbnailObjectMarkup(object, true)).join("");
      const audioBadge = data.audio?.src ? '<span class="slide-thumbnail-audio" title="Slide has music"><i class="bi bi-music-note-beamed"></i></span>' : "";
      return `<article class="slide-item ${index === currentSlideIndex ? "active" : ""}" data-index="${index}" data-slide-number="${index + 1}" tabindex="0" role="button" aria-label="Open slide ${index + 1}: ${esc(slide.title || "Untitled slide")}"><div class="slide-thumbnail-stage" style="--slide-thumbnail-bg:${safeColor(data.background, "#fffefb")}">${objects}${audioBadge}</div><div class="slide-actions-inline"><button type="button" data-slide-duplicate="${index}" aria-label="Duplicate slide ${index + 1}" title="Duplicate"><i class="bi bi-copy"></i></button><button class="is-danger" type="button" data-slide-delete="${index}" aria-label="Delete slide ${index + 1}" title="Delete"><i class="bi bi-trash"></i></button></div></article>`;
    }).join("");
    all("#slideList .slide-item").forEach((item) => {
      const open = () => { capture(); currentSlideIndex = Number(item.dataset.index); render(); };
      item.addEventListener("click", (event) => { if (!event.target.closest(".slide-actions-inline")) open(); });
      item.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } });
    });
    all("[data-slide-duplicate]").forEach((button) => button.addEventListener("click", (event) => {
      event.stopPropagation(); capture(); currentSlideIndex = Number(button.dataset.slideDuplicate); duplicateSlide();
    }));
    all("[data-slide-delete]").forEach((button) => button.addEventListener("click", (event) => {
      event.stopPropagation(); currentSlideIndex = Number(button.dataset.slideDelete); deleteSlide();
    }));
  };

  function updateVideoOverlays() {
    if (!canvas || !byId("slideCanvas")) return;
    const host = byId("slideCanvas");
    const container = host.querySelector(".canvas-container");
    if (!container) return;
    const scaleX = container.clientWidth / canvas.getWidth();
    const scaleY = container.clientHeight / canvas.getHeight();
    const liveIds = new Set();
    canvas.getObjects().filter((object) => object.mediaType === "video" && object.src).forEach((object) => {
      const id = String(object.id || `video_${canvas.getObjects().indexOf(object)}`);
      liveIds.add(id);
      let video = [...host.querySelectorAll(".fabric-video-overlay")].find((item) => item.dataset.objectId === id);
      let control = [...host.querySelectorAll(".fabric-video-control")].find((item) => item.dataset.objectId === id);
      if (!video) {
        video = document.createElement("video");
        video.className = "fabric-video-overlay";
        video.dataset.objectId = id;
        video.src = object.src;
        video.preload = "metadata";
        video.playsInline = true;
        host.append(video);
      }
      if (!control) {
        control = document.createElement("button");
        control.className = "fabric-video-control";
        control.dataset.objectId = id;
        control.type = "button";
        control.setAttribute("aria-label", "Play video");
        control.innerHTML = '<i class="bi bi-play-fill"></i>';
        control.addEventListener("click", async () => {
          if (video.paused) {
            // This click is a browser-approved user gesture, so enable the
            // video's audio here instead of leaving editor videos permanently muted.
            video.muted = false;
            object.muted = false;
            try {
              await video.play();
              control.innerHTML = '<i class="bi bi-pause-fill"></i>';
              control.setAttribute("aria-label", "Pause video");
              if (typeof schedule === "function") schedule();
            } catch {
              // Some browsers/codecs still require muted playback. Keep playback
              // usable and tell the user rather than failing silently.
              video.muted = true;
              try {
                await video.play();
                control.innerHTML = '<i class="bi bi-pause-fill"></i>';
                control.setAttribute("aria-label", "Pause video");
                toast("Video is playing muted because the browser blocked audio playback.");
              } catch {
                toast("The browser could not play this video format.");
              }
            }
          } else {
            video.pause();
            control.innerHTML = '<i class="bi bi-play-fill"></i>';
            control.setAttribute("aria-label", "Play video");
          }
        });
        video.addEventListener("play", () => {
          control.innerHTML = '<i class="bi bi-pause-fill"></i>';
          control.setAttribute("aria-label", "Pause video");
        });
        video.addEventListener("pause", () => {
          control.innerHTML = '<i class="bi bi-play-fill"></i>';
          control.setAttribute("aria-label", "Play video");
        });
        host.append(control);
      }
      // Keep the HTML media element synchronized with the Fabric placeholder.
      if (video.src !== new URL(object.src, location.href).href) video.src = object.src;
      video.loop = Boolean(object.loop ?? true);
      if (video.paused) video.muted = Boolean(object.muted ?? false);
      video.style.objectFit = object.fit || "contain";
      const bounds = object.getBoundingRect(true, true);
      const left = container.offsetLeft + bounds.left * scaleX;
      const top = container.offsetTop + bounds.top * scaleY;
      const width = Math.max(36, bounds.width * scaleX);
      const height = Math.max(30, bounds.height * scaleY);
      Object.assign(video.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
      Object.assign(control.style, { left: `${left + width / 2 - 16}px`, top: `${top + height / 2 - 16}px` });
    });
    all(".fabric-video-overlay, .fabric-video-control").forEach((item) => { if (!liveIds.has(item.dataset.objectId)) item.remove(); });
  }

  function queueVideoOverlayUpdate() { window.requestAnimationFrame(updateVideoOverlays); }

  function renderSlideAudio() {
    const dock = byId("slideAudioPlayer");
    const player = byId("slideAudioElement");
    const track = presentation ? ensure(activeSlide()).canvas.audio : null;
    if (!track?.src) {
      player.pause();
      player.removeAttribute("src");
      dock.hidden = true;
      return;
    }
    if (player.src !== new URL(track.src, location.href).href) player.src = track.src;
    player.loop = track.loop !== false;
    byId("slideAudioName").textContent = track.name || "Slide music";
    dock.hidden = false;
  }

  const originalAddAsset = addAsset;
  addAsset = function addBuilderAsset(asset, announce = true) {
    if (!asset) return;
    if (asset.mimeType.startsWith("audio/")) {
      ensure(activeSlide()).canvas.audio = { id: asset.id, src: asset.url, name: asset.name, loop: true };
      renderSlideAudio();
      renderList();
      schedule();
      renderUploadStatus("success", `${asset.name} added as music for this slide.`);
      if (announce) toast("Music added to this slide.");
      return;
    }
    originalAddAsset(asset, announce);
    const refreshThumbnail = () => {
      if (!presentation || loading) return;
      capture();
      renderList();
      queueVideoOverlayUpdate();
      schedule();
    };
    window.setTimeout(refreshThumbnail, 30);
    if (asset.mimeType.startsWith("image/")) window.setTimeout(refreshThumbnail, 900);
  };

  uploadFile = async function uploadFileWithProgress(file) {
    if (file.size > MAX_MEDIA_UPLOAD_BYTES) {
      retryUploadFile = null;
      renderUploadStatus("error", `${file.name} is too large. Maximum upload size is ${MAX_MEDIA_UPLOAD_LABEL}.`);
      toast(`Maximum upload size is ${MAX_MEDIA_UPLOAD_LABEL}.`);
      return null;
    }
    const requestId = ++builderUploadRequestId;
    retryUploadFile = null;
    const title = byId("builderUploadTitle");
    const filename = byId("builderUploadFile");
    const bar = byId("builderUploadBar");
    const percentage = byId("builderUploadPercent");
    const setProgress = (value) => {
      const progress = Math.max(0, Math.min(100, Math.round(value)));
      bar.style.width = `${progress}%`;
      percentage.textContent = `${progress}%`;
    };
    title.textContent = "Uploading media…";
    filename.textContent = file.name;
    setProgress(0);
    uploadOverlay.hidden = false;
    uploadOverlay.setAttribute("aria-busy", "true");
    renderUploadStatus("uploading", `Uploading… ${file.name}`);

    return new Promise((resolve) => {
      const request = new XMLHttpRequest();
      request.open("POST", "/api/media/upload");
      request.withCredentials = true;
      const token = localStorage.getItem("presentStudio.accessToken");
      if (token) request.setRequestHeader("Authorization", `Bearer ${token}`);
      request.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable && requestId === builderUploadRequestId) setProgress(event.loaded / event.total * 100);
      });
      const fail = (message) => {
        if (requestId !== builderUploadRequestId) return resolve(null);
        retryUploadFile = file;
        title.textContent = "Upload failed";
        uploadOverlay.setAttribute("aria-busy", "false");
        renderUploadStatus("error", message);
        window.setTimeout(() => { uploadOverlay.hidden = true; }, 900);
        resolve(null);
      };
      request.addEventListener("error", () => fail("Upload failed because the server could not be reached."));
      request.addEventListener("load", () => {
        let body = {};
        try { body = JSON.parse(request.responseText || "{}"); } catch { body = {}; }
        if (request.status < 200 || request.status >= 300 || !body.asset) {
          const message = body.detail || body.error || `Upload failed (${request.status || "network error"}).`;
          return fail(String(message).includes("Cloudinary") ? "Media storage is not configured on this server." : message);
        }
        if (requestId !== builderUploadRequestId) return resolve(null);
        setProgress(100);
        title.textContent = "Upload complete";
        uploadOverlay.setAttribute("aria-busy", "false");
        mediaAssets.unshift(body.asset);
        addAsset(body.asset, false);
        mediaLibrary();
        renderUploadStatus("success", `${file.name} uploaded successfully.`);
        window.setTimeout(() => { uploadOverlay.hidden = true; }, 450);
        window.setTimeout(queueVideoOverlayUpdate, 80);
        resolve(body);
      });
      const form = new FormData();
      form.append("file", file);
      request.send(form);
    });
  };

  function setSaveAppearance(value) {
    saveStatus.classList.toggle("is-saving", /saving|loading/i.test(value));
    saveStatus.classList.toggle("is-error", /failed|error/i.test(value));
  }

  const statusObserver = new MutationObserver(() => setSaveAppearance(byId("modeLabel").textContent));
  statusObserver.observe(byId("modeLabel"), { childList: true, characterData: true, subtree: true });

  const originalRender = render;
  render = function renderBuilder() {
    originalRender();
    if (presentation) {
      titleInput.value = presentation.title || "Untitled presentation";
      const slide = activeSlide();
      notesEditor.value = slide?.canvas?.notes || "";
    }
    renderSlideAudio();
    window.setTimeout(queueVideoOverlayUpdate, 60);
    window.setTimeout(queueVideoOverlayUpdate, 300);
  };

  ["object:added", "object:removed", "object:moving", "object:scaling", "object:rotating", "object:modified"].forEach((eventName) => canvas.on(eventName, queueVideoOverlayUpdate));
  window.addEventListener("resize", queueVideoOverlayUpdate);

  byId("removeSlideAudio").addEventListener("click", () => {
    const data = ensure(activeSlide()).canvas;
    delete data.audio;
    renderSlideAudio();
    renderList();
    schedule();
    toast("Slide music removed.");
  });

  const slideAudioToggle = byId("slideAudioToggle");
  const slideAudioElement = byId("slideAudioElement");
  function syncAudioToggle() {
    const playing = !slideAudioElement.paused;
    slideAudioToggle.innerHTML = playing ? '<i class="bi bi-pause-fill"></i><span>Pause</span>' : '<i class="bi bi-play-fill"></i><span>Play</span>';
    slideAudioToggle.setAttribute("aria-label", `${playing ? "Pause" : "Play"} slide music`);
  }
  slideAudioToggle.addEventListener("click", () => slideAudioElement.paused ? slideAudioElement.play().catch(() => toast("This audio format could not be played.")) : slideAudioElement.pause());
  slideAudioElement.addEventListener("play", syncAudioToggle);
  slideAudioElement.addEventListener("pause", syncAudioToggle);
  slideAudioElement.addEventListener("ended", syncAudioToggle);

  const originalSave = save;
  save = async function saveBuilder() {
    setSaveAppearance("Saving");
    try {
      const result = await originalSave();
      renderList();
      queueVideoOverlayUpdate();
      setSaveAppearance("Saved");
      return result;
    } catch (error) {
      setSaveAppearance("Save failed");
      throw error;
    }
  };

  all("[data-builder-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      all("[data-builder-tab]").forEach((item) => item.classList.toggle("is-active", item === button));
      all("[data-ribbon-panel]").forEach((panel) => {
        const active = panel.dataset.ribbonPanel === button.dataset.builderTab;
        panel.hidden = !active;
        panel.classList.toggle("is-active", active);
      });
    });
  });

  function editPresentationTitle() {
    if (!presentation) return;
    if (!titleInput.readOnly) return;
    titleInput.readOnly = false;
    titleInput.focus();
    titleInput.select();
  }

  function commitPresentationTitle() {
    if (!presentation || titleInput.readOnly) return;
    presentation.title = titleInput.value.trim() || "Untitled presentation";
    titleInput.value = presentation.title;
    titleInput.readOnly = true;
    schedule();
  }

  byId("editPresentationTitle").addEventListener("click", editPresentationTitle);
  titleInput.addEventListener("click", editPresentationTitle);
  titleInput.addEventListener("dblclick", editPresentationTitle);
  titleInput.addEventListener("blur", commitPresentationTitle);
  titleInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") titleInput.blur();
    if (event.key === "Escape") {
      titleInput.value = presentation?.title || "Untitled presentation";
      titleInput.readOnly = true;
    }
  });

  byId("addSlideProxy")?.addEventListener("click", () => addSlide());

  byId("insertText").addEventListener("click", () => {
    const object = new fabric.Textbox("Type your text", {
      id: `text_${Date.now()}`,
      left: 320,
      top: 250,
      width: 640,
      fontSize: 48,
      fontFamily: "Arial",
      fill: "#171717",
      textAlign: "center"
    });
    canvas.add(object);
    canvas.setActiveObject(object);
    canvas.requestRenderAll();
    panel();
    schedule();
  });

  function insertShape(type) {
    const common = { id: `shape_${Date.now()}`, left: 440, top: 240, fill: "#f5c842", stroke: "#101010", strokeWidth: 2 };
    const object = type === "circle"
      ? new fabric.Circle({ ...common, radius: 100 })
      : new fabric.Rect({ ...common, width: 260, height: 180, rx: 4, ry: 4 });
    canvas.add(object);
    canvas.setActiveObject(object);
    canvas.requestRenderAll();
    schedule();
  }

  byId("insertRectangle")?.addEventListener("click", () => insertShape("rectangle"));
  byId("insertCircle")?.addEventListener("click", () => insertShape("circle"));

  function copyObject() {
    const object = active();
    if (!object) { toast("Select an element to copy."); return false; }
    object.clone((clone) => {
      builderClipboard = clone;
      builderClipboardText = ["textbox", "text", "i-text"].includes(object.type) ? object.text : `Present Studio object ${object.id || Date.now()}`;
      navigator.clipboard?.writeText(builderClipboardText).catch(() => {});
      toast("Object copied.");
    });
    return true;
  }

  function pasteObject() {
    if (!builderClipboard) { toast("Copy an element first."); return; }
    builderClipboard.clone((clone) => {
      clone.set({ id: `element_${Date.now()}`, left: (clone.left || 0) + 28, top: (clone.top || 0) + 28 });
      if (clone.type === "activeSelection") {
        clone.canvas = canvas;
        clone.forEachObject((object, index) => {
          object.set({ id: `element_${Date.now()}_${index}` });
          canvas.add(object);
        });
        clone.setCoords();
        canvas.setActiveObject(clone);
      } else {
        canvas.add(clone);
        canvas.setActiveObject(clone);
      }
      builderClipboard = clone;
      canvas.requestRenderAll();
      panel();
      schedule();
      toast("Object pasted.");
    });
  }

  function insertClipboardText(value) {
    if (!value || !value.trim()) return false;
    addText(value, { left: 220, top: 180, width: 840, fontSize: 36, textAlign: "left" });
    toast("Text pasted as a new text box.");
    return true;
  }

  function insertClipboardImage(blob) {
    if (!blob) return false;
    if (blob.size > MAX_MEDIA_UPLOAD_BYTES) { toast(`Clipboard image exceeds ${MAX_MEDIA_UPLOAD_LABEL}.`); return false; }
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      image({ id: `image_${Date.now()}`, type: "image", src: reader.result, x: 15, y: 15, width: 70, height: 70, full_bleed: false, fit: "contain" });
      toast("Image pasted onto the slide.");
    });
    reader.readAsDataURL(blob);
    return true;
  }

  function imageSourceFromHtml(html) {
    if (!html) return "";
    try { return new DOMParser().parseFromString(html, "text/html").querySelector("img")?.src || ""; }
    catch { return ""; }
  }

  function insertClipboardImageSource(src) {
    if (!src) return false;
    image({ id: `image_${Date.now()}`, type: "image", src, x: 15, y: 15, width: 70, height: 70, full_bleed: false, fit: "contain" });
    toast("Image pasted onto the slide.");
    return true;
  }

  async function pasteFromSystemClipboard() {
    try {
      if (navigator.clipboard?.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const imageType = item.types.find((type) => type.startsWith("image/"));
          if (imageType) return insertClipboardImage(await item.getType(imageType));
        }
      }
      const value = await navigator.clipboard?.readText();
      if (builderClipboard && value === builderClipboardText) return pasteObject();
      if (insertClipboardText(value || "")) return;
    } catch {}
    if (builderClipboard) return pasteObject();
    toast("Copy text or an image, then press Ctrl+V on the slide.");
  }

  byId("copyObject").addEventListener("click", copyObject);
  byId("pasteObject").addEventListener("click", pasteFromSystemClipboard);

  all("[data-slide-background]").forEach((button) => {
    button.addEventListener("click", () => {
      canvas.backgroundColor = button.dataset.slideBackground;
      const backgroundInput = byId("slideBackground");
      if (backgroundInput) backgroundInput.value = button.dataset.slideBackground;
      canvas.requestRenderAll();
      schedule();
    });
  });

  byId("slideBackground")?.addEventListener("input", (event) => {
    canvas.backgroundColor = event.target.value;
    canvas.requestRenderAll();
    schedule();
  });

  all("[data-media-input]").forEach((input) => input.addEventListener("change", upload));

  byId("transitionType").addEventListener("change", (event) => {
    ensure(activeSlide()).canvas.transition.type = event.target.value;
    schedule();
  });
  function setTransitionDuration(value) {
    const duration = Math.max(50, Math.min(10000, Number(value) || 500));
    ensure(activeSlide()).canvas.transition.duration_ms = duration;
    const custom = byId("transitionDurationCustom");
    if (custom) custom.value = duration;
    schedule();
  }
  byId("transitionDuration").addEventListener("change", (event) => setTransitionDuration(event.target.value));
  byId("transitionDurationCustom")?.addEventListener("input", (event) => setTransitionDuration(event.target.value));
  byId("toggleNotes").addEventListener("click", () => {
    notesTray.hidden = !notesTray.hidden;
    if (!notesTray.hidden) notesEditor.focus();
  });
  byId("closeNotes").addEventListener("click", () => { notesTray.hidden = true; });
  notesEditor.addEventListener("input", () => {
    if (!presentation) return;
    ensure(activeSlide()).canvas.notes = notesEditor.value;
    schedule();
  });

  function updateZoom(next) {
    zoom = Math.max(50, Math.min(150, next));
    byId("zoomValue").textContent = `${zoom}%`;
    byId("slideCanvas").style.width = `${zoom}%`;
    byId("slideCanvas").style.maxWidth = zoom > 100 ? "none" : "1200px";
  }
  byId("zoomOut").addEventListener("click", () => updateZoom(zoom - 10));
  byId("zoomIn").addEventListener("click", () => updateZoom(zoom + 10));

  function openShare() { shareModal.hidden = false; }
  function closeShare() { shareModal.hidden = true; }
  byId("quickShare").addEventListener("click", openShare);
  byId("closeShare").addEventListener("click", closeShare);
  shareModal.addEventListener("mousedown", (event) => { if (event.target === shareModal) closeShare(); });

  async function openPreview(slideIndex = 0) {
    if (!presentation) return toast("The presentation is still loading.");
    if (document.getElementById("builderPreviewOverlay")) return;
    capture();
    const previousFocus = document.activeElement;
    const overlay = document.createElement("div");
    overlay.id = "builderPreviewOverlay";
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:#000;color:#fff;display:grid;place-items:center;";
    overlay.textContent = "Loading preview…";
    overlay.tabIndex = -1;
    const frame = document.createElement("iframe");
    frame.title = "Presentation preview. Use arrow keys to navigate and Escape to return to the editor.";
    frame.allow = "autoplay; fullscreen";
    frame.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0;background:#000;";
    let closed = false;
    let enteredFullscreen = false;
    const close = () => {
      if (closed) return;
      closed = true;
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("message", onMessage);
      if (document.fullscreenElement === overlay) document.exitFullscreen().catch(() => {});
      overlay.remove();
      previousFocus?.focus();
    };
    const onFullscreenChange = () => {
      if (document.fullscreenElement === overlay) enteredFullscreen = true;
      else if (enteredFullscreen) close();
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
      }
    };
    const onMessage = (event) => {
      if (event.origin === location.origin && event.source === frame.contentWindow && event.data?.type === "preview:exit") close();
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("message", onMessage);
    document.body.append(overlay);
    overlay.focus();
    // Request while the Preview click still has browser user activation.
    // If fullscreen is unavailable, the overlay still fills the browser viewport.
    overlay.requestFullscreen?.().catch(() => {});
    try {
      await save();
      if (closed) return;
      const index = Math.max(0, Math.min(presentation.slides.length - 1, Number(slideIndex) || 0));
      frame.src = `/preview.html?id=${encodeURIComponent(presentation.id)}&slide=${index + 1}`;
      frame.addEventListener("load", () => { if (!closed) frame.contentWindow.focus(); });
      overlay.replaceChildren(frame);
    } catch (error) {
      close();
      toast(error?.message || "The presentation could not be saved for preview.");
    }
  }

  byId("quickPreview")?.addEventListener("click", () => openPreview(currentSlideIndex));
  byId("quickPresent")?.addEventListener("click", () => start());
  byId("builderHelp").addEventListener("click", () => toast("Double-click text to edit it. Drag handles to resize and rotate."));

  function selectedText() {
    const object = active();
    return object && ["textbox", "text", "i-text"].includes(object.type) ? object : null;
  }

  function addText(value, options = {}) {
    const object = new fabric.Textbox(value, {
      id: `text_${Date.now()}`,
      left: options.left || 260,
      top: options.top || 220,
      width: options.width || 760,
      fontSize: options.fontSize || 48,
      fontFamily: options.fontFamily || "Arial",
      fontWeight: options.fontWeight || "normal",
      fill: options.fill || "#171717",
      textAlign: options.textAlign || "center",
      backgroundColor: options.backgroundColor || ""
    });
    canvas.add(object);
    canvas.setActiveObject(object);
    canvas.requestRenderAll();
    panel();
    schedule();
    return object;
  }

  function applyLayout(kind = "title-content") {
    const objects = canvas.getObjects();
    objects.forEach((object) => canvas.remove(object));
    if (kind !== "blank") {
      addText(activeSlide().title || "Presentation title", { left: 140, top: 110, width: 1000, fontSize: 64, fontWeight: "bold" });
      if (kind === "title-content") addText("Add your key message", { left: 190, top: 300, width: 900, fontSize: 34, fill: "#555555" });
      if (kind === "two-column") {
        addText("First idea", { left: 120, top: 300, width: 470, fontSize: 32 });
        addText("Second idea", { left: 690, top: 300, width: 470, fontSize: 32 });
      }
    }
    canvas.requestRenderAll();
    schedule();
  }

  function addTable() {
    const parts = [];
    const cols = 4, rows = 3, width = 720, height = 300, cellW = width / cols, cellH = height / rows;
    for (let row = 0; row <= rows; row += 1) parts.push(new fabric.Line([0, row * cellH, width, row * cellH], { stroke: "#202020", strokeWidth: 2 }));
    for (let col = 0; col <= cols; col += 1) parts.push(new fabric.Line([col * cellW, 0, col * cellW, height], { stroke: "#202020", strokeWidth: 2 }));
    const table = new fabric.Group(parts, { id: `table_${Date.now()}`, left: 280, top: 210 });
    canvas.add(table); canvas.setActiveObject(table); canvas.requestRenderAll(); schedule();
  }

  function addChart() {
    const bars = [170, 260, 210, 330, 285].map((height, index) => new fabric.Rect({ left: index * 105, top: 340 - height, width: 68, height, fill: index === 3 ? "#101010" : "#f5c842" }));
    const chart = new fabric.Group(bars, { id: `chart_${Date.now()}`, left: 365, top: 180 });
    canvas.add(chart); canvas.setActiveObject(chart); canvas.requestRenderAll(); schedule();
  }

  function addSymbol(symbol, size = 150) {
    const object = new fabric.Text(symbol, { id: `symbol_${Date.now()}`, left: 560, top: 250, fontSize: size, fill: "#f5c842" });
    canvas.add(object); canvas.setActiveObject(object); canvas.requestRenderAll(); schedule();
  }

  function groupSelection() {
    const object = active();
    if (!object) return toast("Select multiple elements with Shift first.");
    if (object.type === "activeSelection") {
      object.toGroup(); canvas.requestRenderAll(); schedule(); return toast("Elements grouped.");
    }
    if (object.type === "group") {
      object.toActiveSelection(); canvas.requestRenderAll(); schedule(); return toast("Group separated.");
    }
    toast("Select multiple elements with Shift first.");
  }

  function applyTheme(name) {
    const themes = {
      clean: { background: "#fffefb", text: "#101010", accent: "#f5c842", font: "Arial" },
      yellow: { background: "#ffc928", text: "#101010", accent: "#101010", font: "Arial" },
      dark: { background: "#181818", text: "#ffffff", accent: "#f5c842", font: "Arial" },
      grid: { background: "#eef1ed", text: "#17221e", accent: "#4a776d", font: "Inter" },
      editorial: { background: "#f6f0e8", text: "#5f4234", accent: "#9b6b53", font: "Georgia" }
    };
    const theme = themes[name] || themes.clean;
    canvas.backgroundColor = theme.background;
    canvas.getObjects().forEach((object) => {
      if (["textbox", "text", "i-text"].includes(object.type)) object.set({ fill: theme.text, fontFamily: theme.font });
    });
    ensure(activeSlide()).canvas.theme = name;
    ensure(activeSlide()).canvas.accent = theme.accent;
    canvas.requestRenderAll(); schedule();
  }


  function animationStartState(object, type) {
    const base = {
      opacity: object.opacity ?? 1,
      left: object.left || 0,
      top: object.top || 0,
      scaleX: object.scaleX || 1,
      scaleY: object.scaleY || 1
    };
    if (type === "fade") return { opacity: 0 };
    if (type === "zoom") return { opacity: 0, scaleX: base.scaleX * 0.78, scaleY: base.scaleY * 0.78 };
    if (type === "fly") return { opacity: 0, left: base.left - 140 };
    if (type === "rise") return { opacity: 0, top: base.top + 90 };
    if (type === "wipe") return { opacity: 0, scaleX: base.scaleX * 0.08 };
    return {};
  }

  function showTransitionOptions(kind) {
    const submenu = byId("transitionSubmenu");
    if (!submenu) return;
    const options = {
      fade: [["fade", "Fade In"], ["fade-left", "Left"], ["fade-right", "Right"], ["fade-up", "Up"], ["fade-down", "Down"]],
      push: [["push-left", "Left"], ["push-right", "Right"], ["push-up", "Up"], ["push-down", "Down"]],
      morph: [["morph", "Morph"], ["morph-left", "Left"], ["morph-right", "Right"], ["morph-up", "Up"], ["morph-down", "Down"]]
    }[kind] || [];
    submenu.hidden = false;
    submenu.innerHTML = options.map(([value, label]) => `<button class="tool-button" type="button" data-builder-action="transition" data-transition="${value}"><span>${label}</span></button>`).join("");
  }

  function setObjectAnimation(type) {
    const object = active();
    if (!object || object.type === "activeSelection") return toast("Select one element to animate.");
    object.set({
      animation: type,
      animationDuration: Math.max(100, Math.min(5000, Number(byId("animationDuration")?.value) || 600)),
      animationDelay: Math.max(0, Math.min(5000, Number(byId("animationDelay")?.value) || 0))
    });
    all("[data-animation]").forEach((item) => item.classList.toggle("is-active", item.dataset.animation === type));
    schedule();
    if (type !== "none") previewObjectAnimation(object);
    else toast("Animation removed.");
  }

  function previewObjectAnimation(target = active()) {
    const object = target;
    if (!object || object.type === "activeSelection") return toast("Select one element to preview.");
    const type = object.animation || "fade";
    if (type === "none") return toast("No animation selected.");
    const duration = Math.max(100, Math.min(5000, Number(object.animationDuration || byId("animationDuration")?.value) || 600));
    const delay = Math.max(0, Math.min(5000, Number(object.animationDelay || byId("animationDelay")?.value) || 0));
    const finalState = {
      opacity: object.opacity ?? 1,
      left: object.left || 0,
      top: object.top || 0,
      scaleX: object.scaleX || 1,
      scaleY: object.scaleY || 1
    };
    object.set(animationStartState(object, type));
    object.setCoords();
    canvas.requestRenderAll();
    window.setTimeout(() => {
      Object.entries(finalState).forEach(([key, value]) => object.animate(key, value, {
        duration,
        easing: fabric.util.ease.easeOutCubic,
        onChange: canvas.renderAll.bind(canvas),
        onComplete: () => { object.set(finalState); object.setCoords(); canvas.requestRenderAll(); }
      }));
    }, delay);
  }

  document.querySelector(".ribbon").addEventListener("click", (event) => {
    const button = event.target.closest("[data-builder-action]");
    if (!button) return;
    const name = button.dataset.builderAction;
    const object = active();
    const textObject = selectedText();
    switch (name) {
      case "new-slide": addSlide(); break;
      case "duplicate-slide": duplicateSlide(); break;
      case "delete-slide": deleteSlide(); break;
      case "duplicate-object": action("duplicate"); break;
      case "delete-object": action("delete"); break;
      case "bring-forward": action("forward"); break;
      case "send-backward": action("backward"); break;
      case "copy": break;
      case "paste": break;
      case "cut":
        if (!object) return toast("Select an element to cut.");
        object.clone((clone) => { builderClipboard = clone; canvas.remove(object); canvas.requestRenderAll(); schedule(); });
        break;
      case "bold": { const value = selectedTextStyle(textObject, "fontWeight"); format({ fontWeight: String(value) === "bold" || Number(value) >= 700 ? "normal" : "bold" }); break; }
      case "italic": format({ fontStyle: selectedTextStyle(textObject, "fontStyle") === "italic" ? "normal" : "italic" }); break;
      case "underline": format({ underline: !selectedTextStyle(textObject, "underline") }); break;
      case "strike": format({ linethrough: !selectedTextStyle(textObject, "linethrough") }); break;
      case "highlight": format({ textBackgroundColor: selectedTextStyle(textObject, "textBackgroundColor") ? "" : "#fff0a8" }); break;
      case "font-size-decrease": { const size = Number(selectedTextStyle(textObject, "fontSize") || textObject?.fontSize || 42); format({ fontSize: Math.max(8, size - 2) }); break; }
      case "font-size-increase": { const size = Number(selectedTextStyle(textObject, "fontSize") || textObject?.fontSize || 42); format({ fontSize: Math.min(240, size + 2) }); break; }
      case "align-left": format({ textAlign: "left" }); break;
      case "align-center": format({ textAlign: "center" }); break;
      case "align-right": format({ textAlign: "right" }); break;
      case "justify": format({ textAlign: "justify" }); break;
      case "bullets": if (textObject) { textObject.set("text", textObject.text.split("\n").map((line) => line.startsWith("• ") ? line.slice(2) : `• ${line}`).join("\n")); canvas.requestRenderAll(); schedule(); } else toast("Select text first."); break;
      case "numbering": if (textObject) { textObject.set("text", textObject.text.split("\n").map((line, index) => `${index + 1}. ${line.replace(/^\d+\.\s*/, "")}`).join("\n")); canvas.requestRenderAll(); schedule(); } else toast("Select text first."); break;
      case "indent-less": if (textObject) format({ left: Math.max(0, textObject.left - 18) }); break;
      case "indent-more": if (textObject) format({ left: textObject.left + 18 }); break;
      case "line-spacing": if (textObject) format({ lineHeight: textObject.lineHeight >= 1.5 ? 1.16 : 1.5 }); break;
      case "rotate": if (object) { object.rotate(((object.angle || 0) + 90) % 360); canvas.requestRenderAll(); schedule(); } else toast("Select an element first."); break;
      case "group": groupSelection(); break;
      case "align-objects": if (object) { object.set({ left: (W - object.getScaledWidth()) / 2, top: (H - object.getScaledHeight()) / 2 }); object.setCoords(); canvas.requestRenderAll(); schedule(); } else toast("Select an element first."); break;
      case "reset-slide": if (object) { object.set({ angle: 0, opacity: 1, shadow: null }); object.setCoords(); canvas.requestRenderAll(); schedule(); } else { canvas.backgroundColor = "#fffefb"; canvas.requestRenderAll(); schedule(); } break;
      case "layout": applyLayout(window.prompt("Layout: blank, title-content, or two-column", "title-content") || "title-content"); break;
      case "section": ensure(activeSlide()).canvas.section = window.prompt("Section name", ensure(activeSlide()).canvas.section || "New section") || ""; schedule(); break;
      case "format-painter": if (!object) toast("Select a source element first."); else { const style = { fill: object.fill, fontFamily: object.fontFamily, fontSize: object.fontSize, fontWeight: object.fontWeight, fontStyle: object.fontStyle, stroke: object.stroke, strokeWidth: object.strokeWidth }; toast("Format copied. Select another element."); canvas.once("selection:created", (selection) => { selection.selected?.[0]?.set(style); canvas.requestRenderAll(); schedule(); }); } break;
      case "insert-text": break;
      case "word-art": addText("WORD ART", { fontSize: 74, fontWeight: "bold", fill: "#f5c842", backgroundColor: "#101010" }); break;
      case "shapes": { const kind = (window.prompt("Shape: rectangle or circle", "rectangle") || "rectangle").toLowerCase(); insertShape(kind === "circle" ? "circle" : "rectangle"); break; }
      case "icon": addSymbol("★"); break;
      case "sticker": addSymbol("☺", 170); break;
      case "table": addTable(); break;
      case "chart": addChart(); break;
      case "link": if (object) { object.set("hyperlink", window.prompt("Link URL", object.hyperlink || "https://") || ""); schedule(); } else toast("Select an element first."); break;
      case "comment": { const comment = window.prompt("Comment"); if (comment) { const slide = ensure(activeSlide()); slide.canvas.comments ||= []; slide.canvas.comments.push({ text: comment, createdAt: new Date().toISOString() }); schedule(); toast("Comment saved with this slide."); } break; }
      case "slide-size": { const ratio = window.prompt("Slide ratio: 16:9 or 4:3", ensure(activeSlide()).canvas.ratio || "16:9"); if (ratio === "16:9" || ratio === "4:3") { ensure(activeSlide()).canvas.ratio = ratio; byId("slideCanvas").style.aspectRatio = ratio === "4:3" ? "4 / 3" : "16 / 9"; schedule(); } break; }
      case "fit-media": if (typeof fitMediaToSlide === "function") fitMediaToSlide(); break;
      case "animation": setObjectAnimation(button.dataset.animation || "none"); break;
      case "preview-animation": previewObjectAnimation(); break;
      case "transition-menu": showTransitionOptions(button.dataset.transitionMenu); all("[data-transition-menu]").forEach((item) => item.classList.toggle("is-active", item === button)); break;
      case "transition": {
        const submenu = byId("transitionSubmenu");
        if (["none", "zoom"].includes(button.dataset.transition) && submenu) {
          submenu.hidden = true;
          submenu.innerHTML = "";
          all("[data-transition-menu]").forEach((item) => item.classList.remove("is-active"));
        }
        byId("transitionType").value = button.dataset.transition;
        byId("transitionType").dispatchEvent(new Event("change"));
        all("[data-transition]").forEach((item) => item.classList.toggle("is-active", item === button));
        break;
      }
      case "preview-transition": {
        const type = ensure(activeSlide()).canvas.transition.type || "fade";
        const duration = Number(ensure(activeSlide()).canvas.transition.duration_ms || byId("transitionDurationCustom")?.value || byId("transitionDuration").value) || 500;
        const movement = type.endsWith("left") ? "translateX(-42px)" : type.endsWith("right") ? "translateX(42px)" : type.endsWith("up") ? "translateY(-42px)" : type.endsWith("down") ? "translateY(42px)" : "translateX(22px)";
        const startTransform = type.startsWith("push") || type.startsWith("fade") ? movement : type.startsWith("morph") ? `${movement} scale(.94)` : type === "zoom" ? "scale(.9)" : "none";
        byId("slideCanvas").animate([{ opacity: type === "none" ? 1 : .25, transform: startTransform, filter: type.startsWith("morph") ? "blur(8px)" : "none" }, { opacity: 1, transform: "none", filter: "none" }], { duration, easing: "ease-out" });
        break;
      }
      case "apply-transition-all": { capture(); const transition = JSON.parse(JSON.stringify(ensure(activeSlide()).canvas.transition)); presentation.slides.forEach((slide) => { ensure(slide).canvas.transition = JSON.parse(JSON.stringify(transition)); }); schedule(); toast("Transition applied to all slides."); break; }
      case "speaker-notes": notesTray.hidden = false; notesEditor.focus(); break;
      default: break;
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !shareModal.hidden) closeShare();
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c" && !event.target.matches("input,textarea")) {
      event.preventDefault();
      byId("copyObject").click();
    }
    if ((event.ctrlKey || event.metaKey) && ["b", "u", "i"].includes(event.key.toLowerCase()) && active()?.isEditing) {
      event.preventDefault();
      const actionName = { b: "bold", u: "underline", i: "italic" }[event.key.toLowerCase()];
      document.querySelector(`[data-builder-action="${actionName}"]`)?.click();
    }
  });

  document.addEventListener("paste", (event) => {
    const target = event.target;
    if (target?.matches?.("input,textarea,[contenteditable=true]") || active()?.isEditing) return;
    const imageItem = [...(event.clipboardData?.items || [])].find((item) => item.kind === "file" && item.type.startsWith("image/"));
    if (imageItem) {
      event.preventDefault();
      insertClipboardImage(imageItem.getAsFile());
      return;
    }
    const htmlImage = imageSourceFromHtml(event.clipboardData?.getData("text/html") || "");
    if (htmlImage) {
      event.preventDefault();
      insertClipboardImageSource(htmlImage);
      return;
    }
    const value = event.clipboardData?.getData("text/plain") || "";
    event.preventDefault();
    if (builderClipboard && value === builderClipboardText) pasteObject();
    else if (!insertClipboardText(value) && builderClipboard) pasteObject();
    else if (!value) toast("Clipboard does not contain text or an image.");
  });
})();
