/**
 * Client for the backend auth API (`apps/backend/src/auth`).
 *
 * Requests go to the same origin under `/api/*` and are proxied to the backend
 * by the rewrite in `next.config.ts`, so no CORS setup is needed.
 */

/** Mirrors the backend's `AuthResponse` interface. */
export interface AuthResponse {
  accessToken: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Nest's exception body. `message` is a plain string for thrown HTTP
 * exceptions (e.g. 409 on a duplicate email) and a string array for
 * `ValidationPipe` failures.
 */
interface ErrorBody {
  message?: string | string[];
}

const FALLBACK_ERROR = 'Something went wrong. Please try again.';

async function toApiError(response: Response): Promise<ApiError> {
  let message = FALLBACK_ERROR;

  try {
    const body = (await response.json()) as ErrorBody;

    if (Array.isArray(body.message)) {
      message = body.message.join('. ');
    } else if (body.message) {
      message = body.message;
    }
  } catch {
    // Non-JSON body (backend down, proxy error) — keep the fallback message.
  }

  return new ApiError(message, response.status);
}

/** `POST /auth/register` — 201 with a JWT, 409 if the email is taken. */
export async function register(
  email: string,
  password: string,
): Promise<AuthResponse> {
  let response: Response;

  try {
    response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    throw new ApiError('Cannot reach the server. Is the backend running?', 0);
  }

  if (!response.ok) {
    throw await toApiError(response);
  }

  return (await response.json()) as AuthResponse;
}

const ACCESS_TOKEN_KEY = 'accessToken';

export function saveAccessToken(token: string): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, token);
}

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}
