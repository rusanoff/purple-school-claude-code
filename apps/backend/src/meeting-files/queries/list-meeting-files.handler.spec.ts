import { PrismaService } from '../../prisma/prisma.service';
import { MEETING_FILE_UPLOADER_INCLUDE } from '../interfaces/meeting-file.interface';
import {
  TEST_MEETING_ID,
  meetingFileRowWithUploader,
} from '../testing/meeting-file-row.fixture';
import { ListMeetingFilesHandler } from './list-meeting-files.handler';
import { ListMeetingFilesQuery } from './list-meeting-files.query';

describe('ListMeetingFilesHandler', () => {
  let findMany: jest.Mock;
  let handler: ListMeetingFilesHandler;

  beforeEach(() => {
    findMany = jest.fn().mockResolvedValue([]);
    handler = new ListMeetingFilesHandler({
      meetingFile: { findMany },
    } as unknown as PrismaService);
  });

  // The N+1 guard: the uploader profiles have to come from the same
  // `findMany` as the rows themselves, never from a per-file lookup the
  // handler runs in a loop.
  it('fetches the files newest-first and joins the uploader in the same query', async () => {
    await handler.execute(new ListMeetingFilesQuery(TEST_MEETING_ID));

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({
      where: { meetingId: TEST_MEETING_ID },
      orderBy: { createdAt: 'desc' },
      include: MEETING_FILE_UPLOADER_INCLUDE,
    });
  });

  it('maps every row to a response carrying its uploader summary', async () => {
    findMany.mockResolvedValue([
      meetingFileRowWithUploader(
        { id: 'file-1' },
        { name: 'Ada Lovelace', avatarPath: 'avatar-file.png' },
      ),
      meetingFileRowWithUploader(
        { id: 'file-2' },
        { email: 'grace@example.com' },
      ),
    ]);

    const files = await handler.execute(
      new ListMeetingFilesQuery(TEST_MEETING_ID),
    );

    expect(files.map((file) => file.uploadedBy)).toEqual([
      {
        email: 'ada@example.com',
        name: 'Ada Lovelace',
        avatarUrl: '/api/avatars/avatar-file.png',
      },
      { email: 'grace@example.com', name: null, avatarUrl: null },
    ]);
  });
});
