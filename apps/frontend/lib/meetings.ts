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
  const response = await apiFetch(`/meetings/${id}`, { token });

  return (await response.json()) as Meeting;
}
