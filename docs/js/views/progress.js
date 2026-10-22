import { state } from '../state.js';
import { allExerciseNames } from '../program.js';
import { escapeHtml, formatDateShort, formatDateLong, formatNumber } from '../utils.js';
import { e1rm, setsFor, setVolume } from '../stats.js';

// ============================================================
// PROGRESS VIEW
// ============================================================
const maxOrNull = (values) => {
  const nums = values.filter((v) => v != null);
  return nums.length ? Math.max(...nums) : null;
};

const METRICS = {
  e1rm: { label: 'Est. 1RM', withUnit: true, value: (sets) => maxOrNull(sets.map((s) => e1rm(s.weight, s.reps))) },
  top: { label: 'Top set', withUnit: true, value: (sets) => maxOrNull(sets.map((s) => (s.weight > 0 ? s.weight : null))) },
  reps: { label: 'Best reps', withUnit: false, value: (sets) => maxOrNull(sets.map((s) => s.reps)) },
  volume: {
    label: 'Volume',
    withUnit: true,
    value: (sets) => {
      const total = sets.reduce((sum, s) => sum + setVolume(s), 0);
      return total > 0 ? total : null;
    },
  },
};

function getSeries(exerciseName, metric) {
  const index = state.derived.index;
  const points = [];
  for (const sess of index.sessionsAsc) {
    const sets = setsFor(index, sess.id, exerciseName);
    if (sets.length === 0) continue;
    const value = METRICS[metric].value(sets);
    if (value != null) points.push({ date: sess.date, value });
  }
  return points;
}

// Loaded lifts default to estimated 1RM; bodyweight work to reps.
function defaultMetric(exerciseName) {
  return getSeries(exerciseName, 'e1rm').length > 0 ? 'e1rm' : 'reps';
}

export function renderProgressView() {
  const select = document.getElementById('progress-exercise-select');
  const names = allExerciseNames();
  if (select.options.length === 0) {
    select.innerHTML = names.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
  }
  if (!state.progressExercise) state.progressExercise = names[0];
  if (!state.progressMetric) state.progressMetric = defaultMetric(state.progressExercise);
  select.value = state.progressExercise;
  renderProgressChart();
}

function renderProgressChart() {
  const exerciseName = state.progressExercise;
  const metric = state.progressMetric;
  document.querySelectorAll('#progress-metric button').forEach((b) => {
    b.classList.toggle('active', b.dataset.metric === metric);
  });

  const points = getSeries(exerciseName, metric);
  const emptyMsg = document.getElementById('progress-empty');
  const bestEl = document.getElementById('progress-best');
  const canvas = document.getElementById('progress-chart');

  if (state.chartInstance) {
    state.chartInstance.destroy();
    state.chartInstance = null;
  }

  if (points.length === 0) {
    emptyMsg.textContent = `No ${METRICS[metric].label.toLowerCase()} data yet for this exercise.`;
    emptyMsg.classList.remove('hidden');
    canvas.classList.add('hidden');
    bestEl.textContent = '';
    return;
  }
  emptyMsg.classList.add('hidden');
  canvas.classList.remove('hidden');

  const unitLabel = METRICS[metric].withUnit ? ` ${state.unit}` : ' reps';
  const best = points.reduce((a, b) => (b.value > a.value ? b : a));
  bestEl.innerHTML = `Best ${escapeHtml(METRICS[metric].label.toLowerCase())}: <strong>${formatNumber(best.value, 1)}${unitLabel}</strong> on ${escapeHtml(formatDateLong(best.date))} · ${points.length} session${points.length === 1 ? '' : 's'}`;

  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 280);
  gradient.addColorStop(0, 'rgba(255, 201, 77, 0.25)');
  gradient.addColorStop(1, 'rgba(255, 201, 77, 0)');
  const monoFont = { family: "'JetBrains Mono', monospace", size: 11 };

  state.chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: points.map((p) => formatDateShort(p.date)),
      datasets: [{
        label: `${exerciseName} — ${METRICS[metric].label}`,
        data: points.map((p) => Math.round(p.value * 10) / 10),
        borderColor: '#FFC94D',
        backgroundColor: gradient,
        pointBackgroundColor: '#14132B',
        pointBorderColor: '#FFC94D',
        pointBorderWidth: 2,
        pointRadius: 4,
        pointStyle: 'rect',
        borderWidth: 2,
        tension: 0,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#9D99CF', font: monoFont }, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ticks: { color: '#9D99CF', font: monoFont }, grid: { color: 'rgba(255,255,255,0.05)' } },
      },
    },
  });
}

export function wireProgress() {
  document.getElementById('progress-exercise-select').addEventListener('change', (e) => {
    state.progressExercise = e.target.value;
    state.progressMetric = defaultMetric(e.target.value);
    renderProgressChart();
  });
  document.getElementById('progress-metric').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-metric]');
    if (!btn) return;
    state.progressMetric = btn.dataset.metric;
    renderProgressChart();
  });
}
