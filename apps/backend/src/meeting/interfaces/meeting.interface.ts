import { Meeting } from '@prisma/client';

/** Public shape of a meeting returned by the API. */
export interface MeetingResponse {
  id: string;
  title: string;
  date: string;
  participants: string[];
  isOwner: boolean;
}

/**
 * Strips persistence-only fields (timestamps) from a Prisma row, and folds
 * `ownerId` into a single `isOwner` boolean scoped to the caller — the raw
 * id itself is never exposed. Without this, a client has no way to tell
 * whether the signed-in user is the meeting's owner or "just" a
 * participant that happens to have access (`assertMeetingAccess` grants
 * both the same read access); the frontend needs that distinction to
 * decide who's allowed to delete which meeting file (see the root
 * `CLAUDE.md`'s meeting-files access notes and the frontend's
 * `components/meeting-files.tsx`).
 */
export function toMeetingResponse(
  meeting: Meeting,
  callerId: string,
): MeetingResponse {
  return {
    id: meeting.id,
    title: meeting.title,
    date: meeting.date.toISOString(),
    participants: meeting.participants,
    isOwner: meeting.ownerId === callerId,
  };
}
