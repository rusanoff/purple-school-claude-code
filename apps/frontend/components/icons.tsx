/**
 * Small inline SVG icons shared across pages. Kept as plain `<svg>` rather
 * than an icon package — the set is small and this avoids another dependency.
 */

export function EnvelopeIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      viewBox="0 0 24 24"
    >
      <rect height="14" rx="2" width="18" x="3" y="5" />
      <path
        d="m3.5 7 8.5 6 8.5-6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LockIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      viewBox="0 0 24 24"
    >
      <rect height="10" rx="2" width="14" x="5" y="11" />
      <path d="M8 11V8a4 4 0 1 1 8 0v3" strokeLinecap="round" />
    </svg>
  );
}

export function EyeIcon({ isOpen }: { isOpen: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.6}
      viewBox="0 0 24 24"
    >
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
      {!isOpen && <path d="m4 4 16 16" />}
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-7"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

export function LogOutIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.6}
      viewBox="0 0 24 24"
    >
      <path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4" />
      <path d="M16 16.5 21 12l-5-4.5" />
      <path d="M21 12H9" />
    </svg>
  );
}

export function CalendarIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.6}
      viewBox="0 0 24 24"
    >
      <rect height="16" rx="2" width="16" x="4" y="5" />
      <path d="M4 9.5h16M8 3v3.5M16 3v3.5" />
    </svg>
  );
}

export function UsersIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.6}
      viewBox="0 0 24 24"
    >
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <path d="M15.5 6.5a3 3 0 0 1 0 5.9M20 19a5 5 0 0 0-3.9-4.9" />
    </svg>
  );
}

export function VideoIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-6"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.8}
      viewBox="0 0 24 24"
    >
      <rect height="12" rx="3" width="14" x="2.5" y="6" />
      <path d="M16.5 12.5 21.5 15.5V8.5L16.5 11.5Z" />
    </svg>
  );
}
