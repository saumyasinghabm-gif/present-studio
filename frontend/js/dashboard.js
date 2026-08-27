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

// Buttons that don't have real backend wiring yet just announce themselves.
document.querySelectorAll("[data-toast]").forEach((element) => {
  element.addEventListener("click", () => showToast(element.dataset.toast));
});

function renderDecks(presentations) {
  if (!presentations.length) {
    grid.innerHTML = `<p class="status-text">No presentations yet. Use "New presentation" to start your first deck.</p>`;
    return;
  }

  grid.innerHTML = presentations.map((deck) => `
    <article class="deck-card">
      <button type="button" data-open="${deck.id}">
        <span>${deck.slides.length} slide${deck.slides.length === 1 ? "" : "s"}</span>
        <strong>${deck.title}</strong>
        <small>${deck.updatedAt ? new Date(deck.updatedAt).toLocaleString() : "Draft"}</small>
      </button>
    </article>
  `).join("");

  grid.querySelectorAll("[data-open]").forEach((button) => {
    button.addEventListener("click", () => {
      window.location.href = `/editor.html?id=${encodeURIComponent(button.dataset.open)}`;
    });
  });
}

async function loadDashboard() {
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
  try {
    await api.logout();
  } catch (error) {
    // Even if the server call fails, still send the user back to login.
  }
  window.location.href = "/login.html";
});

loadDashboard().catch((error) => {
  grid.innerHTML = `<p class="status-text status-text error">${error.message}</p>`;
});
