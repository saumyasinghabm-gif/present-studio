import { renderThumbnailDataUrl } from "/js/thumbnail.js";

const api = window.PresentStudioApi;
const grid = document.querySelector("#deckGrid");
const newPresentationButton = document.querySelector("#newPresentation");

async function renderDecks(presentations) {
  const deckCards = await Promise.all(presentations.map(async (deck) => {
    const firstSlide = deck.slides[0];
    const thumbnailDataUrl = await safeDeckThumbnail(firstSlide);
    
    return `
      <article class="deck-card">
        <button type="button" data-open="${escapeHtml(deck.id)}">
          ${thumbnailDataUrl ? `<img src="${thumbnailDataUrl}" alt="Thumbnail" class="deck-thumbnail">` : '<div class="deck-thumbnail-placeholder"></div>'}
          <strong>${escapeHtml(deck.title)}</strong>
          <span>${deck.slides.length} slide${deck.slides.length === 1 ? "" : "s"}</span>
          <small>${deck.updatedAt ? formatRelativeTime(deck.updatedAt) : "Draft"}</small>
        </button>
      </article>
    `;
  }));

  grid.innerHTML = deckCards.join("");

  grid.querySelectorAll("[data-open]").forEach((button) => {
    button.addEventListener("click", () => {
      window.location.href = `/editor.html?id=${encodeURIComponent(button.dataset.open)}`;
    });
  });
}

async function safeDeckThumbnail(slide) {
  if (!slide) return "";
  try {
    return await renderThumbnailDataUrl(slide, 420, 236);
  } catch {
    return "";
  }
}

function formatRelativeTime(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffInSeconds = Math.floor((now - date) / 1000);
  
  if (diffInSeconds < 60) {
    return "Just now";
  } else if (diffInSeconds < 3600) {
    const minutes = Math.floor(diffInSeconds / 60);
    return `${minutes} minute${minutes !== 1 ? "s" : ""} ago`;
  } else if (diffInSeconds < 86400) {
    const hours = Math.floor(diffInSeconds / 3600);
    return `${hours} hour${hours !== 1 ? "s" : ""} ago`;
  } else {
    const days = Math.floor(diffInSeconds / 86400);
    return `${days} day${days !== 1 ? "s" : ""} ago`;
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

async function createPresentation() {
  newPresentationButton.disabled = true;
  newPresentationButton.textContent = "Creating...";
  try {
    const { presentation } = await api.createPresentation("Untitled presentation");
    window.location.href = `/editor.html?id=${encodeURIComponent(presentation.id)}`;
  } catch (error) {
    renderError(error.message, "Retry");
    newPresentationButton.disabled = false;
    newPresentationButton.textContent = "New presentation";
  }
}

function renderError(message, actionLabel = "Reload") {
  grid.innerHTML = `
    <div class="error-panel">
      <p class="eyebrow">Something needs attention</p>
      <h2>Could not load presentations</h2>
      <p>${escapeHtml(message)}</p>
      <button id="dashboardRetry" class="primary-button" type="button">${actionLabel}</button>
    </div>
  `;
  document.querySelector("#dashboardRetry").addEventListener("click", () => window.location.reload());
}

async function loadDashboard() {
  grid.innerHTML = `
    <div class="loading-skeleton">
    <div class="skeleton-card"></div>
    <div class="skeleton-card"></div>
    <div class="skeleton-card"></div>
    <div class="skeleton-card"></div>
    </div>
  `;

  try {
    const { presentations } = await api.listPresentations();
    if (presentations.length === 0) {
      grid.innerHTML = `
        <div class="empty-state">
          <h2>No presentations yet</h2>
          <p>Create your first presentation to get started.</p>
          <button id="emptyNewPresentation" class="primary-button" type="button">New presentation</button>
        </div>
      `;
      document.querySelector("#emptyNewPresentation").addEventListener("click", createPresentation);
    } else {
      await renderDecks(presentations);
    }
  } catch (error) {
    renderError(error.message);
  }
}

newPresentationButton.addEventListener("click", createPresentation);
loadDashboard();
