const slides = [
  { title: 'Welcome', subtitle: 'to Present Studio', kicker: 'PRESENT STUDIO' },
  { title: 'Our Mission', subtitle: 'Empowering ideas through thoughtful presentations.', kicker: 'OUR MISSION' },
  { title: 'Key Features', subtitle: 'A clear stage for every important idea.', kicker: 'KEY FEATURES' },
  { title: 'Thank You', subtitle: 'Let’s create something memorable.', kicker: 'THANK YOU' },
];

let currentSlide = 0;
let selectedElement = 'title';
let live = false;
const elementState = {
  title: { x: 21, y: 36, width: 54, fontSize: 54, color: '#1f1e1b', weight: '500', align: 'center' },
  subtitle: { x: 25, y: 54, width: 47, fontSize: 27, color: '#9b7535', weight: '500', align: 'center' },
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const titleElement = $('#titleElement');
const subtitleElement = $('#subtitleElement');
const canvas = $('#slideCanvas');

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('visible');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('visible'), 2600);
}

function renderSlide() {
  const slide = slides[currentSlide];
  titleElement.textContent = slide.title;
  subtitleElement.textContent = slide.subtitle;
  $('.slide-kicker').textContent = slide.kicker;
  $('#slideCount').textContent = `${String(currentSlide + 1).padStart(2, '0')} / ${String(slides.length).padStart(2, '0')}`;
  $('#canvasIndex').textContent = `${String(currentSlide + 1).padStart(2, '0')} / ${String(slides.length).padStart(2, '0')}`;
  $('#pageLabel').textContent = `Slide ${currentSlide + 1} of ${slides.length}`;
  $$('.slide-thumb').forEach((thumb, index) => thumb.classList.toggle('active', index === currentSlide));
  selectedElement = 'title';
  applyState();
  updatePanel();
}

function createThumbs() {
  const list = $('#slideList');
  list.innerHTML = slides.map((slide, index) => `<button class="slide-thumb ${index === 0 ? 'active' : ''}" type="button" data-slide-index="${index}"><span class="slide-number">${String(index + 1).padStart(2, '0')}</span><span class="thumb-title">${slide.title}</span><span class="thumb-subtitle">${slide.subtitle}</span></button>`).join('');
  $$('.slide-thumb').forEach((thumb) => thumb.addEventListener('click', () => { currentSlide = Number(thumb.dataset.slideIndex); renderSlide(); }));
}

function applyState() {
  [titleElement, subtitleElement].forEach((element) => {
    const key = element === titleElement ? 'title' : 'subtitle';
    const state = elementState[key];
    element.style.left = `${state.x}%`;
    element.style.top = `${state.y}%`;
    element.style.width = `${state.width}%`;
    element.style.fontSize = `${state.fontSize}px`;
    element.style.color = state.color;
    element.style.fontWeight = state.weight;
    element.style.textAlign = state.align;
    element.classList.toggle('selected-element', selectedElement === key);
  });
}

function updatePanel() {
  const state = elementState[selectedElement];
  $('#selectionNote').textContent = selectedElement === 'title' ? 'Title' : 'Subtitle';
  $('#fontSize').value = state.fontSize;
  $('#textColor').value = state.color;
  $('#boldButton').classList.toggle('active-format', state.weight === '700');
}

function selectElement(key) {
  selectedElement = key;
  applyState();
  updatePanel();
}

function bindEditorElement(element, key) {
  element.addEventListener('pointerdown', (event) => {
    selectElement(key);
    if (event.target === element && event.button === 0) {
      element.setPointerCapture(event.pointerId);
      const rect = canvas.getBoundingClientRect();
      const start = { x: event.clientX, y: event.clientY, left: elementState[key].x, top: elementState[key].y };
      const move = (moveEvent) => {
        elementState[key].x = Math.max(0, Math.min(88, start.left + ((moveEvent.clientX - start.x) / rect.width) * 100));
        elementState[key].y = Math.max(4, Math.min(82, start.top + ((moveEvent.clientY - start.y) / rect.height) * 100));
        applyState();
      };
      const up = () => { element.removeEventListener('pointermove', move); element.removeEventListener('pointerup', up); showToast(`${key === 'title' ? 'Title' : 'Subtitle'} position updated locally.`); };
      element.addEventListener('pointermove', move);
      element.addEventListener('pointerup', up, { once: true });
    }
  });
  element.addEventListener('input', () => { slides[currentSlide][key] = element.textContent.trim(); createThumbs(); updatePanel(); });
  element.addEventListener('dblclick', () => { element.contentEditable = 'true'; element.focus(); document.execCommand('selectAll', false, null); });
}

