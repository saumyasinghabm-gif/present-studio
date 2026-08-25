const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;

function slideCanvas(slide) {
  const canvas = slide?.canvas || {};
  return {
    background: canvas.background || "#f8f4ea",
    fabric: canvas.fabric || null,
    elements: canvas.elements || [],
    background_media: canvas.background_media || { type: "none", url: "", fit: "cover" }
  };
}

function waitForFabricLoad(canvas, json) {
  return new Promise((resolve) => {
    canvas.loadFromJSON(json, () => {
      canvas.getObjects().forEach((object) => {
        object.selectable = false;
        object.evented = false;
      });
      canvas.renderAll();
      resolve();
    });
  });
}

function loadFabricImage(url) {
  return new Promise((resolve, reject) => {
    window.fabric.Image.fromURL(url, (image) => {
      if (image) resolve(image);
      else reject(new Error("Image failed to load"));
    }, { crossOrigin: "anonymous" });
  });
}

function mediaScale(image, width, height, fit) {
  const scaleX = width / image.width;
  const scaleY = height / image.height;
  return fit === "contain" ? Math.min(scaleX, scaleY) : Math.max(scaleX, scaleY);
}

async function drawBackgroundMedia(canvas, media, width, height) {
  if (!media?.url || media.type === "none") return;

  try {
    const image = media.type === "video"
      ? await captureVideoFrame(media.url, width, height)
      : await loadFabricImage(media.url);
    const scale = mediaScale(image, width, height, media.fit || "cover");
    image.set({
      left: (width - image.width * scale) / 2,
      top: (height - image.height * scale) / 2,
      scaleX: scale,
      scaleY: scale,
      selectable: false,
      evented: false
    });
    canvas.add(image);
    canvas.sendToBack(image);
  } catch {
    // Keep thumbnails usable even when a remote asset cannot be read by canvas.
  }
}

function captureVideoFrame(url, width, height) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const timeout = window.setTimeout(() => reject(new Error("Video frame timed out")), 2500);
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "metadata";
    video.playsInline = true;
    video.src = url;

    video.addEventListener("loadeddata", () => {
      try {
        const frame = document.createElement("canvas");
        frame.width = width;
        frame.height = height;
        frame.getContext("2d").drawImage(video, 0, 0, width, height);
        window.clearTimeout(timeout);
        loadFabricImage(frame.toDataURL("image/png")).then(resolve).catch(reject);
      } catch (error) {
        window.clearTimeout(timeout);
        reject(error);
      }
    }, { once: true });

    video.addEventListener("error", () => {
      window.clearTimeout(timeout);
      reject(new Error("Video frame failed"));
    }, { once: true });
  });
}

function drawLegacyElements(canvas, elements, scale) {
  elements.forEach((element) => {
    if (element.type !== "text") return;
    canvas.add(new window.fabric.Textbox(element.text || "", {
      left: (element.x || 0) * 12.8 * scale,
      top: (element.y || 0) * 7.2 * scale,
      width: (element.width || 40) * 12.8 * scale,
      fontSize: (element.fontSize || 42) * scale,
      fontWeight: element.fontWeight || "500",
      fill: element.color || "#171717",
      textAlign: element.textAlign || "left",
      selectable: false,
      evented: false
    }));
  });
}

export async function renderThumbnail(slide) {
  const data = slideCanvas(slide);
  const canvas = new window.fabric.StaticCanvas(null, {
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    backgroundColor: data.background
  });

  if (data.fabric) {
    await waitForFabricLoad(canvas, data.fabric);
    canvas.backgroundColor = data.background;
  } else if (Array.isArray(data.elements)) {
    drawLegacyElements(canvas, data.elements, 1);
  }

  await drawBackgroundMedia(canvas, data.background_media, DEFAULT_WIDTH, DEFAULT_HEIGHT);
  canvas.renderAll();
  return canvas;
}

export async function renderThumbnailDataUrl(slide, width = 320, height = 180) {
  const canvas = await renderThumbnail(slide);
  try {
    return canvas.toDataURL({
      format: "png",
      multiplier: Math.min(width / DEFAULT_WIDTH, height / DEFAULT_HEIGHT)
    });
  } catch {
    return "";
  } finally {
    canvas.dispose();
  }
}
