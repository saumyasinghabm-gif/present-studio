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
  let shapeTextEditSession = null;

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

  let slidePointerDrag = null;
  let suppressSlideClick = false;
  let slideAutoScrollFrame = 0;

  function moveSlideTo(fromIndex, toIndex) {
    if (!presentation || fromIndex === toIndex || fromIndex < 0 || fromIndex >= presentation.slides.length) return;
    capture();
    const activeSlideId = activeSlide().id;
    const [movedSlide] = presentation.slides.splice(fromIndex, 1);
    const finalIndex = Math.max(0, Math.min(presentation.slides.length, toIndex));
    presentation.slides.splice(finalIndex, 0, movedSlide);
    normalize();
    currentSlideIndex = presentation.slides.findIndex((slide) => slide.id === activeSlideId);
    schedule();
    render();
    window.requestAnimationFrame(() => byId("slideList").querySelector(`[data-index="${finalIndex}"]`)?.focus());
    toast(`Slide moved to position ${finalIndex + 1}.`);
  }

  function clearSlideDropIndicators() {
    all("#slideList .slide-item").forEach((item) => item.classList.remove("is-drop-before", "is-drop-after"));
  }

  function updateSlideDropPosition(clientY) {
    if (!slidePointerDrag?.active) return;
    const items = all("#slideList .slide-item");
    let insertionIndex = items.length;
    for (let index = 0; index < items.length; index += 1) {
      const bounds = items[index].getBoundingClientRect();
      if (clientY < bounds.top + bounds.height / 2) { insertionIndex = index; break; }
    }
    slidePointerDrag.insertionIndex = insertionIndex;
    clearSlideDropIndicators();
    if (!items.length) return;
    if (insertionIndex >= items.length) items.at(-1).classList.add("is-drop-after");
    else items[insertionIndex].classList.add("is-drop-before");
  }

  function autoScrollSlideList() {
    if (!slidePointerDrag?.active) { slideAutoScrollFrame = 0; return; }
    const pane = byId("slideList").closest(".slides-pane");
    const bounds = pane.getBoundingClientRect();
    const edge = 48;
    let delta = 0;
    if (slidePointerDrag.clientY < bounds.top + edge) delta = -Math.ceil((bounds.top + edge - slidePointerDrag.clientY) / 4);
    if (slidePointerDrag.clientY > bounds.bottom - edge) delta = Math.ceil((slidePointerDrag.clientY - (bounds.bottom - edge)) / 4);
    if (delta) {
      pane.scrollTop += Math.max(-18, Math.min(18, delta));
      updateSlideDropPosition(slidePointerDrag.clientY);
    }
    slideAutoScrollFrame = window.requestAnimationFrame(autoScrollSlideList);
  }

  function finishSlidePointerDrag(cancelled = false) {
    if (!slidePointerDrag) return;
    const drag = slidePointerDrag;
    slidePointerDrag = null;
    if (slideAutoScrollFrame) window.cancelAnimationFrame(slideAutoScrollFrame);
    slideAutoScrollFrame = 0;
    drag.item.classList.remove("is-dragging");
    document.body.classList.remove("is-reordering-slides");
    clearSlideDropIndicators();
    if (!drag.active || cancelled) return;
    suppressSlideClick = true;
    window.setTimeout(() => { suppressSlideClick = false; }, 0);
    let finalIndex = drag.insertionIndex;
    if (drag.sourceIndex < finalIndex) finalIndex -= 1;
    moveSlideTo(drag.sourceIndex, finalIndex);
  }

  renderList = function renderBuilderSlideList() {
    if (!presentation) return;
    byId("slideList").innerHTML = presentation.slides.map((slide, index) => {
      const data = ensure(slide).canvas;
      const fabricObjects = data.fabric?.objects || [];
      const legacyObjects = fabricObjects.length ? [] : (data.elements || []);
      const objects = fabricObjects.map((object) => thumbnailObjectMarkup(object)).join("") + legacyObjects.map((object) => thumbnailObjectMarkup(object, true)).join("");
      const audioBadge = data.audio?.src ? '<span class="slide-thumbnail-audio" title="Slide has music"><i class="bi bi-music-note-beamed"></i></span>' : "";
      return `<article class="slide-item ${index === currentSlideIndex ? "active" : ""}" data-index="${index}" data-slide-number="${index + 1}" tabindex="0" role="button" aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" aria-label="Open slide ${index + 1}: ${esc(slide.title || "Untitled slide")}. Drag to reorder."><span class="slide-drag-handle" title="Drag to reorder" aria-hidden="true"><i class="bi bi-grip-horizontal"></i></span><div class="slide-thumbnail-stage" style="--slide-thumbnail-bg:${safeColor(data.background, "#fffefb")}">${objects}${audioBadge}</div><div class="slide-actions-inline"><button type="button" data-slide-duplicate="${index}" aria-label="Duplicate slide ${index + 1}" title="Duplicate"><i class="bi bi-copy"></i></button><button class="is-danger" type="button" data-slide-delete="${index}" aria-label="Delete slide ${index + 1}" title="Delete"><i class="bi bi-trash"></i></button></div></article>`;
    }).join("");
    all("#slideList .slide-item").forEach((item) => {
      const open = () => { capture(); currentSlideIndex = Number(item.dataset.index); render(); };
      item.addEventListener("click", (event) => {
        if (suppressSlideClick) { event.preventDefault(); event.stopPropagation(); return; }
        if (!event.target.closest(".slide-actions-inline, .slide-drag-handle")) open();
      });
      item.addEventListener("keydown", (event) => {
        const index = Number(item.dataset.index);
        if (event.altKey && ["ArrowUp", "ArrowDown"].includes(event.key)) {
          event.preventDefault();
          moveSlideTo(index, index + (event.key === "ArrowUp" ? -1 : 1));
          return;
        }
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); }
      });
      item.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || event.target.closest(".slide-actions-inline")) return;
        if (event.pointerType !== "mouse" && !event.target.closest(".slide-drag-handle")) return;
        slidePointerDrag = { item, pointerId: event.pointerId, sourceIndex: Number(item.dataset.index), startX: event.clientX, startY: event.clientY, clientY: event.clientY, insertionIndex: Number(item.dataset.index), active: false };
        item.setPointerCapture(event.pointerId);
      });
      item.addEventListener("pointermove", (event) => {
        if (!slidePointerDrag || slidePointerDrag.pointerId !== event.pointerId) return;
        slidePointerDrag.clientY = event.clientY;
        const distance = Math.hypot(event.clientX - slidePointerDrag.startX, event.clientY - slidePointerDrag.startY);
        if (!slidePointerDrag.active && distance >= 7) {
          slidePointerDrag.active = true;
          item.classList.add("is-dragging");
          document.body.classList.add("is-reordering-slides");
          slideAutoScrollFrame = window.requestAnimationFrame(autoScrollSlideList);
        }
        if (slidePointerDrag.active) {
          event.preventDefault();
          updateSlideDropPosition(event.clientY);
        }
      });
      item.addEventListener("pointerup", (event) => { if (slidePointerDrag?.pointerId === event.pointerId) finishSlidePointerDrag(); });
      item.addEventListener("pointercancel", (event) => { if (slidePointerDrag?.pointerId === event.pointerId) finishSlidePointerDrag(true); });
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
    const id = `shape_${Date.now()}`;
    const common = { id: `${id}_geometry`, left: 0, top: 0, originX: "center", originY: "center", fill: "#f5c842", stroke: "#101010", strokeWidth: 2 };
    const shapes = {
      circle: () => new fabric.Circle({ ...common, radius: 100 }),
      triangle: () => new fabric.Triangle({ ...common, width: 220, height: 190 }),
      line: () => new fabric.Line([0, 0, 260, 0], { ...common, top: 360, fill: null, strokeWidth: 6 }),
      arrow: () => new fabric.Path("M 0 35 L 180 35 L 180 0 L 260 60 L 180 120 L 180 85 L 0 85 Z", { ...common })
    };
    const shape = shapes[type]?.() || new fabric.Rect({ ...common, width: 260, height: 180, rx: 4, ry: 4 });
    if (type === "line") {
      shape.set({ id, left: 510 });
      canvas.add(shape);
      canvas.setActiveObject(shape);
      canvas.requestRenderAll();
      schedule();
      return;
    }
    const label = createShapeLabel(shape, "", `${id}_label`);
    const object = new fabric.Group([shape, label], {
      id,
      left: type === "circle" ? 540 : type === "triangle" ? 530 : 510,
      top: type === "circle" ? 340 : type === "triangle" ? 350 : 360
    });
    configureShapeTextGroup(object);
    canvas.add(object);
    canvas.setActiveObject(object);
    canvas.requestRenderAll();
    schedule();
    toast("Shape inserted. Double-click it to add text.");
  }

  const SHAPE_TYPES = new Set(["rect", "circle", "triangle", "path"]);

  function isEditableShape(object) {
    return Boolean(object && SHAPE_TYPES.has(object.type) && object.mediaType !== "video");
  }

  function shapeTextParts(group) {
    if (group?.type !== "group") return null;
    const objects = group.getObjects?.() || [];
    const label = objects.find((object) => object.type === "textbox");
    const shape = objects.find(isEditableShape);
    return label && shape && objects.length === 2 ? { shape, label } : null;
  }

  function createShapeLabel(shape, value = "", id = `shape_label_${Date.now()}`) {
    const shapeWidth = Number(shape.width) || Number(shape.radius) * 2 || 220;
    return new fabric.Textbox(value, {
      id,
      left: 0,
      top: 0,
      originX: "center",
      originY: "center",
      width: Math.max(70, shapeWidth * 0.76),
      fontSize: 32,
      fontFamily: "Arial",
      fontWeight: "normal",
      fill: "#171717",
      textAlign: "center",
      lockScalingFlip: true
    });
  }

  function configureShapeTextGroup(group) {
    const parts = shapeTextParts(group);
    if (!parts) return false;
    // Fabric can otherwise reuse the empty group cache created before the
    // label was edited, which makes saved text disappear until the next edit.
    group.set({ lockScalingFlip: true, objectCaching: false, dirty: true });
    parts.label.set({ objectCaching: false, dirty: true });
    // Corner resizing keeps the shape and its text proportional. Side-only
    // scaling would stretch the letters, so it stays disabled for this pair.
    group.setControlsVisibility?.({ mt: false, mb: false, ml: false, mr: false });
    return true;
  }

  function groupState(group, fallbackId) {
    return {
      id: group?.id || fallbackId || `shape_${Date.now()}`,
      hyperlink: group?.hyperlink || "",
      animation: group?.animation || "none",
      animationDuration: group?.animationDuration || 600,
      animationDelay: group?.animationDelay || 0
    };
  }

  function finishShapeTextEditing(label = shapeTextEditSession?.label) {
    const session = shapeTextEditSession;
    if (!session || label !== session.label) return;
    shapeTextEditSession = null;
    loading = session.previousLoading;
    label.exitEditing?.();
    label.set({ selectable: true, evented: true });
    label.initDimensions?.();
    label.setCoords();
    const selection = new fabric.ActiveSelection([session.shape, label], { canvas });
    canvas.setActiveObject(selection);
    const group = selection.toGroup();
    group.set(session.state);
    configureShapeTextGroup(group);
    group.setCoords();
    canvas.setActiveObject(group);
    canvas.requestRenderAll();
    panel();
    schedule();
  }

  function beginShapeTextEditing(target) {
    if (shapeTextEditSession) finishShapeTextEditing();
    let shape;
    let label;
    let state;
    if (target.type === "group") {
      const parts = shapeTextParts(target);
      if (!parts) return false;
      ({ shape, label } = parts);
      state = groupState(target);
      target.toActiveSelection();
      canvas.discardActiveObject();
    } else if (isEditableShape(target)) {
      shape = target;
      const center = shape.getCenterPoint();
      label = createShapeLabel(shape, "", `${shape.id || `shape_${Date.now()}`}_label`);
      label.set({
        left: center.x,
        top: center.y,
        angle: shape.angle || 0,
        width: Math.max(70, shape.getScaledWidth() * 0.76)
      });
      canvas.add(label);
      state = groupState(null, shape.id);
    } else return false;

    const previousLoading = loading;
    loading = true;
    shapeTextEditSession = { shape, label, state, previousLoading };
    configureTextResize(label);
    label.once("editing:exited", () => window.setTimeout(() => finishShapeTextEditing(label), 0));
    canvas.setActiveObject(label);
    label.enterEditing();
    if (label.text) label.selectAll();
    label.hiddenTextarea?.focus();
    canvas.requestRenderAll();
    panel();
    toast("Type inside the shape, then press Esc or click outside.");
    return true;
  }

  canvas.on("mouse:dblclick", (event) => {
    if (beginShapeTextEditing(event.target)) event.e?.preventDefault?.();
  });
  canvas.on("object:added", (event) => configureShapeTextGroup(event.target));
  canvas.on("selection:created", (event) => (event.selected || []).forEach(configureShapeTextGroup));
  canvas.on("selection:updated", (event) => (event.selected || []).forEach(configureShapeTextGroup));

  byId("insertRectangle")?.addEventListener("click", () => insertShape("rectangle"));
  byId("insertCircle")?.addEventListener("click", () => insertShape("circle"));

  let internalCopyPending = false;

  function copyObject() {
    const object = active();
    if (!object) { toast("Select an element to copy."); return false; }
    object.clone((clone) => {
      builderClipboard = clone;
      builderClipboardText = ["textbox", "text", "i-text"].includes(object.type) ? object.text : `Present Studio object ${object.id || Date.now()}`;
      internalCopyPending = true;
      navigator.clipboard?.writeText(builderClipboardText).catch(() => {});
      toast("Object copied.");
    });
    return true;
  }

  function fitPastedTextToSlide(object, padding = 36) {
    if (!object || !["textbox", "text", "i-text"].includes(object.type)) return object;
    object.initDimensions?.();
    object.setCoords();
    let bounds = object.getBoundingRect(true, true);
    const availableWidth = W - padding * 2;
    const availableHeight = H - padding * 2;
    const fitScale = Math.min(1, availableWidth / Math.max(1, bounds.width), availableHeight / Math.max(1, bounds.height));
    if (fitScale < 1) {
      object.set({
        scaleX: (Number(object.scaleX) || 1) * fitScale,
        scaleY: (Number(object.scaleY) || 1) * fitScale
      });
      object.setCoords();
      bounds = object.getBoundingRect(true, true);
    }
    let left = Number(object.left) || 0;
    let top = Number(object.top) || 0;
    if (bounds.left < padding) left += padding - bounds.left;
    if (bounds.top < padding) top += padding - bounds.top;
    if (bounds.left + bounds.width > W - padding) left -= bounds.left + bounds.width - (W - padding);
    if (bounds.top + bounds.height > H - padding) top -= bounds.top + bounds.height - (H - padding);
    object.set({ left, top });
    object.setCoords();
    return object;
  }

  function resizeTextboxHeight(_eventData, transform, x, y) {
    const object = transform.target;
    const localPoint = fabric.controlsUtils.getLocalPoint(
      transform,
      transform.originX,
      transform.originY,
      x,
      y
    );
    const scaleY = Math.max(0.001, Math.abs(Number(object.scaleY) || 1));
    const strokePadding = (Number(object.strokeWidth) || 0) / (object.strokeUniform ? scaleY : 1);
    const nextHeight = Math.abs(localPoint.y / scaleY) - strokePadding;
    const contentHeight = Number(object.calcTextHeight?.()) || Number(object.height) || 24;
    const minimumHeight = Math.max(24, contentHeight);
    if (!Number.isFinite(nextHeight) || nextHeight < minimumHeight || Math.abs(nextHeight - object.height) < 0.5) {
      return false;
    }
    object.set({ height: nextHeight });
    return true;
  }

  const anchoredTextboxHeightResize = fabric.controlsUtils.wrapWithFixedAnchor(resizeTextboxHeight);

  function textboxHeightControl(source) {
    return new fabric.Control({
      x: source.x,
      y: source.y,
      offsetX: source.offsetX,
      offsetY: source.offsetY,
      cursorStyle: source.cursorStyle,
      cursorStyleHandler: source.cursorStyleHandler,
      render: source.render,
      actionName: "changeHeight",
      actionHandler: anchoredTextboxHeightResize
    });
  }

  function configureTextboxHeightHandles(object) {
    if (object.type !== "textbox") {
      object.setControlsVisibility?.({ mt: false, mb: false });
      return;
    }
    if (!object.__hasHeightOnlyControls) {
      object.controls = {
        ...object.controls,
        mt: textboxHeightControl(object.controls.mt),
        mb: textboxHeightControl(object.controls.mb)
      };
      Object.defineProperty(object, "__hasHeightOnlyControls", { value: true, configurable: true });
    }
    object.setControlsVisibility?.({ mt: true, mb: true });
  }

  function configureTextResize(object, repairDistortion = false) {
    if (!object || !["textbox", "text", "i-text"].includes(object.type)) return false;
    object.set({ lockScalingFlip: true });
    configureTextboxHeightHandles(object);
    const scaleX = Math.abs(Number(object.scaleX) || 1);
    const scaleY = Math.abs(Number(object.scaleY) || 1);
    const isDistorted = Math.max(scaleX, scaleY) / Math.max(0.001, Math.min(scaleX, scaleY)) > 1.08;
    if (!repairDistortion || !isDistorted) return false;

    object.set({
      width: Math.max(80, Math.min(W - 72, (Number(object.width) || 760) * scaleX)),
      fontSize: Math.max(24, Number(object.fontSize) || 36),
      scaleX: 1,
      scaleY: 1
    });
    object.initDimensions?.();
    fitPastedTextToSlide(object);
    object.setCoords();
    return true;
  }

  canvas.on("object:added", (event) => {
    const object = event.target;
    const repaired = configureTextResize(object, true);
    if (repaired) {
      canvas.requestRenderAll();
      window.setTimeout(() => schedule(), 0);
    }
  });
  canvas.on("selection:created", (event) => (event.selected || []).forEach((object) => configureTextResize(object)));
  canvas.on("selection:updated", (event) => (event.selected || []).forEach((object) => configureTextResize(object)));

  function clipboardTextStyle(html) {
    if (!html) return {};
    try {
      const documentNode = new DOMParser().parseFromString(html, "text/html");
      const node = documentNode.body.querySelector("h1,h2,h3,h4,h5,h6,p,li,div,span") || documentNode.body.firstElementChild;
      if (!node) return {};
      const style = node.style;
      const sizeValue = String(style.fontSize || "").trim().toLowerCase();
      const parsedSize = Number.parseFloat(sizeValue);
      const fontSize = Number.isFinite(parsedSize) ? (sizeValue.endsWith("pt") ? parsedSize * 96 / 72 : parsedSize) : undefined;
      const fontFamily = String(style.fontFamily || "").split(",")[0].replace(/["']/g, "").trim();
      return {
        ...(fontFamily ? { fontFamily } : {}),
        ...(fontSize ? { fontSize: Math.max(24, Math.min(240, fontSize)) } : {}),
        ...(style.fontWeight ? { fontWeight: style.fontWeight } : {}),
        ...(style.fontStyle ? { fontStyle: style.fontStyle } : {}),
        ...(safeColor(style.color, "") ? { fill: style.color } : {}),
        ...(style.textAlign ? { textAlign: style.textAlign } : {}),
        ...(safeColor(style.backgroundColor, "") ? { backgroundColor: style.backgroundColor } : {})
      };
    } catch {
      return {};
    }
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
        configureTextResize(clone, true);
        fitPastedTextToSlide(clone);
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

  function insertClipboardText(value, style = {}) {
    if (!value || !value.trim()) return false;
    const object = addText(value, { left: 220, top: 120, width: 840, fontSize: 36, textAlign: "left", ...style });
    fitPastedTextToSlide(object);
    canvas.requestRenderAll();
    toast("Text pasted as a new text box.");
    return true;
  }

  function insertClipboardImage(blob) {
    if (!blob) return false;
    if (blob.size > MAX_MEDIA_UPLOAD_BYTES) { toast(`Clipboard image exceeds ${MAX_MEDIA_UPLOAD_LABEL}.`); return false; }
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      image({ id: `image_${Date.now()}`, type: "image", src: reader.result, x: 0, y: 0, width: 100, height: 100, full_bleed: false, fitToSlide: true, fit: "contain" });
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
    image({ id: `image_${Date.now()}`, type: "image", src, x: 0, y: 0, width: 100, height: 100, full_bleed: false, fitToSlide: true, fit: "contain" });
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
          if (item.types.includes("text/plain")) {
            const value = await (await item.getType("text/plain")).text();
            const html = item.types.includes("text/html") ? await (await item.getType("text/html")).text() : "";
            if (builderClipboard && value === builderClipboardText) return pasteObject();
            if (insertClipboardText(value, clipboardTextStyle(html))) return;
          }
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
    byId("canvasStage").style.setProperty("--canvas-zoom", String(zoom / 100));
    byId("zoomOut").disabled = zoom <= 50;
    byId("zoomIn").disabled = zoom >= 150;
  }
  byId("zoomOut").addEventListener("click", () => updateZoom(zoom - 10));
  byId("zoomIn").addEventListener("click", () => updateZoom(zoom + 10));
  byId("fitToWindow").addEventListener("click", () => updateZoom(100));

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
      fontStyle: options.fontStyle || "normal",
      fill: options.fill || "#171717",
      textAlign: options.textAlign || "center",
      backgroundColor: options.backgroundColor || "",
      stroke: options.stroke || null,
      strokeWidth: Number(options.strokeWidth) || 0,
      paintFirst: "stroke",
      shadow: options.shadow || null,
      wordArt: options.wordArt === true
    });
    configureTextResize(object);
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
      case "insert-shape": insertShape(button.dataset.shape || "rectangle"); break;
      case "word-art": addText("WORD ART", { fontSize: 74, fontFamily: "Impact", fontWeight: "bold", fill: "#f5c842", stroke: "#8a5b00", strokeWidth: 2, shadow: wordArtPresets.gold.shadow, wordArt: true }); syncWordArtControls("gold"); break;
      case "word-art-reset": applyWordArtFormat({ fill: "#f5c842", stroke: "#8a5b00", strokeWidth: 2, shadow: null }, "custom"); break;
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

  byId("wordArtStyle")?.addEventListener("change", (event) => {
    const preset = wordArtPresets[event.target.value];
    if (preset) applyWordArtFormat(preset, event.target.value);
  });
  byId("wordArtFill")?.addEventListener("input", (event) => applyWordArtFormat({ fill: event.target.value }));
  byId("wordArtOutline")?.addEventListener("input", (event) => applyWordArtFormat({ stroke: event.target.value }));
  byId("wordArtOutlineWidth")?.addEventListener("input", (event) => {
    byId("wordArtOutlineValue").textContent = `${event.target.value} px`;
    applyWordArtFormat({ strokeWidth: Number(event.target.value) });
  });
  byId("wordArtShadow")?.addEventListener("change", (event) => {
    applyWordArtFormat({ shadow: event.target.checked ? { color: "rgba(0,0,0,.35)", blur: 8, offsetX: 5, offsetY: 5 } : null });
  });
  canvas.on("selection:created", () => syncWordArtControls());
  canvas.on("selection:updated", () => syncWordArtControls());
  canvas.on("selection:cleared", () => syncWordArtControls());
  syncWordArtControls();

  const SMART_GUIDE_THRESHOLD = 7;
  let smartGuides = [];
  let transformMeasurement = null;
  const smartGuideCanvas = document.createElement("canvas");
  smartGuideCanvas.width = W;
  smartGuideCanvas.height = H;
  smartGuideCanvas.className = "smart-guide-overlay";
  smartGuideCanvas.setAttribute("aria-hidden", "true");
  canvas.wrapperEl.append(smartGuideCanvas);
  const smartGuideContext = smartGuideCanvas.getContext("2d");

  function boundsFor(object) {
    return object.getBoundingRect(true, true);
  }

  const wordArtPresets = {
    gold: { fill: "#f5c842", stroke: "#8a5b00", strokeWidth: 2, shadow: { color: "rgba(0,0,0,.35)", blur: 8, offsetX: 5, offsetY: 5 } },
    ocean: { fill: "#53d8fb", stroke: "#075985", strokeWidth: 3, shadow: { color: "rgba(7,89,133,.35)", blur: 10, offsetX: 4, offsetY: 5 } },
    outline: { fill: "#ffffff", stroke: "#111827", strokeWidth: 5, shadow: null },
    neon: { fill: "#f0abfc", stroke: "#86198f", strokeWidth: 2, shadow: { color: "#d946ef", blur: 18, offsetX: 0, offsetY: 0 } }
  };

  function isTextObject(object) {
    return object && ["textbox", "text", "i-text"].includes(object.type);
  }

  function applyWordArtFormat(changes, preset = "custom") {
    const object = active();
    if (!isTextObject(object)) return toast("Select WordArt or text to format it.");
    object.set({ ...changes, wordArt: true, paintFirst: "stroke" });
    object.dirty = true;
    object.initDimensions?.();
    object.setCoords();
    canvas.requestRenderAll();
    syncWordArtControls(preset);
    schedule();
  }

  function syncWordArtControls(preset = "custom") {
    const object = active();
    const enabled = isTextObject(object);
    const controls = ["wordArtStyle", "wordArtFill", "wordArtOutline", "wordArtOutlineWidth", "wordArtShadow"]
      .map(byId).filter(Boolean);
    controls.forEach((control) => { control.disabled = !enabled; });
    if (!enabled) return;
    byId("wordArtStyle").value = preset;
    byId("wordArtFill").value = safeColor(object.fill, "#f5c842").slice(0, 7);
    byId("wordArtOutline").value = safeColor(object.stroke, "#8a5b00").slice(0, 7);
    byId("wordArtOutlineWidth").value = Math.max(0, Math.min(12, Number(object.strokeWidth) || 0));
    byId("wordArtOutlineValue").textContent = `${byId("wordArtOutlineWidth").value} px`;
    byId("wordArtShadow").checked = Boolean(object.shadow);
  }

  function nearestGuide(points, candidates) {
    let best = null;
    points.forEach((point) => candidates.forEach((candidate) => {
      const delta = candidate - point;
      if (Math.abs(delta) <= SMART_GUIDE_THRESHOLD && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, value: candidate };
    }));
    return best;
  }

  function updateSmartGuides(event, snap = true) {
    const target = event.target;
    if (!target) return;
    let bounds = boundsFor(target);
    const xCandidates = [0, W / 2, W];
    const yCandidates = [0, H / 2, H];
    canvas.getObjects().filter((object) => object !== target).forEach((object) => {
      const other = boundsFor(object);
      xCandidates.push(other.left, other.left + other.width / 2, other.left + other.width);
      yCandidates.push(other.top, other.top + other.height / 2, other.top + other.height);
    });
    const xGuide = nearestGuide([bounds.left, bounds.left + bounds.width / 2, bounds.left + bounds.width], xCandidates);
    const yGuide = nearestGuide([bounds.top, bounds.top + bounds.height / 2, bounds.top + bounds.height], yCandidates);
    if (snap && xGuide) target.set("left", (target.left || 0) + xGuide.delta);
    if (snap && yGuide) target.set("top", (target.top || 0) + yGuide.delta);
    if (snap && (xGuide || yGuide)) { target.setCoords(); bounds = boundsFor(target); }
    smartGuides = [xGuide && { axis: "x", value: xGuide.value }, yGuide && { axis: "y", value: yGuide.value }].filter(Boolean);
    transformMeasurement = {
      left: bounds.left,
      top: bounds.top,
      width: Math.round(bounds.width),
      height: Math.round(bounds.height)
    };
    canvas.requestRenderAll();
  }

  function clearSmartGuides() {
    smartGuides = [];
    transformMeasurement = null;
    smartGuideContext.clearRect(0, 0, W, H);
  }

  canvas.on("object:moving", (event) => updateSmartGuides(event, true));
  canvas.on("mouse:up", clearSmartGuides);
  canvas.on("object:modified", clearSmartGuides);
  canvas.on("selection:cleared", clearSmartGuides);
  window.addEventListener("pointerup", clearSmartGuides);
  function renderSmartGuides() {
    const context = smartGuideContext;
    context.clearRect(0, 0, W, H);
    if (!smartGuides.length && !transformMeasurement) return;
    context.save();
    context.strokeStyle = "#0d99ff";
    context.lineWidth = 2;
    context.setLineDash([7, 5]);
    smartGuides.forEach((guide) => {
      context.beginPath();
      if (guide.axis === "x") { context.moveTo(guide.value, 0); context.lineTo(guide.value, H); }
      else { context.moveTo(0, guide.value); context.lineTo(W, guide.value); }
      context.stroke();
    });
    if (transformMeasurement) {
      const label = transformMeasurement.angle === undefined
        ? `${transformMeasurement.width} × ${transformMeasurement.height}`
        : `${transformMeasurement.angle}°`;
      context.setLineDash([]);
      context.font = "600 15px Arial";
      const width = context.measureText(label).width + 18;
      const x = Math.max(4, Math.min(W - width - 4, transformMeasurement.left));
      const y = Math.max(24, transformMeasurement.top - 12);
      context.fillStyle = "#0d99ff";
      context.fillRect(x, y - 20, width, 25);
      context.fillStyle = "#fff";
      context.fillText(label, x + 9, y - 3);
    }
    context.restore();
  }

  canvas.on("after:render", renderSmartGuides);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !shareModal.hidden) closeShare();
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c" && !event.target.matches("input,textarea")) {
      event.preventDefault();
      byId("copyObject").click();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v" && internalCopyPending && !event.target.matches("input,textarea,[contenteditable=true]") && !active()?.isEditing) {
      event.preventDefault();
      internalCopyPending = false;
      pasteObject();
    }
    if ((event.ctrlKey || event.metaKey) && ["b", "u", "i"].includes(event.key.toLowerCase()) && active()?.isEditing) {
      event.preventDefault();
      const actionName = { b: "bold", u: "underline", i: "italic" }[event.key.toLowerCase()];
      document.querySelector(`[data-builder-action="${actionName}"]`)?.click();
    }
  });

  document.addEventListener("paste", (event) => {
    const target = event.target;
    const imageItem = [...(event.clipboardData?.items || [])].find((item) => item.kind === "file" && item.type.startsWith("image/"));
    if (imageItem) {
      event.preventDefault();
      active()?.exitEditing?.();
      insertClipboardImage(imageItem.getAsFile());
      return;
    }
    const htmlImage = imageSourceFromHtml(event.clipboardData?.getData("text/html") || "");
    if (htmlImage) {
      event.preventDefault();
      active()?.exitEditing?.();
      insertClipboardImageSource(htmlImage);
      return;
    }
    if (target?.matches?.("input,textarea,[contenteditable=true]")) return;
    if (active()?.isEditing) {
      const editingObject = active();
      window.setTimeout(() => {
        fitPastedTextToSlide(editingObject);
        canvas.requestRenderAll();
        schedule();
      }, 0);
      return;
    }
    const value = event.clipboardData?.getData("text/plain") || "";
    const html = event.clipboardData?.getData("text/html") || "";
    event.preventDefault();
    if (builderClipboard && value === builderClipboardText) pasteObject();
    else if (!insertClipboardText(value, clipboardTextStyle(html)) && builderClipboard) pasteObject();
    else if (!value) toast("Clipboard does not contain text or an image.");
  });

  window.addEventListener("blur", () => { internalCopyPending = false; });
})();
