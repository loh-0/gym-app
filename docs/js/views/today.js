import { state, notifyDataChanged } from '../state.js';
import { PROGRAM, ACTIVE_DAYS, DAY_LABELS, WEEKLY_TARGET, QUICK_LIFT_COUNT, findExerciseInProgram } from '../program.js';
import {
  escapeHtml, todayStr, formatDateLong, formatDateShort, formatRest, formatNumber, formatSet,
  formatWeekday, daysBetween, isoWeekNumber, weekStartStr, showToast, ICONS,
} from '../utils.js';
import { XP, setsFor, sessionCompletion, suggestProgression } from '../stats.js';
import * as db from '../data.js';
import { startRest, stopRest, primeAudio } from '../timer.js';
import { celebrate, floatXp } from '../fx.js';
import { openSummary, formatPr } from './summary.js';

// Each card is 'done', 'focus' (the next thing to do), 'next' (a later main
// lift) or 'optional'. Kept from the last render so we only re-render the list
// when one of them changes.
let cardStates = {};

// ============================================================
// ACTIVE SESSION
// ============================================================
// Opens a date in the Today view: today by default, or a past date picked in
// History to back-fill or fix. An unlogged date gets a suggested day that
// alternates from the last session before it.
export function openSession(dateStr) {
  const existing = state.sessions.find((s) => s.date === dateStr);
  if (existing) {
    state.activeSession = existing;
  } else {
    const before = state.derived.index.sessionsAsc.filter((s) => s.date < dateStr);
    const last = before[before.length - 1];
    // Alternate 1 -> 2 -> 1. A legacy Day 3 as the last session rolls over to Day 1.
    const dayNumber = !last ? 1 : (last.day_number === 1 ? 2 : 1);
    state.activeSession = { id: null, date: dateStr, day_number: dayNumber, user_id: state.user.id };
  }
  state.dayNumber = state.activeSession.day_number;
  state.cardOverrides = {};
  computeLastPerformedByDay();
  computeExtraSetsFromExisting();
}

// For each day, the most recent date it was performed (excluding the session
// being edited), so the day-picker can show it.
function computeLastPerformedByDay() {
  const result = {};
  for (const sess of state.derived.index.sessionsAsc) {
    if (sess.id === state.activeSession.id) continue;
    result[sess.day_number] = sess.date;
  }
  state.lastPerformedByDay = result;
}

// Restore "+ Add Set" counts and alternative-note drafts when resuming a
// partially-logged session (e.g. after a page reload).
function computeExtraSetsFromExisting() {
  state.extraSets = {};
  state.alternativeDrafts = {};
  if (!state.activeSession.id) return;
  const sessionSets = state.sets.filter((s) => s.session_id === state.activeSession.id);
  for (const ex of PROGRAM[state.dayNumber]) {
    const logged = sessionSets.filter((s) => s.exercise_name === ex.name);
    if (logged.length === 0) continue;
    const maxSetNum = Math.max(...logged.map((s) => s.set_number));
    if (maxSetNum > ex.sets) {
      state.extraSets[ex.name] = maxSetNum - ex.sets;
    }
    const altSet = logged.find((s) => s.is_alternative);
    if (altSet) {
      state.alternativeDrafts[ex.name] = { isAlternative: true, note: altSet.alternative_note || '' };
    }
  }
}

function getLoggedSet(exerciseName, setNumber) {
  if (!state.activeSession.id) return null;
  return state.sets.find(
    (s) => s.session_id === state.activeSession.id && s.exercise_name === exerciseName && s.set_number === setNumber
  ) || null;
}

function getLoggedSets(exerciseName) {
  if (!state.activeSession.id) return [];
  return state.sets
    .filter((s) => s.session_id === state.activeSession.id && s.exercise_name === exerciseName)
    .sort((a, b) => a.set_number - b.set_number);
}

// Sets from the most recent earlier session that included this exercise, on
// either day — Barbell Row progress carries across both.
function getPriorSets(exerciseName) {
  const sessions = state.derived.index.sessionsAsc;
  for (let i = sessions.length - 1; i >= 0; i--) {
    if (sessions[i].date >= state.activeSession.date) continue;
    const sets = setsFor(state.derived.index, sessions[i].id, exerciseName);
    if (sets.length > 0) return sets;
  }
  return null;
}

