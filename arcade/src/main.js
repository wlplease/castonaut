import './style.css';
import { NeonRush } from './game.js';
import { claimQuarter, cloudReady, connectArcade, getLocalBest, getName, playerId, reportChat, saveScore, sendChat, setName, watchChat, watchQuarterBalance, watchScores } from './store.js';
import { baseContractReady, getBaseQuarterPrice, payQuarter, paymentsReady, signQuarterClaim } from './payments.js';
import { createAmbience, mountRoom, renderRoomChat, renderRoomScores } from './room.js';
import './room.css';

const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const format = value => Number(value || 0).toLocaleString();
const randomName = () => `PLAYER ${Math.floor(1000 + Math.random() * 9000)}`;
let nickname = getName() || randomName();
if (!getName()) setName(nickname);
let arcadeStatus = cloudReady ? 'connecting' : 'local';
let scores = [];
let chat = [];
let game;
let currentView = 'floor';
let selectedCurrency = 'USDC';
let baseQuarterPrice = null;
let quarterBusy = false;
let stopBalance = () => {};
let toastTimer;

const app = $('#app');
app.innerHTML = `
  <div class="ambient ambient-one"></div><div class="ambient ambient-two"></div>
  <header class="topbar">
    <a class="brand" href="#floor" aria-label="Afterhours Arcade home"><span class="brand-symbol">✳</span><span>AFTERHOURS<span class="brand-dot">.</span><small>ARCADE CLUB</small></span></a>
    <nav class="nav" aria-label="Main navigation"><button class="nav-link active" data-view="floor">Arcade floor</button><button class="nav-link" data-view="scores">High scores</button><button class="nav-link" data-view="lobby">The lobby</button></nav>
    <div class="top-actions"><span class="online-pill"><i></i><span id="network-label">LOCAL MODE</span></span><button class="profile-button" id="profile-button" title="Change player name"><span class="avatar">P</span><span id="header-name"></span></button></div>
  </header>
  <main>
    <section class="hero" id="hero"><div class="hero-copy"><span class="eyebrow"><span class="eyebrow-line"></span> THE ARCADE IS OPEN</span><h1>One more game<span class="accent">.</span><br><em>One more night.</em></h1><p>Old school energy, new friends, original games. Chase a high score, hang out in the lobby, and stay a little longer.</p><div class="hero-actions"><button class="button primary" id="hero-play">Play Neon Rush <span>↗</span></button><button class="button ghost" id="hero-scores">View high scores <span>→</span></button></div><div class="hero-note"><span class="tiny-star">✦</span> FREE PLAY IS ON · QUARTERS OPTIONAL</div></div><div class="hero-illustration" aria-hidden="true"><div class="sun"></div><div class="mountains"></div><div class="hero-grid"></div><div class="hero-ship">✦</div><div class="hero-coin one">★</div><div class="hero-coin two">★</div><div class="hero-pixel p1"></div><div class="hero-pixel p2"></div><div class="hero-pixel p3"></div><span class="hero-art-label">INSERT COIN / PRESS START</span></div></section>
    <div class="ticker"><span>★ &nbsp; NEW GAME: NEON RUSH</span><span>✳ &nbsp; ONE MORE GAME, TOGETHER</span><span>◈ &nbsp; THE CABINET NEVER CLOSES</span><span>★ &nbsp; NEW GAME: NEON RUSH</span></div>
    <section class="view active" id="view-floor">
      <div class="section-title"><div><span class="eyebrow">THE FLOOR</span><h2>Pick your cabinet<span class="accent">.</span></h2></div><span class="section-aside">01 ORIGINAL GAME · MORE IN THE WORKSHOP</span></div>
      <div class="floor-grid"><article class="cabinet featured"><div class="cabinet-screen"><div class="screen-grid"></div><span class="cabinet-topline">AFTERHOURS ORIGINAL #001</span><div class="cabinet-preview"><span class="preview-coin">★</span><span class="preview-ship">▲</span><span class="preview-spark a">✦</span><span class="preview-spark b">✦</span></div><span class="screen-bottom">HIGH SCORE <b id="cabinet-high">000000</b></span></div><div class="cabinet-body"><div><span class="tag">SCORE ATTACK</span><h3>NEON RUSH</h3><p>Catch the light. Dodge the dark. You have 75 seconds to make the leaderboard.</p><div class="cabinet-meta"><span>◷ 75 SEC</span><span>⌨ KEYBOARD + TOUCH</span><span>★ 1 PLAYER</span></div></div><button class="button primary cabinet-play" id="cabinet-play">PLAY NOW <span>↗</span></button></div></article>
      <article class="next-cabinet"><div class="next-top"><span class="tag muted">IN THE WORKSHOP</span><span class="dotted">✳</span></div><div class="next-art"><span>?</span></div><h3>CABINET 002</h3><p>The next game is being dreamed up. Your scores and feedback help shape what lands on the floor.</p><button class="text-link" id="next-lobby">Talk in the lobby →</button></article></div>
      <div class="floor-bottom"><div class="floor-stat"><span>01</span><small>ORIGINAL CABINET</small></div><div class="floor-stat"><span>75s</span><small>TO MAKE YOUR MARK</small></div><div class="floor-stat"><span id="floor-best">0</span><small>YOUR PERSONAL BEST</small></div><div class="floor-quote">“The best arcade was never just about the games. It was about who was there.”</div></div>
    </section>
    <section class="view" id="view-scores"><div class="section-title"><div><span class="eyebrow">THE WALL OF FAME</span><h2>High scores<span class="accent">.</span></h2></div><span class="section-aside">NEON RUSH · ALL TIME</span></div><div class="scores-layout"><div class="leaderboard"><div class="leaderboard-header"><span>RANK</span><span>PLAYER</span><span>SCORE</span></div><div id="score-rows"></div></div><aside class="score-side"><div class="score-side-icon">★</div><span class="eyebrow">YOUR RECORD</span><strong id="personal-best">0</strong><p>Make a run, find your name on the wall, then try to beat it.</p><button class="button primary" id="scores-play">PLAY NEON RUSH <span>↗</span></button><small id="score-note"></small></aside></div></section>
    <section class="view" id="view-lobby"><div class="section-title"><div><span class="eyebrow">ARCADE FRIENDS</span><h2>The lobby<span class="accent">.</span></h2></div><span class="section-aside">PULL UP A STOOL · SAY HELLO</span></div><div class="lobby-layout"><div class="chat-card"><div class="chat-head"><span class="chat-indicator"></span><strong>LOBBY CHAT</strong><small id="chat-status">CONNECTING</small></div><div class="chat-list" id="chat-list"></div><form class="chat-compose" id="chat-form"><input id="chat-input" type="text" maxlength="160" placeholder="Say something nice…" autocomplete="off" aria-label="Lobby message"/><button type="submit" aria-label="Send message">↗</button></form></div><aside class="lobby-side"><span class="eyebrow">HOUSE RULES</span><h3>Good games.<br>Good company.</h3><p>Be kind. Cheer other players on. Keep it fun for everyone. Messages are public and visible to anyone in the arcade.</p><div class="rule-line"></div><span class="eyebrow">YOUR PLAYER TAG</span><div class="name-card"><span class="avatar large">P</span><strong id="lobby-name"></strong><button id="edit-name" aria-label="Edit player name">✎</button></div><small>You can change your name anytime.</small></aside></div></section>
    <section class="quarter-section"><div><span class="eyebrow">KEEP THE LIGHTS ON</span><h2>Drop a quarter<span class="accent">.</span></h2><p>Playing is free. If you love the arcade, a quarter helps us make the next cabinet. Base quarters are recorded by the arcade contract. Ethereum support payments go to our treasury.</p></div><div class="quarter-controls"><div class="currency-toggle" role="group" aria-label="Payment currency"><button class="selected" data-currency="USDC">USDC<br>BASE</button><button data-currency="BASE_ETH">ETH<br>BASE</button><button data-currency="ETH_MAINNET">ETH<br>ETHEREUM</button></div><button class="button quarter-button" id="quarter-button">DROP A QUARTER <span>↗</span></button><small id="quarter-detail">0.25 USDC on Base · network fees apply</small></div></section>
  </main>
  <footer><span>✳ AFTERHOURS ARCADE</span><span>BUILT FOR ONE MORE GAME.</span><span>© ${new Date().getFullYear()}</span></footer>
  <div class="modal-backdrop" id="game-modal" hidden><div class="game-dialog" role="dialog" aria-modal="true" aria-label="Neon Rush game"><div class="game-top"><div><span class="eyebrow">CABINET 001 / SCORE ATTACK</span><h2>NEON RUSH</h2></div><button class="icon-button" id="close-game" aria-label="Close game">×</button></div><div class="game-hud"><span>SCORE <b id="hud-score">000000</b></span><span>COMBO <b id="hud-combo">×0</b></span><span>LIVES <b id="hud-lives">♥ ♥ ♥</b></span><span>TIME <b id="hud-time">75</b></span></div><div class="game-screen"><canvas id="game-canvas" width="720" height="900" aria-label="Neon Rush game"></canvas><div class="game-overlay" id="game-overlay"><span class="overlay-kicker">AFTERHOURS PRESENTS</span><h3 id="overlay-title">NEON RUSH</h3><p id="overlay-copy">Move with ← → or A / D. On touch screens, drag your finger. Collect stars, dodge the red hazards, grab shields.</p><button class="button primary" id="game-start">START GAME <span>↗</span></button><button class="share-button" id="share-score" hidden>SHARE YOUR SCORE ↗</button><small id="overlay-foot">75 SECONDS · 3 LIVES · ONE MORE TRY</small></div></div><div class="game-bottom"><span>← → / A D / TOUCH TO MOVE</span><button id="sound-toggle" aria-label="Toggle sound">♪ SOUND ON</button></div></div></div>
  <div class="modal-backdrop" id="name-modal" hidden><div class="name-dialog" role="dialog" aria-modal="true" aria-label="Choose player name"><button class="icon-button name-close" id="close-name" aria-label="Close">×</button><span class="eyebrow">YOUR ARCADE NAME</span><h2>What should we call you?</h2><p>This name appears beside your scores and chat messages.</p><form id="name-form"><input id="name-input" maxlength="18" minlength="2" required autocomplete="nickname" aria-label="Player name"/><button class="button primary" type="submit">SAVE NAME <span>↗</span></button></form></div></div>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>
`;
mountRoom();
for (const id of ['view-scores', 'view-lobby']) {
  const returnButton = document.createElement('button');
  returnButton.className = 'return-floor';
  returnButton.textContent = '← BACK TO THE ARCADE FLOOR';
  document.querySelector(`#${id}`).prepend(returnButton);
}

