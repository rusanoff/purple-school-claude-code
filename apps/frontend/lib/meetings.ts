/** Client for the backend meetings API (`apps/backend/src/meeting`). */

import { apiFetch } from './api';

/** Mirrors the backend's `MeetingResponse` interface. */
export interface Meeting {
  id: string;
  title: string;
  date: string;
  participants: string[];
}

/**
 * `GET /meetings` — every meeting owned by the caller, newest-created first.
 * Requires a bearer token; a 401 means the token is missing or expired.
 */
export async function getMeetings(token: string): Promise<Meeting[]> {
  const response = await apiFetch('/meetings', { token });

  return (await response.json()) as Meeting[];
}

/**
 * `GET /meetings/:id` — a single meeting, visible to its owner or any
 * participant (matched by JWT email, case-insensitively). A 401 means the
 * token is missing or expired; a 403 means the caller is neither; a 404
 * means no meeting with that id exists.
 */
export async function getMeeting(token: string, id: string): Promise<Meeting> {
  const response = await apiFetch(`/meetings/${encodeURIComponent(id)}`, {
    token,
  });

  return (await response.json()) as Meeting;
}

/**
 * Whether the signed-in user (by email) is this meeting's owner — deduced
 * without the backend ever exposing `ownerId` over the API
 * (`MeetingResponse` deliberately hides it, see the backend's
 * `toMeetingResponse`). A meeting only ever reaches the caller as `success`
 * for its owner or a participant (`assertMeetingAccess` on the backend, see
 * the root `CLAUDE.md`) — so if the signed-in email isn't (case-
 * insensitively) one of `meeting.participants`, the caller must be the
 * owner by elimination. Used by `components/meeting-files.tsx` to decide
 * who sees the delete button for which files: the owner may delete any
 * file, a participant only their own.
 */
export function isMeetingOwner(
  meeting: Meeting,
  email: string | null,
): boolean {
  if (!email) return false;

  const normalized = email.toLowerCase();
  return !meeting.participants.some(
    (participant) => participant.toLowerCase() === normalized,
  );
}
