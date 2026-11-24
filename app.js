// ---------- DOM ----------
const tabBar = document.querySelector('.tabs');
const tabs = [...document.querySelectorAll('.tab')];
const title = document.querySelector('h1');
const credits = document.querySelector('.credits');

// ---------- Config ----------
// Starting position (fraction of viewport) and velocity for the first few boxes per tab.
const PRESETS = [
  { x: .07, y: .10, vx: 1.05, vy: .78 },
  { x: .74, y: .36, vx: -.90, vy: 1.08 },
  { x: .12, y: .68, vx: .82, vy: -1.10 },
  { x: .72, y: .80, vx: -1.12, vy: -.72 },
];
const randomSpeed = () => (0.7 + Math.random() * 0.5) * (Math.random() < 0.5 ? -1 : 1);

const movers = [...document.querySelectorAll('.repo')].map((element) => ({
  element, group: element.dataset.group, x: 0, y: 0, vx: 0, vy: 0, width: 0, height: 0,
}));

// ---------- State ----------
let active = [];
let bounds = { w: window.innerWidth, h: window.innerHeight, top: 0 };
let lastTime = 0;
let rafId = 0;
let resizeQueued = false;

// ---------- Audio ----------
let audioCtx = null;
let lastSoundTime = 0;
const UNLOCK_EVENTS = ['pointerdown', 'keydown', 'touchstart'];

function unlockAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audioCtx = new AC();
  }
  Promise.resolve(audioCtx.resume()).then(() => {
    // Once audio is running, the unlock listeners are no longer needed.
    if (audioCtx.state === 'running') {
      UNLOCK_EVENTS.forEach((type) => window.removeEventListener(type, unlockAudio));
    }
  });
}
UNLOCK_EVENTS.forEach((type) => window.addEventListener(type, unlockAudio, { passive: true }));

function playBounce(baseFreq, volume) {
  if (!audioCtx || audioCtx.state !== 'running') return;
  const now = audioCtx.currentTime;
  if (now - lastSoundTime < 0.025) return; // avoid stacking too many sounds
  lastSoundTime = now;

  const freq = baseFreq * (0.9 + Math.random() * 0.25);
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq * 1.6, now);
  osc.frequency.exponentialRampToValueAtTime(freq, now + 0.05);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(volume, now + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.16);
}

const playWallBounce = () => playBounce(220, 0.10);
const playBoxBounce = () => playBounce(440, 0.14);

// ---------- Colors ----------
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// h: 0-360, s/l: 0-1 -> [r, g, b] in 0-1
function hslToRgb(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

function randomizeColors() {
  const base = Math.random() * 360;
  const order = shuffle(movers.map((_, i) => i));
  movers.forEach((mover, i) => {
    const hue = (base + order[i] * (360 / movers.length) + (Math.random() * 30 - 15) + 360) % 360;
    const sat = 60 + Math.random() * 30;
    const light = 45 + Math.random() * 35;
    const [r, g, b] = hslToRgb(hue, sat / 100, light / 100);
    const luma = 0.299 * r + 0.587 * g + 0.114 * b; // approximate perceived brightness
    const { style } = mover.element;
    style.setProperty('--btn-bg', `hsl(${hue.toFixed(0)} ${sat.toFixed(0)}% ${light.toFixed(0)}%)`);
    style.setProperty('--btn-fg', luma > 0.6 ? '#171717' : '#ffffff');
  });
}

// ---------- Layout ----------
const place = (m) => { m.element.style.transform = `translate3d(${m.x}px, ${m.y}px, 0)`; };

// Measures everything once (reads), then positions (writes). Runs on tab change and resize,
// never inside the animation loop.
function layout() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const top = Math.ceil(tabBar.getBoundingClientRect().bottom);
  const prev = bounds;
  const rects = active.map((m) => m.element.getBoundingClientRect()); // batched reads

  active.forEach((m, i) => {
    const first = m.width === 0;
    const oldMaxX = Math.max(0, prev.w - m.width);
    const oldRangeY = Math.max(0, prev.h - m.height - prev.top);

    m.width = rects[i].width;
    m.height = rects[i].height;
    const maxX = Math.max(0, w - m.width);
    const maxY = Math.max(top, h - m.height);
    const rangeY = maxY - top;

    if (first) {
      const p = PRESETS[i];
      m.vx = p?.vx ?? randomSpeed();
      m.vy = p?.vy ?? randomSpeed();
      m.x = p ? w * p.x : Math.random() * maxX;
      m.y = top + (p ? p.y : Math.random()) * rangeY;
    } else {
      // Keep the same relative position when the viewport changes.
      m.x = oldMaxX ? (m.x / oldMaxX) * maxX : m.x;
      m.y = top + (oldRangeY ? ((m.y - prev.top) / oldRangeY) * rangeY : 0);
    }
    m.x = Math.max(0, Math.min(maxX, m.x));
    m.y = Math.max(top, Math.min(maxY, m.y));
    place(m);
  });

  bounds = { w, h, top };
}

