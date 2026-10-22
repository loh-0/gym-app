import { state, saveUnit, notifyDataChanged } from '../state.js';
import { WEEKLY_TARGET, QUICK_LIFT_COUNT } from '../program.js';
import { escapeHtml, formatDateLong, formatNumber, ICONS } from '../utils.js';
import { XP, FREEZE_EVERY_WEEKS, MAX_FREEZES, sessionVolume } from '../stats.js';
import { renderToday } from './today.js';

// ============================================================
// PROFILE VIEW — level, stats, how XP works, badges, settings
// ============================================================
export function renderProfile() {
  const { level, weeks, index, prs, badges, xp } = state.derived;
  const totalVolume = index.sessionsAsc.reduce((sum, s) => sum + sessionVolume(index, s.id), 0);
  const prCount = Object.values(prs.bySession).reduce((sum, list) => sum + list.length, 0);
  const unlockedCount = badges.filter((b) => b.unlocked).length;
  // Unlocked first (newest first), then locked by how close they are.
  const sortedBadges = [...badges].sort((a, b) => {
    if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
    if (a.unlocked) return b.unlockedBy.date.localeCompare(a.unlockedBy.date);
    const pa = a.progress ? a.progress[0] / a.progress[1] : 0;
    const pb = b.progress ? b.progress[0] / b.progress[1] : 0;
    return pb - pa;
  });

  const stat = (label, value, sub = '') => `
    <div class="stat-card"><span class="stat-label">${label}</span><span class="stat-value">${value}</span><span class="stat-sub">${sub}</span></div>`;

  const rules = [
    ['Each logged set', `+${XP.set}`],
    ['Optional movement set', `+${XP.set + XP.optionalSetBonus}`],
    [`Quick session (first ${QUICK_LIFT_COUNT} main lifts)`, `+${XP.quickSession}`],
    ['Full session (all main lifts)', `+${XP.fullSession}`],
    ['Personal record', `+${XP.pr}`],
    [`Weekly quest (${WEEKLY_TARGET} sessions Mon-Sun)`, `+${XP.weeklyQuest}`],
  ];

  document.getElementById('profile-content').innerHTML = `
    <div class="level-card">
      <div class="level-card-top">
        <div class="level-badge">${level.level}</div>
        <div>
          <div class="level-title">${escapeHtml(level.title)}</div>
          <div class="level-sub">${formatNumber(xp.total, 0)} XP total</div>
        </div>
      </div>
      <div class="level-bar"><div class="level-bar-fill" style="width:${Math.round(level.pct * 100)}%"></div></div>
      <div class="level-bar-label"><span>${formatNumber(level.into, 0)} / ${formatNumber(level.span, 0)} XP</span><span>Lv ${level.level + 1}</span></div>
    </div>
    <div class="profile-stats">
      ${stat('Workouts', index.sessionsAsc.length)}
      ${stat('Streak', `${weeks.streak} wk${weeks.streak === 1 ? '' : 's'}`, `Best ${weeks.bestStreak}`)}
      ${stat('Freezes', `${weeks.freezes}/${MAX_FREEZES}`, `<span class="stat-sub freeze">${ICONS.snowflake} 1 per ${FREEZE_EVERY_WEEKS} wks</span>`)}
      ${stat('PRs', prCount)}
      ${stat('Total volume', formatNumber(totalVolume, 0), state.unit)}
      ${stat('Badges', `${unlockedCount}/${badges.length}`)}
    </div>
    <p class="section-note" style="margin-top:var(--sp-1)">Freezes are earned every ${FREEZE_EVERY_WEEKS} weeks you hit the weekly quest and are spent automatically on a missed week, so one bad week doesn't reset your streak.</p>
    <h3 class="section-title">Badges</h3>
    <div class="badge-grid">
      ${sortedBadges.map(buildBadgeHtml).join('')}
    </div>
    <h3 class="section-title">How XP works</h3>
    <div class="rules-list">
      ${rules.map(([label, value]) => `<div class="rule-row"><span>${escapeHtml(label)}</span><strong>${value}</strong></div>`).join('')}
    </div>`;

  document.querySelectorAll('#unit-toggle button').forEach((b) => {
    b.classList.toggle('active', b.dataset.unit === state.unit);
  });
}

function buildBadgeHtml(badge) {
  let footer = '';
  if (badge.unlocked) {
    footer = `<div class="badge-date">${escapeHtml(formatDateLong(badge.unlockedBy.date))}</div>`;
  } else if (badge.progress) {
    const [cur, target] = badge.progress;
    const pct = Math.min(100, Math.round((cur / target) * 100));
    footer = `<div class="badge-progress"><div style="width:${pct}%"></div></div>`;
  }
  return `
    <div class="badge-card ${badge.unlocked ? 'unlocked' : 'locked'}">
      <div class="badge-icon">${ICONS[badge.icon]}</div>
      <div class="badge-text">
        <div class="badge-name">${escapeHtml(badge.name)}</div>
        <div class="badge-desc">${escapeHtml(badge.desc)}</div>
        ${footer}
      </div>
    </div>`;
}

export function wireProfile() {
  document.getElementById('unit-toggle').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-unit]');
    if (!btn || btn.dataset.unit === state.unit) return;
    saveUnit(btn.dataset.unit);
    notifyDataChanged();
    // Weight increments in the Today view's suggestions depend on the unit.
    renderToday();
  });
}
