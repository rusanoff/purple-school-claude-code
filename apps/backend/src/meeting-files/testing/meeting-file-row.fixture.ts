import { MeetingFile } from '@prisma/client';
import { TEST_USER_ID, userRow } from '../../users/testing/user-row.fixture';
import { MeetingFileWithUploader } from '../interfaces/meeting-file.interface';

export const TEST_MEETING_ID = 'b7c2d1ef-0000-4000-8000-000000000010';
export const TEST_MEETING_FILE_ID = 'c8d3e2fa-0000-4000-8000-000000000020';
/** Same id `userRow` carries, so the row's `uploadedById` and the uploader
 * joined onto it always describe the same person. */
export const TEST_UPLOADER_ID = TEST_USER_ID;

/**
 * A complete Prisma `MeetingFile` row for unit tests, overridable field by
 * field — the same "full row shape in one place" reasoning as
 * `userRow` in `src/users/testing/`: every spec that stubs
 * `prisma.meetingFile` needs one, and a private copy per spec is a place a
 * new column can be forgotten.
 */
export function meetingFileRow(
  overrides: Partial<MeetingFile> = {},
): MeetingFile {
  return {
    id: TEST_MEETING_FILE_ID,
    meetingId: TEST_MEETING_ID,
    uploadedById: TEST_UPLOADER_ID,
    filename: 'recording.mp4',
    mimeType: 'video/mp4',
    size: BigInt(2048),
    path: 'generated-on-disk-name.mp4',
    createdAt: new Date('2026-09-05T10:20:30.000Z'),
    ...overrides,
  };
}

/**
 * The same row as Prisma returns it once the uploader relation is included —
 * i.e. what `toMeetingFileResponse` actually consumes. The uploader is built
 * from `userRow` so the two fixtures can't drift on the profile columns.
 */
export function meetingFileRowWithUploader(
  overrides: Partial<MeetingFile> = {},
  uploaderOverrides: Parameters<typeof userRow>[0] = {},
): MeetingFileWithUploader {
  const { email, name, avatarPath } = userRow(uploaderOverrides);

  return {
    ...meetingFileRow(overrides),
    uploadedBy: { email, name, avatarPath },
  };
}
