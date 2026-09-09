import { Meeting } from '@prisma/client';
import { UserSummaryResponse } from '../../users/interfaces/user-summary.interface';
import {
  ParticipantDirectory,
  toParticipantSummary,
} from '../participants/participant-directory';

/** Public shape of a meeting returned by the API. */
export interface MeetingResponse {
  id: string;
  title: string;
  date: string;
  /**
   * Expanded from the stored email list: one summary per participant, in the
   * meeting's own order, whether or not that email belongs to a registered
   * user. Note the asymmetry with `CreateMeetingDto`, which still *accepts*
   * plain emails — the API takes what the organizer typed and answers with
   * who that turned out to be.
   */
  participants: UserSummaryResponse[];
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
 *
 * The participant summaries are read out of an already-loaded
 * `ParticipantDirectory` rather than fetched here: this function is called
 * once per meeting, so anything it fetched itself would be an N+1. Callers
 * build the directory for every meeting they are mapping — see
 * `loadParticipantDirectory`.
 */
export function toMeetingResponse(
  meeting: Meeting,
  callerId: string,
  participants: ParticipantDirectory,
): MeetingResponse {
  return {
    id: meeting.id,
    title: meeting.title,
    date: meeting.date.toISOString(),
    participants: meeting.participants.map((email) =>
      toParticipantSummary(email, participants),
    ),
    isOwner: meeting.ownerId === callerId,
  };
}
