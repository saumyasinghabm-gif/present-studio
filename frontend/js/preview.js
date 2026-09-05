(() => {
  "use strict";

  const api = window.PresentStudioApi;
  const params = new URLSearchParams(location.search);
  const presentationId = params.get("id") || "pres_demo";
  const requestedSlide = Math.max(0, (Number.parseInt(params.get("slide") || "1", 10) || 1) - 1);
  const byId = (id) => document.getElementById(id);
  let presentation;
  let canvas;
  let currentSlideIndex = 0;
  let audioEnabled = true;
  let controlsTimer;

  function textObject(item) {
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

  function stopMedia() {
    byId("previewMedia").querySelectorAll("video,audio").forEach((media) => media.pause());
    byId("previewMedia").replaceChildren();
  }

  function addMediaNode(item) {
    const node = document.createElement(item.type === "video" ? "video" : "img");
    node.src = item.src;
    node.className = `slide-media ${item.full_bleed ? "full-bleed" : ""}`;
    node.style.left = `${item.x || 0}%`;
    node.style.top = `${item.y || 0}%`;
    node.style.width = `${item.width || 100}%`;
    node.style.height = `${item.height || 100}%`;
    node.style.objectFit = item.fit || "contain";
    if (item.type === "video") {
      Object.assign(node, {
        autoplay: true,
        muted: item.muted === true || !audioEnabled,
        loop: item.loop !== false,
        playsInline: true,
        controls: false
      });
    }
    byId("previewMedia").append(node);
    if (item.type === "video") node.play().catch(() => {
      node.muted = true;
      audioEnabled = false;
      syncAudioControl();
      node.play().catch(() => {});
    });
  }

  function mediaItems(slide) {
    const legacy = (slide.canvas?.elements || []).filter((item) => ["image", "video"].includes(item.type));
    const fabricVideos = (slide.canvas?.fabric?.objects || []).filter((item) => item.mediaType === "video").map((item) => ({
      type: "video",
      src: item.src,
      full_bleed: item.full_bleed,
      x: ((item.left || 0) / 1280) * 100,
      y: ((item.top || 0) / 720) * 100,
      width: (((item.width || 0) * (item.scaleX || 1)) / 1280) * 100,
      height: (((item.height || 0) * (item.scaleY || 1)) / 720) * 100,
      loop: item.loop,
      fit: item.fit || "contain",
      muted: item.muted
    }));
    return [...legacy, ...fabricVideos].filter((item) => item.src);
  }

  function renderMedia(slide) {
    stopMedia();
    const items = mediaItems(slide);
    items.forEach(addMediaNode);
    const track = slide.canvas?.audio;
    if (track?.src) {
      const audio = document.createElement("audio");
      audio.src = track.src;
      Object.assign(audio, { autoplay: true, muted: !audioEnabled, loop: track.loop !== false, playsInline: true });
      byId("previewMedia").append(audio);
      audio.play().catch(() => {
        audio.muted = true;
        audioEnabled = false;
        syncAudioControl();
        audio.play().catch(() => {});
      });
    }
  }

  function animateSlide(slide) {
    const frame = byId("previewFrame");
    const transition = slide.canvas?.transition || { type: "fade", duration_ms: 500 };
    frame.style.setProperty("--transition-duration", `${transition.duration_ms || 500}ms`);
    frame.classList.remove("transition-fade", "transition-fade-left", "transition-fade-right", "transition-fade-up", "transition-fade-down", "transition-slide", "transition-push-left", "transition-push-right", "transition-push-up", "transition-push-down", "transition-morph", "transition-morph-left", "transition-morph-right", "transition-morph-up", "transition-morph-down", "transition-zoom");
    if (transition.type && transition.type !== "none") {
      requestAnimationFrame(() => {
        frame.classList.add(`transition-${transition.type}`);
        window.setTimeout(() => frame.classList.remove(`transition-${transition.type}`), transition.duration_ms || 500);
      });
    }
  }

  function animateObjects() {
    canvas.getObjects().forEach((object) => {
      const type = object.animation || "none";
      if (type === "none") return;
      const duration = Math.max(100, Math.min(5000, Number(object.animationDuration) || 600));
      const delay = Math.max(0, Math.min(5000, Number(object.animationDelay) || 0));
      const finalState = {
        opacity: object.opacity ?? 1,
        left: object.left || 0,
        top: object.top || 0,
        scaleX: object.scaleX || 1,
        scaleY: object.scaleY || 1
      };
      const startState = {};
      if (type === "fade") Object.assign(startState, { opacity: 0 });
      if (type === "zoom") Object.assign(startState, { opacity: 0, scaleX: finalState.scaleX * 0.78, scaleY: finalState.scaleY * 0.78 });
      if (type === "fly") Object.assign(startState, { opacity: 0, left: finalState.left - 140 });
      if (type === "rise") Object.assign(startState, { opacity: 0, top: finalState.top + 90 });
      if (type === "wipe") Object.assign(startState, { opacity: 0, scaleX: finalState.scaleX * 0.08 });
      object.set(startState);
      window.setTimeout(() => {
        Object.entries(finalState).forEach(([key, value]) => object.animate(key, value, {
          duration,
          easing: fabric.util.ease.easeOutCubic,
          onChange: canvas.renderAll.bind(canvas),
          onComplete: () => { object.set(finalState); canvas.requestRenderAll(); }
        }));
      }, delay);
    });
  }

  function sanitizeFabricScene(scene) {
    (scene.objects || []).forEach((object) => {
      if (object.textBaseline === "alphabetical") object.textBaseline = "alphabetic";
    });
    scene.objects = (scene.objects || []).filter((object) => object.mediaType !== "video");
    return scene;
  }

  function renderSlide() {
    const slide = presentation.slides[currentSlideIndex];
    const data = slide.canvas || {};
    canvas.clear();
    canvas.backgroundColor = data.background || "#f8f4ea";
    const done = () => {
      canvas.getObjects().forEach((object) => {
        object.selectable = false;
        object.evented = false;
      });
      canvas.renderAll();
      animateObjects();
    };
    if (data.fabric) {
      canvas.loadFromJSON(sanitizeFabricScene(JSON.parse(JSON.stringify(data.fabric))), done);
    } else {
      (data.elements || []).filter((item) => item.type === "text").forEach((item) => canvas.add(textObject(item)));
      done();
    }
    renderMedia(slide);
    animateSlide(slide);
    byId("previewStatus").textContent = `${presentation.title} - Slide ${currentSlideIndex + 1} of ${presentation.slides.length}`;
  }

  function go(delta) {
    const next = Math.max(0, Math.min(presentation.slides.length - 1, currentSlideIndex + delta));
    if (next === currentSlideIndex) return;
    currentSlideIndex = next;
    renderSlide();
    syncNavigationControls();
  }

  function exitPreview() {
    stopMedia();
    if (window.parent !== window) {
      window.parent.postMessage({ type: "preview:exit" }, location.origin);
      return;
    }
    window.close();
    if (!window.closed) location.href = `/builder.html?id=${encodeURIComponent(presentationId)}`;
  }

  function toggleAudio() {
    audioEnabled = !audioEnabled;
    byId("previewMedia").querySelectorAll("video,audio").forEach((media) => {
      media.muted = !audioEnabled;
      if (audioEnabled) media.play().catch(() => {});
    });
    syncAudioControl();
  }

  function syncAudioControl() {
    const button = byId("previewAudio");
    if (!button) return;
    button.textContent = audioEnabled ? "🔊" : "🔇";
    button.setAttribute("aria-label", audioEnabled ? "Mute presentation audio" : "Enable presentation audio");
  }

  function syncNavigationControls() {
    byId("previewPrevious").disabled = currentSlideIndex === 0;
    byId("previewNext").disabled = currentSlideIndex === presentation.slides.length - 1;
  }

  function revealControls() {
    const controls = byId("previewControls");
    controls.classList.add("is-visible");
    window.clearTimeout(controlsTimer);
    controlsTimer = window.setTimeout(() => {
      if (!controls.matches(":focus-within")) controls.classList.remove("is-visible");
    }, 2400);
  }

  function showError(message) {
    byId("previewLoading").hidden = true;
    byId("previewStage").hidden = true;
    byId("previewError").hidden = false;
    byId("previewErrorMessage").textContent = message;
  }

  async function init() {
    if (!window.fabric) throw new Error("The preview canvas library could not be loaded.");
    const result = await api.getPresentation(presentationId);
    presentation = result.presentation;
    if (!presentation.slides.length) throw new Error("This presentation has no slides.");
    currentSlideIndex = Math.min(requestedSlide, presentation.slides.length - 1);
    canvas = new fabric.StaticCanvas("previewCanvas", { width: 1280, height: 720, selection: false });
    byId("previewLoading").hidden = true;
    byId("previewStage").hidden = false;
    byId("previewPrevious").addEventListener("click", () => go(-1));
    byId("previewNext").addEventListener("click", () => go(1));
    byId("previewAudio").addEventListener("click", toggleAudio);
    byId("previewExit").addEventListener("click", exitPreview);
    ["pointermove", "pointerdown", "touchstart"].forEach((name) => document.addEventListener(name, revealControls, { passive: true }));
    document.addEventListener("focusin", revealControls);
    syncAudioControl();
    syncNavigationControls();
    renderSlide();
  }

  // Install before loading so Escape also works during loading and errors.
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      exitPreview();
      return;
    }
    if (!canvas || !presentation?.slides.length) return;
    if (["ArrowLeft", "ArrowRight", " "].includes(event.key)) {
      event.preventDefault();
      go(event.key === "ArrowLeft" ? -1 : 1);
    }
    if (event.key.toLowerCase() === "m") toggleAudio();
  });

  init().catch((error) => showError(error.message));
})();
