import { MeetingFile } from '@prisma/client';
import {
  USER_SUMMARY_SELECT,
  UserSummaryResponse,
  UserSummarySource,
  toUserSummary,
} from '../../users/interfaces/user-summary.interface';

/**
 * The fields that come straight off the `MeetingFile` row — everything both
 * the public response and the internal record share. Factored out because
 * the two shapes diverge past this point: only one of them joins the
 * uploader, only the other carries the on-disk path.
 */
export interface MeetingFileFields {
  id: string;
  meetingId: string;
  uploadedById: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

/**
 * Public shape of a meeting file returned by the API.
 *
 * `uploadedById` and `uploadedBy` are both here on purpose and answer
 * different questions: the id is identity (the frontend compares it against
 * the signed-in user to decide who may delete the file), the summary is
 * display (name and avatar, falling back to the email). Neither substitutes
 * for the other.
 */
export interface MeetingFileResponse extends MeetingFileFields {
  uploadedBy: UserSummaryResponse;
}

/**
 * Prisma `include` that brings the uploader's display fields back with the
 * file row(s). Used by the list query specifically so a meeting's whole file
 * list costs one query rather than one lookup per file — anything that
 * produces a `MeetingFileResponse` must go through this, because
 * `toMeetingFileResponse` has no way to fetch an uploader it wasn't given.
 */
export const MEETING_FILE_UPLOADER_INCLUDE = {
  uploadedBy: { select: USER_SUMMARY_SELECT },
} as const;

/** A `MeetingFile` row as Prisma returns it under
 * `MEETING_FILE_UPLOADER_INCLUDE`. */
export type MeetingFileWithUploader = MeetingFile & {
  uploadedBy: UserSummarySource;
};

/** Maps the columns shared by both public and internal shapes. */
function toMeetingFileFields(file: MeetingFile): MeetingFileFields {
  return {
    id: file.id,
    meetingId: file.meetingId,
    uploadedById: file.uploadedById,
    filename: file.filename,
    mimeType: file.mimeType,
    // `size` is a BigInt column (Int would overflow past ~2.1GB, plausible
    // for an audio/video recording) — converted to a plain number here
    // since bigint isn't directly JSON-serializable and no realistic
    // upload gets anywhere near Number.MAX_SAFE_INTEGER bytes.
    size: Number(file.size),
    createdAt: file.createdAt.toISOString(),
  };
}

/** Strips the on-disk `path` (never exposed to clients) from a Prisma row and
 * folds the joined uploader into its public summary. */
export function toMeetingFileResponse(
  file: MeetingFileWithUploader,
): MeetingFileResponse {
  return {
    ...toMeetingFileFields(file),
    uploadedBy: toUserSummary(file.uploadedBy),
  };
}

/**
 * Internal shape carrying the on-disk `path` — like `UserRecord` in
 * `src/users/interfaces/`, this is a cross-handler message type, not an
 * HTTP response shape. Used only by the download route (to address the file
 * on disk and set `Content-Disposition`) and the delete flow; must never be
 * serialized straight to a client the way `MeetingFileResponse` is.
 *
 * It shares `MeetingFileFields` with the response rather than extending the
 * response itself: both callers work with one already-identified file and
 * only ever address it on disk, so joining the uploader for them would be a
 * query nothing reads.
 */
export interface MeetingFileRecord extends MeetingFileFields {
  path: string;
}

export function toMeetingFileRecord(file: MeetingFile): MeetingFileRecord {
  return { ...toMeetingFileFields(file), path: file.path };
}
