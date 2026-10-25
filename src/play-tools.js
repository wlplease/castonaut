import { NeonRush } from './neon-rush.js';
import { isFarcasterMiniAppLink } from './mini-app-links.js';
import './play-tools.css';

const $ = (selector) => document.querySelector(selector);
const BEST_KEY = 'castonaut.neon-rush.best.v1';
let game = null;
let best = 0;
let lastScore = 0;
let miniAppFilter = '';
let miniApps = [];
try { best = Number(localStorage.getItem(BEST_KEY)) || 0; } catch { /* Scores can stay temporary when storage is unavailable. */ }

function paintBest() {
  const label = $('#neon-rush-best');
  if (label) label.textContent = `Personal best · ${best.toLocaleString()}`;
  const share = $('#neon-rush-share');
  if (share) share.disabled = lastScore <= 0;
}

function paintHud(snapshot) {
  $('#neon-rush-score').textContent = snapshot.score.toLocaleString().padStart(6, '0');
  $('#neon-rush-combo').textContent = `×${snapshot.combo}`;
  $('#neon-rush-lives').textContent = '♥ '.repeat(snapshot.lives).trim() || '—';
  $('#neon-rush-time').textContent = String(Math.ceil(snapshot.seconds));
  $('#neon-rush-pause').textContent = snapshot.paused ? 'Resume' : 'Pause';
  const dash = $('#neon-rush-dash');
  if (dash) {
    const ready = snapshot.dashMeter >= 100;
    dash.disabled = !ready;
    dash.textContent = ready ? 'Dash ready' : `Dash ${Math.floor(snapshot.dashMeter)}%`;
  }
}

function openGame() {
  const dialog = $('#neon-rush-dialog');
  dialog.showModal();
  game = new NeonRush($('#neon-rush-canvas'), (score) => {
    lastScore = score;
    const isNewBest = score > best;
    if (isNewBest) {
      best = score;
      try { localStorage.setItem(BEST_KEY, String(best)); } catch { /* Keep this run playable when storage is unavailable. */ }
    }
    $('#neon-rush-result').hidden = false;
    $('#neon-rush-result').textContent = score > 0 ? `Run complete · ${score.toLocaleString()} points${isNewBest ? ' · new personal best' : ''}` : 'Run complete';
    $('#neon-rush-start').textContent = 'Play again';
    $('.neon-rush-start-card').hidden = false;
    paintBest();
  }, paintHud);
  game.sound = false;
  $('#neon-rush-sound').textContent = 'Sound off';
  $('#neon-rush-result').hidden = true;
  $('.neon-rush-start-card').hidden = false;
  $('#neon-rush-start').textContent = 'Start game';
  paintHud(game);
  paintBest();
}

function closeGame() {
  game?.destroy();
  game = null;
}

