import { renderThumbnailDataUrl } from "/js/thumbnail.js";

const api = window.PresentStudioApi;
const params = new URLSearchParams(window.location.search);
const presentationId = params.get("id") || "pres_demo";
const canvas = new fabric.Canvas("slideCanvas", {
  backgroundColor: "#f8f4ea",
  preserveObjectStacking: true
});
const socket = window.io ? window.io() : null;

let presentation = null;
let currentSlideIndex = 0;

const deckTitle = document.querySelector("#deckTitle");
const statusText = document.querySelector("#editorStatus");
const slideList = document.querySelector("#slideList");
const textValue = document.querySelector("#textValue");
const fontSize = document.querySelector("#fontSize");
const textColor = document.querySelector("#textColor");
const backgroundInput = document.querySelector("#backgroundInput");
const backgroundFit = document.querySelector("#backgroundFit");
const backgroundLoop = document.querySelector("#backgroundLoop");
const backgroundMuted = document.querySelector("#backgroundMuted");
const transitionType = document.querySelector("#transitionType");
const transitionDuration = document.querySelector("#transitionDuration");
const saveButton = document.querySelector("#saveDeck");
const saveStatePill = document.querySelector("#saveState");
const createShareLinkButton = document.querySelector("#createShareLink");
const sharePermission = document.querySelector("#sharePermission");
const shareOutput = document.querySelector("#shareOutput");
const copyShareLinkButton = document.querySelector("#copyShareLink");
let saveState = "saved";

