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
  let audioEnabled = false;

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
    node.style.objectFit = item.fit || "cover";
    if (item.type === "video") {
      Object.assign(node, {
        autoplay: true,
        muted: !audioEnabled,
        loop: item.loop !== false,
        playsInline: true,
        controls: !item.full_bleed
      });
    }
    byId("previewMedia").append(node);
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
      fit: item.fit || "cover"
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
      audio.play().catch(() => {});
    }
    const hasAudio = items.some((item) => item.type === "video") || Boolean(track?.src);
    byId("previewAudioToggle").hidden = !hasAudio;
  }

  function animateSlide(slide) {
    const frame = byId("previewFrame");
    const transition = slide.canvas?.transition || { type: "fade", duration_ms: 500 };
    frame.style.setProperty("--transition-duration", `${transition.duration_ms || 500}ms`);
    frame.classList.remove("transition-fade", "transition-slide", "transition-zoom");
    if (transition.type && transition.type !== "none") {
      requestAnimationFrame(() => {
        frame.classList.add(`transition-${transition.type}`);
        window.setTimeout(() => frame.classList.remove(`transition-${transition.type}`), transition.duration_ms || 500);
      });
    }
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
    };
    if (data.fabric) {
      canvas.loadFromJSON(sanitizeFabricScene(JSON.parse(JSON.stringify(data.fabric))), done);
    } else {
      (data.elements || []).filter((item) => item.type === "text").forEach((item) => canvas.add(textObject(item)));
      done();
    }
    renderMedia(slide);
    animateSlide(slide);
    byId("previewStatus").textContent = `${presentation.title} - Preview`;
    byId("previewCounter").textContent = `${currentSlideIndex + 1} / ${presentation.slides.length}`;
    byId("previewPrevious").disabled = currentSlideIndex === 0;
    byId("previewNext").disabled = currentSlideIndex === presentation.slides.length - 1;
  }

  function go(delta) {
    const next = Math.max(0, Math.min(presentation.slides.length - 1, currentSlideIndex + delta));
    if (next === currentSlideIndex) return;
    currentSlideIndex = next;
    renderSlide();
  }

  function exitPreview() {
    window.close();
    if (!window.closed) location.href = `/builder.html?id=${encodeURIComponent(presentationId)}`;
  }

  function toggleAudio() {
    audioEnabled = !audioEnabled;
    const button = byId("previewAudioToggle");
    button.textContent = audioEnabled ? "Mute audio" : "Enable audio";
    button.setAttribute("aria-label", audioEnabled ? "Mute preview audio" : "Enable preview audio");
    byId("previewMedia").querySelectorAll("video,audio").forEach((media) => {
      media.muted = !audioEnabled;
      if (audioEnabled) media.play().catch(() => {});
    });
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
    byId("previewPrevious").addEventListener("click", () => go(-1));
    byId("previewNext").addEventListener("click", () => go(1));
    byId("previewAudioToggle").addEventListener("click", toggleAudio);
    byId("previewFullscreen").addEventListener("click", () => document.fullscreenElement ? document.exitFullscreen() : byId("previewStage").requestFullscreen());
    ["closePreview", "exitPreview", "closePreviewError"].forEach((id) => byId(id).addEventListener("click", exitPreview));
    document.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft") go(-1);
      if (event.key === "ArrowRight" || event.key === " ") {
        event.preventDefault();
        go(1);
      }
      if (event.key.toLowerCase() === "f") byId("previewFullscreen").click();
      if (event.key === "Escape" && !document.fullscreenElement) exitPreview();
    });
    byId("previewLoading").hidden = true;
    byId("previewStage").hidden = false;
    renderSlide();
  }

  init().catch((error) => showError(error.message));
})();
