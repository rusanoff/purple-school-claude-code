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
  return (
    ALLOWED_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix)) ||
    ALLOWED_DOCUMENT_MIME_TYPES.has(mimeType)
  );
}

/**
 * Hard backstop passed to `@fastify/multipart` at plugin-registration time
 * (see `src/multipart.ts`). Deliberately unrelated to — and much larger
 * than — the actual business max-size: that one is enforced per-request in
 * `MeetingFileStorageService` from `FILE_MAX_SIZE_BYTES`, so it can be
 * configured (or overridden per e2e test) without re-registering the
 * plugin. This constant only protects the process from a pathologically
 * huge request body.
 */
export const MULTIPART_PLUGIN_FILE_SIZE_LIMIT_BYTES = 1024 * 1024 * 1024; // 1GB
