import { User } from '@prisma/client';

/**
 * Where this backend itself serves avatar files: the prefix
 * `registerAvatarStatic` (`src/avatar-static.ts`) mounts the avatar directory
 * on, and therefore the second half of `AVATAR_URL_PREFIX` below. Declared
 * here, next to the response mapping that embeds it, so the mount and the URL
 * it is reachable at cannot drift apart.
 *
 * No `/api` in it — that prefix is the frontend proxy's, not this app's, and
 * requesting `/api/avatars/...` against the backend directly is a 404. See
 * `AVATAR_URL_PREFIX` for the split.
 */
export const AVATAR_STATIC_ROUTE_PREFIX = '/avatars';

/**
 * URL path prefix `avatarUrl` is built from, and the one place the two halves
 * of that path are pinned down — the whole point of composing it here rather
 * than writing `/api/avatars` as one literal is that each half has a
 * different owner:
 *
 * - `/avatars` (`AVATAR_STATIC_ROUTE_PREFIX`) is **this backend's**: the
 *   `@fastify/static` mount over the avatar directory.
 * - `/api` is the **frontend's** rewrite prefix, added here and nowhere else.
 *   The browser never calls this backend cross-origin: it requests
 *   `/api/:path*` on its own origin and Next proxies it here with the prefix
 *   stripped (see the root `CLAUDE.md`), which is why the backend has no
 *   `/api/...` route and needs no CORS. Emitting it as part of `avatarUrl` is
 *   deliberate — it makes the value usable as-is in an `<img src>`, instead
 *   of every client re-deriving what `apiFetch` already does for API calls,
 *   and it means the frontend must *not* prepend it a second time. The
 *   trade-off: `avatarUrl` only resolves through that proxy, not against the
 *   backend's own origin, which is fine because the proxy is the only
 *   supported way in.
 */
export const AVATAR_URL_PREFIX = `/api${AVATAR_STATIC_ROUTE_PREFIX}`;

/**
 * Turns a stored `avatarPath` into something a browser can request — the one
 * place `AVATAR_URL_PREFIX` is ever attached to a filename, so every avatar
 * the API hands out (the caller's own profile, a file uploader's, a meeting
 * participant's) resolves the same way.
 *
 * `avatarPath` is a generated single-segment filename (never a path or a URL,
 * same convention as `MeetingFile.path`), so it needs no escaping here — but
 * it is also an on-disk detail, and exposing it as a URL is what keeps the
 * storage layout out of the API contract. A user who never uploaded one has
 * null, and stays null rather than becoming a URL to nothing.
 */
export function toAvatarUrl(avatarPath: string | null): string | null {
  return avatarPath ? `${AVATAR_URL_PREFIX}/${avatarPath}` : null;
}

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
 * leaving the fields the caller is allowed to see about themselves. Compare
 * `toUserSummary` (`user-summary.interface.ts`), which produces the narrower
 * shape the API hands out about *other* people.
 */
export function toUserProfileResponse(user: User): UserProfileResponse {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: toAvatarUrl(user.avatarPath),
    createdAt: user.createdAt.toISOString(),
  };
}