const controlDeck = document.createElement('div');
controlDeck.className = 'control-deck';
controlDeck.innerHTML = `<div class="deck-meta"><span class="deck-led"></span> PLAYER 1 <small>AFTERHOURS ORIGINAL</small></div><div class="deck-buttons"><button class="arcade-control" data-move="arrowleft" aria-label="Move left">◀</button><button class="arcade-control" data-move="arrowright" aria-label="Move right">▶</button><button class="arcade-control dash-control" id="dash-control" aria-label="Use dash">⚡</button></div><div class="coin-slot"><span>25¢</span><i></i><small>FREE PLAY</small></div>`;
$('.game-bottom').before(controlDeck);
const dashStatus = document.createElement('div');
dashStatus.className = 'dash-status';
dashStatus.innerHTML = `<span id="wave-label">WAVE 1</span><div class="dash-track"><i id="dash-fill"></i></div><strong id="dash-label">DASH 0%</strong>`;
$('.game-screen').before(dashStatus);
const pauseButton = document.createElement('button');
pauseButton.id = 'pause-game';
pauseButton.textContent = 'Ⅱ PAUSE';
$('.game-bottom').append(pauseButton);
$('#overlay-copy').textContent = 'Move with ← → or A / D, or drag on the screen. Catch stars and gems, dodge hazards. Fill DASH, then press SPACE or the red button. P pauses.';
const balanceBadge = document.createElement('div');
balanceBadge.className = 'balance-badge';
balanceBadge.innerHTML = `<span id="quarter-balance">QUARTERS COLLECTED · —</span><button id="retry-claim" hidden>CLAIM PENDING PURCHASE ↗</button>`;
$('#quarter-detail').after(balanceBadge);