function getSuggestion(ex) {
  return suggestProgression(ex, getPriorSets(ex.name), state.unit);
}

async function ensureActiveSessionPersisted() {
  if (state.activeSession.id) return state.activeSession;
  const data = await db.upsertSession(state.user.id, state.activeSession.date, state.activeSession.day_number);
  state.activeSession = data;
  if (!state.sessions.some((s) => s.id === data.id)) state.sessions.push(data);
  return data;
}

// Let the user override which day they want to do, instead of being locked to
// the auto-detected suggestion.
async function selectDay(dayNumber) {
  if (dayNumber === state.dayNumber) return;
  state.dayNumber = dayNumber;
  state.activeSession.day_number = dayNumber;
  state.cardOverrides = {};
  computeExtraSetsFromExisting();

  if (state.activeSession.id) {
    try {
      await db.updateSessionDay(state.activeSession.id, dayNumber);
    } catch (err) {
      console.error(err);
      showToast('Failed to switch day: ' + err.message, 'error');
    }
    notifyDataChanged();
  }
  renderToday();
}

// ============================================================
// CARD STATES
// ============================================================
function isExerciseDone(ex) {
  return getLoggedSets(ex.name).filter((s) => s.reps != null || s.weight != null).length >= ex.sets;
}

// The first unfinished main lift is the focus. Once every main lift is done,
// the first unfinished optional movement takes over.
function computeCardStates() {
  const result = {};
  let focusName = null;
  for (const ex of PROGRAM[state.dayNumber]) {
    if (isExerciseDone(ex)) {
      result[ex.name] = 'done';
    } else if (!ex.optional && !focusName) {
      result[ex.name] = 'focus';
      focusName = ex.name;
    } else {
      result[ex.name] = ex.optional ? 'optional' : 'next';
    }
  }
  if (!focusName) {
    const firstOptional = PROGRAM[state.dayNumber].find((ex) => result[ex.name] === 'optional');
    if (firstOptional) result[firstOptional.name] = 'focus';
  }
  return result;
}

function isExpanded(ex, cardState) {
  const override = state.cardOverrides[ex.name];
  return override !== undefined ? override : cardState === 'focus';
}

// Re-render the list only when a card changed state (an exercise finished or
// the focus moved), so numbers typed but not yet logged elsewhere survive.
function refreshCardsIfStateChanged(changedExercise) {
  const next = computeCardStates();
  if (Object.keys(next).every((name) => next[name] === cardStates[name])) return;
  if (next[changedExercise] === 'done' && cardStates[changedExercise] !== 'done') {
    delete state.cardOverrides[changedExercise];
  }
  renderExerciseList();
}

// ============================================================
// RENDERING
// ============================================================
export function renderToday() {
  const sess = state.activeSession;
  const isToday = sess.date === todayStr();
  document.getElementById('edit-banner').classList.toggle('hidden', isToday);
  document.getElementById('edit-banner-date').textContent = formatDateLong(sess.date);
  document.getElementById('today-day-label').textContent = `Day ${state.dayNumber} · ${DAY_LABELS[state.dayNumber]}`;
  document.getElementById('today-date-label').textContent = formatDateLong(sess.date);
  document.getElementById('finish-btn').textContent = isToday ? 'Complete quest' : 'View session summary';
  renderDayPicker();
  renderExerciseList();
  updateProgressUi();
}

function renderExerciseList() {
  cardStates = computeCardStates();
  const program = PROGRAM[state.dayNumber];
  const main = program.filter((e) => !e.optional);
  const optional = program.filter((e) => e.optional);
  document.getElementById('exercise-list').innerHTML =
    main.map((ex, i) => buildExerciseCardHtml(ex, cardStates[ex.name], `Step ${i + 1}/${main.length}`)).join('') +
    (optional.length
      ? `<div class="optional-label"><span>Side quests</span><span>+${XP.set + XP.optionalSetBonus} XP per set</span></div>`
      : '') +
    optional.map((ex) => buildExerciseCardHtml(ex, cardStates[ex.name], 'Side quest')).join('');
  updatePrBadges();
}

