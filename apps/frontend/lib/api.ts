/**
 * Shared fetch helper for the backend API (`apps/backend/src`).
 *
 * Requests go to the same origin under `/api/*` and are proxied to the
 * backend by the rewrite in `next.config.ts`, so no CORS setup is needed.
 */

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

interface ApiFetchOptions extends RequestInit {
  /** Bearer token, attached as an `Authorization` header when given. */
  token?: string;
}

/**
 * Fetches `/api<path>` and throws `ApiError` on a network failure or a
 * non-2xx response — every caller can rely on a resolved response being ok.
 */
export async function apiFetch(
  path: string,
  { token, headers, ...init }: ApiFetchOptions = {},
): Promise<Response> {
  let response: Response;

  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    });
  } catch {
    throw new ApiError('Cannot reach the server. Is the backend running?', 0);
  }

  if (!response.ok) {
    throw await toApiError(response);
  }

  return response;
}