function setStatus(message) {
  statusText.textContent = message;
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function fabricToSlideCanvas() {
  const previous = activeSlide()?.canvas || {};
  return {
    background: canvas.backgroundColor || "#f8f4ea",
    fabric: canvas.toJSON(["id", "name"]),
    background_media: previous.background_media || defaultBackgroundMedia(),
    transition: previous.transition || defaultTransition(),
    notes: previous.notes || ""
  };
}

function defaultBackgroundMedia() {
  return { type: "none", url: "", loop: true, muted: true, fit: "cover", fade_in_ms: 400 };
}

function defaultTransition() {
  return { type: "fade", duration_ms: 400 };
}

function ensureSlideCanvasSettings(slide) {
  slide.canvas = slide.canvas || {};
  slide.canvas.background_media = slide.canvas.background_media || defaultBackgroundMedia();
  slide.canvas.transition = slide.canvas.transition || defaultTransition();
}

function activeSlide() {
  return presentation.slides[currentSlideIndex];
}

function updateActiveSlideFromCanvas() {
  const slide = activeSlide();
  ensureSlideCanvasSettings(slide);
  slide.canvas = fabricToSlideCanvas();
  const titleObject = canvas.getObjects().find((item) => item.type === "textbox");
  slide.title = titleObject?.text || slide.title;
}

function loadCanvasFromSlide(slide) {
  ensureSlideCanvasSettings(slide);
  canvas.clear();
  canvas.backgroundColor = slide.canvas?.background || "#f8f4ea";
  if (slide.canvas?.fabric) {
    canvas.loadFromJSON(slide.canvas.fabric, () => canvas.renderAll());
    return;
  }
  if (Array.isArray(slide.canvas?.elements) && slide.canvas.elements.length) {
    slide.canvas.elements.forEach((element) => {
      if (element.type === "text") {
        canvas.add(new fabric.Textbox(element.text || "", {
          left: (element.x || 0) * 12.8,
          top: (element.y || 0) * 7.2,
          width: (element.width || 40) * 12.8,
          fontSize: element.fontSize || 42,
          fontWeight: element.fontWeight || "500",
          fill: element.color || "#171717",
          textAlign: element.textAlign || "left"
        }));
      }
    });
    canvas.renderAll();
    return;
  }
  const title = new fabric.Textbox(slide.title || "Untitled Slide", {
    left: 220,
    top: 220,
    width: 840,
    fontSize: 64,
    fontWeight: "600",
    fill: "#171717",
    textAlign: "center"
  });
  canvas.add(title);
  canvas.renderAll();
}

function syncSlideSettingsPanel() {
  const slide = activeSlide();
  ensureSlideCanvasSettings(slide);
  backgroundFit.value = slide.canvas.background_media.fit || "cover";
  backgroundLoop.checked = slide.canvas.background_media.loop !== false;
  backgroundMuted.checked = slide.canvas.background_media.muted !== false;
  transitionType.value = slide.canvas.transition.type || "fade";
  transitionDuration.value = slide.canvas.transition.duration_ms || 400;
}

async function renderSlides() {
  const slideThumbs = await Promise.all(presentation.slides.map(async (slide, index) => {
    const thumbnailDataUrl = await safeSlideThumbnail(slide);
    
    return `
      <button class="slide-thumb ${index === currentSlideIndex ? "active" : ""}" type="button" data-slide="${index}">
        ${thumbnailDataUrl ? `<img src="${thumbnailDataUrl}" alt="Thumbnail" class="slide-thumbnail">` : '<span class="slide-thumbnail slide-thumbnail-placeholder"></span>'}
        <span>${String(index + 1).padStart(2, "0")}</span>
        <strong>${escapeHtml(slide.title)}</strong>
      </button>
    `;
  }));

  slideList.innerHTML = slideThumbs.join("");
  slideList.querySelectorAll("[data-slide]").forEach((button) => {
    button.addEventListener("click", () => {
      updateActiveSlideFromCanvas();
      currentSlideIndex = Number(button.dataset.slide);
      loadCanvasFromSlide(activeSlide());
      syncSlideSettingsPanel();
      renderSlides();
    });
  });
}

async function safeSlideThumbnail(slide) {
  try {
    return await renderThumbnailDataUrl(slide, 160, 90);
  } catch {
    return "";
  }
}

async function loadEditor() {
  const result = await api.getPresentation(presentationId);
  presentation = result.presentation;
  deckTitle.textContent = presentation.title;
  loadCanvasFromSlide(activeSlide());
  syncSlideSettingsPanel();
  await renderSlides();
  socket?.emit("join_presentation", { presentationId: presentation.id });
  setSaveState("saved");
  setStatus("Ready");
}

function setSaveState(state) {
  saveState = state;
  updateSaveState();
}

function markUnsaved() {
  if (saveState !== "saving") setSaveState("unsaved");
}

async function saveDeck() {
  updateActiveSlideFromCanvas();
  setSaveState("saving");
  try {
    await api.savePresentation(presentation);
    setSaveState("saved");
    await renderSlides();
  } catch (error) {
    setSaveState("unsaved");
    setStatus(error.message);
  }
}

function updateSaveState() {
  saveStatePill.className = `save-pill ${saveState}`;
  switch (saveState) {
    case "unsaved":
      saveStatePill.textContent = "Unsaved changes";
      statusText.textContent = "Unsaved changes";
      saveButton.disabled = false;
      saveButton.textContent = "Save";
      break;
    case "saving":
      saveStatePill.textContent = "Saving...";
      statusText.textContent = "Saving...";
      saveButton.disabled = true;
      saveButton.textContent = "Saving...";
      break;
    case "saved":
      saveStatePill.textContent = "Saved";
      statusText.textContent = "Saved";
      saveButton.disabled = false;
      saveButton.textContent = "Save";
      break;
  }
}

function addText() {
  const text = new fabric.Textbox("New text", {
    left: 180,
    top: 160,
    width: 360,
    fontSize: 42,
    fill: "#171717"
  });
  canvas.add(text);
  canvas.setActiveObject(text);
  canvas.renderAll();
  markUnsaved();
}

function addSlide() {
  updateActiveSlideFromCanvas();
  const next = presentation.slides.length + 1;
  presentation.slides.push({
    id: `slide_${Date.now()}`,
    order: next,
    title: `Slide ${next}`,
    canvas: { background: "#f8f4ea", fabric: null }
  });
  currentSlideIndex = presentation.slides.length - 1;
  loadCanvasFromSlide(activeSlide());
  syncSlideSettingsPanel();
  renderSlides();
  markUnsaved();
}

// Add icons to toolbar buttons
const toolbarButtons = {
  addText: { icon: "<svg viewBox='0 0 24 24' aria-hidden='true'><path d='M5 4h14v3h-1.5l-.4-1H13v13h2v1H9v-1h2V6H6.9l-.4 1H5V4z'/></svg>", label: "Text" },
  addSlide: { icon: "<svg viewBox='0 0 24 24' aria-hidden='true'><path d='M4 5h16v11H4V5zm2 2v7h12V7H6zm5 11h2v2h-2v-2z'/></svg>", label: "Add" },
  deleteObject: { icon: "<svg viewBox='0 0 24 24' aria-hidden='true'><path d='M8 4h8l1 2h4v2H3V6h4l1-2zm1 6h2v8H9v-8zm4 0h2v8h-2v-8z'/></svg>", label: "Delete selection" },
  createShareLink: { icon: "<svg viewBox='0 0 24 24' aria-hidden='true'><path d='M8 12a4 4 0 0 1 4-4h3v2h-3a2 2 0 0 0 0 4h3v2h-3a4 4 0 0 1-4-4zm5-1h-2v2h2v-2zm-4-1H6a2 2 0 0 0 0 4h3v2H6a4 4 0 0 1 0-8h3v2zm6-2h3a4 4 0 0 1 0 8h-3v-2h3a2 2 0 0 0 0-4h-3V8z'/></svg>", label: "Create share link" }
};

Object.entries(toolbarButtons).forEach(([id, { icon, label }]) => {
  const button = document.querySelector(`#${id}`);
  if (button) {
    button.innerHTML = `${icon}<span>${label}</span>`;
  }
});

document.querySelector("#saveDeck").addEventListener("click", () => saveDeck().catch((error) => setStatus(error.message)));
document.querySelector("#addText").addEventListener("click", addText);
document.querySelector("#addSlide").addEventListener("click", addSlide);
document.querySelector("#deleteObject").addEventListener("click", () => {
  const selected = canvas.getActiveObject();
  if (selected) {
    canvas.remove(selected);
    updateActiveSlideFromCanvas();
    markUnsaved();
  }
});

document.querySelector("#imageInput").addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  fabric.Image.fromURL(url, (image) => {
    image.scaleToWidth(420);
    image.set({ left: 180, top: 140 });
    canvas.add(image);
    canvas.setActiveObject(image);
    updateActiveSlideFromCanvas();
    markUnsaved();
  });
});