// Everything on the Today view that depends on derived stats, without touching
// the set inputs.
export function updateProgressUi() {
  updateHero();
  updateSessionProgress();
  updateSessionStatus();
  updatePrBadges();
  document.getElementById('finish-btn').disabled = !state.activeSession.id;
}

function formatLastWorkoutLabel(days) {
  if (days == null) return 'No workouts yet';
  if (days === 0) return 'Last: today';
  return `Last: ${days}d ago`;
}

function updateHero() {
  const { level, weeks, index } = state.derived;
  document.getElementById('hero-level').textContent = String(level.level);
  document.getElementById('hero-title').textContent = level.title;
  document.getElementById('hero-xp-fill').style.width = `${Math.round(level.pct * 100)}%`;
  document.getElementById('hero-xp-into').textContent = formatNumber(level.into, 0);
  document.getElementById('hero-xp-span').textContent = formatNumber(level.span, 0);

  const met = weeks.currentCount >= WEEKLY_TARGET;
  document.getElementById('quest-title').textContent = `Quest · Week ${isoWeekNumber(todayStr())}`;
  const reward = document.getElementById('quest-reward');
  reward.textContent = met ? `Complete · +${XP.weeklyQuest} XP` : `Reward ${XP.weeklyQuest} XP`;
  reward.classList.toggle('complete', met);

  const thisWeek = index.sessionsAsc.filter((s) => weekStartStr(s.date) === weeks.currentWeek);
  const taskCount = Math.max(WEEKLY_TARGET, thisWeek.length);
  document.getElementById('quest-tasks').innerHTML = Array.from({ length: taskCount }, (_, i) => {
    const sess = thisWeek[i];
    if (sess) {
      return `<div class="quest-task done"><span class="quest-check">${ICONS.check}</span><span>Session ${i + 1} · ${escapeHtml(formatWeekday(sess.date))} · ${escapeHtml(DAY_LABELS[sess.day_number])}</span></div>`;
    }
    const isLastNeeded = i === WEEKLY_TARGET - 1;
    return `<div class="quest-task"><span class="quest-check"></span><span>Session ${i + 1}</span>${isLastNeeded ? `<em>+${XP.weeklyQuest} XP</em>` : ''}</div>`;
  }).join('');

  document.getElementById('stat-streak').textContent = `${weeks.streak} wk${weeks.streak === 1 ? '' : 's'}`;
  document.getElementById('stat-freezes').textContent = weeks.freezes > 0
    ? `${weeks.freezes} freeze${weeks.freezes === 1 ? '' : 's'}`
    : '';
  const last = index.sessionsAsc[index.sessionsAsc.length - 1];
  document.getElementById('stat-last').textContent = formatLastWorkoutLabel(last ? daysBetween(last.date, todayStr()) : null);
}

function updateSessionStatus() {
  const el = document.getElementById('session-status');
  const main = PROGRAM[state.dayNumber].filter((e) => !e.optional);
  const completion = sessionCompletion(state.derived.index, state.activeSession);
  const hasQuickOption = main.length > QUICK_LIFT_COUNT;
  el.classList.toggle('good', completion.quick);
  if (completion.full) {
    el.textContent = 'All main lifts done. Side quests earn bonus XP.';
  } else if (completion.quick && hasQuickOption) {
    el.textContent = 'Quick session done. Finish now, or keep going for the full-session bonus.';
  } else if (hasQuickOption) {
    el.textContent = `Short on time? Stopping after ${main[QUICK_LIFT_COUNT - 1].name} still counts as a quick session.`;
  } else {
    el.textContent = '';
  }
}

function updatePrBadges() {
  const prNames = new Set((state.derived.prs.bySession[state.activeSession.id] || []).map((p) => p.exercise));
  document.querySelectorAll('#exercise-list .exercise-card').forEach((card) => {
    card.querySelector('.pr-badge').classList.toggle('hidden', !prNames.has(card.dataset.exerciseCard));
  });
}