function queueLayout() {
  if (resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(() => { resizeQueued = false; layout(); });
}

// ---------- Tabs ----------
function setTab(name) {
  const showingCredits = name === 'credits';
  tabs.forEach((tab) => tab.setAttribute('aria-selected', String(tab.dataset.tab === name)));
  title.hidden = showingCredits;
  credits.hidden = !showingCredits;
  movers.forEach((m) => {
    m.element.hidden = showingCredits || m.group !== name;
    m.width = 0; // forces a fresh initial layout
  });
  active = showingCredits ? [] : movers.filter((m) => m.group === name);
  layout();
  start();
}

// ---------- Animation ----------
function step(time) {
  const dt = Math.min(2, (time - (lastTime || time)) / 16.67);
  lastTime = time;
  const { w, h, top } = bounds;

  for (const m of active) {
    const right = Math.max(0, w - m.width);
    const bottom = Math.max(top, h - m.height);
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    if (m.x <= 0) { m.x = 0; if (m.vx < 0) playWallBounce(); m.vx = Math.abs(m.vx); }
    if (m.x >= right) { m.x = right; if (m.vx > 0) playWallBounce(); m.vx = -Math.abs(m.vx); }
    if (m.y <= top) { m.y = top; if (m.vy < 0) playWallBounce(); m.vy = Math.abs(m.vy); }
    if (m.y >= bottom) { m.y = bottom; if (m.vy > 0) playWallBounce(); m.vy = -Math.abs(m.vy); }
  }

  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i], b = active[j];
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (overlapX <= 0 || overlapY <= 0) continue;

      if (overlapX < overlapY) {
        const dir = a.x + a.width / 2 < b.x + b.width / 2 ? -1 : 1;
        a.x += dir * (overlapX / 2 + .5);
        b.x -= dir * (overlapX / 2 + .5);
        [a.vx, b.vx] = [b.vx, a.vx];
      } else {
        const dir = a.y + a.height / 2 < b.y + b.height / 2 ? -1 : 1;
        a.y += dir * (overlapY / 2 + .5);
        b.y -= dir * (overlapY / 2 + .5);
        [a.vy, b.vy] = [b.vy, a.vy];
      }
      playBoxBounce();
    }
  }

  active.forEach(place); // single write per element per frame

  // Nothing to animate (e.g. Credits tab): stop the loop instead of idling.
  rafId = active.length ? requestAnimationFrame(step) : 0;
}

function start() {
  if (rafId || !active.length) return;
  lastTime = 0;
  rafId = requestAnimationFrame(step);
}

// ---------- Init ----------
tabs.forEach((tab) => tab.addEventListener('click', () => setTab(tab.dataset.tab)));
window.addEventListener('resize', queueLayout);
randomizeColors();
setTab('phone');