const pendingKey = 'afterhours-pending-claims-v1';
const getPending = () => { try { return JSON.parse(localStorage.getItem(pendingKey) || '[]'); } catch { return []; } };
const savePending = claims => { localStorage.setItem(pendingKey, JSON.stringify(claims.slice(-20))); $('#retry-claim').hidden = claims.length === 0; };
savePending(getPending());

function showToast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4200);
}

function updateName() {
  $('#header-name').textContent = nickname;
  $('#lobby-name').textContent = nickname;
  document.querySelectorAll('.avatar').forEach(item => item.textContent = nickname.charAt(0).toUpperCase());
}

function setView(view) {
  currentView = view;
  document.querySelectorAll('.view').forEach(item => item.classList.toggle('active', item.id === `view-${view}`));
  document.querySelectorAll('[data-view]').forEach(item => item.classList.toggle('active', item.dataset.view === view));
  $('#hero').classList.toggle('compact', view !== 'floor');
  location.hash = view;
  document.querySelector('main').scrollIntoView({ behavior: 'smooth' });
}

function updateBest() {
  const best = getLocalBest();
  $('#floor-best').textContent = format(best);
  $('#personal-best').textContent = format(best);
  renderRoomScores(scores, best);
}

function renderScores() {
  const target = $('#score-rows');
  if (!scores.length) {
    target.innerHTML = `<div class="empty-state"><span>★</span><h3>The wall is waiting.</h3><p>${cloudReady ? 'Be the first to set a score.' : 'Connect Firebase to share scores. Your personal best still saves on this device.'}</p></div>`;
  } else {
    target.innerHTML = scores.map((row, i) => `<div class="score-row ${row.uid === playerId() ? 'mine' : ''}"><span class="rank ${i < 3 ? 'medal' : ''}">${String(i + 1).padStart(2, '0')}</span><span class="player-name"><span class="mini-avatar">${escape((row.name || 'P').charAt(0).toUpperCase())}</span>${escape(row.name || 'PLAYER')}</span><strong>${format(row.score)}</strong></div>`).join('');
  }
  $('#score-note').textContent = arcadeStatus === 'online' ? 'Scores sync to the arcade wall.' : 'Local play is available; shared scores need Firebase.';
  updateBest();
}