function renderDayPicker() {
  const days = ACTIVE_DAYS.includes(state.dayNumber) ? ACTIVE_DAYS : [...ACTIVE_DAYS, state.dayNumber];
  document.getElementById('day-picker').innerHTML = days.map((n) => {
    const isSelected = n === state.dayNumber;
    const lastDate = state.lastPerformedByDay[n];
    const lastLabel = lastDate ? formatDateShort(lastDate) : 'Not yet';
    return `
      <button class="day-option ${isSelected ? 'selected' : ''}" data-action="select-day" data-day="${n}">
        <span class="day-option-number">Day ${n}</span>
        <span class="day-option-label">${escapeHtml(DAY_LABELS[n])}</span>
        <span class="day-option-last">Last: ${escapeHtml(lastLabel)}</span>
      </button>`;
  }).join('');
}

// Main-lift sets logged vs prescribed, one segment per set. Extra sets beyond
// the prescription don't count.
function updateSessionProgress() {
  const mandatory = PROGRAM[state.dayNumber].filter((e) => !e.optional);
  const total = mandatory.reduce((sum, e) => sum + e.sets, 0);
  const logged = mandatory.reduce((sum, ex) => sum + Math.min(ex.sets, getLoggedSets(ex.name).length), 0);
  document.getElementById('ring-value').textContent = `${logged}/${total}`;
  document.getElementById('session-progress').innerHTML = Array.from({ length: total }, (_, i) => `<i class="${i < logged ? 'on' : ''}"></i>`).join('');
}

function doneSummary(ex) {
  const sets = getLoggedSets(ex.name);
  const weights = new Set(sets.map((s) => s.weight));
  const reps = sets.map((s) => s.reps ?? '–').join(', ');
  if (weights.size === 1 && sets[0].weight > 0) return `${sets.length} × ${formatNumber(sets[0].weight)} ${state.unit} · ${reps} reps`;
  if (weights.size === 1) return `${sets.length} sets · ${reps} reps`;
  return sets.map(formatSet).join(', ');
}

function buildExerciseCardHtml(ex, cardState, stepLabel) {
  const expanded = isExpanded(ex, cardState);
  const suggestion = getSuggestion(ex);
  const totalSets = ex.sets + (state.extraSets[ex.name] || 0);
  const setsHtml = Array.from({ length: totalSets }, (_, i) => buildSetRowHtml(ex, i + 1, suggestion)).join('');
  const draft = state.alternativeDrafts[ex.name];
  const hasAlt = !!(draft && draft.isAlternative);
  const repLabel = ex.repTarget === 'To failure' ? ex.repTarget : `${ex.repTarget} reps`;
  const tipHtml = suggestion
    ? `<div class="exercise-tip ${suggestion.bumped ? 'bump' : ''}">${suggestion.bumped ? ICONS.arrowUp : ICONS.target}<span>${escapeHtml(suggestion.tip)}</span></div>`
    : '';

  return `
    <div class="exercise-card ${ex.optional ? 'optional' : 'mandatory'} is-${cardState} ${expanded ? '' : 'collapsed'}" data-exercise-card="${escapeHtml(ex.name)}">
      <div class="exercise-header" data-action="toggle-collapse">
        <div class="exercise-title-row">
          <span class="ex-tick">${ICONS.check}</span>
          <h3>${escapeHtml(ex.name)}</h3>
          <span class="step-label">${escapeHtml(stepLabel)}</span>
          <span class="pr-badge hidden">PR</span>
        </div>
        <div class="exercise-summary">${cardState === 'done' ? escapeHtml(doneSummary(ex)) : ''}</div>
        <div class="exercise-meta">
          <span class="meta-pill"><strong>${ex.sets} × ${escapeHtml(repLabel)}</strong></span>
          <span class="meta-pill">${formatRest(ex.restSeconds)}</span>
        </div>
        ${tipHtml}
        <span class="collapse-toggle">${expanded ? '▾' : '▸'}</span>
      </div>
      <div class="exercise-body">
        <div class="sets-table">${setsHtml}</div>
        <button class="btn-add-set" data-action="add-set">+ Add Set</button>
        <div class="alternative-block">
          <button class="btn-alt-toggle ${hasAlt ? 'hidden' : ''}" data-action="alt-toggle">Used an alternative?</button>
          <div class="alt-summary ${hasAlt ? '' : 'hidden'}">${ICONS.note} Alternative: <span class="alt-note-text">${escapeHtml((draft && draft.note) || '')}</span> <button class="btn-alt-edit" data-action="alt-toggle">Edit</button> <button class="btn-alt-edit" data-action="alt-clear">Clear</button></div>
          <div class="alt-form hidden">
            <input type="text" class="alt-input" placeholder="What did you do instead?" value="${escapeHtml((draft && draft.note) || '')}">
            <button class="btn-alt-save" data-action="alt-save">Save</button>
            <button class="btn-alt-cancel" data-action="alt-cancel">Cancel</button>
          </div>
        </div>
      </div>
    </div>`;
}

