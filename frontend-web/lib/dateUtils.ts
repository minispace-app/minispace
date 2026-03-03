/**
 * Get the configured timezone from environment variable
 * Uses NEXT_PUBLIC_TZ (frontend-accessible) from .env
 * Defaults to America/Montreal if not set
 */
function getConfiguredTimezone(): string {
  return process.env.NEXT_PUBLIC_TZ || "America/Montreal";
}

/**
 * Get today's date in the configured timezone
 * The timezone can be set via NEXT_PUBLIC_TIMEZONE environment variable
 * Defaults to America/Montreal if not configured
 */
export function getTodayInMontreal(): Date {
  const timeZone = getConfiguredTimezone();

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
 * Format a date as YYYY-MM-DD in the configured timezone
 * The timezone can be set via NEXT_PUBLIC_TIMEZONE environment variable
 * Defaults to America/Montreal if not configured
 */
export function formatDateInMontreal(date: Date): string {
  const timeZone = getConfiguredTimezone();

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
