/**
 * Client for the backend meeting-files API
 * (`apps/backend/src/meeting-files`): upload, list, download, and delete.
 */

import { apiFetch } from './api';

/** Mirrors the backend's `MeetingFileResponse` interface. */
export interface MeetingFile {
  id: string;
  meetingId: string;
  uploadedById: string;
  filename: string;
  mimeType: string;
  /** Bytes. A `number` here — the backend's `BigInt` column is converted to
   * a plain number before it's ever serialized to JSON. */
  size: number;
  createdAt: string;
}

/**
 * `POST /meetings/:id/files` — uploads one file as `multipart/form-data`.
 * Requires a bearer token; a 401 means the token is missing or expired, 403
 * means the caller is neither the meeting's owner nor a participant, 400
 * means the backend rejected the MIME type or the file exceeds
 * `FILE_MAX_SIZE_BYTES` — both should already be caught client-side by
 * `validateFile` before this is ever called, this is the backend's own
 * enforcement of the same rules.
 */
export async function uploadMeetingFile(
  token: string,
  meetingId: string,
  file: File,
): Promise<MeetingFile> {
  const body = new FormData();
  body.append('file', file);

  const response = await apiFetch(
    `/meetings/${encodeURIComponent(meetingId)}/files`,
    { method: 'POST', token, body },
  );

  return (await response.json()) as MeetingFile;
}

/**
 * `GET /meetings/:id/files` — every file attached to the meeting, newest
 * first, visible to its owner or any participant. Same 401/403 shape as
 * `uploadMeetingFile`.
 */
export async function listMeetingFiles(
  token: string,
  meetingId: string,
): Promise<MeetingFile[]> {
  const response = await apiFetch(
    `/meetings/${encodeURIComponent(meetingId)}/files`,
    { token },
  );

  return (await response.json()) as MeetingFile[];
}

/**
 * `GET /meetings/:id/files/:fileId` — downloads a file and saves it via a
 * throwaway `<a download>` pointed at an object URL. A plain `<a href="...">`
 * can't carry the `Authorization` header this route requires, so the file has
 * to be fetched as a blob first rather than just navigating to the URL. Same
 * 401/403 shape as `uploadMeetingFile`; 404 means the file (or its meeting)
 * was deleted since the list was last loaded.
 */
export async function downloadMeetingFile(
  token: string,
  meetingId: string,
  fileId: string,
  filename: string,
): Promise<void> {
  const response = await apiFetch(
    `/meetings/${encodeURIComponent(meetingId)}/files/${encodeURIComponent(fileId)}`,
    { token },
  );

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);

  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // Deferred rather than revoked immediately after `click()` — the
    // browser needs time to actually start reading the object URL before
    // it's invalidated, and a same-tick `setTimeout(fn, 0)` isn't a
    // guarantee that it has by then (a slow device or a large blob could
    // still be mid-read). A few seconds is a heuristic too, just a much
    // safer margin — there's no cross-browser "download started" event to
    // wait on instead.
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

/**
 * `DELETE /meetings/:id/files/:fileId` — the owner may delete any file, a
 * participant only one they uploaded themselves (`file.uploadedById`
 * matches); enforced by the backend, not this client. Same 401/403 shape as
 * `uploadMeetingFile`; 404 means the file was already deleted (e.g. by
 * another tab, or another participant with the same right).
 */
export async function deleteMeetingFile(
  token: string,
  meetingId: string,
  fileId: string,
): Promise<void> {
  await apiFetch(
    `/meetings/${encodeURIComponent(meetingId)}/files/${encodeURIComponent(fileId)}`,
    { method: 'DELETE', token },
  );
}

/**
 * Mirrors the backend's allowlist
 * (`apps/backend/src/meeting-files/constants/file-upload.constants.ts`) so
 * the picker/dropzone can reject an obviously-invalid file before it ever
 * reaches the network — the backend re-checks the same rule regardless, this
 * is purely a faster/friendlier client-side rejection, not the source of
 * truth. Keep in sync with that file if the allowlist ever changes.
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

/** `<input accept="...">` value built from the same allowlist, so the OS
 * file picker pre-filters to roughly the same set (not a security boundary
 * — `validateFile` is what actually enforces it). */
export const FILE_INPUT_ACCEPT = [
  ...ALLOWED_MIME_PREFIXES.map((prefix) => `${prefix}*`),
  ...ALLOWED_DOCUMENT_MIME_TYPES,
].join(',');

function isAllowedMimeType(mimeType: string): boolean {
  const normalized = mimeType.toLowerCase();
  return (
    ALLOWED_MIME_PREFIXES.some((prefix) => normalized.startsWith(prefix)) ||
    ALLOWED_DOCUMENT_MIME_TYPES.has(normalized)
  );
}

/**
 * Broad category for a file's MIME type, used by the file list to pick a
 * type icon (see `getFileTypeIcon` in `components/meeting-files.tsx`).
 * Derived from the same allowlist `validateFile` enforces, so an allowed
 * file always maps to `'audio' | 'video' | 'document'` — `'other'` is
 * reachable in the UI only for a file the backend accepted under a rule
 * this list doesn't (yet) know about, and gets a generic fallback icon.
 */
export function getFileCategory(
  mimeType: string,
): 'audio' | 'video' | 'document' | 'other' {
  const normalized = mimeType.toLowerCase();
  if (normalized.startsWith('audio/')) return 'audio';
  if (normalized.startsWith('video/')) return 'video';
  if (ALLOWED_DOCUMENT_MIME_TYPES.has(normalized)) return 'document';
  return 'other';
}

/**
 * Mirrors the backend's *documented default* (`FILE_MAX_SIZE_BYTES` in
 * `apps/backend/.env.example`, 50MB) — the actual server-side limit is
 * configurable per deployment and not exposed over the API, so a deployment
 * that changes it will just have this client-side check under- or
 * over-reject slightly until the backend's own check runs; the backend
 * limit is always the one that's actually enforced.
 */
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

/** `MAX_FILE_SIZE_BYTES` in whole MB — the single source for the "50MB"
 * shown to the user, in both `validateFile`'s own rejection message and the
 * dropzone hint text (`components/meeting-files.tsx`). Computed once here
 * rather than in each place that displays it, so the two can't ever show
 * different numbers. */
export const MAX_FILE_SIZE_MB = Math.floor(MAX_FILE_SIZE_BYTES / (1024 * 1024));

/**
 * Client-side pre-check for a file about to be uploaded — returns a
 * human-readable rejection reason, or `null` if the file passes. Called
 * before any network request, so an invalid type or an oversized file is
 * rejected instantly instead of round-tripping to the backend first.
 */
export function validateFile(file: File): string | null {
  if (!isAllowedMimeType(file.type)) {
    return file.type
      ? `Unsupported file type: ${file.type}`
      : 'Unsupported or unrecognized file type';
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return `File is too large (max ${MAX_FILE_SIZE_MB}MB)`;
  }

  return null;
}
