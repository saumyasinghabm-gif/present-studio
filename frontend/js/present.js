const api = window.PresentStudioApi;
const params = new URLSearchParams(window.location.search);
const presentationId = params.get("id") || "pres_demo";
const canvas = new fabric.Canvas("presentCanvas", {
  selection: false,
  backgroundColor: "#f8f4ea"
});
const socket = window.io ? window.io() : null;

let presentation = null;
let currentSlideIndex = 0;

function activeSlide() {
  return presentation.slides[currentSlideIndex];
}

function renderSlide() {
  const slide = activeSlide();
  canvas.clear();
  canvas.backgroundColor = slide.canvas?.background || "#f8f4ea";
  if (slide.canvas?.fabric) {
    canvas.loadFromJSON(slide.canvas.fabric, () => {
      canvas.getObjects().forEach((object) => {
        object.selectable = false;
        object.evented = false;
      });
      canvas.renderAll();
    });
  } else if (Array.isArray(slide.canvas?.elements)) {
    slide.canvas.elements.forEach((element) => {
      if (element.type === "text") {
        const text = new fabric.Textbox(element.text || "", {
          left: (element.x || 0) * 12.8,
          top: (element.y || 0) * 7.2,
          width: (element.width || 40) * 12.8,
          fontSize: element.fontSize || 42,
          fontWeight: element.fontWeight || "500",
          fill: element.color || "#171717",
          textAlign: element.textAlign || "left",
          selectable: false,
          evented: false
        });
        canvas.add(text);
      }
    });
    canvas.renderAll();
  }
  document.querySelector("#slideCounter").textContent = `${currentSlideIndex + 1} / ${presentation.slides.length}`;
  document.querySelector("#presentStatus").textContent = presentation.title;
}

function go(delta) {
  currentSlideIndex = (currentSlideIndex + delta + presentation.slides.length) % presentation.slides.length;
  renderSlide();
  socket?.emit("slide_changed", { presentationId: presentation.id, slideId: activeSlide().id });
}

document.querySelector("#nextSlide").addEventListener("click", () => go(1));
document.querySelector("#previousSlide").addEventListener("click", () => go(-1));

async function loadPresentation() {
  const result = await api.getPresentation(presentationId);
  presentation = result.presentation;
  socket?.emit("join_presentation", { presentationId: presentation.id });
  socket?.on("active_slide_changed", (event) => {
    const index = presentation.slides.findIndex((slide) => slide.id === event.slideId);
    if (index >= 0) {
      currentSlideIndex = index;
      renderSlide();
    }
  });
  renderSlide();
}

loadPresentation().catch((error) => {
  document.querySelector("#presentStatus").textContent = error.message;
});