function renderChat() {
  const target = $('#chat-list');
  if (!chat.length) {
    target.innerHTML = `<div class="chat-empty"><span>✳</span><h3>It’s quiet in here.</h3><p>${arcadeStatus === 'online' ? 'Break the ice and say hello.' : 'Connect Firebase to open the live lobby.'}</p></div>`;
  } else {
    target.innerHTML = chat.map(item => `<div class="chat-message"><span class="mini-avatar">${escape((item.name || 'P').charAt(0).toUpperCase())}</span><div><div class="message-top"><strong>${escape(item.name || 'PLAYER')}</strong><small>${item.createdAt?.toDate ? item.createdAt.toDate().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'now'}</small><button class="report-button" data-report="${escape(item.id)}" aria-label="Report message from ${escape(item.name || 'PLAYER')}">REPORT</button></div><p>${escape(item.body)}</p></div></div>`).join('');
    target.scrollTop = target.scrollHeight;
  }
  $('#chat-status').textContent = arcadeStatus === 'online' ? 'LIVE' : arcadeStatus.toUpperCase();
  $('#chat-input').disabled = arcadeStatus !== 'online';
  renderRoomChat(chat, arcadeStatus);
}

function openGame() {
  playCoinClink();
  $('#game-modal').hidden = false;
  document.body.classList.add('modal-open');
  $('#game-overlay').hidden = false;
  $('#overlay-title').textContent = 'NEON RUSH';
  $('#overlay-copy').textContent = 'Move with ← → or A / D, or drag on the screen. Catch stars and gems, dodge hazards. Fill DASH, then press SPACE or the red button. P pauses.';
  $('#game-start').innerHTML = 'START GAME <span>↗</span>';
  $('#overlay-foot').textContent = '75 SECONDS · 3 LIVES · ONE MORE TRY';
  $('#share-score').hidden = true;
  game ||= new NeonRush($('#game-canvas'), onGameEnd, state => {
    $('#hud-score').textContent = String(state.score).padStart(6, '0');
    $('#hud-combo').textContent = `×${state.combo}`;
    $('#hud-lives').textContent = '♥ '.repeat(state.lives).trim() || '—';
    $('#hud-time').textContent = Math.ceil(state.seconds);
    $('#wave-label').textContent = `WAVE ${state.wave}`;
    $('#dash-fill').style.width = `${state.dashMeter}%`;
    $('#dash-label').textContent = state.dashMeter >= 100 ? 'DASH READY' : `DASH ${Math.floor(state.dashMeter)}%`;
    $('#dash-control').classList.toggle('ready', state.dashMeter >= 100);
    $('#pause-game').textContent = state.paused ? '▶ RESUME' : 'Ⅱ PAUSE';
  });
}

