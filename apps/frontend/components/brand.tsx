import { VideoIcon } from './icons';

export const APP_NAME = 'Video Meetings';

/** Logo + wordmark lockup, shown above the card on standalone pages. */
export function Brand() {
  return (
    <div className="flex items-center justify-center gap-3">
      <span className="bg-accent text-accent-foreground flex size-11 items-center justify-center rounded-2xl shadow-sm">
        <VideoIcon />
      </span>
      <span className="text-xl font-semibold tracking-tight">{APP_NAME}</span>
    </div>
  );
}
