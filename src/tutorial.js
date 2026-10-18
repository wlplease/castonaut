import './styles.css';
import './guide.css';

const toast = document.querySelector('#guide-toast');
let toastTimer;

function announce(message) {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2600);
}

document.querySelectorAll('[data-copy]').forEach((button) => {
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      button.textContent = 'COPIED ✓';
      announce('Command copied. Replace any example IP before running it.');
      setTimeout(() => { button.textContent = 'COPY ⧉'; }, 1800);
    } catch {
      announce('Clipboard access was blocked. Select and copy the command text.');
    }
  });
});

document.querySelectorAll('.guide-nav a[href^="#"]').forEach((link) => {
  link.addEventListener('click', () => {
    document.querySelectorAll('.guide-nav .nav-item').forEach((item) => item.classList.toggle('active', item === link));
  });
});