function renderMiniApps(messages) {
  const shelf = $('#mini-app-shelf');
  if (!shelf) return;
  const apps = new Map();
  for (const message of messages ?? []) {
    const body = message?.data?.castAddBody;
    if (!body) continue;
    const urls = [
      ...(Array.isArray(body.embeds) ? body.embeds.map((embed) => embed?.url) : []),
      ...[...String(body.text || '').matchAll(/https?:\/\/[^\s<>"'`]+/gi)].map((match) => match[0].replace(/[),.!?:;\]}]+$/g, '')),
    ];
    for (const value of urls) {
      try {
        const url = new URL(value);
        if (!isFarcasterMiniAppLink(url) || apps.has(url.href)) continue;
        const parts = url.pathname.split('/').filter(Boolean);
        const slug = (parts[2] || 'Mini App').replace(/[-_]+/g, ' ');
        apps.set(url.href, { url, title: slug.replace(/\b\w/g, (letter) => letter.toUpperCase()) });
      } catch { /* Ignore malformed embed URLs. */ }
    }
  }
  if (messages !== undefined) miniApps = [...apps.values()];
  const query = miniAppFilter.trim().toLowerCase();
  const entries = miniApps.filter((app) => !query || `${app.title} ${app.url.hostname} ${app.url.href}`.toLowerCase().includes(query)).slice(0, 24);
  $('#mini-apps-count').textContent = query ? `${entries.length} of ${miniApps.length}` : `${miniApps.length} found`;
  shelf.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement('p');
    empty.className = 'workshop-empty';
    empty.textContent = miniApps.length ? 'No apps match that search.' : 'Mini Apps appear here when they are linked in posts from your loaded feed.';
    shelf.append(empty);
    return;
  }
  for (const app of entries) {
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'mini-app-card';
    link.dataset.miniAppUrl = app.url.href;
    link.setAttribute('aria-label', `Open ${app.title} inside Castonaut`);
    const mark = document.createElement('span'); mark.className = 'mini-app-mark'; mark.setAttribute('aria-hidden', 'true'); mark.textContent = '✳';
    const copy = document.createElement('span'); copy.className = 'mini-app-copy';
    const title = document.createElement('strong'); title.textContent = app.title;
    const detail = document.createElement('small'); detail.textContent = `${app.url.hostname} · Open in Castonaut`;
    copy.append(title, detail); link.append(mark, copy); shelf.append(link);
  }
}

export function refreshMiniAppShelf(messages) { renderMiniApps(messages); }

export function initPlayTools({ onShareScore }) {
  paintBest();
  $('#neon-rush-open')?.addEventListener('click', openGame);
  $('#profile-neon-rush-open')?.addEventListener('click', openGame);
  $('#neon-rush-close')?.addEventListener('click', () => $('#neon-rush-dialog').close());
  $('#neon-rush-dialog')?.addEventListener('close', closeGame);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game?.running && !game.paused) game.togglePause();
  });
  $('#neon-rush-dialog')?.addEventListener('click', (event) => {
    if (event.target === $('#neon-rush-dialog')) $('#neon-rush-dialog').close();
  });
  $('#neon-rush-start')?.addEventListener('click', () => {
    $('#neon-rush-result').hidden = true;
    $('.neon-rush-start-card').hidden = true;
    game?.start();
  });
  $('#neon-rush-pause')?.addEventListener('click', () => game?.togglePause());
  $('#neon-rush-sound')?.addEventListener('click', (event) => {
    if (!game) return;
    game.sound = !game.sound;
    event.currentTarget.textContent = `Sound ${game.sound ? 'on' : 'off'}`;
  });
  $('#neon-rush-dash')?.addEventListener('click', () => game?.dash());
  $('#neon-rush-share')?.addEventListener('click', () => onShareScore?.(lastScore));
  $('#mini-app-search')?.addEventListener('input', (event) => {
    miniAppFilter = event.currentTarget.value;
    renderMiniApps();
  });
  document.querySelectorAll('[data-desk-tool]').forEach((button) => button.addEventListener('click', () => {
    const tool = button.dataset.deskTool;
    document.querySelector('[data-view="desk"]')?.click();
    requestAnimationFrame(() => {
      if (tool === 'capsules') {
          const drawer = document.querySelector('.time-capsule');
          if (drawer) { drawer.open = true; drawer.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      } else {
        const accessories = document.querySelector('.desk-accessories');
        const details = tool === 'orbit' ? $('#desk-atlas') : $('#desk-notepad-drawer');
        if (accessories) accessories.open = true;
        if (details) { details.open = true; details.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      }
    });
  }));

  // A quiet nod to early desktop keyboard discoveries. It only reveals a small note.
  const sequence = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'];
  let entered = [];
  window.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || /input|textarea|select/i.test(event.target?.tagName || '')) return;
    const key = event.key.toLowerCase();
    entered.push(key); entered = entered.slice(-sequence.length);
    if (sequence.some((item, index) => entered[index] !== item)) return;
    const secret = $('#workshop-secret');
    if (secret) secret.hidden = false;
  });
  renderMiniApps();
}
