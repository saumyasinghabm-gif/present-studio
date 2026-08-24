const presentations = [
  { title: 'Welcome to Present Studio', meta: '4 slides · Edited today', accent: 'warm', initials: '01' },
  { title: 'Our Q3 Story', meta: '8 slides · Edited yesterday', accent: 'cream', initials: '02' },
  { title: 'Brand Direction 2026', meta: '12 slides · Edited Aug 20', accent: 'dark', initials: '03' },
  { title: 'Team Offsite', meta: '6 slides · Edited Aug 18', accent: 'soft', initials: '04' },
];

const grid = document.querySelector('#presentationGrid');
const toast = document.querySelector('#toast');

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('visible'), 2600);
}

function renderCards() {
  grid.innerHTML = presentations.map((presentation, index) => `
    <article class="presentation-card">
      <button class="presentation-preview ${presentation.accent}" type="button" data-open="${index}" aria-label="Open ${presentation.title}">
        <span class="preview-kicker">PRESENT STUDIO</span>
        <span class="preview-number">${presentation.initials}</span>
        <span class="preview-title">${presentation.title}</span>
        <span class="preview-wave"></span>
      </button>
      <div class="presentation-card-info"><div><h3>${presentation.title}</h3><p>${presentation.meta}</p></div><button type="button" class="card-menu" data-toast="Presentation options will connect to the backend.">•••</button></div>
    </article>
  `).join('');
  grid.querySelectorAll('[data-open]').forEach((card) => card.addEventListener('click', () => { window.location.href = './index.html'; }));
  grid.querySelectorAll('[data-toast]').forEach((button) => button.addEventListener('click', () => showToast(button.dataset.toast)));
}

document.querySelector('#createPresentation').addEventListener('click', () => {
  presentations.unshift({ title: 'Untitled presentation', meta: '1 slide · Just created', accent: 'warm', initials: String(presentations.length + 1).padStart(2, '0') });
  renderCards();
  showToast('New presentation created in the local demo.');
});

document.querySelector('#profileButton').addEventListener('click', () => showToast('Account menu will connect to the backend.'));
document.querySelectorAll('[data-toast]').forEach((button) => button.addEventListener('click', () => showToast(button.dataset.toast)));
renderCards();
