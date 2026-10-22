import { PROGRAM, WEEKLY_TARGET, QUICK_LIFT_COUNT, INCREMENTS, parseRepRange } from './program.js';
import { addDays, daysBetween, formatNumber, toDateStr, weekStartStr } from './utils.js';

// ============================================================
// GAMIFICATION ENGINE
// ============================================================
// Everything here is derived from the sessions + sets tables on every change,
// never stored. That keeps the schema unchanged, makes XP retroactive for past
// workouts, and means tweaking a rule re-scores all history consistently.

export const XP = {
  set: 10,
  optionalSetBonus: 5,
  quickSession: 25,
  fullSession: 50,
  pr: 25,
  weeklyQuest: 100,
};
export const FREEZE_EVERY_WEEKS = 4;
export const MAX_FREEZES = 2;

const LB_TO_KG = 0.45359237;

const LEVEL_TITLES = [
  [1, 'Apprentice'],
  [5, 'Iron Initiate'],
  [10, 'Barbell Knight'],
  [15, 'Plate Mage'],
  [20, 'Iron Paladin'],
  [30, 'Legend'],
];

// A set counts once it has reps or weight. Old rows logged with both empty don't.
function isCounted(set) {
  return set.reps != null || set.weight != null;
}

// Epley estimated one-rep max. Only meaningful for loaded sets.
export function e1rm(weight, reps) {
  if (weight == null || reps == null || weight <= 0 || reps < 1) return null;
  return reps === 1 ? weight : weight * (1 + reps / 30);
}

export function setVolume(set) {
  return set.weight > 0 && set.reps > 0 ? set.weight * set.reps : 0;
}

