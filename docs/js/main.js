import { supabase } from './config.js';
import { state, onDataChanged } from './state.js';
import { computeAll } from './stats.js';
import * as db from './data.js';
import { todayStr, showToast } from './utils.js';
import { registerView, switchView, markViewsStale } from './nav.js';
import { stopRest, wireRestTimer } from './timer.js';
import { openSession, renderToday, wireToday } from './views/today.js';
import { renderHistory, wireHistory } from './views/history.js';
import { renderProgressView, wireProgress } from './views/progress.js';
import { renderProfile, wireProfile } from './views/profile.js';
import { closeSummary, wireSummary } from './views/summary.js';

// ============================================================
// DERIVED STATS
// ============================================================
function recompute() {
  state.derived = computeAll(state.sessions, state.sets, todayStr(), state.unit);
  renderLevelChip();
}

function renderLevelChip() {
  const { level } = state.derived;
  document.getElementById('level-chip-num').textContent = String(level.level);
  document.getElementById('level-chip-fill').style.width = `${Math.round(level.pct * 100)}%`;
}

onDataChanged(() => {
  recompute();
  markViewsStale();
});

// ============================================================
// SCREENS
// ============================================================
function showLoadingScreen() { document.getElementById('loading-screen').classList.remove('hidden'); }
function hideLoadingScreen() { document.getElementById('loading-screen').classList.add('hidden'); }
function showLogin() { document.getElementById('login-view').classList.remove('hidden'); }
function hideLogin() { document.getElementById('login-view').classList.add('hidden'); }
function showApp() { document.getElementById('app-view').classList.remove('hidden'); }
function hideApp() { document.getElementById('app-view').classList.add('hidden'); }
function showConfigError() {
  hideLoadingScreen();
  document.getElementById('config-error').classList.remove('hidden');
}

// ============================================================
// AUTH
// ============================================================
async function handleLoginSubmit(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  const submitBtn = document.getElementById('login-submit-btn');
  errorEl.classList.add('hidden');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Logging in…';
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  } catch (err) {
    errorEl.textContent = err.message || 'Login failed';
    errorEl.classList.remove('hidden');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Log In';
  }
}

async function handleLogout() {
  await supabase.auth.signOut();
}

async function onLoggedIn(user) {
  if (state.user && state.user.id === user.id && state.dataLoaded) return;
  state.user = user;
  hideLogin();
  showLoadingScreen();
  try {
    const { sessions, sets } = await db.loadAllData();
    state.sessions = sessions;
    state.sets = sets;
    recompute();
    const now = new Date();
    state.calendarYear = now.getFullYear();
    state.calendarMonth = now.getMonth();
    state.selectedHistoryDate = null;
    openSession(todayStr());
    state.dataLoaded = true;
    markViewsStale();
    showApp();
    renderToday();
    switchView('today');
  } catch (err) {
    console.error(err);
    showToast('Failed to load data: ' + err.message, 'error');
  } finally {
    hideLoadingScreen();
  }
}

function onLoggedOut() {
  state.user = null;
  state.dataLoaded = false;
  state.sessions = [];
  state.sets = [];
  if (state.chartInstance) {
    state.chartInstance.destroy();
    state.chartInstance = null;
  }
  stopRest();
  closeSummary();
  hideApp();
  hideLoadingScreen();
  showLogin();
  document.getElementById('login-form').reset();
}

// If the app sits open across midnight with nothing logged yet, move the Today
// view to the new day when it's brought back to the foreground.
function handleVisibilityChange() {
  if (document.visibilityState !== 'visible' || !state.dataLoaded) return;
  const sess = state.activeSession;
  if (!sess.id && sess.date !== todayStr() && state.currentView === 'today') {
    recompute();
    openSession(todayStr());
    renderToday();
  }
}

// ============================================================
// WIRING + INIT
// ============================================================
function wireStaticEvents() {
  document.getElementById('login-form').addEventListener('submit', handleLoginSubmit);
  document.getElementById('logout-btn').addEventListener('click', handleLogout);
  document.getElementById('level-chip').addEventListener('click', () => switchView('profile'));
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
  document.addEventListener('visibilitychange', handleVisibilityChange);
  wireToday();
  wireHistory();
  wireProgress();
  wireProfile();
  wireSummary();
  wireRestTimer();
}

async function init() {
  registerView('history', renderHistory);
  registerView('progress', renderProgressView);
  registerView('profile', renderProfile);
  wireStaticEvents();
  if (!supabase) {
    showConfigError();
    return;
  }
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (data.session && data.session.user) {
      await onLoggedIn(data.session.user);
    } else {
      hideLoadingScreen();
      showLogin();
    }
  } catch (err) {
    console.error(err);
    hideLoadingScreen();
    showLogin();
  }

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      onLoggedOut();
    } else if (session && session.user) {
      onLoggedIn(session.user);
    }
  });
}

init();
