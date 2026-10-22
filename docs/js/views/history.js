import { state } from '../state.js';
import { PROGRAM, DAY_LABELS, WEEKLY_TARGET } from '../program.js';
import { escapeHtml, todayStr, addDays, formatDateLong, formatSet, ICONS } from '../utils.js';
import { sessionCompletion } from '../stats.js';
import { switchView } from '../nav.js';
import { openSession, renderToday } from './today.js';
import { openSummary } from './summary.js';

const HEATMAP_WEEKS = 26;
const TIER_LABELS = { full: 'Full session', quick: 'Quick session', partial: 'Partial session' };

// ============================================================
// HISTORY VIEW
// ============================================================
export function renderHistory() {
  renderHeatmap();
  renderCalendar();
  renderSessionDetail(state.selectedHistoryDate);
}

// GitHub-style grid: one column per week (Mon at top), plus a bar under each
// column showing whether that week hit the target, used a freeze, or missed.
function renderHeatmap() {
  const { index, weeks } = state.derived;
  const sessionDates = new Set(index.sessionsAsc.map((s) => s.date));
  const today = todayStr();
  const start = addDays(weeks.currentWeek, -7 * (HEATMAP_WEEKS - 1));
  let html = '';
  let metInWindow = 0;
  for (let w = 0; w < HEATMAP_WEEKS; w++) {
    const wk = addDays(start, 7 * w);
    let status = '';
    if (weeks.metWeeks.has(wk)) status = 'met';
    else if (weeks.frozenWeeks.has(wk)) status = 'frozen';
    else if (wk === weeks.currentWeek) status = 'current';
    else if (weeks.firstWeek && wk >= weeks.firstWeek) status = 'missed';
    if (status === 'met') metInWindow++;

    let cells = '';
    for (let d = 0; d < 7; d++) {
      const day = addDays(wk, d);
      const classes = ['hm-cell', sessionDates.has(day) ? 'on' : '', day > today ? 'future' : ''].filter(Boolean).join(' ');
      cells += `<div class="${classes}" title="${day}"></div>`;
    }
    html += `<div class="hm-col">${cells}<div class="hm-week ${status}"></div></div>`;
  }
  document.getElementById('heatmap').innerHTML = html;
  document.getElementById('heatmap-summary').textContent = `${metInWindow}/${HEATMAP_WEEKS} weeks at ${WEEKLY_TARGET}+ sessions`;
}

function renderCalendar() {
  const year = state.calendarYear;
  const month = state.calendarMonth;
  const label = new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  document.getElementById('cal-month-label').textContent = label;

  const sessionDates = new Set(state.derived.index.sessionsAsc.map((s) => s.date));
  const today = todayStr();
  const startOffset = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  let html = '';
  for (let i = 0; i < startOffset; i++) html += '<div class="cal-day empty"></div>';
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const hasSession = sessionDates.has(dateStr);
    const classes = [
      'cal-day',
      hasSession ? 'has-session' : '',
      dateStr === today ? 'is-today' : '',
      dateStr === state.selectedHistoryDate ? 'selected' : '',
    ].filter(Boolean).join(' ');
    // Past days without a session stay tappable so a missed log can be back-filled.
    html += dateStr <= today
      ? `<button class="${classes}" data-date="${dateStr}">${day}${hasSession ? '<span class="cal-dot"></span>' : ''}</button>`
      : `<button class="${classes}" disabled>${day}</button>`;
  }
  document.getElementById('calendar-grid').innerHTML = html;
}

function handleCalendarClick(e) {
  const btn = e.target.closest('.cal-day[data-date]');
  if (!btn) return;
  state.selectedHistoryDate = btn.dataset.date;
  renderCalendar();
  renderSessionDetail(btn.dataset.date);
}

function renderSessionDetail(dateStr) {
  const container = document.getElementById('session-detail');
  if (!dateStr) {
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }
  const { index, xp, prs } = state.derived;
  const session = index.sessionsAsc.find((s) => s.date === dateStr);
  if (!session) {
    container.innerHTML = `
      <h3>${escapeHtml(formatDateLong(dateStr))}</h3>
      <p class="muted">No workout logged.</p>
      <div class="detail-actions">
        <button class="btn btn-secondary" data-action="edit-date" data-date="${dateStr}">Log a workout for this day</button>
      </div>`;
    container.classList.remove('hidden');
    return;
  }

  const byExercise = {};
  for (const s of index.setsBySession[session.id]) {
    (byExercise[s.exercise_name] ||= []).push(s);
  }
  const exerciseOrder = PROGRAM[session.day_number].map((e) => e.name);
  const orderedNames = [
    ...exerciseOrder.filter((n) => byExercise[n]),
    ...Object.keys(byExercise).filter((n) => !exerciseOrder.includes(n)),
  ];
  const prNames = new Set((prs.bySession[session.id] || []).map((p) => p.exercise));
  const tier = sessionCompletion(index, session).tier;

  let html = `
    <h3>${escapeHtml(formatDateLong(dateStr))} — ${escapeHtml(DAY_LABELS[session.day_number])}</h3>
    <div class="detail-meta">${TIER_LABELS[tier]} · <strong>+${xp.bySession[session.id].total} XP</strong></div>`;
  for (const name of orderedNames) {
    const setsForEx = byExercise[name].slice().sort((a, b) => a.set_number - b.set_number);
    const altNote = setsForEx.find((s) => s.is_alternative && s.alternative_note);
    html += `<div class="detail-exercise">
      <div class="detail-exercise-name">${escapeHtml(name)}${prNames.has(name) ? '<span class="pr-badge">PR</span>' : ''}</div>
      <div class="detail-sets">${setsForEx.map((s) => `<span class="detail-set">${escapeHtml(formatSet(s))}</span>`).join('')}</div>
      ${altNote ? `<div class="detail-alt-note">${ICONS.note} ${escapeHtml(altNote.alternative_note)}</div>` : ''}
    </div>`;
  }
  html += `
    <div class="detail-actions">
      <button class="btn btn-secondary" data-action="summary" data-session="${session.id}">Summary</button>
      <button class="btn btn-secondary" data-action="edit-date" data-date="${dateStr}">Edit</button>
    </div>`;
  container.innerHTML = html;
  container.classList.remove('hidden');
}

function handleDetailClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  if (btn.dataset.action === 'summary') {
    openSummary(btn.dataset.session);
  } else if (btn.dataset.action === 'edit-date') {
    openSession(btn.dataset.date);
    renderToday();
    switchView('today');
    window.scrollTo(0, 0);
  }
}

export function wireHistory() {
  document.getElementById('calendar-grid').addEventListener('click', handleCalendarClick);
  document.getElementById('session-detail').addEventListener('click', handleDetailClick);
  document.getElementById('cal-prev').addEventListener('click', () => {
    state.calendarMonth -= 1;
    if (state.calendarMonth < 0) { state.calendarMonth = 11; state.calendarYear -= 1; }
    renderCalendar();
  });
  document.getElementById('cal-next').addEventListener('click', () => {
    state.calendarMonth += 1;
    if (state.calendarMonth > 11) { state.calendarMonth = 0; state.calendarYear += 1; }
    renderCalendar();
  });
}
