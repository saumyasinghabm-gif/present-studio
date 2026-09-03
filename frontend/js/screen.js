(async function () {
  const api = window.PresentStudioApi;
  const params = new URLSearchParams(location.search);
  const presentationId = params.get("id") || "pres_demo";
  const shareToken = params.get("token") || "";
  const socket = window.io ? window.io({ reconnection: true }) : null;
  const mediaLayer = document.getElementById("outputMedia");
  const canvasWrap = document.getElementById("outputCanvasWrap");
  const stage = document.getElementById("outputStage");
  let presentation;
  let canvas;
  let audioUnlocked = false;
  let activeMedia = null;
  let linkedAudio = null;

  function stopMedia() {
    if (activeMedia?.pause) activeMedia.pause();
    if (linkedAudio) linkedAudio.pause();
    activeMedia = null;
    linkedAudio = null;
  }

  function transition() {
    stage.classList.remove("output-enter");
    void stage.offsetWidth;
    stage.classList.add("output-enter");
  }

  function slideById(id) { return presentation.slides.find(slide => slide.id === id); }
  function objectById(slide, id, kind) {
    const objects = slide?.canvas?.fabric?.objects || [];
    return objects.find((object, index) => object.mediaType === kind && String(object.id || index) === String(id));
  }

  function playLinkedAudio(src, loop = false) {
    if (!src || !audioUnlocked) return;
    linkedAudio = new Audio(src);
    linkedAudio.volume = 1;
    linkedAudio.loop = loop;
    linkedAudio.hidden = true;
    linkedAudio.dataset.slideMusic = "true";
    mediaLayer.append(linkedAudio);
    activeMedia = linkedAudio;
    linkedAudio.play().catch(() => {});
  }

  function renderDirectMedia(slide, mediaId, kind) {
    if (kind === "audio") {
      renderSlide(slide);
      return;
    }
    const object = objectById(slide, mediaId, kind);
    if (!object?.src) return renderSlide(slide);
    stopMedia();
    canvasWrap.hidden = true;
    mediaLayer.replaceChildren();
    const node = document.createElement(kind === "video" ? "video" : "img");
    node.src = object.src;
    node.className = "live-output-item";
    if (kind === "video") {
      Object.assign(node, { autoplay: true, playsInline: true, loop: object.loop !== false, muted: !audioUnlocked });
      activeMedia = node;
      node.play().catch(() => { node.muted = true; node.play().catch(() => {}); });
    } else {
      playLinkedAudio(object.audioSrc);
      activeMedia = linkedAudio;
    }
    mediaLayer.append(node);
    stage.dataset.slideId = slide.id;
    stage.dataset.presentationTitle = presentation.title;
    transition();
  }

  function renderSlide(slide) {
    if (!slide) return;
    stage.dataset.slideId = slide.id;
    stage.dataset.presentationTitle = presentation.title;
    stopMedia();
    mediaLayer.replaceChildren();
    canvasWrap.hidden = false;
    const data = slide.canvas || {};
    canvas.clear();
    canvas.backgroundColor = data.background || "#000";
    if (data.fabric) {
      const scene = JSON.parse(JSON.stringify(data.fabric));
      const videos = (scene.objects || []).filter(object => object.mediaType === "video");
      const firstAudio = (scene.objects || []).find(object => object.mediaType === "image" && object.audioSrc)?.audioSrc;
      scene.objects = (scene.objects || []).filter(object => object.mediaType !== "video");
      canvas.loadFromJSON(scene, () => { canvas.getObjects().forEach(object => { object.selectable = false; object.evented = false; }); canvas.renderAll(); });
      videos.forEach(object => {
        const video = document.createElement("video");
        video.src = object.src;
        video.className = "live-output-positioned-video";
        video.style.left = `${((object.left || 0) / 1280) * 100}%`;
        video.style.top = `${((object.top || 0) / 720) * 100}%`;
        video.style.width = `${(((object.width || 0) * (object.scaleX || 1)) / 1280) * 100}%`;
        video.style.height = `${(((object.height || 0) * (object.scaleY || 1)) / 720) * 100}%`;
        Object.assign(video, { autoplay: true, playsInline: true, loop: object.loop !== false, muted: !audioUnlocked });
        mediaLayer.append(video);
        activeMedia = video;
        video.play().catch(() => { video.muted = true; video.play().catch(() => {}); });
      });
      playLinkedAudio(data.audio?.src || (!videos.length ? firstAudio : ""), data.audio?.loop !== false);
    } else {
      playLinkedAudio(data.audio?.src, data.audio?.loop !== false);
    }
    transition();
  }

  function handleSelection(event) {
    const slide = slideById(event.slideId);
    if (!slide) return;
    if (["image", "video", "audio"].includes(event.kind)) renderDirectMedia(slide, event.mediaId, event.kind);
    else renderSlide(slide);
  }

  function joinRoom() { socket?.emit("join_presentation", { presentationId }); }

  function handlePresentationUpdate(event) {
    if (event.presentationId !== presentationId || !event.presentation) return;
    const previousSlideId = presentation?.slides?.find(slide => slide.id === event.activeSlideId)?.id;
    presentation = event.presentation;
    renderSlide(slideById(previousSlideId || event.activeSlideId) || presentation.slides[0]);
  }

  function control(action) {
    const media = activeMedia;
    if (action === "stop") { stopMedia(); mediaLayer.replaceChildren(); canvasWrap.hidden = true; stage.classList.remove("output-enter"); return; }
    if (!media) return;
    if (action === "toggle") media.paused ? media.play().catch(() => {}) : media.pause();
    if (action === "replay") { media.currentTime = 0; media.play().catch(() => {}); }
  }

  document.getElementById("enableScreen").addEventListener("click", async () => {
    audioUnlocked = true;
    document.getElementById("audioGate").hidden = true;
    try { await document.documentElement.requestFullscreen?.(); } catch {}
    const slide = slideById(stage.dataset.slideId);
    if (slide) renderSlide(slide);
    else if (activeMedia) { activeMedia.muted = false; activeMedia.play?.().catch(() => {}); }
  });

  try {
    const [result, live] = await Promise.all([api.getPresentation(presentationId, shareToken), api.getLiveSession(presentationId)]);
    presentation = result.presentation;
    canvas = new fabric.StaticCanvas("outputCanvas", { width: 1280, height: 720, selection: false });
    if (presentation.slides.length) renderSlide(slideById(live.activeSlideId) || presentation.slides[0]);
    socket?.on("connect", joinRoom);
    if (socket?.connected) joinRoom();
    socket?.on("presentation_media_changed", handleSelection);
    socket?.on("active_slide_changed", event => { const slide = slideById(event.slideId); if (slide) renderSlide(slide); });
    socket?.on("presentation_updated", handlePresentationUpdate);
    socket?.on("presentation_deleted", event => { if (event.presentationId === presentationId) control("stop"); });
    socket?.on("presentation_media_control", event => control(event.action));
    socket?.on("session_ended", () => control("stop"));
  } catch {
    mediaLayer.replaceChildren();
    canvasWrap.hidden = true;
  }
})();
