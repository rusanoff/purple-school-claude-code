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
 * assume a name is there — `components/avatar.tsx` is the shared component
 * that does it, so don't hand-roll a placeholder per screen.
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

/**
 * Mirrors the backend's `USER_NAME_MIN_LENGTH` / `USER_NAME_MAX_LENGTH`
 * (`apps/backend/src/users/dto/update-user-profile.dto.ts`) so the profile
 * form can reject an empty or over-long name before it ever reaches the
 * network. The frontend is a separate workspace app and cannot import from
 * the backend one, so this is a hand-kept copy, not a derivation: if those
 * numbers change there, change them here in the same commit or the client
 * will validate against a stale limit and surface unexplained 400s.
 *
 * Both bounds apply to the **trimmed** value — the backend trims in a
 * `@Transform` before validating, so a client check on the untrimmed string
 * would disagree with it (`'  '` passes a naive length check but is empty to
 * the server, and a padded 100-character name would be rejected here while
 * the server accepts it). Trim first, then measure.
 */
export const USER_NAME_MIN_LENGTH = 1;
export const USER_NAME_MAX_LENGTH = 100;

/**
 * Client-side pre-check for a display name about to be saved — returns a
 * human-readable rejection reason, or `null` if the name passes. Same role
 * as `validateFile` in `lib/files.ts`: a faster, friendlier rejection than a
 * round-trip, never the source of truth (the backend re-validates
 * regardless).
 *
 * Measures the trimmed value, exactly as the backend does, so this and the
 * server can't disagree: a whitespace-only name is rejected here rather than
 * passing a raw length check and coming back a 400, and a name padded to
 * just over the maximum isn't rejected here while the server would accept
 * it. Callers should validate through this rather than comparing a raw
 * `.length` against the constants above.
 */
export function validateName(name: string): string | null {
  const trimmed = name.trim();

  if (trimmed.length < USER_NAME_MIN_LENGTH) {
    return 'Name cannot be empty';
  }

  if (trimmed.length > USER_NAME_MAX_LENGTH) {
    return `Name is too long (max ${USER_NAME_MAX_LENGTH} characters)`;
  }

  return null;
}

/** Body of `PATCH /users/me` — mirrors the backend's `UpdateUserProfileDto`.
 * A partial profile: it names `name` alone and leaves the avatar and
 * everything else untouched. */
export interface UpdateProfileInput {
  name: string;
}

/**
 * `PATCH /users/me` — renames the signed-in user. Like `getUserProfile`, the
 * route takes no id: the bearer token alone decides which row is written, so
 * this can never edit someone else's profile.
 *
 * Returns the full updated profile, identical to what a following
 * `GET /users/me` would return — use it to refresh the UI instead of
 * re-fetching.
 *
 * `name` is trimmed before it is sent — the backend trims it anyway, and
 * doing it here too means the value that was validated by `validateName` is
 * the value that gets stored, so the returned profile's `name` matches what
 * the caller checked. A 400 means the trimmed name fell outside
 * `USER_NAME_MIN_LENGTH`…`USER_NAME_MAX_LENGTH`; `validateName` catches that
 * first, so this is the backend's own enforcement rather than the expected
 * path. 401/404 mean the same as on `getUserProfile` and are handled the
 * same way (clear the token, redirect to `/login`).
 */
export async function updateProfile(
  token: string,
  { name }: UpdateProfileInput,
): Promise<UserProfile> {
  const response = await apiFetch('/users/me', {
    method: 'PATCH',
    token,
    body: JSON.stringify({ name: name.trim() }),
  });

  return (await response.json()) as UserProfile;
}