function playCoinClink() {
  try {
    const context = new (window.AudioContext || window.webkitAudioContext)();
    for (const [frequency, delay] of [[1100, 0], [690, .075]]) {
      const oscillator = context.createOscillator();
      const volume = context.createGain();
      oscillator.type = 'triangle';
      oscillator.frequency.value = frequency;
      volume.gain.setValueAtTime(.0001, context.currentTime + delay);
      volume.gain.exponentialRampToValueAtTime(.035, context.currentTime + delay + .005);
      volume.gain.exponentialRampToValueAtTime(.0001, context.currentTime + delay + .11);
      oscillator.connect(volume).connect(context.destination);
      oscillator.start(context.currentTime + delay);
      oscillator.stop(context.currentTime + delay + .12);
    }
    setTimeout(() => context.close(), 450);
  } catch { /* The arcade remains playable when audio is unavailable. */ }
}

function closeGame() {
  game?.stop();
  $('#game-modal').hidden = true;
  document.body.classList.remove('modal-open');
}

async function onGameEnd(score) {
  $('#game-overlay').hidden = false;
  $('#overlay-title').textContent = score >= 3000 ? 'LEGENDARY RUN' : 'GAME OVER';
  $('#overlay-copy').innerHTML = `YOU SCORED <strong>${format(score)}</strong>. ${score > getLocalBest() ? 'NEW PERSONAL BEST!' : 'THE CABINET IS WAITING FOR ANOTHER TRY.'}`;
  $('#game-start').innerHTML = 'PLAY AGAIN <span>↗</span>';
  $('#overlay-foot').textContent = 'ONE MORE GAME?';
  $('#share-score').hidden = false;
  if (score > getLocalBest()) {
    const result = await saveScore(score, nickname);
    if (!result.saved) showToast(`Personal best saved here. ${result.reason}.`);
  }
  updateBest();
}

