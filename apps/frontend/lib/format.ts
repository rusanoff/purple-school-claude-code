/** Shared display formatting, used by the dashboard and the meeting detail page. */

/** e.g. "Sep 1, 2026, 3:00 PM" — used everywhere a meeting's `date` is shown. */
export function formatMeetingDate(date: string): string {
  return new Date(date).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
