const toast = document.querySelector('#toast');

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('visible'), 2600);
}

document.querySelector('#loginForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const email = document.querySelector('#email').value.trim();
  if (!email) return;
  showToast('Demo sign-in successful. Opening your workspace…');
  window.setTimeout(() => { window.location.href = './dashboard.html'; }, 650);
});

document.querySelectorAll('[data-toast]').forEach((element) => {
  element.addEventListener('click', (event) => {
    event.preventDefault();
    showToast(element.dataset.toast);
  });
});
