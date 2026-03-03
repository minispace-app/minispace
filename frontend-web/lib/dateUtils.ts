/**
 * Get today's date in Montreal timezone (America/Montreal)
 * This ensures that "today" is determined by Montreal time, not UTC
 */
export function getTodayInMontreal(): Date {
  const timeZone = "America/Montreal";

  // Get the current time formatted in Montreal timezone
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(new Date());
  const dateObj: Record<string, string> = {};

  parts.forEach(({ type, value }) => {
    dateObj[type] = value;
  });

  // Create a date object with Montreal time
  return new Date(
    parseInt(dateObj.year),
    parseInt(dateObj.month) - 1,
    parseInt(dateObj.day),
    parseInt(dateObj.hour),
    parseInt(dateObj.minute),
    parseInt(dateObj.second)
  );
}

/**
 * Format a date as YYYY-MM-DD in Montreal timezone
 */
export function formatDateInMontreal(date: Date): string {
  const timeZone = "America/Montreal";

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(date);
  const dateObj: Record<string, string> = {};

  parts.forEach(({ type, value }) => {
    dateObj[type] = value;
  });

  return `${dateObj.year}-${dateObj.month}-${dateObj.day}`;
}
