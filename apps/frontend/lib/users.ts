/**
 * Client for the backend users API (`apps/backend/src/users`), plus the one
 * call that edits the signed-in user's account rather than their profile —
 * `changePassword`, which is served by `apps/backend/src/auth` because it
 * answers with credentials. It is grouped here, with the other profile-page
 * actions, rather than in `lib/auth.ts` with the sign-in calls.
 */

import { apiFetch } from './api';
import type { AuthResponse } from './auth';

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
 * The reasons are worded as instructions ("Enter your name.") rather than
 * verdicts ("Name cannot be empty"), matching the auth forms' field errors —
 * this is rendered in a `FieldError` on the same kind of `Form`, and a field
 * error that says what to do beats one that only says what is wrong.
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
    return 'Enter your name.';
  }

  if (trimmed.length > USER_NAME_MAX_LENGTH) {
    return `Name must be at most ${USER_NAME_MAX_LENGTH} characters.`;
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

/**
 * Mirrors the backend's avatar allowlist
 * (`ALLOWED_AVATAR_MIME_TYPES` in
 * `apps/backend/src/users/constants/avatar-upload.constants.ts`) — a hand-kept
 * copy for the same reason `USER_NAME_MAX_LENGTH` is one: the frontend is a
 * separate workspace app and cannot import from the backend, so both sides
 * must move in the same change or this will reject what the server accepts.
 *
 * Deliberately **not** `lib/files.ts`'s meeting-file allowlist: that one
 * accepts audio, video and documents and no images at all, so it is both too
 * wide and too narrow for an avatar. And deliberately a fixed set rather than
 * an `image/` prefix check, because an avatar is the one thing this monorepo
 * serves publicly and renders inline — `image/svg+xml` can carry script, and
 * exotic formats aren't reliably renderable. These three are what the backend
 * accepts and what every target browser displays.
 */
const ALLOWED_AVATAR_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

/** `<input accept="...">` value built from the same allowlist, so the OS file
 * picker pre-filters to the set `validateAvatar` enforces. Same role as
 * `FILE_INPUT_ACCEPT` in `lib/files.ts` — a convenience for the picker, never
 * a security boundary (the backend re-checks the type regardless). */
export const AVATAR_INPUT_ACCEPT = [...ALLOWED_AVATAR_MIME_TYPES].join(',');

/**
 * Mirrors the backend's *documented default* (`AVATAR_MAX_SIZE_BYTES` in
 * `apps/backend/.env.example`, 2MB — its own, much smaller limit than the
 * meeting-file one, since an avatar is a single small image and a meeting file
 * may be a multi-hour recording). The real server-side limit is configurable
 * per deployment and not exposed over the API, so a deployment that changes it
 * leaves this check slightly under- or over-rejecting until the backend's own
 * check runs; the backend limit is always the one actually enforced.
 */
export const MAX_AVATAR_SIZE_BYTES = 2 * 1024 * 1024;

/** `MAX_AVATAR_SIZE_BYTES` in whole MB — the single source for the "2MB" shown
 * to the user, in both `validateAvatar`'s rejection message and the upload
 * zone's hint text, so the two can't ever show different numbers. Same
 * arrangement as `MAX_FILE_SIZE_MB` in `lib/files.ts`. */
export const MAX_AVATAR_SIZE_MB = Math.floor(
  MAX_AVATAR_SIZE_BYTES / (1024 * 1024),
);

/**
 * Client-side pre-check for an avatar about to be uploaded — returns a
 * human-readable rejection reason, or `null` if the file passes. Same role as
 * `validateFile` in `lib/files.ts`: a faster, friendlier rejection than a
 * round-trip, never the source of truth.
 *
 * The MIME type is lowercased before the lookup because the backend's own
 * check is case-insensitive (MIME tokens are, per RFC 2045/6838) — matching it
 * exactly is what keeps this from rejecting a file the server would accept.
 *
 * Worded as verdicts ("Unsupported image type: …"), like `validateFile` and
 * unlike `validateName`'s instructions: this is rejected file feedback shown
 * next to the upload zone, not a `FieldError` on a text input. Each verdict is
 * then followed by the way out of it — the accepted types, a smaller file —
 * because these render in a `danger` `Alert` that replaces the whole upload
 * affordance's feedback, and an alert that only says what is wrong leaves the
 * user to guess the fix. (`validateFile`'s messages are terser: they sit in an
 * upload queue row beside a dropzone that states its own limits, so the next
 * step is already on screen next to them.) Naming the accepted types is
 * affordable here only because, unlike the meeting-file allowlist, this one is
 * three entries long.
 */
export function validateAvatar(file: File): string | null {
  // Checked before the type, because a 0-byte file's reported type is guessed
  // from its name and says nothing about its contents. Nothing on the server
  // catches this — an empty upload is under every limit, so it is stored and
  // answered with a perfectly good `avatarUrl` — and the result is an avatar
  // that can never decode, which `components/avatar.tsx` renders as the
  // initial placeholder forever while the page reports the save succeeded.
  if (file.size === 0) {
    return 'That image file is empty.';
  }

  if (!ALLOWED_AVATAR_MIME_TYPES.has(file.type.toLowerCase())) {
    return file.type
      ? `Unsupported image type: ${file.type}. Use a JPEG, PNG or WebP image.`
      : 'Unsupported or unrecognized image type. Use a JPEG, PNG or WebP image.';
  }

  if (file.size > MAX_AVATAR_SIZE_BYTES) {
    return `Image is too large (max ${MAX_AVATAR_SIZE_MB}MB). Choose a smaller image.`;
  }

  return null;
}

/**
 * `POST /users/me/avatar` — sets or replaces the signed-in user's avatar from
 * a `multipart/form-data` body. Self-scoped like the rest of this module: the
 * request carries an image and no id, so the bearer token alone decides whose
 * avatar is written.
 *
 * The `FormData` body is passed to `apiFetch` unstringified on purpose — the
 * browser has to set `Content-Type` itself with the multipart boundary, which
 * is why `apiFetch` only defaults that header for a string body.
 *
 * Returns the full updated profile (the backend answers 200 with the same
 * shape as `GET /users/me`, not 201 — the avatar is a singleton sub-resource,
 * so a second upload creates nothing), so the caller refreshes the UI from it
 * rather than refetching. A 400 means the backend rejected the type or the
 * size; `validateAvatar` catches both first, so that is the server's own
 * enforcement rather than the expected path. 401/404 mean what they do on
 * `getUserProfile` and are handled the same way.
 */
export async function uploadAvatar(
  token: string,
  file: File,
): Promise<UserProfile> {
  const body = new FormData();
  body.append('file', file);

  const response = await apiFetch('/users/me/avatar', {
    method: 'POST',
    token,
    body,
  });

  return (await response.json()) as UserProfile;
}

/**
 * `DELETE /users/me/avatar` — clears the signed-in user's avatar, file
 * included. Returns the updated profile (with `avatarUrl` back to `null`)
 * rather than 204, so the caller can drop back to the initial placeholder
 * from the same source of truth the rest of the page reads.
 *
 * Deleting an avatar that isn't there is not an error — the backend clears an
 * already-null column and answers with the profile — so a caller doesn't have
 * to guard the call on `avatarUrl` being set.
 */
export async function deleteAvatar(token: string): Promise<UserProfile> {
  const response = await apiFetch('/users/me/avatar', {
    method: 'DELETE',
    token,
  });

  return (await response.json()) as UserProfile;
}

/** Body of `POST /auth/change-password` — mirrors the backend's
 * `ChangePasswordDto`. Neither password is trimmed anywhere on the way to the
 * server (unlike `UpdateProfileInput.name`): a password is an opaque secret
 * whose leading and trailing whitespace is part of it, so trimming would send
 * — and have the backend store — something other than what the user typed. */
export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

/**
 * `POST /auth/change-password` — replaces the signed-in user's password.
 * Self-scoped like the rest of this module: the body carries no email or id,
 * so the account written is the one the bearer token identifies, and knowing
 * `currentPassword` is what keeps a stolen token from being enough to lock the
 * real owner out.
 *
 * Lives here with the other profile-editing calls because that is where it is
 * used from, but it is the one function in this module that does **not** hit
 * `/users` and does not answer with a `UserProfile`: it returns credentials.
 * The backend's JWTs are stateless and never revoked, so rather than signing
 * the user out it hands back a freshly signed token — **the caller must store
 * it** (`saveAccessToken` from `lib/auth.ts`), or the app keeps using the old
 * one until it expires and the user appears to have been logged out by
 * changing their password.
 *
 * A wrong `currentPassword` is a **400**, not the 401 a wrong password gets at
 * login, and that is a deliberate backend choice rather than an accident: every
 * page in this app treats a 401 as "the session is over" and redirects to
 * `/login`, so answering 401 would log a user out for a typo. Callers must
 * therefore not fold this call's 400s into that path — its message ("Current
 * password is incorrect") is written for a person and renders as-is.
 *
 * A `newPassword` under the backend's minimum length is also a 400, but that
 * one comes from the global `ValidationPipe` and reads like a schema error
 * ("newPassword must be longer than or equal to 6 characters") rather than
 * like something written for the user. Callers should keep it off the screen
 * by pre-checking the length client-side, the way `validateName` and
 * `validateAvatar` guard the other writable inputs here — this module has no
 * such mirror of the backend's `PASSWORD_MIN_LENGTH` yet, so until it does,
 * that check lives with the form (as `MIN_PASSWORD_LENGTH` already does in
 * `app/register/page.tsx`).
 *
 * 401 and 404 keep the meanings they have on every other function in this
 * module — the token is missing or expired, or it verified but the user row is
 * gone — and are handled the same way (clear the token, redirect to `/login`).
 * The warning above is about 400s specifically and does not exempt this call
 * from that. A 409 means a concurrent change won the race and the password the
 * user typed is no longer the current one.
 */
export async function changePassword(
  token: string,
  { currentPassword, newPassword }: ChangePasswordInput,
): Promise<AuthResponse> {
  const response = await apiFetch('/auth/change-password', {
    method: 'POST',
    token,
    body: JSON.stringify({ currentPassword, newPassword }),
  });

  return (await response.json()) as AuthResponse;
}
