/** Shared display formatting, used by the dashboard and the meeting detail page. */

/** e.g. "Sep 1, 2026, 3:00 PM" — used everywhere a meeting's `date` is shown. */
export function formatMeetingDate(date: string): string {
  return new Date(date).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

const FILE_SIZE_UNITS = ['B', 'KB', 'MB', 'GB'];

/** e.g. "2.3 MB" — used for `MeetingFile.size` (bytes) in the file list. */
export function formatFileSize(bytes: number): string {
  if (bytes <= 0) return '0 B';

  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    FILE_SIZE_UNITS.length - 1,
  );
  const value = bytes / 1024 ** exponent;

  // Whole units (e.g. "512 B") skip the decimal, everything else keeps one.
  return `${exponent === 0 ? value : value.toFixed(1)} ${FILE_SIZE_UNITS[exponent]}`;
}
