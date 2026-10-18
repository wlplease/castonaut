const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export function mountRoom() {
  document.querySelector('#hero').outerHTML = `
    <section class="room-hero" id="hero" aria-labelledby="room-title">
      <div class="room-header">
        <div><span class="room-open"><i></i> THE DOORS ARE OPEN</span><h1 id="room-title">Welcome to<br><em>Afterhours.</em></h1><p>Hear the hum. Find your machine. Meet your people. The next high score could be yours.</p></div>
        <div class="room-header-side"><div class="admit-stamp">ADMIT<br><strong>ONE</strong><small>FREE PLAY</small></div><span>EST. 2026 &nbsp; · &nbsp; ALWAYS OPEN</span></div>
      </div>
      <div class="arcade-room" aria-label="Interactive arcade room">
        <div class="room-ceiling"><span class="ceiling-light l1"></span><span class="ceiling-light l2"></span><span class="ceiling-light l3"></span></div>
        <div class="room-wall"><div class="wall-brick"></div><div class="wall-neon">AFTER<span>HOURS</span><small>ARCADE CLUB</small></div><div class="wall-poster left-poster"><span>★</span><small>BEAT<br>THE BEST</small></div><div class="wall-poster right-poster"><span>✳</span><small>STAY<br>A WHILE</small></div></div>
        <div class="room-floor-perspective"></div>
        <div class="room-machines">
          <button class="room-machine side-machine wall-machine" id="hero-scores" aria-label="Walk to the high score wall">
            <span class="machine-marquee">HIGH SCORES</span><span class="machine-glass wall-glass"><span>01&nbsp; <b id="room-screen-name">YOUR NAME?</b></span><strong id="room-screen-score">000000</strong><small>CAN YOU TOP IT?</small></span><span class="machine-controls"><i></i><i></i></span><span class="machine-lower">WALL OF FAME</span>
          </button>
          <button class="room-machine star-machine" id="hero-play" aria-label="Walk up to Neon Rush and play">
            <span class="machine-marquee">NEON RUSH</span><span class="machine-glass rush-glass"><span class="attract-star">★</span><span class="attract-ship">▲</span><span class="attract-copy">PRESS START</span></span><span class="machine-controls"><i></i><i></i><i></i></span><span class="machine-lower">1 PLAYER <b>◉</b> FREE PLAY</span>
          </button>
          <button class="room-machine side-machine chat-machine" id="hero-lobby" aria-label="Walk to the lobby chat">
            <span class="machine-marquee">THE LOBBY</span><span class="machine-glass chat-glass"><span>✳</span><strong>HEY, PLAYER.</strong><small>COME SAY HELLO</small></span><span class="machine-controls"><i></i><i></i></span><span class="machine-lower">ARCADE FRIENDS</span>
          </button>
        </div>
        <div class="room-selection"><span>←</span> 1 PLAY &nbsp; · &nbsp; 2 SCORES &nbsp; · &nbsp; 3 LOBBY <span>→</span></div>
      </div>
      <div class="room-status-bar"><span><i class="status-light"></i><b id="room-network">LOCAL ARCADE</b></span><span>01 MACHINE READY</span><span>YOUR BEST <b id="floor-best">0</b></span><button id="ambience-toggle" aria-pressed="false">♫ AMBIENCE OFF</button></div>
    </section>`;

  document.querySelector('#view-floor').innerHTML = `
    <div class="room-followup"><div><span class="eyebrow">NOW ON THE FLOOR</span><h2>Choose your next move<span class="accent">.</span></h2></div><p>No menus to learn. Walk up to a cabinet, see who’s on the wall, or hang out by the counter.</p></div>
    <div class="room-cards">
      <article class="room-card play-card"><div class="room-card-top"><span>01 / PLAY</span><span>● READY</span></div><div class="play-card-art"><span>★</span><b>▲</b></div><h3>NEON RUSH</h3><p>75 seconds. Three lives. Collect light, dodge trouble, make your mark.</p><div class="room-card-bottom"><span>1 PLAYER · SCORE ATTACK</span><button id="cabinet-play">STEP UP ↗</button></div></article>
      <article class="room-card scores-card"><div class="room-card-top"><span>02 / COMPETE</span><span>ALL TIME</span></div><h3>THE WALL OF FAME</h3><div id="room-top-scores" class="room-score-preview"></div><div class="room-card-bottom"><span>YOUR BEST <b id="room-personal-best">0</b></span><button id="room-scores">SEE THE WALL ↗</button></div></article>
      <article class="room-card social-card"><div class="room-card-top"><span>03 / HANG OUT</span><span id="room-chat-status">LOCAL</span></div><h3>ARCADE FRIENDS</h3><div id="room-chat-preview" class="room-chat-preview"></div><div class="room-card-bottom"><span>THE LOBBY IS OPEN</span><button id="next-lobby">SAY HELLO ↗</button></div></article>
    </div>
    <div class="room-next"><div class="repair-icon">✳</div><div><span class="eyebrow">BEHIND THE CURTAIN</span><h3>More cabinets are coming.</h3><p>The best arcades grow around their regulars. Play the first machine and tell us what belongs here next.</p></div><button id="room-next-lobby">TELL US IN THE LOBBY →</button></div>`;
}

