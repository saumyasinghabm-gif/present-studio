const api = window.PresentStudioApi;
const grid = document.querySelector("#deckGrid");

function renderDecks(presentations) {
  grid.innerHTML = presentations.map((deck) => `
    <article class="deck-card">
      <button type="button" data-open="${deck.id}">
        <span>${deck.slides.length} slides</span>
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
  const { presentations } = await api.listPresentations();
  renderDecks(presentations);
}

document.querySelector("#newPresentation").addEventListener("click", async () => {
  const { presentation } = await api.createPresentation("Untitled presentation");
  window.location.href = `/editor.html?id=${encodeURIComponent(presentation.id)}`;
});

loadDashboard().catch((error) => {
  grid.innerHTML = `<p class="status-text">${error.message}</p>`;
});
