// ============================================================
// ICONS (inline SVG, no emoji)
// ============================================================
const svg = (paths, strokeWidth = 2) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

export const ICONS = {
  check: svg('<path d="M20 6L9 17l-5-5"/>', 2.5),
  save: svg('<path d="M12 19V5M5 12l7-7 7 7"/>', 2.5),
  note: svg('<path d="M4 7h16M4 12h10M4 17h7"/>'),
  arrowUp: svg('<path d="M7 17L17 7M9 7h8v8"/>'),
  target: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>'),
  trophy: svg('<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>'),
  medal: svg('<circle cx="12" cy="15" r="6"/><path d="M8.5 9.6L6 2h4l2 5 2-5h4l-2.5 7.6"/>'),
  snowflake: svg('<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7"/>'),
  flame: svg('<path d="M12 22c4 0 7-3 7-7 0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-2 2-5 5-5 8 0 4 3 7 7 7z"/>'),
  bolt: svg('<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/>'),
};

// ============================================================
// STRINGS + NUMBERS
// ============================================================
export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function formatNumber(n, maxDigits = 2) {
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: maxDigits });
}

export function formatRest(seconds) {
  if (seconds % 60 === 0) return `${seconds / 60} min rest`;
  return `${seconds} sec rest`;
}

export function formatSet(set) {
  if (set.weight != null && set.weight > 0) return `${formatNumber(set.weight)}×${set.reps ?? '–'}`;
  return `${set.reps ?? '–'} reps`;
}

// ============================================================
// DATES — all app dates are local "YYYY-MM-DD" strings
// ============================================================
export function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayStr() {
  return toDateStr(new Date());
}

export function parseDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(dateStr, n) {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

export function daysBetween(fromStr, toStr) {
  return Math.round((parseDate(toStr) - parseDate(fromStr)) / 86400000);
}

// Weeks run Monday-Sunday; a week is identified by its Monday.
export function weekStartStr(dateStr) {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toDateStr(d);
}

// ISO-8601 week number: weeks start Monday, and week 1 holds the year's first Thursday.
export function isoWeekNumber(dateStr) {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const jan4 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
}

export function formatWeekday(dateStr) {
  return parseDate(dateStr).toLocaleDateString(undefined, { weekday: 'short' });
}

export function formatDateLong(dateStr) {
  return parseDate(dateStr).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDateShort(dateStr) {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${m}/${d}`;
}

// ============================================================
// TOASTS
// ============================================================
export function showToast(message, type) {
  const toast = document.createElement('div');
  toast.className = 'toast' + (type ? ` ${type}` : '');
  toast.textContent = message;
  document.getElementById('toast-container').appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, type === 'level' || type === 'win' ? 3500 : 2500);
}