// Suggested weight/reps show as dim placeholders, so they never look like
// numbers you actually typed. Tapping log with a field empty accepts the
// suggestion for it.
function buildSetRowHtml(ex, setNumber, suggestion) {
  const logged = getLoggedSet(ex.name, setNumber);
  const s = suggestion ? suggestion.forSet(setNumber) : { weight: null, reps: null, prior: null };
  const weightValue = logged && logged.weight != null ? logged.weight : '';
  const repsValue = logged && logged.reps != null ? logged.reps : '';
  const weightPlaceholder = s.weight != null ? formatNumber(s.weight) : (ex.equipment === 'bodyweight' ? 'BW' : 'Weight');
  const repsPlaceholder = s.reps != null ? String(s.reps) : 'Reps';
  const hint = s.prior ? `<span class="set-hint">prev<span>${escapeHtml(formatSet(s.prior))}</span></span>` : '';
  const suggestAttrs = (s.weight != null ? ` data-suggest-weight="${s.weight}"` : '') + (s.reps != null ? ` data-suggest-reps="${s.reps}"` : '');
  return `
    <div class="set-row ${logged ? 'logged' : ''}"${suggestAttrs}>
      <span class="set-label">S${setNumber}</span>
      <div class="set-inputs">
        <input type="number" step="any" inputmode="decimal" class="input-weight" placeholder="${escapeHtml(weightPlaceholder)}" value="${weightValue}" aria-label="Set ${setNumber} weight">
        <input type="number" inputmode="numeric" class="input-reps" placeholder="${escapeHtml(repsPlaceholder)}" value="${repsValue}" aria-label="Set ${setNumber} reps">
      </div>
      ${hint}
      <button class="btn-log" data-action="log-set" data-set="${setNumber}" title="${logged ? 'Logged (tap to remove)' : 'Log set'}" aria-label="${logged ? 'Remove' : 'Log'} set ${setNumber}">${ICONS.check}</button>
    </div>`;
}

// ============================================================
// INTERACTIONS
// ============================================================
function handleExerciseListClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const card = btn.closest('.exercise-card');
  if (!card) return;
  const exerciseName = card.dataset.exerciseCard;
  switch (btn.dataset.action) {
    case 'log-set':
      handleLogSet(exerciseName, Number(btn.dataset.set), btn);
      break;
    case 'add-set':
      handleAddSet(exerciseName, card);
      break;
    case 'toggle-collapse':
      toggleCollapse(card, exerciseName);
      break;
    case 'alt-toggle':
      toggleAlternativeForm(card);
      break;
    case 'alt-save':
      handleSaveAlternative(exerciseName, card);
      break;
    case 'alt-cancel':
      cancelAlternativeForm(card, exerciseName);
      break;
    case 'alt-clear':
      handleClearAlternative(exerciseName, card);
      break;
  }
}

// Editing a logged row marks it dirty, so its button saves the change instead
// of removing the set.
function handleExerciseListInput(e) {
  const row = e.target.closest('.set-row.logged');
  if (!row || row.classList.contains('dirty')) return;
  row.classList.add('dirty');
  const btn = row.querySelector('.btn-log');
  btn.innerHTML = ICONS.save;
  btn.title = 'Save changes';
}

function readNumber(input, fallback) {
  if (input.value !== '') return Number(input.value);
  return fallback != null ? Number(fallback) : null;
}

function snapshot() {
  const d = state.derived;
  return {
    xp: d.xp.total,
    level: d.level.level,
    prs: new Set((d.prs.bySession[state.activeSession.id] || []).map((p) => p.exercise)),
    badges: new Set(d.badges.filter((b) => b.unlocked).map((b) => b.id)),
    weekMet: d.weeks.metWeeks.has(weekStartStr(state.activeSession.date)),
  };
}

