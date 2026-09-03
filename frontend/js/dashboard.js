const api = window.PresentStudioApi;
const grid = document.querySelector("#presentationGrid");
const createButton = document.querySelector("#createPresentation");
const toast = document.querySelector("#toast");
const profileButton = document.querySelector("#profileButton");
const builderButtons = [document.querySelector("#builderNav"), document.querySelector("#openBuilder")].filter(Boolean);
const searchInput = document.querySelector("#presentationSearch");

let toastTimer = null;
let dashboardPresentations = [];
function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2600);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>\"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;"
  })[character]);
}

function getAccent(deck, index) {
  const explicit = String(deck.accent || "").toLowerCase();
  if (["warm", "cream", "dark", "soft"].includes(explicit)) return explicit;
  return ["warm", "cream", "dark", "soft"][index % 4];
}

function updateDashboardStats(presentations) {
  document.querySelector("#presentationCount").textContent = String(presentations.length).padStart(2, "0");
  document.querySelector("#recentCount").textContent = String(presentations.filter(deck => deck.updatedAt && Date.now() - new Date(deck.updatedAt).getTime() < 30 * 86400000).length).padStart(2, "0");
  document.querySelector("#slideTotal").textContent = String(presentations.reduce((total, deck) => total + (deck.slides?.length || 0), 0)).padStart(2, "0");
}

function filteredPresentations() {
  const query = searchInput?.value.trim().toLowerCase() || "";
  return dashboardPresentations.filter(deck => String(deck.title || "").toLowerCase().includes(query));
}

function renderDecks(presentations) {
  if (!grid) return;
  if (!presentations.length) {
    grid.innerHTML = `<p class="dashboard-status">No presentations yet. Use “New Presentation” to start your first deck.</p>`;
    return;
  }

  grid.innerHTML = presentations.map((deck, index) => {
    const title = escapeHtml(deck.title || "Untitled presentation");
    const slides = Array.isArray(deck.slides) ? deck.slides.length : 0;
    const slideLabel = `${slides} slide${slides === 1 ? "" : "s"}`;
    const updated = deck.updatedAt ? new Date(deck.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "Draft";
    const accent = getAccent(deck, index);
    return `
      <article class="presentation-card">
        <button class="presentation-preview" data-accent="${accent}" type="button" data-open="${escapeHtml(deck.id)}" aria-label="Open ${title}">
          <span class="preview-kicker">PRESENT STUDIO</span>
          <span class="preview-number">${String(index + 1).padStart(2, "0")}</span>
          <span class="preview-title">${title}</span>
        </button>
        <div class="presentation-card-footer">
          <button type="button" class="card-delete" data-delete="${escapeHtml(deck.id)}" aria-label="Delete ${title}" title="Delete presentation"><i class="bi bi-trash"></i></button>
          <div><h3>${title}</h3><p>${slideLabel} · ${escapeHtml(updated)}</p></div>
          <button type="button" class="card-menu" data-toast="Presentation options will connect to the backend.">•••</button>
        </div>
      </article>
    `;
  }).join("");

  grid.querySelectorAll("[data-open]").forEach((button) => {
    button.addEventListener("click", () => {
      window.location.href = `/builder.html?id=${encodeURIComponent(button.dataset.open)}`;
    });
  });
  grid.querySelectorAll("[data-toast]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      showToast(button.dataset.toast);
    });
  });
  grid.querySelectorAll("[data-delete]").forEach(button => button.addEventListener("click", async event => {
    event.stopPropagation();
    const deck = dashboardPresentations.find(item => item.id === button.dataset.delete);
    if (!deck || !window.confirm(`Delete “${deck.title || "Untitled presentation"}”? This cannot be undone.`)) return;
    button.disabled = true;
    try {
      await api.deletePresentation(deck.id);
      dashboardPresentations = dashboardPresentations.filter(item => item.id !== deck.id);
      updateDashboardStats(dashboardPresentations);
      renderDecks(filteredPresentations());
      showToast("Presentation deleted.");
    } catch (error) {
      button.disabled = false;
      showToast(error.message);
    }
  }));
}

async function loadDashboard() {
  if (!grid) return;
  grid.innerHTML = `<p class="dashboard-status">Loading your presentations…</p>`;
  const { presentations } = await api.listPresentations();
  dashboardPresentations = presentations;
  updateDashboardStats(presentations);
  renderDecks(presentations);
}

async function openBuilder() {
  const existing = dashboardPresentations[0];
  if (existing) {
    window.location.href = `/builder.html?id=${encodeURIComponent(existing.id)}`;
    return;
  }
  builderButtons.forEach(button => { button.disabled = true; });
  try {
    const { presentation } = await api.createPresentation("Untitled presentation");
    window.location.href = `/builder.html?id=${encodeURIComponent(presentation.id)}`;
  } catch (error) {
    builderButtons.forEach(button => { button.disabled = false; });
    showToast(error.message);
  }
}

builderButtons.forEach(button => button.addEventListener("click", openBuilder));

createButton?.addEventListener("click", async () => {
  createButton.disabled = true;
  try {
    const { presentation } = await api.createPresentation("Untitled presentation");
    window.location.href = `/builder.html?id=${encodeURIComponent(presentation.id)}`;
  } catch (error) {
    createButton.disabled = false;
    showToast(error.message);
  }
});

profileButton?.addEventListener("click", async () => {
  const confirmed = window.confirm("Sign out of Present Studio?");
  if (!confirmed) return;
  try { await api.logout(); } catch (error) { /* Continue to login even if logout request fails. */ }
  window.location.href = "/login.html";
});

document.querySelectorAll("[data-toast]").forEach((element) => {
  element.addEventListener("click", () => showToast(element.dataset.toast));
});

searchInput?.addEventListener("input", () => {
  renderDecks(filteredPresentations());
});

document.querySelectorAll("[data-view]").forEach(button => button.addEventListener("click", () => {
  document.querySelectorAll("[data-view]").forEach(item => item.classList.toggle("is-active", item === button));
  grid.classList.toggle("is-list", button.dataset.view === "list");
}));

const session = api.getCachedSession();
if (session) {
  const firstName = String(session.name || "Presenter").trim().split(/\s+/)[0];
  const hour = new Date().getHours();
  document.querySelector("#dashboardGreeting").textContent = `${hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"}, ${firstName}.`;
  document.querySelector("#profileInitials").textContent = String(session.name || "PS").split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase();
}
document.querySelector("#dashboardDate").textContent = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date()).toUpperCase();

if (!api.getCachedSession()) {
  window.location.replace("/login.html");
} else loadDashboard().catch((error) => {
  if (/authentication required|not authenticated|invalid token/i.test(error.message || "")) {
    window.location.replace("/login.html");
    return;
  }
  if (grid) grid.innerHTML = `<p class="dashboard-status error">${escapeHtml(error.message)}</p>`;
});
