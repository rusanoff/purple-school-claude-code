/**
 * Client for the backend auth API (`apps/backend/src/auth`), plus the
 * `localStorage`-backed access token used by every authenticated request.
 */

import { apiFetch, ApiError } from './api';

export { ApiError };

/** Mirrors the backend's `AuthResponse` interface. */
export interface AuthResponse {
  accessToken: string;
}

/**
 * Mirrors the backend's `PASSWORD_MIN_LENGTH`
 * (`apps/backend/src/auth/dto/auth-credentials.dto.ts`), which registration
 * and the change-password route both enforce, so every form that sets a
 * password can reject a too-short one before it reaches the network. The
 * frontend is a separate workspace app and cannot import from the backend
 * one, so this is a hand-kept copy, not a derivation — same rule as
 * `USER_NAME_MIN_LENGTH` in `lib/users.ts`: if the number moves there, move
 * it here in the same change, or the client will validate against a stale
 * limit and surface unexplained 400s.
 *
 * It lives here, next to the calls that send passwords, rather than in either
 * form, because both the register page and the profile page's change-password
 * form check against it and two copies of `6` in the app would be a second
 * chance to drift.
 */
export const PASSWORD_MIN_LENGTH = 6;

/**
 * Client-side pre-check for a password about to be set — returns a
 * human-readable rejection reason, or `null` if it passes. Same role as
 * `validateName` in `lib/users.ts`: a faster, friendlier rejection than a
 * round trip, never the source of truth (the backend re-validates
 * regardless).
 *
 * Measures the value **untrimmed**, unlike `validateName`, because the
 * backend does too: `AuthCredentialsDto` and `ChangePasswordDto` deliberately
 * don't `@Transform` a password, since its leading and trailing whitespace is
 * part of the secret. Trimming before measuring here would reject a password
 * of six spaces that the server would happily store.
 *
 * Only ever applies to a *new* password. A current password being proven —
 * `ChangePassword`'s first field — is exempt for the same reason the backend
 * exempts it: it was accepted at some point in the past, possibly under a
 * smaller minimum, and telling its owner it is too short would be a lie about
 * why the request failed.
 */
export function validatePassword(password: string): string | null {
  if (!password) {
    return 'Enter a password.';
  }

  return password.length >= PASSWORD_MIN_LENGTH
    ? null
    : `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
}

/** `POST /auth/register` — 201 with a JWT, 409 if the email is taken. */
export async function register(
  email: string,
  password: string,
): Promise<AuthResponse> {
  const response = await apiFetch('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

  return (await response.json()) as AuthResponse;
}

/** `POST /auth/login` — 200 with a JWT, 401 on invalid credentials. */
export async function login(
  email: string,
  password: string,
): Promise<AuthResponse> {
  const response = await apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

  return (await response.json()) as AuthResponse;
}

const ACCESS_TOKEN_KEY = 'accessToken';

export function saveAccessToken(token: string): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, token);
}

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function clearAccessToken(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
}

/** Mirrors the JWT payload the backend's `TokenService` signs. */
interface JwtPayload {
  sub: string;
  email: string;
}

/**
 * Decodes a JWT's payload without verifying its signature. Safe only for
 * reading claims the backend already vouched for when it issued the token
 * (e.g. to show the signed-in user's email) — never use this to decide
 * whether a request is authorized, that call belongs to the backend.
 */
function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const payload = token.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));

    return JSON.parse(json) as JwtPayload;
  } catch {
    return null;
  }
}

/** The signed-in user's email, read from the stored access token, if any. */
export function getCurrentUserEmail(): string | null {
  const token = getAccessToken();

  return token ? (decodeJwtPayload(token)?.email ?? null) : null;
}

/**
 * The signed-in user's id (`sub` claim), read from the stored access token,
 * if any. Used to tell "you" apart from other uploaders in a meeting file
 * list (`MeetingFileResponse.uploadedById`) — see `lib/files.ts`.
 */
export function getCurrentUserId(): string | null {
  const token = getAccessToken();

  return token ? (decodeJwtPayload(token)?.sub ?? null) : null;
}