backgroundInput.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  setStatus("Uploading background media...");
  try {
    const { asset } = await api.uploadMedia(file);
    const slide = activeSlide();
    ensureSlideCanvasSettings(slide);
    slide.canvas.background_media = {
      type: asset.mimeType.startsWith("video/") ? "video" : "image",
      url: asset.url,
      loop: backgroundLoop.checked,
      muted: backgroundMuted.checked,
      fit: backgroundFit.value,
      fade_in_ms: 400
    };
    markUnsaved();
    setStatus("Background media attached. Save the deck.");
  } catch (error) {
    setStatus(error.message);
  } finally {
    backgroundInput.value = "";
  }
});

function updateBackgroundSettings() {
  const slide = activeSlide();
  ensureSlideCanvasSettings(slide);
  slide.canvas.background_media = {
    ...slide.canvas.background_media,
    loop: backgroundLoop.checked,
    muted: backgroundMuted.checked,
    fit: backgroundFit.value
  };
  markUnsaved();
}

function updateTransitionSettings() {
  const slide = activeSlide();
  ensureSlideCanvasSettings(slide);
  slide.canvas.transition = {
    type: transitionType.value,
    duration_ms: Number(transitionDuration.value || 400)
  };
  markUnsaved();
}

backgroundFit.addEventListener("change", updateBackgroundSettings);
backgroundLoop.addEventListener("change", updateBackgroundSettings);
backgroundMuted.addEventListener("change", updateBackgroundSettings);
transitionType.addEventListener("change", updateTransitionSettings);
transitionDuration.addEventListener("input", updateTransitionSettings);

