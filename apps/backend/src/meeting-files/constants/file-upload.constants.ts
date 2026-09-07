/**
 * Single source of truth for which MIME types a meeting file upload
 * accepts. Read from `MeetingFileStorageService`; a later frontend phase
 * should mirror this list for the `<input accept="...">` client-side check
 * (see docs/research-meeting-upload.md §1) so the two never drift apart.
 */
const ALLOWED_MIME_PREFIXES = ['audio/', 'video/'];

const ALLOWED_DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
]);

export function isAllowedMimeType(mimeType: string): boolean {
  // MIME type tokens are case-insensitive (RFC 2045/6838) — a client
  // sending e.g. "Video/MP4" must match "video/mp4" in the allowlist.
  const normalized = mimeType.toLowerCase();
  return (
    ALLOWED_MIME_PREFIXES.some((prefix) => normalized.startsWith(prefix)) ||
    ALLOWED_DOCUMENT_MIME_TYPES.has(normalized)
  );
}

/**
 * Fallback for `FILE_STORAGE_DIR`, resolved relative to cwd. Exported rather
 * than kept private to `MeetingFileStorageService` because
 * `AvatarStorageService` needs the *effective* meeting-file directory — the
 * configured value or this default — to assert the publicly served avatar
 * directory is disjoint from it. A second copy of the literal there would let
 * the two drift and silently weaken that check.
 */
export const DEFAULT_FILE_STORAGE_DIR = './uploads';

/**
 * Default passed to `@fastify/multipart` at plugin-registration time (see
 * `src/multipart.ts`) — only a fallback for any future route that doesn't
 * pass its own per-call `limits.fileSize`. `MeetingFileStorageService`
 * always does (from `FILE_MAX_SIZE_BYTES`), so for this feature's own
 * upload route this value is never actually the effective limit.
 */
export const MULTIPART_PLUGIN_FILE_SIZE_LIMIT_BYTES = 1024 * 1024 * 1024; // 1GB