// ============================================================
// INDEX
// ============================================================
// Sessions without any sets (e.g. every set was removed) don't count anywhere.
export function buildIndex(sessions, sets) {
  const setsBySession = {};
  for (const s of sets) {
    (setsBySession[s.session_id] ||= []).push(s);
  }
  const sessionsAsc = sessions
    .filter((s) => setsBySession[s.id] && setsBySession[s.id].length > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const sessionById = Object.fromEntries(sessionsAsc.map((s) => [s.id, s]));
  return { sessionsAsc, sessionById, setsBySession };
}

export function setsFor(index, sessionId, exerciseName) {
  return (index.setsBySession[sessionId] || [])
    .filter((s) => s.exercise_name === exerciseName)
    .sort((a, b) => a.set_number - b.set_number);
}

export function sessionVolume(index, sessionId) {
  return (index.setsBySession[sessionId] || []).reduce((sum, s) => sum + setVolume(s), 0);
}

// ============================================================
// SESSION COMPLETION
// ============================================================
export function sessionCompletion(index, session) {
  const program = PROGRAM[session.day_number] || [];
  const sets = (session.id && index.setsBySession[session.id]) || [];
  const isDone = (ex) => sets.filter((s) => s.exercise_name === ex.name && isCounted(s)).length >= ex.sets;
  const main = program.filter((e) => !e.optional);
  const optional = program.filter((e) => e.optional);
  const mainDone = main.map(isDone);
  const full = main.length > 0 && mainDone.every(Boolean);
  const quick = mainDone.slice(0, QUICK_LIFT_COUNT).every(Boolean);
  const allOptional = optional.length > 0 && optional.every(isDone);
  return { full, quick, allOptional, tier: full ? 'full' : quick ? 'quick' : 'partial' };
}

// ============================================================
// PERSONAL RECORDS
// ============================================================
// Walks sessions oldest-first and flags a session whose best set for an exercise
// beats every earlier session. Loaded sets compare by estimated 1RM; unloaded
// (bodyweight) sets compare by reps. An exercise's first session only sets the
// baseline, so it's never a PR. At most one PR per exercise per session.
export function computePRs(index) {
  const best = {};
  const bySession = {};
  for (const sess of index.sessionsAsc) {
    const sessionBest = {};
    for (const s of index.setsBySession[sess.id]) {
      const b = (sessionBest[s.exercise_name] ||= { e1rm: null, reps: null });
      const est = e1rm(s.weight, s.reps);
      if (est != null) b.e1rm = Math.max(b.e1rm ?? 0, est);
      else if (!(s.weight > 0) && s.reps != null) b.reps = Math.max(b.reps ?? 0, s.reps);
    }
    const prs = [];
    for (const [name, b] of Object.entries(sessionBest)) {
      const prev = best[name];
      if (prev) {
        if (b.e1rm != null && prev.e1rm != null && b.e1rm > prev.e1rm) {
          prs.push({ exercise: name, kind: 'e1rm', value: b.e1rm, previous: prev.e1rm });
        } else if (b.reps != null && prev.reps != null && b.reps > prev.reps) {
          prs.push({ exercise: name, kind: 'reps', value: b.reps, previous: prev.reps });
        }
      }
      const next = (best[name] ||= { e1rm: null, reps: null });
      if (b.e1rm != null) next.e1rm = Math.max(next.e1rm ?? 0, b.e1rm);
      if (b.reps != null) next.reps = Math.max(next.reps ?? 0, b.reps);
    }
    if (prs.length) bySession[sess.id] = prs;
  }
  return { bySession, best };
}

// ============================================================
// WEEKLY QUEST, STREAK + FREEZES
// ============================================================
// A week (Mon-Sun) is "met" at WEEKLY_TARGET sessions. The streak counts met weeks
// in a row. Every FREEZE_EVERY_WEEKS met weeks bank a freeze (max MAX_FREEZES),
// and a banked freeze is spent automatically on a missed week so one bad week
// doesn't wipe the streak. The current week is still in progress, so it can add
// to the streak but never breaks it.
export function computeWeeks(index, today) {
  const counts = {};
  const completedBy = {}; // week -> id of the session that reached the target
  for (const sess of index.sessionsAsc) {
    const wk = weekStartStr(sess.date);
    counts[wk] = (counts[wk] || 0) + 1;
    if (counts[wk] === WEEKLY_TARGET) completedBy[wk] = sess.id;
  }
  const currentWeek = weekStartStr(today);
  const result = {
    counts,
    completedBy,
    currentWeek,
    currentCount: counts[currentWeek] || 0,
    streak: 0,
    bestStreak: 0,
    freezes: 0,
    metWeeks: new Set(),
    frozenWeeks: new Set(),
    firstWeek: null,
    streakMilestones: [], // { streak, week } each time the streak grows
  };
  if (index.sessionsAsc.length === 0) return result;

  result.firstWeek = weekStartStr(index.sessionsAsc[0].date);
  let sinceEarned = 0;
  for (let wk = result.firstWeek; wk <= currentWeek; wk = addDays(wk, 7)) {
    if ((counts[wk] || 0) >= WEEKLY_TARGET) {
      result.metWeeks.add(wk);
      result.streak++;
      result.streakMilestones.push({ streak: result.streak, week: wk });
      if (++sinceEarned >= FREEZE_EVERY_WEEKS) {
        sinceEarned = 0;
        result.freezes = Math.min(MAX_FREEZES, result.freezes + 1);
      }
    } else if (wk === currentWeek) {
      // In progress — nothing lost yet.
    } else if (result.streak > 0 && result.freezes > 0) {
      result.freezes--;
      result.frozenWeeks.add(wk);
    } else {
      result.streak = 0;
      sinceEarned = 0;
    }
    result.bestStreak = Math.max(result.bestStreak, result.streak);
  }
  return result;
}

// ============================================================
// XP + LEVELS
// ============================================================
export function computeXp(index, prs, weeks) {
  const weeklyBonusSession = new Set([...weeks.metWeeks].map((wk) => weeks.completedBy[wk]));
  const bySession = {};
  let total = 0;
  for (const sess of index.sessionsAsc) {
    const program = PROGRAM[sess.day_number] || [];
    const optionalNames = new Set(program.filter((e) => e.optional).map((e) => e.name));
    const sets = index.setsBySession[sess.id]
      .filter(isCounted)
      .reduce((sum, s) => sum + XP.set + (optionalNames.has(s.exercise_name) ? XP.optionalSetBonus : 0), 0);
    const tier = sessionCompletion(index, sess).tier;
    const completion = tier === 'full' ? XP.fullSession : tier === 'quick' ? XP.quickSession : 0;
    const prXp = (prs.bySession[sess.id] || []).length * XP.pr;
    const weekly = weeklyBonusSession.has(sess.id) ? XP.weeklyQuest : 0;
    const entry = { sets, completion, prs: prXp, weekly, total: sets + completion + prXp + weekly };
    bySession[sess.id] = entry;
    total += entry.total;
  }
  return { total, bySession };
}

// Total XP needed to reach a level: 0, 150, 450, 900, 1500, ... Each level costs
// 150 XP more than the last, roughly one extra session's worth.
export function xpForLevel(level) {
  return 75 * level * (level - 1);
}

export function levelInfo(xp) {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  const base = xpForLevel(level);
  const next = xpForLevel(level + 1);
  const title = LEVEL_TITLES.filter(([min]) => level >= min).pop()[1];
  return { level, title, xp, base, next, into: xp - base, span: next - base, pct: (xp - base) / (next - base) };
}

// ============================================================
// BADGES
// ============================================================
// Each badge records the session that unlocked it (null while locked) and, while
// locked, progress toward it.
export function computeBadges(index, prs, weeks, unit) {
  const sessions = index.sessionsAsc;
  const toKg = unit === 'lb' ? LB_TO_KG : 1;
  const fromKg = (kg) => kg / toKg;
  const nth = (n) => sessions[n - 1] || null;
  const firstWhere = (pred) => sessions.find(pred) || null;

  const prSessions = sessions.flatMap((sess) => (prs.bySession[sess.id] || []).map(() => sess));
  const streakUnlock = (n) => {
    const m = weeks.streakMilestones.find((x) => x.streak >= n);
    return m ? index.sessionById[weeks.completedBy[m.week]] : null;
  };

  let cumulativeKg = 0;
  const volumeAt = sessions.map((sess) => {
    cumulativeKg += sessionVolume(index, sess.id) * toKg;
    return { sess, kg: cumulativeKg };
  });
  const volumeUnlock = (kg) => (volumeAt.find((v) => v.kg >= kg) || {}).sess || null;

  const startedAtHour = (sess) => {
    const first = new Date(Math.min(...index.setsBySession[sess.id].map((s) => new Date(s.created_at))));
    // Back-logged sessions are entered on a later day; their clock time means nothing.
    return toDateStr(first) === sess.date ? first.getHours() : null;
  };

  const sessionCountBadge = (id, name, n) => ({
    id, name, icon: 'medal', desc: `Log ${n} workouts`, unlockedBy: nth(n), progress: [sessions.length, n],
  });
  const streakBadge = (id, name, n) => ({
    id, name, icon: 'flame', desc: `Hit your weekly target ${n} weeks in a row`, unlockedBy: streakUnlock(n), progress: [weeks.bestStreak, n],
  });
  const volumeBadge = (id, name, kg, thing) => ({
    id, name, icon: 'bolt',
    desc: `Lift ${formatNumber(fromKg(kg), 0)} ${unit} in total (${thing})`,
    unlockedBy: volumeUnlock(kg),
    progress: [Math.round(fromKg(cumulativeKg)), Math.round(fromKg(kg))],
  });

  const defs = [
    { id: 'first', name: 'First Rep', icon: 'medal', desc: 'Log your first workout', unlockedBy: nth(1), progress: [sessions.length, 1] },
    sessionCountBadge('sessions-10', 'Regular', 10),
    sessionCountBadge('sessions-25', 'Committed', 25),
    sessionCountBadge('sessions-50', 'Iron Habit', 50),
    sessionCountBadge('sessions-100', 'Centurion', 100),
    streakBadge('streak-4', 'Month Strong', 4),
    streakBadge('streak-12', 'Quarter Beast', 12),
    streakBadge('streak-26', 'Half-Year Hero', 26),
    { id: 'pr-1', name: 'Personal Best', icon: 'trophy', desc: 'Set your first PR', unlockedBy: prSessions[0] || null, progress: [prSessions.length, 1] },
    { id: 'pr-10', name: 'PR Hunter', icon: 'trophy', desc: 'Set 10 PRs', unlockedBy: prSessions[9] || null, progress: [prSessions.length, 10] },
    {
      id: 'full-send', name: 'Full Send', icon: 'flame', desc: 'Finish every main lift and every optional movement in one session',
      unlockedBy: firstWhere((sess) => {
        const c = sessionCompletion(index, sess);
        return c.full && c.allOptional;
      }),
    },
    {
      id: 'bar-master', name: 'Bar Master', icon: 'target', desc: '3 sets of 8+ pull-ups in one session',
      unlockedBy: firstWhere((sess) => setsFor(index, sess.id, 'Pull-ups').filter((s) => s.reps >= 8).length >= 3),
    },
    {
      id: 'comeback', name: 'Comeback', icon: 'bolt', desc: 'Return after 2+ weeks away',
      unlockedBy: sessions.find((sess, i) => i > 0 && daysBetween(sessions[i - 1].date, sess.date) >= 14) || null,
    },
    {
      id: 'early-bird', name: 'Early Bird', icon: 'target', desc: 'Start a workout before 8am',
      unlockedBy: firstWhere((sess) => { const h = startedAtHour(sess); return h != null && h < 8; }),
    },
    {
      id: 'night-owl', name: 'Night Owl', icon: 'target', desc: 'Start a workout after 9pm',
      unlockedBy: firstWhere((sess) => { const h = startedAtHour(sess); return h != null && h >= 21; }),
    },
    volumeBadge('volume-elephant', 'Elephant', 6000, 'an elephant'),
    volumeBadge('volume-whale', 'Blue Whale', 150000, 'a blue whale'),
    volumeBadge('volume-shuttle', 'Liftoff', 2000000, 'a space shuttle'),
  ];
  return defs.map((d) => ({ ...d, unlocked: !!d.unlockedBy }));
}

// ============================================================
// PROGRESSION (double progression)
// ============================================================
// Once every working set reaches the top of the rep range, add weight and drop
// back to the bottom of the range. Otherwise keep the weight and add a rep.
// "To failure" work just tries to beat last time.
export function suggestProgression(ex, priorSets, unit) {
  if (!priorSets || priorSets.length === 0) return null;
  const range = parseRepRange(ex.repTarget);
  const working = priorSets.filter((s) => s.set_number <= ex.sets);
  const loaded = working.some((s) => s.weight > 0);
  const toppedOut = !!range && working.length >= ex.sets && working.every((s) => s.reps != null && s.reps >= range.max);
  const increment = (INCREMENTS[unit] || INCREMENTS.kg)[ex.equipment];
  const bump = toppedOut && loaded && increment ? increment : 0;

  function forSet(setNumber) {
    const prior = priorSets.find((s) => s.set_number === setNumber) || priorSets[priorSets.length - 1];
    const weight = prior.weight == null ? null : prior.weight + (prior.weight > 0 ? bump : 0);
    let reps = null;
    if (prior.reps != null) {
      if (!range) reps = prior.reps + 1;
      else if (bump) reps = range.min;
      else reps = Math.min(range.max, Math.max(range.min, prior.reps + 1));
    }
    return { weight, reps, prior: priorSets.find((s) => s.set_number === setNumber) || null };
  }

  let tip;
  if (!range) tip = 'Beat last time by a rep';
  else if (bump) tip = `Top of range on every set last time: +${formatNumber(bump)} ${unit}`;
  else if (toppedOut) tip = 'Top of range on every set: add load or slow the lowering';
  else tip = `Same weight, chase ${range.max} reps on every set`;
  return { tip, bumped: bump > 0, forSet };
}

// ============================================================
// ENTRY POINT
// ============================================================
export function computeAll(sessions, sets, today, unit) {
  const index = buildIndex(sessions, sets);
  const prs = computePRs(index);
  const weeks = computeWeeks(index, today);
  const xp = computeXp(index, prs, weeks);
  return {
    index,
    prs,
    weeks,
    xp,
    level: levelInfo(xp.total),
    badges: computeBadges(index, prs, weeks, unit),
  };
}
