// ============================================================
// PROGRAM DATA
// ============================================================
// The program is 2 days/week. Day 3 stays defined only so sessions logged under
// the old 3-day rotation still render in History and Progress.
//
// Exercise names are the key that links logged sets across sessions, so renaming
// one here splits its history in two.
export const ACTIVE_DAYS = [1, 2];
export const LEGACY_DAYS = [3];
export const WEEKLY_TARGET = ACTIVE_DAYS.length;

// A "quick session" is every set of the first QUICK_LIFT_COUNT main lifts. The
// program allows stopping after the presses on a short day, and that still keeps
// the streak alive.
export const QUICK_LIFT_COUNT = 3;

// Weight added when progression says to go up. Bodyweight work progresses by reps.
export const INCREMENTS = {
  kg: { barbell: 2.5, dumbbell: 2 },
  lb: { barbell: 5, dumbbell: 5 },
};

export const DAY_LABELS = {
  1: 'Deadlift & Pull',
  2: 'Squat & Row',
  3: 'Split Squat & Press',
};

export const PROGRAM = {
  1: [
    { name: 'Trap Bar Deadlift', sets: 3, repTarget: '4-6', restSeconds: 120, optional: false, equipment: 'barbell' },
    { name: 'Pull-ups', sets: 3, repTarget: '6-8', restSeconds: 120, optional: false, equipment: 'bodyweight' },
    { name: 'Low Incline DB Press', sets: 3, repTarget: '8-10', restSeconds: 120, optional: false, equipment: 'dumbbell' },
    { name: 'Barbell Row', sets: 3, repTarget: '8-10', restSeconds: 120, optional: false, equipment: 'barbell' },
    { name: 'Incline Bicep Curls', sets: 3, repTarget: '10-12', restSeconds: 60, optional: true, equipment: 'dumbbell' },
    { name: 'Toes to Bar', sets: 2, repTarget: 'To failure', restSeconds: 90, optional: true, equipment: 'bodyweight' },
    { name: 'Lu Lateral Raises', sets: 2, repTarget: '10-12', restSeconds: 90, optional: true, equipment: 'dumbbell' },
  ],
  2: [
    { name: 'Zercher Squat', sets: 5, repTarget: '6-8', restSeconds: 120, optional: false, equipment: 'barbell' },
    { name: 'Barbell Row', sets: 3, repTarget: '8-10', restSeconds: 120, optional: false, equipment: 'barbell' },
    { name: 'Half-kneeling Landmine Press', sets: 3, repTarget: '8-10', restSeconds: 120, optional: false, equipment: 'barbell' },
    { name: 'Hammer Bicep Curls', sets: 3, repTarget: '10-12', restSeconds: 60, optional: true, equipment: 'dumbbell' },
    { name: 'Toes to Bar', sets: 2, repTarget: 'To failure', restSeconds: 90, optional: true, equipment: 'bodyweight' },
    { name: 'Single-arm DB Lateral Raises', sets: 2, repTarget: '12-15', restSeconds: 90, optional: true, equipment: 'dumbbell' },
  ],
  3: [
    { name: 'Bulgarian Split Squats', sets: 3, repTarget: '10-12', restSeconds: 120, optional: false, equipment: 'dumbbell' },
    { name: 'DB Row', sets: 3, repTarget: '10-12', restSeconds: 120, optional: false, equipment: 'dumbbell' },
    { name: 'Close-grip Bench Press', sets: 3, repTarget: '8-10', restSeconds: 120, optional: false, equipment: 'barbell' },
    { name: 'Barbell Bicep Curls', sets: 3, repTarget: '10-12', restSeconds: 120, optional: true, equipment: 'barbell' },
    { name: 'Toes to Bar', sets: 2, repTarget: 'To failure', restSeconds: 90, optional: true, equipment: 'bodyweight' },
    { name: 'Skull Crushers', sets: 3, repTarget: '10-12', restSeconds: 90, optional: true, equipment: 'barbell' },
  ],
};

export function findExerciseInProgram(dayNumber, name) {
  return PROGRAM[dayNumber].find((e) => e.name === name);
}

// Current days first, so the Progress picker leads with exercises you still do.
export function allExerciseNames() {
  const names = [];
  for (const day of [...ACTIVE_DAYS, ...LEGACY_DAYS]) {
    for (const ex of PROGRAM[day]) {
      if (!names.includes(ex.name)) names.push(ex.name);
    }
  }
  return names;
}

// "8-10" -> { min: 8, max: 10 }; "To failure" -> null.
export function parseRepRange(repTarget) {
  const match = /^(\d+)-(\d+)$/.exec(repTarget);
  return match ? { min: Number(match[1]), max: Number(match[2]) } : null;
}
