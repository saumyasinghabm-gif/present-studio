const api = window.PresentStudioApi;
const grid = document.querySelector("#presentationGrid");
const createButton = document.querySelector("#createPresentation");
const toast = document.querySelector("#toast");
const profileButton = document.querySelector("#profileButton");

let toastTimer = null;
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

function renderDecks(presentations) {
  if (!grid) return;
  if (!presentations.length) {
    grid.innerHTML = `<p class="status-text">No presentations yet. Use “New presentation” to start your first deck.</p>`;
    return;
  }

  grid.innerHTML = presentations.map((deck, index) => {
    const title = escapeHtml(deck.title || "Untitled presentation");
    const slides = Array.isArray(deck.slides) ? deck.slides.length : 0;
    const slideLabel = `${slides} slide${slides === 1 ? "" : "s"}`;
    const updated = deck.updatedAt ? new Date(deck.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "Draft";
    const accent = getAccent(deck, index);
    return `
      <article class="deck-card">
        <button class="presentation-preview" data-accent="${accent}" type="button" data-open="${escapeHtml(deck.id)}" aria-label="Open ${title}">
          <span class="preview-kicker">PRESENT STUDIO</span>
          <span class="preview-number">${String(index + 1).padStart(2, "0")}</span>
          <span class="preview-title">${title}</span>
        </button>
        <div class="deck-card-info">
          <div><h3>${title}</h3><p>${slideLabel} · ${escapeHtml(updated)}</p></div>
          <button type="button" class="card-menu" data-toast="Presentation options will connect to the backend.">•••</button>
        </div>
      </article>
    `;
  }).join("");

  grid.querySelectorAll("[data-open]").forEach((button) => {
    button.addEventListener("click", () => {
      window.location.href = `/editor.html?id=${encodeURIComponent(button.dataset.open)}`;
    });
  });
  grid.querySelectorAll("[data-toast]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      showToast(button.dataset.toast);
    });
  });
}

async function loadDashboard() {
  if (!grid) return;
  grid.innerHTML = `<p class="status-text">Loading your presentations...</p>`;
  const { presentations } = await api.listPresentations();
  renderDecks(presentations);
}

createButton?.addEventListener("click", async () => {
  createButton.disabled = true;
  try {
    const { presentation } = await api.createPresentation("Untitled presentation");
    window.location.href = `/editor.html?id=${encodeURIComponent(presentation.id)}`;
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

if (!api.getCachedSession()) {
  window.location.replace("/login.html");
} else loadDashboard().catch((error) => {
  if (/authentication required|not authenticated|invalid token/i.test(error.message || "")) {
    window.location.replace("/login.html");
    return;
  }
  if (grid) grid.innerHTML = `<p class="status-text status-text error">${escapeHtml(error.message)}</p>`;
});
