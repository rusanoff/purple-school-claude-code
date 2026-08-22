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