function announceGains(before) {
  const d = state.derived;
  const after = snapshot();
  let party = false;
  for (const pr of d.prs.bySession[state.activeSession.id] || []) {
    if (before.prs.has(pr.exercise)) continue;
    showToast(`New PR · ${formatPr(pr, state.unit)}`, 'win');
    party = true;
  }
  if (!before.weekMet && after.weekMet) {
    showToast(`Quest complete · +${XP.weeklyQuest} XP`, 'win');
    party = true;
  }
  for (const badge of d.badges) {
    if (!badge.unlocked || before.badges.has(badge.id)) continue;
    showToast(`Achievement unlocked · ${badge.name}`, 'win');
    party = true;
  }
  if (after.level > before.level) {
    showToast(`Level up · Lv ${after.level} ${d.level.title}`, 'level');
    party = true;
  }
  if (party) celebrate();
  return after;
}

async function handleLogSet(exerciseName, setNumber, buttonEl) {
  const row = buttonEl.closest('.set-row');
  const logged = getLoggedSet(exerciseName, setNumber);
  if (logged && !row.classList.contains('dirty')) {
    handleRemoveSet(logged, row, buttonEl);
    return;
  }

  const weightInput = row.querySelector('.input-weight');
  const repsInput = row.querySelector('.input-reps');
  const weight = readNumber(weightInput, row.dataset.suggestWeight);
  const reps = readNumber(repsInput, row.dataset.suggestReps);
  if (reps == null) {
    showToast('Enter reps first', 'error');
    repsInput.focus();
    return;
  }

  primeAudio();
  buttonEl.disabled = true;
  const before = snapshot();
  try {
    const session = await ensureActiveSessionPersisted();
    const draft = state.alternativeDrafts[exerciseName];
    const data = await db.upsertSet({
      session_id: session.id,
      exercise_name: exerciseName,
      set_number: setNumber,
      reps,
      weight,
      is_alternative: !!(draft && draft.isAlternative),
      alternative_note: (draft && draft.note) || null,
    });
    const idx = state.sets.findIndex(
      (s) => s.session_id === data.session_id && s.exercise_name === data.exercise_name && s.set_number === data.set_number
    );
    if (idx >= 0) state.sets[idx] = data; else state.sets.push(data);

    weightInput.value = data.weight ?? '';
    repsInput.value = data.reps ?? '';
    row.classList.add('logged');
    row.classList.remove('dirty');
    buttonEl.innerHTML = ICONS.check;
    buttonEl.title = 'Logged (tap to remove)';
    buttonEl.classList.remove('pop');
    void buttonEl.offsetWidth; // restart the animation on a re-log
    buttonEl.classList.add('pop');

    notifyDataChanged();
    const after = announceGains(before);
    // Float before any re-render detaches the button.
    floatXp(buttonEl, after.xp - before.xp);
    refreshCardsIfStateChanged(exerciseName);
    updateProgressUi();
    if (!logged) {
      const ex = findExerciseInProgram(state.dayNumber, exerciseName);
      if (ex && state.activeSession.date === todayStr()) startRest(ex.restSeconds, exerciseName);
    } else {
      showToast(`Updated ${exerciseName} set ${setNumber}`);
    }
  } catch (err) {
    console.error(err);
    showToast('Failed to save set: ' + err.message, 'error');
  } finally {
    buttonEl.disabled = false;
  }
}

// Removing the last set of a session removes the session too, so an empty
// session never counts toward the weekly quest.
async function handleRemoveSet(logged, row, buttonEl) {
  if (!confirm(`Remove ${logged.exercise_name} set ${logged.set_number}?`)) return;
  buttonEl.disabled = true;
  try {
    await db.deleteSet(logged.id);
    state.sets = state.sets.filter((s) => s.id !== logged.id);
    const sessionId = state.activeSession.id;
    if (!state.sets.some((s) => s.session_id === sessionId)) {
      await db.deleteSession(sessionId);
      state.sessions = state.sessions.filter((s) => s.id !== sessionId);
      state.activeSession = { id: null, date: state.activeSession.date, day_number: state.dayNumber, user_id: state.user.id };
    }
    notifyDataChanged();
    const ex = findExerciseInProgram(state.dayNumber, logged.exercise_name);
    row.outerHTML = buildSetRowHtml(ex, logged.set_number, getSuggestion(ex));
    refreshCardsIfStateChanged(logged.exercise_name);
    updateProgressUi();
    showToast('Set removed');
  } catch (err) {
    console.error(err);
    showToast('Failed to remove set: ' + err.message, 'error');
    buttonEl.disabled = false;
  }
}

