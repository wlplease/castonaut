import './endorsements.css';

const SAFE_POST_HOSTS = new Set(['farcaster.xyz', 'warpcast.com']);
const list = document.querySelector('#endorsement-list');
const counter = document.querySelector('#note-count');

function safePostUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !SAFE_POST_HOSTS.has(url.hostname.toLowerCase()) || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

function render(items) {
  const valid = Array.isArray(items) ? items.filter((item) => item && typeof item === 'object' && safePostUrl(item.url)) : [];
  counter.textContent = `${valid.length} ${valid.length === 1 ? 'NOTE' : 'NOTES'}`;
  if (!valid.length) return;
  list.replaceChildren();
  for (const item of valid) {
    const article = document.createElement('article');
    article.className = 'endorsement-card';
    const top = document.createElement('div');
    top.className = 'endorsement-card-top';
    const heading = document.createElement('h3');
    heading.textContent = typeof item.name === 'string' && item.name.trim() ? item.name.trim().slice(0, 80) : 'Community member';
    top.append(heading);
    const body = document.createElement('p');
    body.textContent = typeof item.note === 'string' ? item.note.trim().slice(0, 500) : '';
    const link = document.createElement('a');
    link.href = safePostUrl(item.url);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'READ ORIGINAL FARCASTER POST ↗';
    article.append(top);
    if (body.textContent) article.append(body);
    article.append(link);
    list.append(article);
  }
}

fetch('/endorsements.json', { headers: { accept: 'application/json' } })
  .then((response) => response.ok ? response.json() : [])
  .then(render)
  .catch(() => {});
