import { PrismaService } from '../../prisma/prisma.service';
import { MEETING_FILE_UPLOADER_INCLUDE } from '../interfaces/meeting-file.interface';
import {
  TEST_MEETING_ID,
  TEST_UPLOADER_ID,
  meetingFileRowWithUploader,
} from '../testing/meeting-file-row.fixture';
import { UploadMeetingFileCommand } from './upload-meeting-file.command';
import { UploadMeetingFileHandler } from './upload-meeting-file.handler';

describe('UploadMeetingFileHandler', () => {
  let create: jest.Mock;
  let handler: UploadMeetingFileHandler;

  const command = new UploadMeetingFileCommand(
    TEST_MEETING_ID,
    TEST_UPLOADER_ID,
    'recording.mp4',
    'video/mp4',
    2048,
    'generated-on-disk-name.mp4',
  );

  beforeEach(() => {
    create = jest.fn().mockResolvedValue(meetingFileRowWithUploader());
    handler = new UploadMeetingFileHandler({
      meetingFile: { create },
    } as unknown as PrismaService);
  });

  // The upload response is what the frontend prepends to its file list
  // without refetching, so it has to be the same shape the list returns —
  // uploader summary included, or the newest row would render nameless
  // until a reload.
  it('persists the metadata and reads the uploader back in the same query', async () => {
    await handler.execute(command);

    expect(create).toHaveBeenCalledWith({
      data: {
        meetingId: TEST_MEETING_ID,
        uploadedById: TEST_UPLOADER_ID,
        filename: 'recording.mp4',
        mimeType: 'video/mp4',
        size: 2048,
        path: 'generated-on-disk-name.mp4',
      },
      include: MEETING_FILE_UPLOADER_INCLUDE,
    });
  });

  it('returns the created file with its uploader summary', async () => {
    create.mockResolvedValue(
      meetingFileRowWithUploader(
        {},
        { name: 'Ada Lovelace', avatarPath: 'avatar-file.png' },
      ),
    );

    const file = await handler.execute(command);

    expect(file.uploadedBy).toEqual({
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      avatarUrl: '/api/avatars/avatar-file.png',
    });
    expect(file).not.toHaveProperty('path');
  });
});