document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
document.querySelectorAll('.return-floor').forEach(button => button.addEventListener('click', () => setView('floor')));
$('#hero-play').onclick = openGame;
$('#cabinet-play').onclick = openGame;
$('#scores-play').onclick = openGame;
$('#hero-scores').onclick = () => setView('scores');
$('#hero-lobby').onclick = () => setView('lobby');
$('#room-scores').onclick = () => setView('scores');
$('#next-lobby').onclick = () => setView('lobby');
$('#room-next-lobby').onclick = () => setView('lobby');
createAmbience($('#ambience-toggle'));
$('#close-game').onclick = closeGame;
$('#game-start').onclick = () => { $('#game-overlay').hidden = true; game.start(); };
$('#share-score').onclick = async () => {
  const message = `${nickname} scored ${format(game.score)} in Neon Rush at Afterhours Arcade. Can you beat it?`;
  const url = location.origin;
  try {
    if (navigator.share) await navigator.share({ title: 'Neon Rush high score', text: message, url });
    else { await navigator.clipboard.writeText(`${message} ${url}`); showToast('Score challenge copied. Send it to a friend!'); }
  } catch (error) { if (error.name !== 'AbortError') showToast('Could not share this score.'); }
};
$('#sound-toggle').onclick = () => { game.sound = !game.sound; $('#sound-toggle').textContent = game.sound ? '♪ SOUND ON' : '♪ SOUND OFF'; };
$('#dash-control').onclick = () => { if (!game?.dash()) showToast('Collect stars to charge your dash.'); };
$('#pause-game').onclick = () => game?.togglePause();
document.querySelectorAll('[data-move]').forEach(button => {
  const release = () => { game?.keys.delete(button.dataset.move); button.classList.remove('pressed'); };
  button.addEventListener('pointerdown', event => { event.preventDefault(); game.pointer = null; game.keys.add(button.dataset.move); button.classList.add('pressed'); button.setPointerCapture(event.pointerId); });
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('lostpointercapture', release);
});
$('#game-modal').addEventListener('click', event => { if (event.target.id === 'game-modal') closeGame(); });
window.addEventListener('keydown', event => { if (event.key === 'Escape') { closeGame(); $('#name-modal').hidden = true; } });
window.addEventListener('keydown', event => {
  if (currentView !== 'floor' || !$('#game-modal').hidden || !$('#name-modal').hidden || /input|textarea/i.test(document.activeElement?.tagName || '')) return;
  if (event.key === '1') openGame();
  if (event.key === '2') setView('scores');
  if (event.key === '3') setView('lobby');
});

function openName() { $('#name-input').value = nickname; $('#name-modal').hidden = false; $('#name-input').focus(); }
$('#profile-button').onclick = openName;
$('#edit-name').onclick = openName;
$('#close-name').onclick = () => $('#name-modal').hidden = true;
$('#name-modal').addEventListener('click', event => { if (event.target.id === 'name-modal') $('#name-modal').hidden = true; });
$('#name-form').addEventListener('submit', event => { event.preventDefault(); nickname = $('#name-input').value.trim().replace(/\s+/g, ' ').slice(0, 18); if (nickname.length < 2) return; setName(nickname); updateName(); $('#name-modal').hidden = true; showToast(`Welcome, ${nickname}.`); });

$('#chat-form').addEventListener('submit', async event => {
  event.preventDefault();
  const field = $('#chat-input');
  const body = field.value.trim();
  if (!body) return;
  field.disabled = true;
  try { await sendChat(body, nickname); field.value = ''; }
  catch (error) { showToast(error.message || 'Message could not be sent.'); }
  finally { field.disabled = arcadeStatus !== 'online'; field.focus(); }
});
$('#chat-list').addEventListener('click', async event => {
  const button = event.target.closest('[data-report]');
  if (!button) return;
  button.disabled = true;
  try { await reportChat(button.dataset.report); showToast('Message reported. Thank you.'); }
  catch (error) { button.disabled = false; showToast(error.message || 'Report could not be sent.'); }
});

