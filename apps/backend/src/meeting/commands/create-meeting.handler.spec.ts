import { PrismaService } from '../../prisma/prisma.service';
import { userRow } from '../../users/testing/user-row.fixture';
import { TEST_OWNER_ID, meetingRow } from '../testing/meeting-row.fixture';
import { CreateMeetingCommand } from './create-meeting.command';
import { CreateMeetingHandler } from './create-meeting.handler';

describe('CreateMeetingHandler', () => {
  let create: jest.Mock;
  let findMany: jest.Mock;
  let handler: CreateMeetingHandler;

  const command = new CreateMeetingCommand(
    TEST_OWNER_ID,
    'Sprint planning',
    '2026-09-01T10:00:00.000Z',
    ['ada@example.com', 'grace@example.com'],
  );

  beforeEach(() => {
    create = jest.fn().mockResolvedValue(meetingRow());
    findMany = jest.fn().mockResolvedValue([]);
    handler = new CreateMeetingHandler({
      meeting: { create },
      user: { findMany },
    } as unknown as PrismaService);
  });

  it('stores the participants as the plain email list they were sent as', async () => {
    await handler.execute(command);

    expect(create).toHaveBeenCalledWith({
      data: {
        ownerId: TEST_OWNER_ID,
        title: 'Sprint planning',
        date: new Date('2026-09-01T10:00:00.000Z'),
        participants: ['ada@example.com', 'grace@example.com'],
      },
    });
  });

  // The create response has to match what a later GET returns, or the
  // frontend gets a differently-shaped meeting depending on how it arrived.
  it('answers with the same expanded participants a read would return', async () => {
    findMany.mockResolvedValue([
      userRow({ name: 'Ada Lovelace', avatarPath: 'avatar-file.png' }),
    ]);

    const meeting = await handler.execute(command);

    expect(meeting.participants).toEqual([
      {
        email: 'ada@example.com',
        name: 'Ada Lovelace',
        avatarUrl: '/api/avatars/avatar-file.png',
      },
      { email: 'grace@example.com', name: null, avatarUrl: null },
    ]);
    expect(meeting.isOwner).toBe(true);
  });
});
