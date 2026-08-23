import { MeetingFile } from '@prisma/client';

/** Public shape of a meeting file returned by the API. */
export interface MeetingFileResponse {
  id: string;
  meetingId: string;
  uploadedById: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

/** Strips the on-disk `path` (never exposed to clients) from a Prisma row. */
export function toMeetingFileResponse(file: MeetingFile): MeetingFileResponse {
  return {
    id: file.id,
    meetingId: file.meetingId,
    uploadedById: file.uploadedById,
    filename: file.filename,
    mimeType: file.mimeType,
    size: file.size,
    createdAt: file.createdAt.toISOString(),
  };
}
