import { User } from '@prisma/client';

/**
 * URL path prefix under which avatar files are served, and the one place the
 * two halves of that path are pinned down:
 *
 * - `/avatars` is where `@fastify/static` will serve the avatar directory on
 *   this backend (nothing writes `avatarPath` yet, so no file is reachable
 *   there today — that registration lands with avatar upload).
 * - `/api` is the frontend's rewrite prefix: the browser never calls this
 *   backend cross-origin, it requests `/api/:path*` on its own origin and
 *   Next proxies it here with the prefix stripped (see the root `CLAUDE.md`).
 *   Emitting it as part of `avatarUrl` is deliberate — it makes the value
 *   usable as-is in an `<img src>`, instead of every client re-deriving what
 *   `apiFetch` already does for API calls. The trade-off: `avatarUrl` only
 *   resolves through that proxy, not against the backend's own origin, which
 *   is fine because the proxy is the only supported way in.
 */
export const AVATAR_URL_PREFIX = '/api/avatars';

/**
 * Public shape of the signed-in user's own profile, returned by
 * `GET /users/me`. Unlike `UserRecord` (the internal, password-hash-carrying
 * cross-handler message type in `user-record.interface.ts`) this one is safe
 * to serialize straight to a client.
 *
 * `name` and `avatarUrl` are nullable: both profile columns are optional, so
 * a user who registered before they existed — or who simply never filled them
 * in — reads back as null on both.
 */
export interface UserProfileResponse {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

/**
 * Strips the password hash and persistence-only timestamps from a Prisma row,
 * and turns the stored `avatarPath` into something a browser can request.
 * `avatarPath` is a generated single-segment filename (never a path or a URL,
 * same convention as `MeetingFile.path`), so it needs no escaping here — but
 * it is also an on-disk detail, and exposing it as a URL is what keeps the
 * storage layout out of the API contract.
 */
export function toUserProfileResponse(user: User): UserProfileResponse {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarPath
      ? `${AVATAR_URL_PREFIX}/${user.avatarPath}`
      : null,
    createdAt: user.createdAt.toISOString(),
  };
}
