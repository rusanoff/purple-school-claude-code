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
const ALLOWED_AVATAR_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
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
  // Both values come straight from env: they may be relative, carry a
  // trailing separator, or spell the same directory two different ways, so
  // compare resolved absolute paths, never the raw strings. The `sep` suffix
  // is what keeps a shared *name* prefix (`/srv/uploads-avatars` vs
  // `/srv/uploads`) from reading as nesting.
  const avatarDir = resolve(avatarStorageDir);
  const meetingFileDir = resolve(meetingFileStorageDir);

  if (avatarDir === meetingFileDir) {
    throw new Error(
      `AVATAR_STORAGE_DIR must not be the meeting-file storage directory (FILE_STORAGE_DIR): both resolve to "${avatarDir}". Avatars are served publicly; meeting files must not be.`,
    );
  }

  if (avatarDir.startsWith(`${meetingFileDir}${sep}`)) {
    throw new Error(
      `AVATAR_STORAGE_DIR ("${avatarDir}") must not be inside the meeting-file storage directory FILE_STORAGE_DIR ("${meetingFileDir}"). Avatars are served publicly; meeting files must not be.`,
    );
  }

  if (meetingFileDir.startsWith(`${avatarDir}${sep}`)) {
    throw new Error(
      `FILE_STORAGE_DIR ("${meetingFileDir}") must not be inside the publicly served avatar directory AVATAR_STORAGE_DIR ("${avatarDir}") — the static mount would expose every meeting file under it.`,
    );
  }
}