function updateQuarterDetail() {
  const label = selectedCurrency === 'USDC' ? '0.25 USDC on Base' : selectedCurrency === 'BASE_ETH' ? `${baseQuarterPrice?.price || 'Price pending'} ETH on Base` : `${import.meta.env.VITE_QUARTER_ETH_MAINNET || 'Price pending'} ETH on Ethereum`;
  $('#quarter-detail').textContent = `${label} · network fees apply`;
}
document.querySelectorAll('[data-currency]').forEach(button => button.addEventListener('click', () => {
  selectedCurrency = button.dataset.currency;
  document.querySelectorAll('[data-currency]').forEach(item => item.classList.toggle('selected', item === button));
  updateQuarterDetail();
}));
$('#quarter-button').onclick = async () => {
  if (quarterBusy) return;
  if (!paymentsReady) { showToast('Add the arcade contract address to enable Base quarters. Free play is open.'); return; }
  if (selectedCurrency !== 'ETH_MAINNET' && arcadeStatus !== 'online') { showToast('Connect Firebase before buying a Base quarter so it can be claimed.'); return; }
  quarterBusy = true;
  $('#quarter-button').disabled = true;
  try {
    const payment = await payQuarter(selectedCurrency, message => { $('#quarter-button').textContent = message; });
    $('#quarter-button').innerHTML = 'THANK YOU! <span>♥</span>';
    if (payment.currency === 'ETH_MAINNET') showToast(`Ethereum support payment confirmed: ${payment.hash.slice(0, 12)}…`);
    else {
      savePending([...getPending(), { hash: payment.hash, account: payment.account }]);
      try { await claimPendingPurchase(payment.hash); }
      catch (error) { showToast(`Purchase confirmed. Claim is pending: ${error.message}`); }
    }
  } catch (error) {
    showToast(error.shortMessage || error.message || 'Payment was cancelled.');
  } finally {
    setTimeout(() => { quarterBusy = false; $('#quarter-button').disabled = false; $('#quarter-button').innerHTML = 'DROP A QUARTER <span>↗</span>'; }, 1800);
  }
};

async function claimPendingPurchase(hash) {
  const pending = getPending().find(item => item.hash === hash);
  if (!pending) return;
  if (!playerId()) throw new Error('Firebase sign-in is required.');
  const signature = await signQuarterClaim(pending.hash, playerId(), pending.account);
  const result = await claimQuarter(pending.hash, signature);
  savePending(getPending().filter(item => item.hash !== hash));
  showToast(`${result.added} quarter claimed! Your total is ${result.quarters}.`);
}

$('#retry-claim').onclick = async () => {
  const next = getPending()[0];
  if (!next) return;
  $('#retry-claim').disabled = true;
  try { await claimPendingPurchase(next.hash); }
  catch (error) { showToast(error.message || 'Claim could not be verified yet.'); }
  finally { $('#retry-claim').disabled = false; }
};

updateName();
updateBest();
renderScores();
renderChat();
if (['scores', 'lobby'].includes(location.hash.slice(1))) setView(location.hash.slice(1));
connectArcade(status => {
  arcadeStatus = status;
  $('#network-label').textContent = status === 'online' ? 'ARCADE ONLINE' : status === 'local' ? 'LOCAL MODE' : status.toUpperCase();
  $('.online-pill').classList.toggle('live', status === 'online');
  renderScores();
  renderChat();
  stopBalance();
  stopBalance = status === 'online' ? watchQuarterBalance(value => { $('#quarter-balance').textContent = value === null ? 'QUARTERS COLLECTED · —' : `QUARTERS COLLECTED · ${value}`; }) : () => {};
});
watchScores(rows => { scores = rows; renderScores(); });
watchChat(rows => { chat = rows; renderChat(); });
if (baseContractReady) getBaseQuarterPrice().then(value => { baseQuarterPrice = value; updateQuarterDetail(); }).catch(error => console.warn('Base quarter price unavailable', error));
