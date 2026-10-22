// ============================================================
// REST TIMER
// ============================================================
// Counts down against a wall-clock end time rather than ticks, so it stays right
// after the phone locks or the tab is backgrounded. Keeps the screen awake while
// running (Wake Lock API, where supported) and beeps/vibrates when rest is over.
let endAt = 0;
let durationMs = 0;
let tickHandle = null;
let hideHandle = null;
let wakeLock = null;
let audioCtx = null;

const el = (id) => document.getElementById(id);

// Browsers (iOS especially) only allow audio after a user gesture, so this is
// called from the "log set" tap and the context is reused when the timer ends.
export function primeAudio() {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch {
    audioCtx = null;
  }
}

export function startRest(seconds, label) {
  clearTimeout(hideHandle);
  durationMs = seconds * 1000;
  endAt = Date.now() + durationMs;
  el('rest-label').textContent = `Rest · ${label}`;
  el('rest-bar').classList.remove('hidden', 'done');
  document.body.classList.add('resting');
  clearInterval(tickHandle);
  tickHandle = setInterval(tick, 250);
  tick();
  requestWakeLock();
}

export function stopRest() {
  clearInterval(tickHandle);
  clearTimeout(hideHandle);
  tickHandle = null;
  el('rest-bar').classList.add('hidden');
  document.body.classList.remove('resting');
  releaseWakeLock();
}

function adjustRest(deltaSeconds) {
  if (!tickHandle) return;
  endAt = Math.max(Date.now(), endAt + deltaSeconds * 1000);
  durationMs = Math.max(1000, durationMs + deltaSeconds * 1000);
  tick();
}

function tick() {
  const remaining = Math.max(0, endAt - Date.now());
  const secs = Math.ceil(remaining / 1000);
  el('rest-time').textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  el('rest-progress').style.width = `${(remaining / durationMs) * 100}%`;
  if (remaining <= 0) finishRest();
}

function finishRest() {
  clearInterval(tickHandle);
  tickHandle = null;
  el('rest-bar').classList.add('done');
  el('rest-label').textContent = 'Rest over';
  el('rest-time').textContent = 'Go';
  beep();
  try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch { /* unsupported */ }
  releaseWakeLock();
  hideHandle = setTimeout(stopRest, 4000);
}

function beep() {
  if (!audioCtx) return;
  try {
    const now = audioCtx.currentTime;
    for (let i = 0; i < 3; i++) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, now + i * 0.22);
      gain.gain.exponentialRampToValueAtTime(0.3, now + i * 0.22 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.22 + 0.14);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now + i * 0.22);
      osc.stop(now + i * 0.22 + 0.15);
    }
  } catch {
    // Audio unavailable — vibration and the on-screen state still signal it.
  }
}

async function requestWakeLock() {
  if (wakeLock || !('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch {
    wakeLock = null;
  }
}

function releaseWakeLock() {
  if (wakeLock) wakeLock.release().catch(() => {});
  wakeLock = null;
}

export function wireRestTimer() {
  el('rest-minus').addEventListener('click', () => adjustRest(-15));
  el('rest-plus').addEventListener('click', () => adjustRest(15));
  el('rest-skip').addEventListener('click', stopRest);
  // The browser drops the wake lock when the page is hidden; take it back on return.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && tickHandle) {
      tick();
      if (tickHandle) requestWakeLock();
    }
  });
}
