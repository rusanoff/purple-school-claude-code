import { realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';

/**
 * Avatar uploads deliberately do **not** reuse the meeting-file allowlist
 * (`src/meeting-files/constants/file-upload.constants.ts`): that one accepts
 * audio, video and documents and no images at all, so it is both too wide and
 * too narrow here. Keeping the two lists separate is a requirement, not an
 * accident — see docs/prd-user-profile-page-and-editing.md, "Технические
 * ограничения".
 *
 * A fixed set rather than an `image/` prefix check, because an avatar is
 * served publicly and rendered inline: `image/svg+xml` can carry script, and
 * exotic formats aren't reliably renderable. These three are what every
 * target browser displays and what the frontend's `<input accept="...">`
 * mirrors (a mirror, not a derivation — the frontend is a separate workspace
 * app that cannot import from this one, so both must move in the same change).
 */
const ALLOWED_AVATAR_MIME_TYPES = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);

export function isAllowedAvatarMimeType(mimeType: string): boolean {
  // MIME type tokens are case-insensitive (RFC 2045/6838) — a client sending
  // e.g. "Image/JPEG" must match "image/jpeg" in the allowlist. Parameters
  // (`; charset=...`) are not stripped: `@fastify/multipart` already hands
  // over a bare type in `data.mimetype`, so anything carrying one didn't come
  // from the path this guards.
  return ALLOWED_AVATAR_MIME_TYPES.has(mimeType.toLowerCase());
}

/**
 * The on-disk extension for an allowed avatar type. The allowlist doubles as
 * the extension table on purpose: the value the storage service names a file
 * with has to come from the type it just validated, never from the client's
 * filename. `@fastify/static` derives the response `Content-Type` from the
 * extension, so a `.svg` suffix on bytes accepted as `image/png` would be
 * served back inline as scriptable SVG — the exact thing the fixed allowlist
 * above exists to prevent.
 *
 * Throws rather than returning a fallback for an unlisted type: reaching here
 * with one means a caller skipped `isAllowedAvatarMimeType`, and a silent
 * `.bin` would write an unservable file instead of surfacing that bug.
 */
export function avatarExtensionForMimeType(mimeType: string): string {
  const extension = ALLOWED_AVATAR_MIME_TYPES.get(mimeType.toLowerCase());
  if (extension === undefined) {
    throw new Error(
      `No avatar extension for MIME type "${mimeType}" — it is not on the avatar allowlist.`,
    );
  }

  return extension;
}

/**
 * Fallback for `AVATAR_MAX_SIZE_BYTES`. Its own, much smaller limit than the
 * meeting-file one (`FILE_MAX_SIZE_BYTES`, 50MB by default): a meeting file
 * may be a multi-hour recording, an avatar is a single small image, and
 * enforcing that difference is the whole reason for a second constant.
 */
export const DEFAULT_AVATAR_MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2MB

/**
 * Fallback for `AVATAR_STORAGE_DIR`, resolved relative to cwd like
 * `FILE_STORAGE_DIR` is.
 *
 * It must stay a **sibling** of the meeting-file storage directory, never the
 * same directory and never nested inside it — see
 * `assertAvatarStorageDirIsSeparate`, which is what actually enforces that
 * for the configured values.
 */
export const DEFAULT_AVATAR_STORAGE_DIR = './uploads-avatars';

/**
 * Fails loudly unless the avatar directory and the meeting-file directory are
 * disjoint. The avatar one gets a public `@fastify/static` mount while meeting
 * files are access-checked per request against owner/participant, so a mount
 * aimed at a directory that holds meeting files — as that directory itself, or
 * as any ancestor of it — would publish every private file underneath. Nesting
 * in *either* direction is fatal for that reason, not just avatars-inside-
 * uploads.
 *
 * Takes both directories as arguments rather than reading env itself: the
 * defaults above are only defaults, `AVATAR_STORAGE_DIR` and
 * `FILE_STORAGE_DIR` can each point anywhere, and a misconfiguration must
 * abort startup instead of quietly serving private files. The avatar storage
 * service calls this once with the two resolved values.
 */
export function assertAvatarStorageDirIsSeparate(
  avatarStorageDir: string,
  meetingFileStorageDir: string,
): void {
  const avatarDir = canonicalizeStorageDir(avatarStorageDir);
  const meetingFileDir = canonicalizeStorageDir(meetingFileStorageDir);

  if (isSamePath(avatarDir, meetingFileDir)) {
    throw new Error(
      `AVATAR_STORAGE_DIR must not be the meeting-file storage directory (FILE_STORAGE_DIR): both resolve to "${avatarDir}". Avatars are served publicly; meeting files must not be.`,
    );
  }

  if (isInside(avatarDir, meetingFileDir)) {
    throw new Error(
      `AVATAR_STORAGE_DIR ("${avatarDir}") must not be inside the meeting-file storage directory FILE_STORAGE_DIR ("${meetingFileDir}"). Avatars are served publicly; meeting files must not be.`,
    );
  }

  if (isInside(meetingFileDir, avatarDir)) {
    throw new Error(
      `FILE_STORAGE_DIR ("${meetingFileDir}") must not be inside the publicly served avatar directory AVATAR_STORAGE_DIR ("${avatarDir}") — the static mount would expose every meeting file under it.`,
    );
  }
}

/**
 * The single spelling of a configured directory the comparisons above are
 * allowed to see.
 *
 * Both values come straight from env: they may be relative, carry a trailing
 * separator, or spell the same directory two different ways, so `resolve`
 * first — comparing the raw strings would let all of those through. Then
 * `realpathSync` on top of it, because a lexical resolve still cannot see
 * through a symlink: `AVATAR_STORAGE_DIR=/srv/public-avatars` pointing at
 * `/srv/uploads` is two different paths to one directory, and the whole point
 * of this check is that those two directories not be the same one.
 */
function canonicalizeStorageDir(storageDir: string): string {
  const absolutePath = resolve(storageDir);
  try {
    // `.native` rather than the JS implementation so a case-insensitive
    // filesystem also hands back the case it actually stored, which is what
    // makes `/srv/Uploads` and `/srv/uploads` compare equal when they are in
    // fact one directory.
    return realpathSync.native(absolutePath);
  } catch {
    // Not created yet — a fresh clone, a fresh e2e temp dir. The resolved
    // path is all there is to compare, and the storage service creates the
    // directory under exactly this name moments later, so the fallback is
    // the string that is about to become real.
    return absolutePath;
  }
}

/**
 * Case-insensitive on purpose. On a case-insensitive filesystem (darwin, the
 * platform this is developed on) `/srv/Uploads` and `/srv/uploads` are one
 * directory, which `canonicalizeStorageDir` can only unify once it exists;
 * on a case-sensitive one they are two, and this rejects a configuration
 * that would in fact have been safe. That trade is deliberate: over-rejecting
 * costs a startup error naming both paths, under-rejecting costs every
 * private meeting file.
 */
function isSamePath(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

/** True if `inner` sits underneath `outer`. The `sep` suffix is what keeps a
 * shared *name* prefix (`/srv/uploads-avatars` vs `/srv/uploads`) from
 * reading as nesting; the lower-casing is `isSamePath`'s reasoning applied to
 * the nesting check. */
function isInside(inner: string, outer: string): boolean {
  return inner.toLowerCase().startsWith(`${outer.toLowerCase()}${sep}`);
}
