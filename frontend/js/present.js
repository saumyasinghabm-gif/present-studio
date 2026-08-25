import { renderThumbnail } from "/js/thumbnail.js";

const api = window.PresentStudioApi;
const params = new URLSearchParams(window.location.search);
const presentationId = params.get("id") || "pres_demo";
const shareToken = params.get("token") || "";
const authToken = window.localStorage.getItem("presentStudio.accessToken") || "";
const socket = window.io ? window.io({ reconnection: true, reconnectionAttempts: 5, reconnectionDelay: 700 }) : null;

let presentation = null;
let permission = "viewer";
let currentSlideIndex = 0;
let canvas = null;
let startedAt = null;
let timerId = null;

const root = document.querySelector("#presentRoot");

function canPresent() {
  return permission === "presenter";
}

function activeSlide() {
  return presentation.slides[currentSlideIndex];
}

function slideCanvas(slide) {
  slide.canvas = slide.canvas || {};
  slide.canvas.background_media = slide.canvas.background_media || { type: "none", url: "", loop: true, muted: true, fit: "cover", fade_in_ms: 400 };
  slide.canvas.transition = slide.canvas.transition || { type: "fade", duration_ms: 400 };
  return slide.canvas;
}

function buildShell() {
  root.className = canPresent() ? "present-stage presenter-mode" : "present-stage audience-mode";
  root.innerHTML = canPresent() ? presenterMarkup() : audienceMarkup();
  canvas = new fabric.Canvas("presentCanvas", { selection: false, backgroundColor: "transparent" });
  canvas.setWidth(1280);
  canvas.setHeight(720);

  if (canPresent()) {
    document.querySelector("#nextSlide").addEventListener("click", () => go(1));
    document.querySelector("#previousSlide").addEventListener("click", () => go(-1));
    document.querySelector("#endSession").addEventListener("click", endSession);
    renderSlideList();
    startedAt = Date.now();
    timerId = window.setInterval(renderTimer, 1000);
    document.addEventListener("keydown", handlePresenterKeys);
  }
}

function presenterMarkup() {
  return `
    <aside class="presenter-sidebar">
      <a class="stage-link" href="/dashboard.html">Dashboard</a>
      <h1>${escapeHtml(presentation.title)}</h1>
      <div id="presenterSlideList" class="presenter-slide-list"></div>
    </aside>
    <section class="presenter-main">
      <div class="presenter-topbar">
        <span id="presentStatus">Presenter Console</span>
        <span id="elapsedTimer">00:00</span>
        <button id="endSession" type="button">End Session</button>
      </div>
      <div id="connectionStatus" class="stage-status status-connected">Connected</div>
      <div class="stage-shell">
        <div id="backgroundLayer" class="background-layer"></div>
        <canvas id="presentCanvas" width="1280" height="720"></canvas>
      </div>
      <nav class="present-controls">
        <button id="previousSlide" type="button">Previous</button>
        <span id="slideCounter">1 / 1</span>
        <button id="nextSlide" type="button">Next</button>
      </nav>
      <section class="speaker-notes">
        <strong>Speaker Notes</strong>
        <p id="speakerNotes">No notes for this slide.</p>
      </section>
    </section>
    <aside class="next-preview">
      <h2>Next</h2>
      <canvas id="nextCanvas" width="320" height="180"></canvas>
    </aside>
  `;
}

function audienceMarkup() {
  return `
    <section class="audience-stage">
      <div id="connectionStatus" class="stage-status status-reconnecting">Connecting...</div>
      <div id="presentStatus" class="audience-title">${escapeHtml(presentation.title)}</div>
      <div class="stage-shell audience-shell">
        <div id="backgroundLayer" class="background-layer"></div>
        <canvas id="presentCanvas" width="1280" height="720"></canvas>
      </div>
    </section>
  `;
}

function renderBackground(slide) {
  const layer = document.querySelector("#backgroundLayer");
  const media = slideCanvas(slide).background_media;
  layer.innerHTML = "";
  if (!media || media.type === "none" || !media.url) return;
  const element = document.createElement(media.type === "video" ? "video" : "img");
  element.className = "stage-media";
  element.src = media.url;
  element.style.objectFit = media.fit || "cover";
  if (media.type === "video") {
    element.autoplay = true;
    element.loop = media.loop !== false;
    element.muted = media.muted !== false;
    element.playsInline = true;
  }
  layer.appendChild(element);
}

function renderFabricObjects(slide) {
  const data = slideCanvas(slide);
  canvas.clear();
  canvas.backgroundColor = "transparent";
  if (data.fabric) {
    canvas.loadFromJSON(data.fabric, () => {
      canvas.getObjects().forEach((object) => {
        object.selectable = false;
        object.evented = false;
      });
      canvas.renderAll();
    });
    return;
  }
  if (Array.isArray(data.elements)) {
    data.elements.forEach((element) => {
      if (element.type === "text") {
        canvas.add(new fabric.Textbox(element.text || "", {
          left: (element.x || 0) * 12.8,
          top: (element.y || 0) * 7.2,
          width: (element.width || 40) * 12.8,
          fontSize: element.fontSize || 42,
          fontWeight: element.fontWeight || "500",
          fill: element.color || "#171717",
          textAlign: element.textAlign || "left",
          selectable: false,
          evented: false
        }));
      }
    });
  }
  canvas.renderAll();
}

