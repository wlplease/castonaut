const W = 720;
const H = 900;
const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

export class NeonRush {
  constructor(canvas, onEnd, onHud) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onEnd = onEnd;
    this.onHud = onHud;
    this.keys = new Set();
    this.pointer = null;
    this.sound = true;
    this.running = false;
    this.frame = 0;
    this.tick = this.tick.bind(this);
    this.keydown = event => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(event.key)) event.preventDefault();
      if (['ArrowLeft', 'ArrowRight', 'a', 'A', 'd', 'D'].includes(event.key)) this.pointer = null;
      if ((event.key === ' ' || event.key === 'Shift') && !event.repeat) this.dash();
      if ((event.key === 'p' || event.key === 'P') && !event.repeat) this.togglePause();
      this.keys.add(event.key.toLowerCase());
    };
    this.keyup = event => this.keys.delete(event.key.toLowerCase());
    this.move = event => {
      const bounds = this.canvas.getBoundingClientRect();
      this.pointer = (event.clientX - bounds.left) / bounds.width * W;
    };
    this.canvas.addEventListener('pointermove', this.move);
    this.canvas.addEventListener('pointerdown', this.move);
    window.addEventListener('keydown', this.keydown);
    window.addEventListener('keyup', this.keyup);
    this.reset();
    this.draw();
  }

  reset() {
    this.player = { x: W / 2, y: H - 118, r: 24, shield: 0, invincible: 0 };
    this.objects = [];
    this.particles = [];
    this.labels = [];
    this.stars = Array.from({ length: 58 }, () => ({ x: rand(0, W), y: rand(0, H), r: rand(1, 2.7), speed: rand(.4, 2) }));
    this.score = 0;
    this.combo = 0;
    this.dashMeter = 0;
    this.wave = 1;
    this.shake = 0;
    this.flash = 0;
    this.paused = false;
    this.lives = 3;
    this.seconds = 75;
    this.elapsed = 0;
    this.spawnClock = 0;
    this.lastTime = 0;
    this.ended = false;
    this.onHud(this);
  }

  start() {
    if (this.running) return;
    this.reset();
    this.running = true;
    this.lastTime = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }

  stop() {
    this.running = false;
    this.paused = false;
    cancelAnimationFrame(this.frame);
  }

  togglePause() {
    if (!this.running) return;
    this.paused = !this.paused;
    this.lastTime = performance.now();
    this.onHud(this);
  }

  dash() {
    if (!this.running || this.paused || this.dashMeter < 100) return false;
    this.dashMeter = 0;
    this.player.invincible = Math.max(this.player.invincible, 1.15);
    this.flash = .35;
    this.shake = 6;
    let cleared = 0;
    for (const item of this.objects) {
      if (item.type === 'hazard' && Math.hypot(item.x - this.player.x, item.y - this.player.y) < 165) {
        item.hit = true;
        cleared++;
        this.burst(item.x, item.y, '#8ef9df', 20);
      }
    }
    this.score += cleared * 100;
    this.label(cleared ? `DASH +${cleared * 100}` : 'DASH!', '#8ef9df', this.player.x, this.player.y - 55);
    this.burst(this.player.x, this.player.y, '#8ef9df', 35);
    this.chirp(1150, .2, 'sawtooth');
    this.onHud(this);
    return true;
  }

  destroy() {
    this.stop();
    this.canvas.removeEventListener('pointermove', this.move);
    this.canvas.removeEventListener('pointerdown', this.move);
    window.removeEventListener('keydown', this.keydown);
    window.removeEventListener('keyup', this.keyup);
  }

  chirp(freq = 640, duration = .08, type = 'sine') {
    if (!this.sound) return;
    try {
      this.audio ||= new (window.AudioContext || window.webkitAudioContext)();
      const osc = this.audio.createOscillator();
      const gain = this.audio.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.audio.currentTime);
      osc.frequency.exponentialRampToValueAtTime(freq * .56, this.audio.currentTime + duration);
      gain.gain.setValueAtTime(.055, this.audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001, this.audio.currentTime + duration);
      osc.connect(gain).connect(this.audio.destination);
      osc.start();
      osc.stop(this.audio.currentTime + duration);
    } catch { /* Audio is optional. */ }
  }

  spawn() {
    const roll = Math.random();
    const type = roll < .57 ? 'coin' : roll < .87 ? 'hazard' : roll < .95 ? 'shield' : 'gem';
    const x = rand(52, W - 52);
    const speed = rand(220, 305) + this.elapsed * 2.5;
    this.objects.push({ type, x, y: -40, r: type === 'hazard' ? 22 : 20, speed, phase: rand(0, TAU), nearAwarded: false });
    if (type === 'coin' && Math.random() < .18) {
      this.objects.push({ type: 'coin', x: clamp(x + rand(-60, 60), 48, W - 48), y: -120, r: 20, speed, phase: rand(0, TAU), nearAwarded: false });
    }
  }

  label(text, color, x, y) { this.labels.push({ text, color, x, y, life: 1 }); }

  burst(x, y, color, count = 13) {
    for (let i = 0; i < count; i++) this.particles.push({ x, y, vx: rand(-170, 170), vy: rand(-190, 80), life: rand(.25, .6), color });
  }

  tick(now) {
    if (!this.running) return;
    if (this.paused) {
      this.lastTime = now;
      this.draw();
      this.frame = requestAnimationFrame(this.tick);
      return;
    }
    const dt = Math.min((now - this.lastTime) / 1000, .04);
    this.lastTime = now;
    this.elapsed += dt;
    const nextWave = Math.min(3, 1 + Math.floor(this.elapsed / 25));
    if (nextWave !== this.wave) {
      this.wave = nextWave;
      this.label(`WAVE ${this.wave}`, '#ffd491', W / 2, H * .36);
      this.chirp(500 + this.wave * 190, .22, 'square');
    }
    this.seconds = Math.max(0, 75 - this.elapsed);
    this.spawnClock += dt;
    const interval = Math.max(.28, .67 - this.elapsed * .0033);
    while (this.spawnClock > interval) {
      this.spawnClock -= interval;
      this.spawn();
    }
    let direction = 0;
    if (this.keys.has('arrowleft') || this.keys.has('a')) direction--;
    if (this.keys.has('arrowright') || this.keys.has('d')) direction++;
    if (this.pointer !== null) this.player.x += (this.pointer - this.player.x) * Math.min(1, dt * 11);
    else this.player.x += direction * 430 * dt;
    this.player.x = clamp(this.player.x, 32, W - 32);
    this.player.invincible = Math.max(0, this.player.invincible - dt);
    this.player.shield = Math.max(0, this.player.shield - dt);
    this.shake = Math.max(0, this.shake - 35 * dt);
    this.flash = Math.max(0, this.flash - dt);
    for (const star of this.stars) star.y = (star.y + star.speed * 65 * dt) % H;
    for (const item of this.objects) {
      item.y += item.speed * dt;
      item.x += Math.sin(this.elapsed * 4 + item.phase) * 12 * dt;
      if (Math.hypot(item.x - this.player.x, item.y - this.player.y) < item.r + this.player.r) {
        item.hit = true;
        if (item.type === 'coin') {
          this.combo = Math.min(10, this.combo + 1);
          const points = 100 + this.combo * 25;
          this.score += points;
          this.dashMeter = Math.min(100, this.dashMeter + 14);
          this.label(`+${points}`, '#ffe38c', item.x, item.y);
          this.burst(item.x, item.y, '#ffe38c');
          this.chirp(680 + this.combo * 65, .07);
        } else if (item.type === 'gem') {
          this.score += 500;
          this.dashMeter = Math.min(100, this.dashMeter + 35);
          this.label('BONUS +500', '#f3a9ff', item.x, item.y);
          this.burst(item.x, item.y, '#e9a5ff', 26);
          this.chirp(1350, .2, 'triangle');
        } else if (item.type === 'shield') {
          this.player.shield = 8;
          this.score += 50;
          this.label('SHIELD', '#77f5e4', item.x, item.y);
          this.burst(item.x, item.y, '#77f5e4');
          this.chirp(980, .18);
        } else if (!this.player.shield && !this.player.invincible) {
          this.lives--;
          this.combo = 0;
          this.player.invincible = 1.4;
          this.shake = 15;
          this.flash = .3;
          this.label('OUCH!', '#ff688d', item.x, item.y);
          this.burst(item.x, item.y, '#ff688d', 24);
          this.chirp(210, .27, 'sawtooth');
          navigator.vibrate?.(65);
        } else if (this.player.shield) {
          this.score += 25;
          this.burst(item.x, item.y, '#77f5e4');
        }
      } else if (item.type === 'hazard' && !item.nearAwarded && !this.player.invincible && item.y > this.player.y + 33 && item.y < this.player.y + 76 && Math.abs(item.x - this.player.x) < 95) {
        item.nearAwarded = true;
        this.score += 75;
        this.dashMeter = Math.min(100, this.dashMeter + 10);
        this.label('NEAR MISS +75', '#f6b7d5', item.x, this.player.y - 40);
        this.chirp(830, .06);
      }
    }
    this.objects = this.objects.filter(item => !item.hit && item.y < H + 44);
    for (const p of this.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 360 * dt; p.life -= dt; }
    this.particles = this.particles.filter(p => p.life > 0);
    for (const label of this.labels) { label.y -= 58 * dt; label.life -= dt; }
    this.labels = this.labels.filter(label => label.life > 0);
    this.onHud(this);
    this.draw();
    if (this.seconds <= 0 || this.lives <= 0) {
      this.stop();
      this.ended = true;
      this.onEnd(this.score);
    } else this.frame = requestAnimationFrame(this.tick);
  }

  draw() {
    const c = this.ctx;
    c.save();
    if (this.shake) c.translate(rand(-this.shake, this.shake), rand(-this.shake, this.shake));
    const bg = c.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#111830');
    bg.addColorStop(.55, '#182039');
    bg.addColorStop(1, '#36213d');
    c.fillStyle = bg;
    c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(239, 107, 170, .12)';
    c.lineWidth = 2;
    for (let x = 0; x < W; x += 72) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
    for (let y = -72 + (this.elapsed * 80) % 72; y < H; y += 72) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    c.fillStyle = '#d9d8ff';
    for (const star of this.stars) { c.globalAlpha = .25 + star.r / 5; c.fillRect(star.x, star.y, star.r, star.r); }
    c.globalAlpha = 1;
    for (const item of this.objects) this.drawItem(c, item);
    for (const p of this.particles) { c.globalAlpha = Math.min(1, p.life * 2); c.fillStyle = p.color; c.fillRect(p.x, p.y, 5, 5); }
    c.globalAlpha = 1;
    this.drawPlayer(c);
    for (const label of this.labels) {
      c.globalAlpha = Math.min(1, label.life * 2);
      c.fillStyle = label.color;
      c.font = 'bold 23px monospace';
      c.textAlign = 'center';
      c.shadowColor = label.color; c.shadowBlur = 10;
      c.fillText(label.text, label.x, label.y);
    }
    c.globalAlpha = 1; c.shadowBlur = 0;
    if (this.flash) { c.fillStyle = `rgba(255,255,255,${this.flash * .28})`; c.fillRect(0, 0, W, H); }
    c.fillStyle = 'rgba(255,255,255,.025)';
    for (let y = 0; y < H; y += 5) c.fillRect(0, y, W, 1);
    c.restore();
    if (this.paused) {
      c.fillStyle = 'rgba(8,10,24,.76)'; c.fillRect(0, 0, W, H);
      c.fillStyle = '#ffe0a1'; c.font = 'bold 52px monospace'; c.textAlign = 'center'; c.fillText('PAUSED', W / 2, H / 2);
      c.font = '21px monospace'; c.fillText('PRESS P TO RESUME', W / 2, H / 2 + 42);
    }
  }

  drawItem(c, item) {
    c.save();
    c.translate(item.x, item.y);
    c.shadowBlur = 24;
    if (item.type === 'coin') {
      c.shadowColor = '#ffd773'; c.fillStyle = '#ffd773';
      c.beginPath(); c.arc(0, 0, 18, 0, TAU); c.fill();
      c.shadowBlur = 0; c.strokeStyle = '#704f37'; c.lineWidth = 3;
      c.beginPath(); c.arc(0, 0, 12, 0, TAU); c.stroke();
      c.fillStyle = '#704f37'; c.font = 'bold 20px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('★', 0, 1);
    } else if (item.type === 'hazard') {
      c.shadowColor = '#ff668a'; c.fillStyle = '#ff668a';
      c.rotate(this.elapsed * 2);
      c.beginPath();
      for (let i = 0; i < 8; i++) { const angle = i * TAU / 8; const r = i % 2 ? 15 : 24; const x = Math.cos(angle) * r; const y = Math.sin(angle) * r; i ? c.lineTo(x, y) : c.moveTo(x, y); }
      c.closePath(); c.fill();
      c.shadowBlur = 0; c.fillStyle = '#541c42'; c.beginPath(); c.arc(0, 0, 8, 0, TAU); c.fill();
    } else if (item.type === 'shield') {
      c.shadowColor = '#6ef1df'; c.strokeStyle = '#6ef1df'; c.lineWidth = 5;
      c.beginPath(); c.arc(0, 0, 18, 0, TAU); c.stroke();
      c.beginPath(); c.moveTo(-8, 0); c.lineTo(8, 0); c.moveTo(0, -8); c.lineTo(0, 8); c.stroke();
    } else {
      c.shadowColor = '#ed9bff'; c.fillStyle = '#dd9cfa';
      c.beginPath(); c.moveTo(0, -24); c.lineTo(20, 0); c.lineTo(0, 24); c.lineTo(-20, 0); c.closePath(); c.fill();
      c.shadowBlur = 0; c.fillStyle = '#fff0ff'; c.beginPath(); c.moveTo(0, -12); c.lineTo(8, 0); c.lineTo(0, 12); c.lineTo(-8, 0); c.closePath(); c.fill();
    }
    c.restore();
  }

  drawPlayer(c) {
    const p = this.player;
    if (p.invincible && Math.floor(p.invincible * 12) % 2) return;
    c.save(); c.translate(p.x, p.y);
    c.shadowBlur = 34; c.shadowColor = '#7af2eb';
    c.fillStyle = '#7af2eb';
    c.beginPath(); c.moveTo(0, -27); c.lineTo(24, 21); c.lineTo(0, 10); c.lineTo(-24, 21); c.closePath(); c.fill();
    c.shadowBlur = 0; c.fillStyle = '#16263b';
    c.beginPath(); c.moveTo(0, -12); c.lineTo(8, 9); c.lineTo(-8, 9); c.closePath(); c.fill();
    c.fillStyle = '#ffa66c'; c.fillRect(-11, 20, 6, 12 + Math.random() * 8); c.fillRect(5, 20, 6, 12 + Math.random() * 8);
    if (p.shield) { c.strokeStyle = '#70f6e3'; c.lineWidth = 3; c.beginPath(); c.arc(0, 0, 37, 0, TAU); c.stroke(); }
    if (p.invincible && !p.shield) { c.strokeStyle = '#f3da9a'; c.lineWidth = 2; c.beginPath(); c.arc(0, 0, 33, 0, TAU); c.stroke(); }
    c.restore();
  }
}
