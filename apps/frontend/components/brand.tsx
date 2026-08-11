export const APP_NAME = 'Video Meetings';

function LogoMark() {
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

/** Logo + wordmark lockup, shown above the card on standalone pages. */
export function Brand() {
  return (
    <div className="flex items-center justify-center gap-3">
      <span className="bg-accent text-accent-foreground flex size-11 items-center justify-center rounded-2xl shadow-sm">
        <LogoMark />
      </span>
      <span className="text-xl font-semibold tracking-tight">{APP_NAME}</span>
    </div>
  );
}
