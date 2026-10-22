// ============================================================
// CELEBRATION EFFECTS
// ============================================================
const COLORS = ['#FFC94D', '#FFE08A', '#8B74FF', '#4FE3C1', '#FFFFFF'];

function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// "+10 XP" drifting up from the button that earned it.
export function floatXp(anchorEl, amount) {
  if (!amount || amount <= 0 || !anchorEl) return;
  const rect = anchorEl.getBoundingClientRect();
  const label = document.createElement('span');
  label.className = 'xp-float';
  label.textContent = `+${amount} XP`;
  label.style.left = `${rect.left + rect.width / 2}px`;
  label.style.top = `${rect.top - 6}px`;
  document.body.appendChild(label);
  setTimeout(() => label.remove(), 1100);
}

// Short confetti burst for PRs, level-ups and finished sessions.
export function celebrate() {
  if (reducedMotion()) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'fx-canvas';
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const w = window.innerWidth;
  const particles = Array.from({ length: 90 }, () => ({
    x: w / 2 + (Math.random() - 0.5) * w * 0.3,
    y: window.innerHeight * 0.35,
    vx: (Math.random() - 0.5) * 9,
    vy: -Math.random() * 10 - 4,
    size: Math.random() * 6 + 4,
    rot: Math.random() * Math.PI,
    spin: (Math.random() - 0.5) * 0.3,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  }));

  const start = performance.now();
  const DURATION = 1800;
  function frame(now) {
    const t = now - start;
    ctx.clearRect(0, 0, w, window.innerHeight);
    ctx.globalAlpha = Math.max(0, 1 - t / DURATION);
    for (const p of particles) {
      p.vy += 0.35;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.spin;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size); // square "pixels"
      ctx.restore();
    }
    if (t < DURATION) requestAnimationFrame(frame);
    else canvas.remove();
  }
  requestAnimationFrame(frame);
}
