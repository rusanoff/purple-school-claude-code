/** Client for the backend users API (`apps/backend/src/users`). */

import { apiFetch } from './api';

/**
 * Mirrors the backend's `UserProfileResponse` interface
 * (`apps/backend/src/users/interfaces/user-profile.interface.ts`).
 *
 * `name` and `avatarUrl` are nullable because both profile columns are
 * optional on the backend: a user who registered before those fields existed
 * — or who simply never filled them in — reads back as `null` on both. Every
 * consumer has to render that case (initial placeholder + email) rather than
 * assume a name, see `components/avatar.tsx`.
 *
 * `avatarUrl`, when set, already carries the `/api` rewrite prefix the
 * backend emits (`AVATAR_URL_PREFIX`), so it goes straight into an `<img
 * src>` — unlike the paths passed to `apiFetch`, it must **not** be prefixed
 * again here.
 *
 * `createdAt` is an ISO-8601 string (JSON has no date type); format it for
 * display with `lib/format.ts` rather than rendering it raw.
 */
export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

/**
 * `GET /users/me` — the signed-in user's own profile. The route takes no id:
 * whose profile comes back is decided entirely by the bearer token, so this
 * can never read someone else's.
 *
 * A 401 means the token is missing or expired and should be handled the same
 * way as everywhere else in the app (clear it and redirect to `/login`); a
 * 404 means the token verified but the user row is gone (deleted after the
 * token was issued) and is equally a reason to send the caller back to
 * `/login`, not something to retry.
 */
export async function getUserProfile(token: string): Promise<UserProfile> {
  const response = await apiFetch('/users/me', { token });

  return (await response.json()) as UserProfile;
}