function animateTransition(slide) {
  const shell = document.querySelector(".stage-shell");
  const transition = slideCanvas(slide).transition;
  shell.style.setProperty("--transition-ms", `${transition.duration_ms || 400}ms`);
  shell.classList.remove("transition-fade", "transition-slide", "transition-zoom");
  if (transition.type && transition.type !== "none") {
    requestAnimationFrame(() => {
      shell.classList.add(`transition-${transition.type}`);
      window.setTimeout(() => shell.classList.remove(`transition-${transition.type}`), transition.duration_ms || 400);
    });
  }
}

async function renderSlide() {
  const slide = activeSlide();
  renderBackground(slide);
  renderFabricObjects(slide);
  animateTransition(slide);
  const counter = document.querySelector("#slideCounter");
  if (counter) counter.textContent = `${currentSlideIndex + 1} / ${presentation.slides.length}`;
  const stageTitle = document.querySelector("#presentStatus");
  if (stageTitle) stageTitle.textContent = canPresent() ? "Presenter Console" : presentation.title;
  const notes = document.querySelector("#speakerNotes");
  if (notes) notes.textContent = slideCanvas(slide).notes || "No notes for this slide.";
  if (canPresent()) {
    renderSlideList();
    await renderNextPreview();
  }
}

function renderSlideList() {
  const list = document.querySelector("#presenterSlideList");
  if (!list) return;
  list.innerHTML = presentation.slides.map((slide, index) => `
    <button class="presenter-thumb ${index === currentSlideIndex ? "active" : ""}" type="button" data-slide="${index}">
      <span>${String(index + 1).padStart(2, "0")}</span>
      <strong>${escapeHtml(slide.title)}</strong>
    </button>
  `).join("");
  list.querySelectorAll("[data-slide]").forEach((button) => {
    button.addEventListener("click", () => {
      currentSlideIndex = Number(button.dataset.slide);
      publishSlideChange();
      renderSlide();
    });
  });
}

async function renderNextPreview() {
  const preview = document.querySelector("#nextCanvas");
  if (!preview) return;
  const nextSlide = presentation.slides[(currentSlideIndex + 1) % presentation.slides.length];
  
  const thumbnailCanvas = await renderThumbnail(nextSlide, preview.width, preview.height);
  const ctx = preview.getContext("2d");
  ctx.drawImage(thumbnailCanvas.getElement(), 0, 0, preview.width, preview.height);
  thumbnailCanvas.dispose();
}

function publishSlideChange() {
  socket?.emit("slide_changed", {
    presentationId: presentation.id,
    slideId: activeSlide().id,
    authToken,
    shareToken
  });
}

async function go(delta) {
  if (!canPresent()) return;
  currentSlideIndex = (currentSlideIndex + delta + presentation.slides.length) % presentation.slides.length;
  publishSlideChange();
  await renderSlide();
}

async function handlePresenterKeys(event) {
  if (!canPresent()) return;
  if (event.key === "ArrowRight") await go(1);
  if (event.key === "ArrowLeft") await go(-1);
}

function renderTimer() {
  if (!startedAt) return;
  const elapsed = Math.floor((Date.now() - startedAt) / 1000);
  const minutes = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const seconds = String(elapsed % 60).padStart(2, "0");
  const timer = document.querySelector("#elapsedTimer");
  if (timer) timer.textContent = `${minutes}:${seconds}`;
}

async function endSession() {
  socket?.emit("end_session", { presentationId: presentation.id, authToken, shareToken });
  try {
    await api.endLiveSession(presentation.id);
  } catch {
    // Socket event still handles local clients when the HTTP call is unavailable.
  }
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

async function loadPresentation() {
  const result = await api.getPresentation(presentationId, shareToken);
  presentation = result.presentation;
  permission = result.permission || "viewer";
  buildShell();
  socket?.emit("join_presentation", { presentationId: presentation.id });
  let connectionState = "connected";
  
  socket?.on("connect", () => {
    connectionState = "connected";
    updateConnectionStatus();
    socket?.emit("join_presentation", { presentationId: presentation.id });
  });
  
  socket?.on("disconnect", () => {
    connectionState = "reconnecting";
    updateConnectionStatus();
  });
  
  socket?.io.on("reconnect_failed", () => {
    connectionState = "failed";
    updateConnectionStatus();
  });
  
  function updateConnectionStatus() {
    const statusElement = document.querySelector("#connectionStatus");
    if (!statusElement) return;
    
    let statusText = "";
    let statusClass = "";
    
    switch (connectionState) {
      case "connected":
        statusText = "Connected";
        statusClass = "status-connected";
        break;
      case "reconnecting":
        statusText = "Reconnecting...";
        statusClass = "status-reconnecting";
        break;
      case "failed":
        statusText = "Connection lost — refresh to rejoin";
        statusClass = "status-failed";
        break;
    }
    
    statusElement.textContent = statusText;
    statusElement.className = `stage-status ${statusClass}`;
  }
  socket?.on("presenter_rejected", (event) => {
    const status = document.querySelector("#presentStatus") || document.querySelector("#connectionStatus");
    if (status) status.textContent = event.message || "Presenter permission rejected";
  });
  socket?.on("session_ended", () => {
    root.innerHTML = `<section class="ended-screen"><h1>Presentation ended</h1><p>Thanks for watching.</p></section>`;
    if (timerId) window.clearInterval(timerId);
  });
  socket?.on("active_slide_changed", async (event) => {
    const index = presentation.slides.findIndex((slide) => slide.id === event.slideId);
    if (index >= 0) {
      currentSlideIndex = index;
      await renderSlide();
    }
  });
  await renderSlide();
}

loadPresentation().catch((error) => {
  root.innerHTML = `<div class="stage-status">${escapeHtml(error.message)}</div>`;
});
