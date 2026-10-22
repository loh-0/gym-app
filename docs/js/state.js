// ============================================================
// IN-MEMORY STATE
// ============================================================
const UNIT_STORAGE_KEY = 'gym-log-unit';

function loadUnit() {
  try {
    return localStorage.getItem(UNIT_STORAGE_KEY) === 'lb' ? 'lb' : 'kg';
  } catch {
    return 'kg';
  }
}

export const state = {
  user: null,
  dataLoaded: false,
  sessions: [],           // all of the user's sessions, loaded once after login
  sets: [],               // all of the user's logged sets, loaded once after login
  derived: null,          // XP, PRs, streaks, badges — see stats.js computeAll()
  activeSession: null,    // the session in the Today view: today's, or a past one being edited
  dayNumber: 1,
  extraSets: {},          // exerciseName -> number of extra "+ Add Set" rows this session
  alternativeDrafts: {},  // exerciseName -> { isAlternative, note }
  cardOverrides: {},      // exerciseName -> true/false when the user expanded/collapsed a card by hand
  lastPerformedByDay: {},
  currentView: 'today',
  calendarYear: 0,
  calendarMonth: 0,       // 0-indexed
  selectedHistoryDate: null,
  progressExercise: null,
  progressMetric: null,
  chartInstance: null,
  unit: loadUnit(),
};

export function saveUnit(unit) {
  state.unit = unit;
  try {
    localStorage.setItem(UNIT_STORAGE_KEY, unit);
  } catch {
    // Storage blocked (private mode) — the choice just won't persist.
  }
}

// Anything that changes sessions/sets calls notifyDataChanged() so derived stats
// are recomputed and the other tabs know to re-render.
const listeners = [];

export function onDataChanged(fn) {
  listeners.push(fn);
}

export function notifyDataChanged() {
  listeners.forEach((fn) => fn());
}
