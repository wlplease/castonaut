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
      const label = button.textContent;
      button.textContent = 'COPIED ✓';
      announce('Copied. Paste it into your terminal and review before running.');
      setTimeout(() => { button.textContent = label; }, 1800);
    } catch {
      announce('Clipboard blocked. Select the command text and copy it.');
    }
  });
});

document.querySelectorAll('.guide-nav a[href^="#"]').forEach((link) => {
  link.addEventListener('click', () => {
    document.querySelectorAll('.guide-nav .nav-item').forEach((item) => item.classList.toggle('active', item === link));
  });
});