export function renderRoomScores(scores, localBest) {
  const preview = document.querySelector('#room-top-scores');
  if (!preview) return;
  preview.innerHTML = scores.length
    ? scores.slice(0, 3).map((row, i) => `<div><span>${String(i + 1).padStart(2, '0')}</span><strong>${escape(row.name || 'PLAYER')}</strong><b>${Number(row.score || 0).toLocaleString()}</b></div>`).join('')
    : `<div class="room-empty">The wall is waiting for its first name.</div>`;
  document.querySelector('#room-screen-name').textContent = scores[0]?.name || 'YOUR NAME?';
  document.querySelector('#room-screen-score').textContent = String(Math.max(localBest, scores[0]?.score || 0)).padStart(6, '0');
  document.querySelector('#room-personal-best').textContent = Number(localBest).toLocaleString();
}

export function renderRoomChat(chat, status) {
  const preview = document.querySelector('#room-chat-preview');
  if (!preview) return;
  preview.innerHTML = chat.length
    ? chat.slice(-2).reverse().map(item => `<div><span class="mini-avatar">${escape((item.name || 'P').charAt(0).toUpperCase())}</span><p><b>${escape(item.name || 'PLAYER')}</b><br>${escape(item.body)}</p></div>`).join('')
    : `<div class="room-empty">${status === 'online' ? 'Be the first to pull up a stool.' : 'The conversation starts when the arcade goes online.'}</div>`;
  document.querySelector('#room-chat-status').textContent = status === 'online' ? '● LIVE' : 'LOCAL';
  document.querySelector('#room-network').textContent = status === 'online' ? 'ARCADE ONLINE' : 'LOCAL ARCADE';
  document.querySelector('.status-light').classList.toggle('online', status === 'online');
}

export function createAmbience(button) {
  let context;
  let oscillator;
  let gain;
  let interval;
  let enabled = false;
  let connected = false;
  const beep = () => {
    if (!context || !enabled) return;
    const note = context.createOscillator();
    const volume = context.createGain();
    note.type = 'sine';
    note.frequency.value = [440, 587, 659, 880][Math.floor(Math.random() * 4)];
    volume.gain.setValueAtTime(.0001, context.currentTime);
    volume.gain.exponentialRampToValueAtTime(.015, context.currentTime + .03);
    volume.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .18);
    note.connect(volume).connect(context.destination);
    note.start(); note.stop(context.currentTime + .19);
  };
  const stop = () => {
    enabled = false;
    clearInterval(interval);
    if (gain) gain.gain.setTargetAtTime(0, context.currentTime, .15);
    button.textContent = '♫ AMBIENCE OFF';
    button.setAttribute('aria-pressed', 'false');
  };
  button.addEventListener('click', async () => {
    if (enabled) { stop(); return; }
    context ||= new (window.AudioContext || window.webkitAudioContext)();
    await context.resume();
    oscillator ||= context.createOscillator();
    gain ||= context.createGain();
    oscillator.type = 'sine'; oscillator.frequency.value = 58;
    gain.gain.value = 0;
    if (!connected) { oscillator.connect(gain).connect(context.destination); oscillator.start(); connected = true; }
    gain.gain.setTargetAtTime(.016, context.currentTime, .25);
    enabled = true;
    interval = setInterval(beep, 2100);
    button.textContent = '♫ AMBIENCE ON';
    button.setAttribute('aria-pressed', 'true');
  });
  return stop;
}