function bindResizeHandle(element, key) {
  element.addEventListener('pointerdown', (event) => {
    if (selectedElement !== key || event.target !== element) return;
    const rect = canvas.getBoundingClientRect();
    const start = { x: event.clientX, width: elementState[key].width };
    const resize = (moveEvent) => {
      elementState[key].width = Math.max(12, Math.min(82, start.width + ((moveEvent.clientX - start.x) / rect.width) * 100));
      applyState();
    };
    const stop = () => { element.removeEventListener('pointermove', resize); element.removeEventListener('pointerup', stop); };
    element.addEventListener('pointermove', resize);
    element.addEventListener('pointerup', stop, { once: true });
  });
}

$('#addSlide').addEventListener('click', () => { slides.push({ title: `New Slide ${slides.length + 1}`, subtitle: 'Add your story here.', kicker: 'NEW SLIDE' }); currentSlide = slides.length - 1; createThumbs(); renderSlide(); showToast('New slide added to the local demo.'); });
$$('[data-slide-next]').forEach((button) => button.addEventListener('click', () => { currentSlide = (currentSlide + 1) % slides.length; renderSlide(); }));
$$('[data-slide-prev]').forEach((button) => button.addEventListener('click', () => { currentSlide = (currentSlide - 1 + slides.length) % slides.length; renderSlide(); }));
$$('[data-toast]').forEach((button) => button.addEventListener('click', () => showToast(button.dataset.toast)));
$$('[data-presenter]').forEach((button) => button.addEventListener('click', () => { $$('.presenter-option').forEach((item) => item.classList.remove('active')); button.classList.add('active'); $('#aiPanel').hidden = button.dataset.presenter !== 'AI'; showToast(`${button.dataset.presenter} presenter selected.`); }));

$('#fontSize').addEventListener('input', (event) => { elementState[selectedElement].fontSize = Number(event.target.value); applyState(); });
$('#textColor').addEventListener('input', (event) => { elementState[selectedElement].color = event.target.value; applyState(); });
$('#boldButton').addEventListener('click', () => { elementState[selectedElement].weight = elementState[selectedElement].weight === '700' ? '500' : '700'; applyState(); updatePanel(); });
$$('[data-align]').forEach((button) => button.addEventListener('click', () => { elementState[selectedElement].align = button.dataset.align; applyState(); }));
$('#closeEditor').addEventListener('click', () => { selectElement('title'); showToast('Title selected.'); });

$$('[data-media-input]').forEach((input) => input.addEventListener('change', () => { const file = input.files[0]; if (!file) return; $('#uploadStatus').textContent = `${file.name} selected locally. Backend upload can be connected here.`; showToast(`${file.type.startsWith('video') ? 'Video' : 'Image'} selected.`); }));
$('#generateAi').addEventListener('click', () => { const prompt = $('#aiPrompt').value.trim(); if (!prompt) { $('#aiStatus').textContent = 'Add a short prompt first.'; return; } $('#aiStatus').textContent = 'Generating a local draft…'; window.setTimeout(() => { slides[currentSlide].title = 'A clearer story'; slides[currentSlide].subtitle = 'Generated from your prompt'; renderSlide(); $('#aiStatus').textContent = 'Draft added to the current slide.'; showToast('AI draft created in the local demo.'); }, 700); });
$('#generateLink').addEventListener('click', () => { $('#shareStatus').textContent = `${window.location.href.replace(/index\.html$/, '')}present.html?demo=welcome`; showToast('Demo share link generated.'); });
$('#copyLink').addEventListener('click', async () => { const link = $('#shareStatus').textContent; if (!link) { $('#shareStatus').textContent = `${window.location.href.replace(/index\.html$/, '')}present.html?demo=welcome`; } try { await navigator.clipboard.writeText($('#shareStatus').textContent); showToast('Share link copied.'); } catch { showToast('Link is ready to copy from the share card.'); } });
$('#startLive').addEventListener('click', () => { live = !live; $('#startLive').innerHTML = live ? '◉ <span>Live Mode On</span>' : '◉ <span>Start Live</span>'; $('#modeLabel').textContent = live ? 'Live session' : 'Local demo'; showToast(live ? 'Live mode started in the frontend demo.' : 'Live mode stopped.'); });
$('[data-fullscreen]').addEventListener('click', () => canvas.requestFullscreen?.());

bindEditorElement(titleElement, 'title');
bindEditorElement(subtitleElement, 'subtitle');
bindResizeHandle(titleElement, 'title');
bindResizeHandle(subtitleElement, 'subtitle');
createThumbs();
renderSlide();