function handleAddSet(exerciseName, card) {
  const table = card.querySelector('.sets-table');
  const newSetNumber = table.querySelectorAll('.set-row').length + 1;
  state.extraSets[exerciseName] = (state.extraSets[exerciseName] || 0) + 1;
  const ex = findExerciseInProgram(state.dayNumber, exerciseName);
  table.insertAdjacentHTML('beforeend', buildSetRowHtml(ex, newSetNumber, getSuggestion(ex)));
}

function toggleCollapse(card, exerciseName) {
  const collapsed = card.classList.toggle('collapsed');
  state.cardOverrides[exerciseName] = !collapsed;
  card.querySelector('.collapse-toggle').textContent = collapsed ? '▸' : '▾';
}

function toggleAlternativeForm(card) {
  card.querySelector('.btn-alt-toggle').classList.add('hidden');
  card.querySelector('.alt-summary').classList.add('hidden');
  const form = card.querySelector('.alt-form');
  form.classList.remove('hidden');
  form.querySelector('.alt-input').focus();
}

function cancelAlternativeForm(card, exerciseName) {
  const draft = state.alternativeDrafts[exerciseName];
  const hasAlt = !!(draft && draft.isAlternative);
  card.querySelector('.alt-form').classList.add('hidden');
  card.querySelector('.btn-alt-toggle').classList.toggle('hidden', hasAlt);
  card.querySelector('.alt-summary').classList.toggle('hidden', !hasAlt);
}

async function persistAlternative(exerciseName, isAlternative, note) {
  if (!state.activeSession.id) return;
  const data = await db.updateAlternative(state.activeSession.id, exerciseName, isAlternative, note);
  data.forEach((updated) => {
    const idx = state.sets.findIndex((s) => s.id === updated.id);
    if (idx >= 0) state.sets[idx] = updated;
  });
  notifyDataChanged();
}

async function handleSaveAlternative(exerciseName, card) {
  const note = card.querySelector('.alt-input').value.trim();
  const saveBtn = card.querySelector('.btn-alt-save');
  saveBtn.disabled = true;
  try {
    state.alternativeDrafts[exerciseName] = { isAlternative: true, note };
    await persistAlternative(exerciseName, true, note);
    card.querySelector('.alt-form').classList.add('hidden');
    card.querySelector('.btn-alt-toggle').classList.add('hidden');
    const summary = card.querySelector('.alt-summary');
    summary.classList.remove('hidden');
    summary.querySelector('.alt-note-text').textContent = note;
    showToast('Alternative noted');
  } catch (err) {
    console.error(err);
    showToast('Failed to save alternative: ' + err.message, 'error');
  } finally {
    saveBtn.disabled = false;
  }
}

async function handleClearAlternative(exerciseName, card) {
  try {
    delete state.alternativeDrafts[exerciseName];
    await persistAlternative(exerciseName, false, null);
    card.querySelector('.alt-input').value = '';
    cancelAlternativeForm(card, exerciseName);
    showToast('Alternative cleared');
  } catch (err) {
    console.error(err);
    showToast('Failed to clear alternative: ' + err.message, 'error');
  }
}

function handleFinish() {
  if (!state.activeSession.id) return;
  stopRest();
  openSummary(state.activeSession.id, { fresh: state.activeSession.date === todayStr() });
}

export function wireToday() {
  document.getElementById('day-picker').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="select-day"]');
    if (btn) selectDay(Number(btn.dataset.day));
  });
  const list = document.getElementById('exercise-list');
  list.addEventListener('click', handleExerciseListClick);
  list.addEventListener('input', handleExerciseListInput);
  document.getElementById('finish-btn').addEventListener('click', handleFinish);
  document.getElementById('back-to-today').addEventListener('click', () => {
    openSession(todayStr());
    renderToday();
    window.scrollTo(0, 0);
  });
}