canvas.on("selection:created", syncProperties);
canvas.on("selection:updated", syncProperties);
canvas.on("object:modified", () => {
  updateActiveSlideFromCanvas();
  markUnsaved();
});
canvas.on("text:changed", () => {
  updateActiveSlideFromCanvas();
  markUnsaved();
});

function syncProperties() {
  const selected = canvas.getActiveObject();
  if (!selected || selected.type !== "textbox") return;
  textValue.value = selected.text || "";
  fontSize.value = selected.fontSize || 42;
  textColor.value = selected.fill || "#171717";
}

textValue.addEventListener("input", () => {
  const selected = canvas.getActiveObject();
  if (selected && selected.type === "textbox") {
    selected.set("text", textValue.value);
    canvas.renderAll();
    updateActiveSlideFromCanvas();
    markUnsaved();
  }
});

fontSize.addEventListener("input", () => {
  const selected = canvas.getActiveObject();
  if (selected && selected.type === "textbox") {
    selected.set("fontSize", Number(fontSize.value));
    canvas.renderAll();
    updateActiveSlideFromCanvas();
    markUnsaved();
  }
});

textColor.addEventListener("input", () => {
  const selected = canvas.getActiveObject();
  if (selected && selected.type === "textbox") {
    selected.set("fill", textColor.value);
    canvas.renderAll();
    updateActiveSlideFromCanvas();
    markUnsaved();
  }
});

createShareLinkButton.addEventListener("click", async () => {
  createShareLinkButton.disabled = true;
  createShareLinkButton.textContent = "Creating...";
  try {
    const { url } = await api.createShareLink(presentation.id, sharePermission.value);
    shareOutput.value = url;
    copyShareLinkButton.disabled = false;
    setStatus(`${sharePermission.value === "presenter" ? "Presenter" : "Viewer"} link ready`);
  } catch (error) {
    setStatus(error.message);
  } finally {
    createShareLinkButton.disabled = false;
    createShareLinkButton.innerHTML = `${toolbarButtons.createShareLink.icon}<span>Create share link</span>`;
  }
});

copyShareLinkButton.addEventListener("click", async () => {
  if (!shareOutput.value) return;
  try {
    await navigator.clipboard.writeText(shareOutput.value);
    copyShareLinkButton.textContent = "Copied";
    window.setTimeout(() => {
      copyShareLinkButton.textContent = "Copy";
    }, 1400);
  } catch {
    shareOutput.focus();
    shareOutput.select();
    copyShareLinkButton.textContent = "Press Ctrl+C";
    setStatus("Could not copy automatically. Press Ctrl+C to copy the selected link.");
    window.setTimeout(() => {
      copyShareLinkButton.textContent = "Copy";
    }, 2400);
  }
});

document.querySelector("#startLive").addEventListener("click", () => {
  updateActiveSlideFromCanvas();
  socket?.emit("slide_changed", {
    presentationId: presentation.id,
    slideId: activeSlide().id,
    authToken: window.localStorage.getItem("presentStudio.accessToken") || ""
  });
  window.open(`/present.html?id=${encodeURIComponent(presentation.id)}`, "_blank");
});

loadEditor().catch((error) => {
  document.querySelector(".canvas-workspace").innerHTML = `
    <div class="error-panel">
      <p class="eyebrow">Editor unavailable</p>
      <h2>Could not open this presentation</h2>
      <p>${escapeHtml(error.message)}</p>
      <a class="primary-button as-link" href="/dashboard.html">Go to dashboard</a>
    </div>
  `;
});
