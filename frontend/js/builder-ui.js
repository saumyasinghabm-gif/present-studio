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
    return /^(transparent|#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(String(value || "")) ? value : fallback;
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
    const groupObjects = object.type === "group" && Array.isArray(object.objects) ? object.objects : [];
    const geometry = groupObjects.find((item) => ["rect", "circle", "triangle", "path", "line"].includes(item.type)) || object;
    const label = groupObjects.find((item) => ["textbox", "text", "i-text"].includes(item.type));
    const shapeType = geometry.type;
    if (["rect", "circle", "triangle", "path"].includes(shapeType)) {
      const kind = geometry.shapeKind || object.shapeKind || "";
      const shapeClass = shapeType === "circle" ? " is-circle" : shapeType === "triangle" ? " is-triangle" : kind ? ` is-${esc(kind)}` : shapeType === "path" ? " is-arrow" : " is-rect";
      const fill = safeColor(geometry.fill, "#f5c842");
      const stroke = safeColor(geometry.stroke, "transparent");
      const opacity = Math.max(0, Math.min(1, Number(object.opacity) || 1));
      const labelFont = ["Arial", "Calibri", "Inter", "Verdana", "Tahoma", "Trebuchet MS", "Georgia", "Times New Roman", "Garamond", "Palatino Linotype", "Courier New", "Impact"].includes(label?.fontFamily) ? label.fontFamily : "Arial";
      const labelMarkup = label ? `<span class="slide-thumbnail-shape-text" style="font-size:${Math.max(4, Number(label.fontSize || 24) / 7)}px;font-family:${labelFont};font-weight:${esc(label.fontWeight || "normal")};font-style:${esc(label.fontStyle || "normal")};color:${safeColor(label.fill, "#171717")};text-align:${esc(label.textAlign || "center")};">${esc(label.text || "")}</span>` : "";
      return `<span class="slide-thumbnail-object is-shape${shapeClass}" style="${style}opacity:${opacity};--thumbnail-shape-fill:${fill};--thumbnail-shape-stroke:${stroke};"><span class="slide-thumbnail-shape-geometry"></span>${labelMarkup}</span>`;
    }
    if (shapeType === "line") {
      return `<span class="slide-thumbnail-object is-shape-line" style="${style}--thumbnail-shape-stroke:${safeColor(geometry.stroke, "#101010")};"></span>`;
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
    const common = { id: `${id}_geometry`, shapeKind: type, left: 0, top: 0, originX: "center", originY: "center", fill: "transparent", stroke: "#101010", strokeWidth: 2 };
    const shapes = {
      circle: () => new fabric.Circle({ ...common, radius: 100 }),
      triangle: () => new fabric.Triangle({ ...common, width: 220, height: 190 }),
      "rounded-rectangle": () => new fabric.Rect({ ...common, width: 260, height: 180, rx: 28, ry: 28 }),
      line: () => new fabric.Line([0, 0, 260, 0], { ...common, top: 360, fill: null, strokeWidth: 6 }),
      arrow: () => new fabric.Path("M 0 35 L 180 35 L 180 0 L 260 60 L 180 120 L 180 85 L 0 85 Z", { ...common }),
      "double-arrow": () => new fabric.Path("M 0 60 L 70 0 L 70 35 L 190 35 L 190 0 L 260 60 L 190 120 L 190 85 L 70 85 L 70 120 Z", { ...common }),
      hexagon: () => new fabric.Path("M 65 0 L 195 0 L 260 90 L 195 180 L 65 180 L 0 90 Z", { ...common }),
      star: () => new fabric.Path("M 130 0 L 160 85 L 250 86 L 178 138 L 204 224 L 130 172 L 56 224 L 82 138 L 10 86 L 100 85 Z", { ...common }),
      callout: () => new fabric.Path("M 18 0 L 242 0 Q 260 0 260 18 L 260 130 Q 260 148 242 148 L 120 148 L 68 198 L 82 148 L 18 148 Q 0 148 0 130 L 0 18 Q 0 0 18 0 Z", { ...common }),
      brace: () => new fabric.Path("M 75 0 C 30 0 30 38 50 58 C 65 74 55 94 25 100 C 55 106 65 126 50 142 C 30 162 30 200 75 200", { ...common, fill: null, strokeWidth: 10, strokeLineCap: "round" })
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
    toast("Shape inserted. Start typing or double-click it to add text.");
  }

  function addGroup(objects, options = {}) {
    const group = new fabric.Group(objects, {
      id: options.id || `group_${Date.now()}`,
      left: options.left ?? 340,
      top: options.top ?? 190,
      objectCaching: false,
      lockScalingFlip: true,
      ...options
    });
    canvas.add(group);
    canvas.setActiveObject(group);
    canvas.requestRenderAll();
    schedule();
    return group;
  }

  function addLabel(text, left, top, options = {}) {
    return new fabric.Textbox(text, {
      left,
      top,
      originX: "center",
      originY: "center",
      width: options.width || 160,
      fontSize: options.fontSize || 28,
      fontFamily: "Arial",
      fill: options.fill || "#171717",
      textAlign: "center",
      ...options
    });
  }

  function insertFrame(kind) {
    const id = `frame_${Date.now()}`;
    const base = { id: `${id}_geometry`, frameKind: kind, left: 0, top: 0, originX: "center", originY: "center", fill: "transparent", stroke: "#101010", strokeWidth: 4 };
    if (kind === "circle") {
      canvas.add(new fabric.Circle({ ...base, id, left: 540, top: 320, radius: 125, strokeWidth: 5 }));
      canvas.setActiveObject(canvas.getObjects().at(-1));
    } else if (kind === "corners") {
      const lines = [[0, 0, 80, 0], [0, 0, 0, 80], [340, 0, 260, 0], [340, 0, 340, 80], [0, 210, 80, 210], [0, 210, 0, 130], [340, 210, 260, 210], [340, 210, 340, 130]]
        .map((points, index) => new fabric.Line(points, { id: `${id}_corner_${index}`, frameKind: kind, stroke: "#101010", strokeWidth: 8, strokeLineCap: "square" }));
      addGroup(lines, { id, frameKind: kind, left: 470, top: 255 });
    } else {
      const options = {
        rounded: { rx: 24, ry: 24 },
        thick: { strokeWidth: 10 },
        dashed: { strokeDashArray: [18, 12] },
        shadow: { shadow: "0 12px 24px rgba(0,0,0,.24)" }
      }[kind] || {};
      canvas.add(new fabric.Rect({ ...base, ...options, id, left: 520, top: 310, width: 360, height: 220 }));
      canvas.setActiveObject(canvas.getObjects().at(-1));
    }
    canvas.requestRenderAll();
    schedule();
    toast("Frame inserted.");
  }

  function insertFlowchart(kind) {
    if (kind === "connector") { insertShape("arrow"); return; }
    if (kind === "database") {
      const id = `flow_${Date.now()}`;
      const parts = [
        new fabric.Rect({ id: `${id}_body`, flowchartKind: kind, left: 0, top: 25, width: 240, height: 130, fill: "transparent", stroke: "#101010", strokeWidth: 2 }),
        new fabric.Ellipse({ id: `${id}_top`, flowchartKind: kind, left: 120, top: 25, originX: "center", originY: "center", rx: 120, ry: 28, fill: "#ffffff", stroke: "#101010", strokeWidth: 2 }),
        new fabric.Ellipse({ id: `${id}_bottom`, flowchartKind: kind, left: 120, top: 155, originX: "center", originY: "center", rx: 120, ry: 28, fill: "transparent", stroke: "#101010", strokeWidth: 2 }),
        addLabel("Data", 120, 90, { width: 180, fontSize: 26 })
      ];
      addGroup(parts, { id, flowchartKind: kind, left: 520, top: 280 });
      toast("Flowchart shape inserted.");
      return;
    }
    const id = `flow_${Date.now()}`;
    const common = { id: `${id}_geometry`, shapeKind: kind, flowchartKind: kind, left: 0, top: 0, originX: "center", originY: "center", fill: "transparent", stroke: "#101010", strokeWidth: 2 };
    const shape = kind === "decision"
      ? new fabric.Path("M 130 0 L 260 85 L 130 170 L 0 85 Z", common)
      : kind === "terminator"
        ? new fabric.Rect({ ...common, width: 280, height: 120, rx: 60, ry: 60 })
        : kind === "document"
          ? new fabric.Path("M 0 0 L 260 0 L 260 130 C 195 100 145 170 80 135 C 48 118 25 122 0 142 Z", common)
          : new fabric.Rect({ ...common, width: 280, height: 130, rx: 5, ry: 5 });
    const label = createShapeLabel(shape, kind === "decision" ? "Decision" : kind === "terminator" ? "Start / End" : kind === "document" ? "Document" : "Process", `${id}_label`);
    const group = new fabric.Group([shape, label], { id, left: 500, top: 300 });
    configureShapeTextGroup(group);
    canvas.add(group);
    canvas.setActiveObject(group);
    canvas.requestRenderAll();
    schedule();
    toast("Flowchart shape inserted.");
  }

  function insertDiagram(kind) {
    const id = `diagram_${Date.now()}`;
    const accent = "#f5c842";
    const dark = "#101010";
    const items = [];
    if (kind === "timeline" || kind === "roadmap") {
      items.push(new fabric.Line([0, 80, 620, 80], { stroke: dark, strokeWidth: 5 }));
      [0, 1, 2, 3].forEach((index) => {
        const x = 70 + index * 160;
        items.push(new fabric.Circle({ left: x, top: 80, originX: "center", originY: "center", radius: 22, fill: accent, stroke: dark, strokeWidth: 2 }));
        items.push(addLabel(kind === "roadmap" ? `Phase ${index + 1}` : `Step ${index + 1}`, x, index % 2 ? 140 : 30, { width: 130, fontSize: 22 }));
      });
    } else if (kind === "cycle") {
      [[190, 20], [340, 150], [190, 280], [40, 150]].forEach(([x, y], index) => {
        items.push(new fabric.Circle({ left: x, top: y, originX: "center", originY: "center", radius: 56, fill: "transparent", stroke: dark, strokeWidth: 2 }));
        items.push(addLabel(`Step ${index + 1}`, x, y, { width: 90, fontSize: 20 }));
      });
      items.push(new fabric.Path("M 250 38 C 350 60 410 115 392 204", { fill: null, stroke: accent, strokeWidth: 8, strokeLineCap: "round" }));
      items.push(new fabric.Path("M 130 262 C 30 240 -30 185 -12 96", { fill: null, stroke: accent, strokeWidth: 8, strokeLineCap: "round" }));
    } else if (kind === "matrix") {
      [0, 1, 2, 3].forEach((index) => {
        items.push(new fabric.Rect({ left: (index % 2) * 230, top: Math.floor(index / 2) * 130, width: 220, height: 120, fill: index % 2 ? "#fff8d9" : "transparent", stroke: dark, strokeWidth: 2 }));
        items.push(addLabel(["Strengths", "Weaknesses", "Opportunities", "Threats"][index], (index % 2) * 230 + 110, Math.floor(index / 2) * 130 + 60, { width: 180, fontSize: 21 }));
      });
    } else if (kind === "venn") {
      items.push(new fabric.Circle({ left: 145, top: 130, originX: "center", originY: "center", radius: 115, fill: "rgba(245,200,66,.45)", stroke: dark, strokeWidth: 2 }));
      items.push(new fabric.Circle({ left: 285, top: 130, originX: "center", originY: "center", radius: 115, fill: "rgba(74,119,109,.38)", stroke: dark, strokeWidth: 2 }));
      items.push(addLabel("A", 95, 130, { width: 80, fontSize: 28 }));
      items.push(addLabel("B", 335, 130, { width: 80, fontSize: 28 }));
    } else {
      [0, 1, 2].forEach((index) => {
        const y = 170 - index * 78;
        const inset = index * 65;
        items.push(new fabric.Path(`M ${inset} ${y} L ${390 - inset} ${y} L ${330 - inset / 2} ${y + 70} L ${60 + inset / 2} ${y + 70} Z`, { fill: index === 1 ? "#fff8d9" : "transparent", stroke: dark, strokeWidth: 2 }));
        items.push(addLabel(`Level ${index + 1}`, 195, y + 35, { width: 160, fontSize: 20 }));
      });
    }
    addGroup(items, { id, diagramKind: kind, left: kind === "timeline" || kind === "roadmap" ? 330 : 430, top: kind === "timeline" || kind === "roadmap" ? 275 : 220 });
    toast("Diagram inserted.");
  }

  function insertChart(kind) {
    const id = `chart_${Date.now()}`;
    const items = [];
    const accent = "#f5c842";
    const dark = "#101010";
    if (kind === "bar") {
      [120, 210, 165, 270, 225].forEach((height, index) => items.push(new fabric.Rect({ left: index * 85, top: 300 - height, width: 50, height, fill: index === 3 ? dark : accent, stroke: dark, strokeWidth: 1 })));
      items.push(new fabric.Line([0, 300, 430, 300], { stroke: dark, strokeWidth: 3 }));
      items.push(addLabel("Bar chart", 215, 340, { width: 220, fontSize: 24 }));
    } else if (kind === "line") {
      items.push(new fabric.Line([0, 250, 450, 250], { stroke: dark, strokeWidth: 3 }));
      items.push(new fabric.Line([0, 0, 0, 250], { stroke: dark, strokeWidth: 3 }));
      items.push(new fabric.Polyline([{ x: 35, y: 190 }, { x: 130, y: 95 }, { x: 225, y: 145 }, { x: 320, y: 55 }, { x: 420, y: 88 }], { fill: null, stroke: accent, strokeWidth: 7 }));
      items.push(addLabel("Line chart", 225, 295, { width: 220, fontSize: 24 }));
    } else if (kind === "progress") {
      items.push(new fabric.Rect({ left: 0, top: 0, width: 520, height: 54, rx: 27, ry: 27, fill: "#ecece7", stroke: dark, strokeWidth: 2 }));
      items.push(new fabric.Rect({ left: 0, top: 0, width: 360, height: 54, rx: 27, ry: 27, fill: accent, stroke: null }));
      items.push(addLabel("70%", 260, 27, { width: 120, fontSize: 28, fontWeight: "bold" }));
    } else if (kind === "kpi") {
      items.push(new fabric.Rect({ left: 0, top: 0, width: 310, height: 180, rx: 8, ry: 8, fill: "#ffffff", stroke: dark, strokeWidth: 2, shadow: "0 10px 22px rgba(0,0,0,.16)" }));
      items.push(addLabel("$42K", 155, 70, { width: 240, fontSize: 54, fontWeight: "bold" }));
      items.push(addLabel("Monthly revenue", 155, 130, { width: 240, fontSize: 22, fill: "#555555" }));
    } else {
      const outer = new fabric.Circle({ left: 130, top: 130, originX: "center", originY: "center", radius: 120, fill: kind === "donut" ? "transparent" : accent, stroke: dark, strokeWidth: 2 });
      const wedge = new fabric.Path("M 130 130 L 130 10 A 120 120 0 0 1 238 182 Z", { fill: dark, stroke: "#ffffff", strokeWidth: 2 });
      items.push(outer, wedge);
      if (kind === "donut") items.push(new fabric.Circle({ left: 130, top: 130, originX: "center", originY: "center", radius: 58, fill: "#ffffff", stroke: "#ffffff", strokeWidth: 2 }));
      items.push(addLabel(kind === "donut" ? "Donut chart" : "Pie chart", 130, 285, { width: 220, fontSize: 24 }));
    }
    addGroup(items, { id, chartKind: kind, left: kind === "kpi" ? 485 : 410, top: kind === "progress" ? 330 : 210 });
    toast("Chart inserted.");
  }

  const SHAPE_TYPES = new Set(["rect", "circle", "triangle", "path"]);

  function isEditableShape(object) {
    return Boolean(object && SHAPE_TYPES.has(object.type) && object.mediaType !== "video");
  }

  function selectedShape(object = active()) {
    if (!object) return null;
    const parts = shapeTextParts(object);
    if (parts) return { object, geometry: parts.shape, label: parts.label, isLine: false };
    if (object.type === "line") return { object, geometry: object, label: null, isLine: true };
    if (isEditableShape(object)) return { object, geometry: object, label: null, isLine: false };
    return null;
  }

  function colorInputValue(value, fallback) {
    const color = String(value || "").trim();
    return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
  }

  function syncShapeFormatControls() {
    const selection = selectedShape();
    const controls = all(".shape-format-group input");
    controls.forEach((control) => { control.disabled = !selection; });
    if (!selection) return;
    const { object, geometry, isLine } = selection;
    const fill = byId("shapeFill");
    const noFill = byId("shapeNoFill");
    const transparentFill = geometry.fill === "transparent" || /^rgba?\([^)]*,\s*0(?:\.0+)?\s*\)$/i.test(String(geometry.fill || ""));
    fill.disabled = isLine;
    fill.value = colorInputValue(geometry.fill, "#f5c842");
    noFill.disabled = isLine;
    noFill.checked = !isLine && transparentFill;
    byId("shapeOutline").value = colorInputValue(geometry.stroke, "#101010");
    const width = Math.max(0, Math.min(16, Number(geometry.strokeWidth) || 0));
    byId("shapeOutlineWidth").value = width;
    byId("shapeOutlineWidthValue").textContent = `${width} px`;
    const opacity = Math.round(Math.max(.1, Math.min(1, Number(object.opacity) || 1)) * 100);
    byId("shapeOpacity").value = opacity;
    byId("shapeOpacityValue").textContent = `${opacity}%`;
    byId("shapeShadow").checked = Boolean(geometry.shadow);
  }

  function applyShapeGeometry(changes) {
    const selection = selectedShape();
    if (!selection) { toast("Select a shape first."); return; }
    selection.geometry.set(changes);
    selection.geometry.setCoords();
    selection.object.set({ dirty: true });
    selection.object.setCoords();
    canvas.requestRenderAll();
    syncShapeFormatControls();
    schedule();
  }

  function applyShapeOpacity(value) {
    const selection = selectedShape();
    if (!selection) { toast("Select a shape first."); return; }
    selection.object.set({ opacity: Math.max(.1, Math.min(1, Number(value) / 100)), dirty: true });
    selection.object.setCoords();
    canvas.requestRenderAll();
    syncShapeFormatControls();
    schedule();
  }

  function shapeTextParts(group) {
    if (group?.type !== "group") return null;
    const objects = group.getObjects?.() || [];
    const label = objects.find((object) => object.type === "textbox");
    const shape = objects.find(isEditableShape);
    return label && shape && objects.length === 2 ? { shape, label } : null;
  }

  function shapeTextBounds(shape) {
    const width = Number(shape?.width) || Number(shape?.radius) * 2 || 220;
    const height = Number(shape?.height) || Number(shape?.radius) * 2 || 160;
    const factor = shape?.type === "circle" ? { width: .68, height: .68 }
      : shape?.type === "triangle" ? { width: .5, height: .44 }
        : shape?.type === "path" ? { width: .64, height: .48 }
          : { width: .82, height: .72 };
    return {
      width: Math.max(48, width * factor.width),
      height: Math.max(32, height * factor.height)
    };
  }

  function fitShapeLabel(shape, label) {
    if (!shape || !label) return;
    const bounds = shapeTextBounds(shape);
    const requestedFontSize = Math.max(8, Math.min(240, Number(label.shapeRequestedFontSize) || Number(label.fontSize) || 32));
    label.set({
      width: bounds.width,
      fontSize: requestedFontSize,
      clipPath: new fabric.Rect({
        originX: "center",
        originY: "center",
        width: bounds.width,
        height: bounds.height
      }),
      objectCaching: false,
      dirty: true
    });
    label.initDimensions?.();
    let attempts = 0;
    while (Number(label.height) > bounds.height && Number(label.fontSize) > 8 && attempts < 8) {
      const ratio = bounds.height / Math.max(1, Number(label.height));
      label.set("fontSize", Math.max(8, Math.floor(Number(label.fontSize) * ratio)));
      label.initDimensions?.();
      attempts += 1;
    }
    label.setCoords();
  }

  function createShapeLabel(shape, value = "", id = `shape_label_${Date.now()}`) {
    const shapeWidth = Number(shape.width) || Number(shape.radius) * 2 || 220;
    const label = new fabric.Textbox(value, {
      id,
      left: 0,
      top: 0,
      originX: "center",
      originY: "center",
      width: Math.max(70, shapeWidth * 0.76),
      fontSize: 32,
      shapeRequestedFontSize: 32,
      shapeText: true,
      fontFamily: "Arial",
      fontWeight: "normal",
      fill: "#171717",
      textAlign: "center",
      lockScalingFlip: true
    });
    fitShapeLabel(shape, label);
    return label;
  }

  function prepareShapeLabelForEditing(shape, label) {
    const center = shape.getCenterPoint();
    label.set({
      left: center.x,
      top: center.y,
      originX: "center",
      originY: "center",
      angle: shape.angle || 0,
      scaleX: Math.abs(Number(shape.scaleX) || 1),
      scaleY: Math.abs(Number(shape.scaleY) || 1),
      hasControls: false,
      borderColor: "#d39e00",
      padding: 2,
      shapeText: true
    });
    fitShapeLabel(shape, label);
    label.setCoords();
  }

  function configureShapeTextGroup(group) {
    const parts = shapeTextParts(group);
    if (!parts) return false;
    // Fabric can otherwise reuse the empty group cache created before the
    // label was edited, which makes saved text disappear until the next edit.
    group.set({ lockScalingFlip: true, objectCaching: false, dirty: true });
    parts.label.set({ objectCaching: false, dirty: true });
    fitShapeLabel(parts.shape, parts.label);
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
    label.set({ selectable: true, evented: true, hasControls: true });
    fitShapeLabel(session.shape, label);
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
    syncTextControls();
    schedule();
  }

  function beginShapeTextEditing(target, options = {}) {
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
      prepareShapeLabelForEditing(shape, label);
    } else if (isEditableShape(target)) {
      shape = target;
      const center = shape.getCenterPoint();
      label = createShapeLabel(shape, "", `${shape.id || `shape_${Date.now()}`}_label`);
      label.set({ left: center.x, top: center.y });
      prepareShapeLabelForEditing(shape, label);
      canvas.add(label);
      state = groupState(null, shape.id);
    } else return false;

    const previousLoading = loading;
    loading = true;
    shapeTextEditSession = { shape, label, state, previousLoading };
    configureTextResize(label);
    label.setControlsVisibility?.({ tl: false, tr: false, bl: false, br: false, ml: false, mr: false, mt: false, mb: false, mtr: false });
    label.once("editing:exited", () => window.setTimeout(() => finishShapeTextEditing(label), 0));
    canvas.setActiveObject(label);
    label.enterEditing();
    if (options.replaceText !== undefined) {
      label.set("text", String(options.replaceText));
      fitShapeLabel(shape, label);
    }
    const caret = String(label.text || "").length;
    label.selectionStart = options.selectAll ? 0 : caret;
    label.selectionEnd = caret;
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
  canvas.on("text:changed", (event) => {
    if (shapeTextEditSession?.label !== event.target) return;
    fitShapeLabel(shapeTextEditSession.shape, event.target);
    canvas.requestRenderAll();
  });

  byId("shapeFill")?.addEventListener("input", (event) => {
    byId("shapeNoFill").checked = false;
    applyShapeGeometry({ fill: event.target.value });
  });
  byId("shapeNoFill")?.addEventListener("change", (event) => applyShapeGeometry({
    fill: event.target.checked ? "transparent" : byId("shapeFill").value
  }));
  byId("shapeOutline")?.addEventListener("input", (event) => applyShapeGeometry({ stroke: event.target.value }));
  byId("shapeOutlineWidth")?.addEventListener("input", (event) => {
    byId("shapeOutlineWidthValue").textContent = `${event.target.value} px`;
    applyShapeGeometry({ strokeWidth: Number(event.target.value) });
  });
  byId("shapeOpacity")?.addEventListener("input", (event) => {
    byId("shapeOpacityValue").textContent = `${event.target.value}%`;
    applyShapeOpacity(event.target.value);
  });
  byId("shapeShadow")?.addEventListener("change", (event) => applyShapeGeometry({
    shadow: event.target.checked ? new fabric.Shadow({ color: "rgba(0,0,0,.3)", blur: 12, offsetX: 7, offsetY: 7 }) : null
  }));
  canvas.on("selection:created", syncShapeFormatControls);
  canvas.on("selection:updated", syncShapeFormatControls);
  canvas.on("selection:cleared", syncShapeFormatControls);
  canvas.on("object:modified", syncShapeFormatControls);
  syncShapeFormatControls();

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
    if (object && ["textbox", "text", "i-text"].includes(object.type)) return object;
    return shapeTextParts(object)?.label || null;
  }

  function selectedTextContainer() {
    const object = active();
    return shapeTextParts(object) ? object : null;
  }

  function paragraphIndexAt(textObject, position) {
    return String(textObject?.text || "").slice(0, Math.max(0, Number(position) || 0)).split("\n").length - 1;
  }

  function paragraphAlignmentAt(textObject, position) {
    const paragraphIndex = paragraphIndexAt(textObject, position);
    const alignment = textObject?.paragraphAlignments?.[paragraphIndex];
    return ["left", "center", "right", "justify"].includes(alignment) ? alignment : (textObject?.textAlign || "left");
  }

  function syncTextControls() {
    const textObject = selectedText();
    const editorPanel = byId("editorPanel");
    if (editorPanel) editorPanel.hidden = !textObject;
    if (!textObject) return;
    const size = selectedTextStyle(textObject, "fontSize") || textObject.fontSize || 32;
    const fill = selectedTextStyle(textObject, "fill") || textObject.fill || "#171717";
    byId("selectionNote").textContent = selectedTextContainer() ? "Shape text" : textObject.id === "title" ? "Title" : textObject.id === "subtitle" ? "Subtitle" : "Text";
    byId("fontSize").value = Math.round(size);
    byId("fontFamily").value = textObject.fontFamily || "Arial";
    byId("textColor").value = colorInputValue(fill, "#171717");
    const weight = selectedTextStyle(textObject, "fontWeight");
    byId("boldButton").classList.toggle("active", String(weight) === "bold" || Number(weight) >= 700);
    byId("italicButton").classList.toggle("active", selectedTextStyle(textObject, "fontStyle") === "italic");
    const alignment = paragraphAlignmentAt(textObject, textObject.isEditing ? textObject.selectionStart : 0);
    const alignmentActions = { "align-left": "left", "align-center": "center", "align-right": "right", justify: "justify" };
    Object.entries(alignmentActions).forEach(([actionName, value]) => {
      const button = document.querySelector(`[data-builder-action="${actionName}"]`);
      button?.classList.toggle("is-active", alignment === value);
      button?.setAttribute("aria-pressed", alignment === value ? "true" : "false");
    });
    const spacing = Number(textObject.lineHeight) || 1.16;
    const spacingOption = [1, 1.15, 1.5, 2].reduce((closest, value) => Math.abs(value - spacing) < Math.abs(closest - spacing) ? value : closest, 1.15);
    byId("lineSpacing").value = String(spacingOption);
  }

  const basePanel = panel;
  panel = function builderPanel() {
    basePanel();
    syncTextControls();
  };

  format = function formatBuilderText(changes) {
    const textObject = selectedText();
    if (!textObject) { toast("Select a text element or a shape containing text."); return; }
    if (changes.fontSize !== undefined) textObject.set("shapeRequestedFontSize", Number(changes.fontSize));
    if (textObject.isEditing && textObject.selectionStart !== textObject.selectionEnd) {
      textObject.setSelectionStyles(changes, textObject.selectionStart, textObject.selectionEnd);
    } else textObject.set(changes);
    textObject.set({ dirty: true });
    textObject.initDimensions?.();
    const container = selectedTextContainer();
    const parts = shapeTextParts(container);
    if (parts) {
      fitShapeLabel(parts.shape, textObject);
      container.set({ dirty: true });
      container.setCoords();
    } else if (shapeTextEditSession?.label === textObject) {
      fitShapeLabel(shapeTextEditSession.shape, textObject);
    }
    textObject.setCoords();
    canvas.requestRenderAll();
    syncTextControls();
    schedule();
  };

  function selectedParagraphRange(textObject) {
    const value = String(textObject.text || "");
    if (!textObject.isEditing) return { start: 0, end: value.length };
    const selectionStart = Math.max(0, Number(textObject.selectionStart) || 0);
    const selectionEnd = Math.max(selectionStart, Number(textObject.selectionEnd) || selectionStart);
    const start = value.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1;
    const nextBreak = value.indexOf("\n", selectionEnd);
    return { start, end: nextBreak < 0 ? value.length : nextBreak };
  }

  let pendingParagraphSelection = null;

  function selectedParagraphIndexes(textObject) {
    const value = String(textObject.text || "");
    const saved = pendingParagraphSelection?.textObject === textObject ? pendingParagraphSelection : null;
    if (!textObject.isEditing && !saved) return value.split("\n").map((_, index) => index);
    const selectionStart = Math.max(0, Number(saved?.start ?? textObject.selectionStart) || 0);
    const selectionEnd = Math.max(selectionStart, Number(saved?.end ?? textObject.selectionEnd) || selectionStart);
    const first = paragraphIndexAt(textObject, selectionStart);
    const lastPosition = selectionEnd > selectionStart ? selectionEnd - 1 : selectionStart;
    const last = paragraphIndexAt(textObject, lastPosition);
    return Array.from({ length: last - first + 1 }, (_, index) => first + index);
  }

  function applyParagraphAlignment(alignment) {
    const textObject = selectedText() || pendingParagraphSelection?.textObject;
    if (!textObject) { toast("Select text first."); return; }
    const paragraphs = String(textObject.text || "").split("\n");
    const indexes = selectedParagraphIndexes(textObject);
    if (indexes.length === paragraphs.length) {
      textObject.set({ textAlign: alignment, paragraphAlignments: [] });
    } else {
      const paragraphAlignments = Array.isArray(textObject.paragraphAlignments) ? textObject.paragraphAlignments.slice(0, paragraphs.length) : [];
      indexes.forEach((index) => { paragraphAlignments[index] = alignment; });
      textObject.set("paragraphAlignments", paragraphAlignments);
    }
    pendingParagraphSelection = null;
    textObject.set({ dirty: true });
    textObject.initDimensions?.();
    const container = selectedTextContainer();
    const parts = shapeTextParts(container);
    if (parts) { fitShapeLabel(parts.shape, textObject); container.set({ dirty: true }); container.setCoords(); }
    else if (shapeTextEditSession?.label === textObject) fitShapeLabel(shapeTextEditSession.shape, textObject);
    textObject.setCoords();
    canvas.requestRenderAll();
    syncTextControls();
    schedule();
  }

  function transformSelectedParagraphs(transformer) {
    const textObject = selectedText();
    if (!textObject) { toast("Select text first."); return; }
    const value = String(textObject.text || "");
    const range = selectedParagraphRange(textObject);
    const transformed = transformer(value.slice(range.start, range.end).split("\n"));
    textObject.set("text", value.slice(0, range.start) + transformed.join("\n") + value.slice(range.end));
    textObject.initDimensions?.();
    const container = selectedTextContainer();
    const parts = shapeTextParts(container);
    if (parts) { fitShapeLabel(parts.shape, textObject); container.set({ dirty: true }); }
    else if (shapeTextEditSession?.label === textObject) fitShapeLabel(shapeTextEditSession.shape, textObject);
    textObject.setCoords();
    canvas.requestRenderAll();
    syncTextControls();
    schedule();
  }

  byId("lineSpacing")?.addEventListener("change", (event) => format({ lineHeight: Number(event.target.value) }));
  byId("fontSize")?.addEventListener("input", (event) => format({ fontSize: Math.max(8, Math.min(240, Number(event.target.value) || 32)) }));
  byId("textColor")?.addEventListener("input", (event) => format({ fill: event.target.value }));
  byId("fontFamily")?.addEventListener("change", (event) => format({ fontFamily: event.target.value }));
  canvas.on("selection:created", syncTextControls);
  canvas.on("selection:updated", syncTextControls);
  canvas.on("selection:cleared", syncTextControls);
  syncTextControls();

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

  document.querySelector(".ribbon").addEventListener("pointerdown", (event) => {
    const button = event.target.closest("[data-builder-action]");
    if (!button || !["align-left", "align-center", "align-right", "justify"].includes(button.dataset.builderAction)) return;
    const textObject = selectedText();
    if (textObject?.isEditing) {
      pendingParagraphSelection = { textObject, start: textObject.selectionStart, end: textObject.selectionEnd };
    }
  });

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
      case "align-left": applyParagraphAlignment("left"); break;
      case "align-center": applyParagraphAlignment("center"); break;
      case "align-right": applyParagraphAlignment("right"); break;
      case "justify": applyParagraphAlignment("justify"); break;
      case "bullets": transformSelectedParagraphs((lines) => { const remove = lines.filter((line) => line.trim()).every((line) => /^\s*•\s+/.test(line)); return lines.map((line) => !line.trim() ? line : remove ? line.replace(/^(\s*)•\s+/, "$1") : line.replace(/^(\s*)(?:•\s+|\d+\.\s+)?/, "$1• ")); }); break;
      case "numbering": transformSelectedParagraphs((lines) => { let number = 0; return lines.map((line) => { if (!line.trim()) return line; number += 1; return line.replace(/^(\s*)(?:•\s+|\d+\.\s+)?/, `$1${number}. `); }); }); break;
      case "indent-less": transformSelectedParagraphs((lines) => lines.map((line) => line.replace(/^(?:\t| {1,4})/, ""))); break;
      case "indent-more": transformSelectedParagraphs((lines) => lines.map((line) => line.trim() ? `\t${line}` : line)); break;
      case "line-spacing": if (textObject) { const values = [1, 1.15, 1.5, 2]; const current = Number(textObject.lineHeight) || 1.15; const next = values[(values.findIndex((value) => value >= current - .01) + 1) % values.length]; format({ lineHeight: next }); } else toast("Select text first."); break;
      case "rotate": if (object) { object.rotate(((object.angle || 0) + 90) % 360); canvas.requestRenderAll(); schedule(); } else toast("Select an element first."); break;
      case "group": groupSelection(); break;
      case "align-objects": if (object) { object.set({ left: (W - object.getScaledWidth()) / 2, top: (H - object.getScaledHeight()) / 2 }); object.setCoords(); canvas.requestRenderAll(); schedule(); } else toast("Select an element first."); break;
      case "reset-slide": if (object) { object.set({ angle: 0, opacity: 1, shadow: null }); object.setCoords(); canvas.requestRenderAll(); schedule(); } else { canvas.backgroundColor = "#fffefb"; canvas.requestRenderAll(); schedule(); } break;
      case "layout": applyLayout(window.prompt("Layout: blank, title-content, or two-column", "title-content") || "title-content"); break;
      case "section": ensure(activeSlide()).canvas.section = window.prompt("Section name", ensure(activeSlide()).canvas.section || "New section") || ""; schedule(); break;
      case "format-painter": if (!object) toast("Select a source element first."); else { const style = { fill: object.fill, fontFamily: object.fontFamily, fontSize: object.fontSize, fontWeight: object.fontWeight, fontStyle: object.fontStyle, stroke: object.stroke, strokeWidth: object.strokeWidth }; toast("Format copied. Select another element."); canvas.once("selection:created", (selection) => { selection.selected?.[0]?.set(style); canvas.requestRenderAll(); schedule(); }); } break;
      case "insert-text": break;
      case "insert-shape": insertShape(button.dataset.shape || "rectangle"); break;
      case "word-art-gallery": toggleWordArtGallery(button); break;
      case "word-art": addWordArtFromPreset("gold"); break;
      case "insert-frame": insertFrame(button.dataset.frame || "border"); break;
      case "insert-flowchart": insertFlowchart(button.dataset.flowchart || "process"); break;
      case "insert-diagram": insertDiagram(button.dataset.diagram || "timeline"); break;
      case "insert-chart": insertChart(button.dataset.chart || "bar"); break;
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
    const preset = resolveWordArtPreset(event.target.value);
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
  const SMART_DISTANCE_LIMIT = 130;
  let smartGuides = [];
  let smartDistances = [];
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

  const wordArtGradient = (colors) => () => new fabric.Gradient({
    type: "linear",
    coords: { x1: 0, y1: 0, x2: 900, y2: 0 },
    colorStops: colors.map((color, index) => ({ offset: index / (colors.length - 1), color }))
  });
  const wordArtPresets = {
    neon: { fontFamily: "Impact", fontWeight: "bold", fill: "#f4b7ff", stroke: "#9715a4", strokeWidth: 2, shadow: { color: "#e946ff", blur: 22, offsetX: 0, offsetY: 0 } },
    threeD: { fontFamily: "Impact", fontWeight: "bold", fill: "#ff7043", stroke: "#4a140c", strokeWidth: 2, shadow: { color: "#6f2115", blur: 0, offsetX: 10, offsetY: 10 } },
    retro: { fontFamily: "Georgia", fontWeight: "bold", fontStyle: "italic", fill: "#f45d48", stroke: "#542c72", strokeWidth: 2, skewX: -8, shadow: { color: "#51b8ae", blur: 0, offsetX: 6, offsetY: 6 } },
    gradient: { fontFamily: "Impact", fontWeight: "bold", fill: wordArtGradient(["#7557ff", "#fb4e91", "#ffb32c"]), stroke: null, strokeWidth: 0, shadow: { color: "rgba(50,25,90,.24)", blur: 8, offsetX: 3, offsetY: 5 } },
    outline: { fontFamily: "Impact", fontWeight: "bold", fill: "#ffffff", stroke: "#111827", strokeWidth: 5, shadow: null },
    gold: { fontFamily: "Georgia", fontWeight: "bold", fill: "#f5c842", stroke: "#8a5b00", strokeWidth: 2, shadow: { color: "rgba(90,55,0,.42)", blur: 9, offsetX: 5, offsetY: 6 } },
    comic: { fontFamily: "Impact", fontWeight: "bold", fill: "#ffe338", stroke: "#151515", strokeWidth: 4, skewX: -3, shadow: { color: "#ef3d55", blur: 0, offsetX: 7, offsetY: 7 } },
    glow: { fontFamily: "Arial", fontWeight: "bold", fill: "#ffffff", stroke: "#35c9ff", strokeWidth: 1, shadow: { color: "#18bdf1", blur: 25, offsetX: 0, offsetY: 0 } },
    ocean: { fontFamily: "Trebuchet MS", fontWeight: "bold", fill: "#53d8fb", stroke: "#075985", strokeWidth: 3, shadow: { color: "rgba(7,89,133,.38)", blur: 10, offsetX: 4, offsetY: 5 } },
    chrome: { fontFamily: "Impact", fontWeight: "bold", fill: wordArtGradient(["#ffffff", "#7c8796", "#f6f8fb", "#586270", "#ffffff"]), stroke: "#16191d", strokeWidth: 2, shadow: { color: "rgba(0,0,0,.42)", blur: 8, offsetX: 4, offsetY: 6 } }
  };

  function resolveWordArtPreset(name) {
    const preset = wordArtPresets[name];
    if (!preset) return null;
    return { ...preset, fill: typeof preset.fill === "function" ? preset.fill() : preset.fill };
  }

  function closeWordArtGallery() {
    const gallery = byId("wordArtGallery");
    const trigger = byId("wordArtGalleryButton");
    if (gallery) gallery.hidden = true;
    trigger?.setAttribute("aria-expanded", "false");
  }

  function toggleWordArtGallery(trigger = byId("wordArtGalleryButton")) {
    const gallery = byId("wordArtGallery");
    if (!gallery || !trigger) return;
    if (!gallery.hidden) { closeWordArtGallery(); return; }
    const bounds = trigger.getBoundingClientRect();
    gallery.hidden = false;
    gallery.style.top = `${Math.min(window.innerHeight - gallery.offsetHeight - 12, bounds.bottom + 8)}px`;
    gallery.style.left = `${Math.max(14, Math.min(window.innerWidth - gallery.offsetWidth - 14, bounds.left))}px`;
    trigger.setAttribute("aria-expanded", "true");
    gallery.querySelector("[data-word-art-preset]")?.focus();
  }

  function addWordArtFromPreset(name) {
    const preset = resolveWordArtPreset(name) || resolveWordArtPreset("gold");
    const object = addText("YOUR TEXT", { left: 190, top: 250, width: 900, fontSize: 78, textAlign: "center", wordArt: true, ...preset });
    object.set({ ...preset, wordArt: true, wordArtPreset: name, paintFirst: "stroke", lockScalingFlip: true });
    object.dirty = true;
    object.initDimensions?.();
    object.setCoords();
    canvas.requestRenderAll();
    syncWordArtControls(name);
    closeWordArtGallery();
    schedule();
    window.setTimeout(() => {
      canvas.setActiveObject(object);
      object.enterEditing?.();
      object.selectAll?.();
      object.hiddenTextarea?.focus();
      canvas.requestRenderAll();
    }, 0);
  }

  byId("wordArtGallery")?.querySelectorAll("[data-word-art-preset]").forEach((button) => {
    button.addEventListener("click", () => addWordArtFromPreset(button.dataset.wordArtPreset));
  });
  byId("closeWordArtGallery")?.addEventListener("click", closeWordArtGallery);
  document.addEventListener("pointerdown", (event) => {
    const gallery = byId("wordArtGallery");
    if (!gallery?.hidden && !gallery.contains(event.target) && !byId("wordArtGalleryButton")?.contains(event.target)) closeWordArtGallery();
  });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeWordArtGallery(); });

  function isTextObject(object) {
    return object && ["textbox", "text", "i-text"].includes(object.type);
  }

  function applyWordArtFormat(changes, preset = "custom") {
    const object = active();
    if (!isTextObject(object)) return toast("Select WordArt or text to format it.");
    object.set({ ...changes, wordArt: true, wordArtPreset: preset, paintFirst: "stroke" });
    object.dirty = true;
    object.initDimensions?.();
    object.setCoords();
    canvas.requestRenderAll();
    syncWordArtControls(preset);
    schedule();
  }

  function syncWordArtControls(preset = null) {
    const object = active();
    const enabled = isTextObject(object);
    const controls = ["wordArtStyle", "wordArtFill", "wordArtOutline", "wordArtOutlineWidth", "wordArtShadow"]
      .map(byId).filter(Boolean);
    controls.forEach((control) => { control.disabled = !enabled; });
    if (!enabled) return;
    byId("wordArtStyle").value = preset || object.wordArtPreset || "custom";
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

  function objectGaps(bounds, other) {
    const verticalOverlap = bounds.top < other.top + other.height && bounds.top + bounds.height > other.top;
    const horizontalOverlap = bounds.left < other.left + other.width && bounds.left + bounds.width > other.left;
    const overlapMidpoint = (startA, endA, startB, endB) => (Math.max(startA, startB) + Math.min(endA, endB)) / 2;
    const gaps = [];
    if (verticalOverlap) {
      const cross = overlapMidpoint(bounds.top, bounds.top + bounds.height, other.top, other.top + other.height);
      if (other.left + other.width <= bounds.left) gaps.push({ axis: "x", from: other.left + other.width, to: bounds.left, cross });
      if (bounds.left + bounds.width <= other.left) gaps.push({ axis: "x", from: bounds.left + bounds.width, to: other.left, cross });
    }
    if (horizontalOverlap) {
      const cross = overlapMidpoint(bounds.left, bounds.left + bounds.width, other.left, other.left + other.width);
      if (other.top + other.height <= bounds.top) gaps.push({ axis: "y", from: other.top + other.height, to: bounds.top, cross });
      if (bounds.top + bounds.height <= other.top) gaps.push({ axis: "y", from: bounds.top + bounds.height, to: other.top, cross });
    }
    return gaps.map((gap) => ({ ...gap, size: Math.round(Math.abs(gap.to - gap.from)) })).filter((gap) => gap.size > 0 && gap.size <= SMART_DISTANCE_LIMIT);
  }

  function nearestObjectDistances(bounds, objects) {
    const best = { x: null, y: null };
    objects.forEach((object) => {
      objectGaps(bounds, boundsFor(object)).forEach((gap) => {
        if (!best[gap.axis] || gap.size < best[gap.axis].size) best[gap.axis] = gap;
      });
    });
    return [best.x, best.y].filter(Boolean);
  }

  function updateSmartGuides(event, snap = true) {
    const target = event.target;
    if (!target) return;
    let bounds = boundsFor(target);
    const xCandidates = [0, W / 2, W];
    const yCandidates = [0, H / 2, H];
    const referenceObjects = canvas.getObjects().filter((object) => object !== target && object !== smartGuideCanvas);
    referenceObjects.forEach((object) => {
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
    smartDistances = nearestObjectDistances(bounds, referenceObjects);
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
    smartDistances = [];
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
    if (!smartGuides.length && !smartDistances.length && !transformMeasurement) return;
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
    context.setLineDash([]);
    smartDistances.forEach((gap) => {
      context.beginPath();
      context.strokeStyle = "rgba(13,153,255,.82)";
      context.lineWidth = 1.5;
      if (gap.axis === "x") {
        context.moveTo(gap.from, gap.cross);
        context.lineTo(gap.to, gap.cross);
      } else {
        context.moveTo(gap.cross, gap.from);
        context.lineTo(gap.cross, gap.to);
      }
      context.stroke();
      const label = `${gap.size}px`;
      context.font = "600 12px Arial";
      const width = context.measureText(label).width + 10;
      const x = gap.axis === "x" ? (gap.from + gap.to) / 2 - width / 2 : gap.cross + 8;
      const y = gap.axis === "x" ? gap.cross - 7 : (gap.from + gap.to) / 2 + 5;
      context.fillStyle = "rgba(13,153,255,.92)";
      context.fillRect(Math.max(4, Math.min(W - width - 4, x)), y - 15, width, 19);
      context.fillStyle = "#fff";
      context.fillText(label, Math.max(9, Math.min(W - width + 1, x + 5)), y - 1);
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
    const typingTarget = event.target.matches?.("input,textarea,select,[contenteditable=true]");
    const selectedObject = active();
    const canEditShapeText = !typingTarget && !selectedObject?.isEditing && (Boolean(shapeTextParts(selectedObject)) || isEditableShape(selectedObject));
    const printableKey = event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
    if (canEditShapeText && (printableKey || event.key === "Enter" || event.key === "F2")) {
      event.preventDefault();
      beginShapeTextEditing(selectedObject, printableKey ? { replaceText: event.key } : {});
      return;
    }
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
