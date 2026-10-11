export const RECURRENCES = ['once', 'daily', 'weekly', 'monthly'];

const DAY_MS = 24 * 60 * 60 * 1000;

// Returns the Date of the nth occurrence (0-based) of a schedule, or null when
// a one-off schedule has no occurrence at that index. All times are UTC.
export function occurrenceAt(startAt, recurrence, index) {
  const start = new Date(startAt);
  if (index === 0) return start;

  switch (recurrence) {
    case 'once':
      return null;
    case 'daily':
      return new Date(start.getTime() + index * DAY_MS);
    case 'weekly':
      return new Date(start.getTime() + index * 7 * DAY_MS);
    case 'monthly': {
      // Keep the original day of month, clamped to the end of shorter months
      // (e.g. the 31st becomes the 28th/29th in February).
      const monthIndex = start.getUTCMonth() + index;
      const year = start.getUTCFullYear();
      const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
      const day = Math.min(start.getUTCDate(), lastDay);
      return new Date(
        Date.UTC(year, monthIndex, day, start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds()),
      );
    }
    default:
      throw new Error(`Unknown recurrence: ${recurrence}`);
  }
}
