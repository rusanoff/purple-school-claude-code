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
