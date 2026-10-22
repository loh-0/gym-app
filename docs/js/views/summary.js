import { state } from '../state.js';
import { DAY_LABELS, WEEKLY_TARGET } from '../program.js';
import { escapeHtml, formatDateLong, formatNumber, weekStartStr, ICONS } from '../utils.js';
import { sessionCompletion, sessionVolume } from '../stats.js';
import { celebrate } from '../fx.js';

// ============================================================
// WORKOUT SUMMARY — the payoff screen after "Finish workout"
// ============================================================
const TIER_LABELS = { full: 'Full session', quick: 'Quick session', partial: 'Partial session' };

// Minutes from first to last logged set, when that's plausible (back-logged
// sessions have all their sets entered in a burst, or days later).
function durationMinutes(sets) {
  if (sets.length < 2) return null;
  const times = sets.map((s) => new Date(s.created_at).getTime());
  const minutes = Math.round((Math.max(...times) - Math.min(...times)) / 60000);
  return minutes >= 5 && minutes <= 240 ? minutes : null;
}

export function formatPr(pr, unit) {
  return pr.kind === 'e1rm'
    ? `${pr.exercise}: est. 1RM ${formatNumber(pr.value, 1)} ${unit} (was ${formatNumber(pr.previous, 1)})`
    : `${pr.exercise}: ${pr.value} reps (was ${pr.previous})`;
}

export function openSummary(sessionId, { fresh = false } = {}) {
  const d = state.derived;
  const sess = d.index.sessionById[sessionId];
  if (!sess) return;
  const xp = d.xp.bySession[sessionId];
  const completion = sessionCompletion(d.index, sess);
  const prs = d.prs.bySession[sessionId] || [];
  const newBadges = d.badges.filter((b) => b.unlockedBy && b.unlockedBy.id === sessionId);
  const sets = d.index.setsBySession[sessionId];
  const volume = sessionVolume(d.index, sessionId);
  const prevSameDay = [...d.index.sessionsAsc].reverse().find((s) => s.date < sess.date && s.day_number === sess.day_number);
  const prevVolume = prevSameDay ? sessionVolume(d.index, prevSameDay.id) : 0;
  const volumeDelta = prevVolume > 0 ? Math.round((volume / prevVolume - 1) * 100) : null;
  const minutes = durationMinutes(sets);
  const weekCount = d.weeks.counts[weekStartStr(sess.date)] || 0;
  const level = d.level;

  const breakdown = [
    ['Sets logged', xp.sets],
    [completion.tier === 'full' ? 'Full session bonus' : 'Quick session bonus', xp.completion],
    [`${prs.length} PR${prs.length === 1 ? '' : 's'}`, xp.prs],
    ['Weekly quest complete', xp.weekly],
  ].filter(([, value]) => value > 0);

  const deltaHtml = volumeDelta == null
    ? '<span class="stat-sub"></span>'
    : `<span class="stat-sub ${volumeDelta >= 0 ? 'good' : ''}">${volumeDelta >= 0 ? '+' : ''}${volumeDelta}% vs last</span>`;

  document.getElementById('summary-sheet').innerHTML = `
    <span class="today-eyebrow">${escapeHtml(formatDateLong(sess.date))} · ${escapeHtml(DAY_LABELS[sess.day_number])}</span>
    <h2 class="today-title" id="summary-title">${fresh ? 'Quest complete' : 'Session summary'}</h2>
    <span class="summary-tier ${completion.tier}">${TIER_LABELS[completion.tier]}</span>
    <div class="summary-xp">+${xp.total} XP</div>
    <div class="rules-list">
      ${breakdown.map(([label, value]) => `<div class="rule-row"><span>${escapeHtml(label)}</span><strong>+${value}</strong></div>`).join('')}
    </div>
    <div class="stat-row">
      <div class="stat-card"><span class="stat-label">Sets</span><span class="stat-value">${sets.length}</span><span class="stat-sub"></span></div>
      <div class="stat-card"><span class="stat-label">Volume</span><span class="stat-value">${formatNumber(volume, 0)}</span>${deltaHtml}</div>
      <div class="stat-card"><span class="stat-label">Time</span><span class="stat-value">${minutes ? `${minutes}m` : '—'}</span><span class="stat-sub"></span></div>
    </div>
    <div class="summary-section">
      <h4>Level ${level.level} · ${escapeHtml(level.title)}</h4>
      <div class="level-bar"><div class="level-bar-fill" style="width:${Math.round(level.pct * 100)}%"></div></div>
      <div class="level-bar-label"><span>${formatNumber(level.into, 0)} / ${formatNumber(level.span, 0)} XP</span><span>Lv ${level.level + 1}</span></div>
    </div>
    <div class="summary-section">
      <h4>Weekly quest</h4>
      <div class="summary-item">${ICONS.flame}<span>${Math.min(weekCount, WEEKLY_TARGET)}/${WEEKLY_TARGET} sessions that week · streak ${d.weeks.streak} wk${d.weeks.streak === 1 ? '' : 's'}</span></div>
    </div>
    ${prs.length ? `
    <div class="summary-section">
      <h4>Personal records</h4>
      ${prs.map((pr) => `<div class="summary-item pr">${ICONS.trophy}<span>${escapeHtml(formatPr(pr, state.unit))}</span></div>`).join('')}
    </div>` : ''}
    ${newBadges.length ? `
    <div class="summary-section">
      <h4>Achievements unlocked</h4>
      ${newBadges.map((b) => `<div class="summary-item">${ICONS[b.icon]}<span><strong>${escapeHtml(b.name)}</strong> · ${escapeHtml(b.desc)}</span></div>`).join('')}
    </div>` : ''}
    <button class="btn btn-primary btn-block" data-action="close-summary">Done</button>`;

  document.getElementById('summary-modal').classList.remove('hidden');
  if (fresh && (completion.full || prs.length > 0)) celebrate();
}

export function closeSummary() {
  document.getElementById('summary-modal').classList.add('hidden');
}

export function wireSummary() {
  const modal = document.getElementById('summary-modal');
  modal.addEventListener('click', (e) => {
    if (e.target === modal || e.target.closest('[data-action="close-summary"]')) closeSummary();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSummary();
  });
}
