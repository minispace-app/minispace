export function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Returns the default active tab index (0–4) for a given week start.
 * - Current week → index of today (clamped to 0–4).
 * - Past/future week → 0.
 */
export function getDefaultActiveDayIndex(weekStart: Date): number {
  const today = new Date();
  const todayStr = formatDate(today);
  for (let i = 0; i < 5; i++) {
    const d = addDays(weekStart, i);
    if (formatDate(d) === todayStr) return i;
  }
  return 0;
}
