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

function setStatus(message) {
  statusText.textContent = message;
}

function fabricToSlideCanvas() {
  return {
    background: canvas.backgroundColor || "#f8f4ea",
    fabric: canvas.toJSON(["id", "name"])
  };
}

function activeSlide() {
  return presentation.slides[currentSlideIndex];
}

function updateActiveSlideFromCanvas() {
  const slide = activeSlide();
  slide.canvas = fabricToSlideCanvas();
  const titleObject = canvas.getObjects().find((item) => item.type === "textbox");
  slide.title = titleObject?.text || slide.title;
}

function loadCanvasFromSlide(slide) {
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

function renderSlides() {
  slideList.innerHTML = presentation.slides.map((slide, index) => `
    <button class="slide-thumb ${index === currentSlideIndex ? "active" : ""}" type="button" data-slide="${index}">
      <span>${String(index + 1).padStart(2, "0")}</span>
      <strong>${slide.title}</strong>
    </button>
  `).join("");
  slideList.querySelectorAll("[data-slide]").forEach((button) => {
    button.addEventListener("click", () => {
      updateActiveSlideFromCanvas();
      currentSlideIndex = Number(button.dataset.slide);
      loadCanvasFromSlide(activeSlide());
      renderSlides();
    });
  });
}

async function loadEditor() {
  const result = await api.getPresentation(presentationId);
  presentation = result.presentation;
  deckTitle.textContent = presentation.title;
  loadCanvasFromSlide(activeSlide());
  renderSlides();
  socket?.emit("join_presentation", { presentationId: presentation.id });
  setStatus("Ready");
}

async function saveDeck() {
  updateActiveSlideFromCanvas();
  await api.savePresentation(presentation);
  renderSlides();
  setStatus("Saved");
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
  renderSlides();
}

document.querySelector("#saveDeck").addEventListener("click", () => saveDeck().catch((error) => setStatus(error.message)));
document.querySelector("#addText").addEventListener("click", addText);
document.querySelector("#addSlide").addEventListener("click", addSlide);
document.querySelector("#deleteObject").addEventListener("click", () => {
  const selected = canvas.getActiveObject();
  if (selected) canvas.remove(selected);
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
  });
});

canvas.on("selection:created", syncProperties);
canvas.on("selection:updated", syncProperties);
canvas.on("object:modified", updateActiveSlideFromCanvas);
canvas.on("text:changed", updateActiveSlideFromCanvas);

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
  }
});

fontSize.addEventListener("input", () => {
  const selected = canvas.getActiveObject();
  if (selected && selected.type === "textbox") {
    selected.set("fontSize", Number(fontSize.value));
    canvas.renderAll();
  }
});

textColor.addEventListener("input", () => {
  const selected = canvas.getActiveObject();
  if (selected && selected.type === "textbox") {
    selected.set("fill", textColor.value);
    canvas.renderAll();
  }
});

document.querySelector("#shareDeck").addEventListener("click", async () => {
  const { url } = await api.createShareLink(presentation.id);
  document.querySelector("#shareOutput").textContent = url;
});

document.querySelector("#startLive").addEventListener("click", () => {
  updateActiveSlideFromCanvas();
  socket?.emit("slide_changed", { presentationId: presentation.id, slideId: activeSlide().id });
  window.open(`/present.html?id=${encodeURIComponent(presentation.id)}`, "_blank");
});

loadEditor().catch((error) => setStatus(error.message));
