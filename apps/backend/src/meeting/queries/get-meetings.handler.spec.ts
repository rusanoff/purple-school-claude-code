import { PrismaService } from '../../prisma/prisma.service';
import { USER_SUMMARY_SELECT } from '../../users/interfaces/user-summary.interface';
import { userRow } from '../../users/testing/user-row.fixture';
import { TEST_OWNER_ID, meetingRow } from '../testing/meeting-row.fixture';
import { GetMeetingsHandler } from './get-meetings.handler';
import { GetMeetingsQuery } from './get-meetings.query';

describe('GetMeetingsHandler', () => {
  let findMany: jest.Mock;
  let findManyUsers: jest.Mock;
  let handler: GetMeetingsHandler;

  beforeEach(() => {
    findMany = jest.fn().mockResolvedValue([]);
    findManyUsers = jest.fn().mockResolvedValue([]);
    handler = new GetMeetingsHandler({
      meeting: { findMany },
      user: { findMany: findManyUsers },
    } as unknown as PrismaService);
  });

  it('lists the caller-owned meetings newest-first', async () => {
    await handler.execute(new GetMeetingsQuery(TEST_OWNER_ID));

    expect(findMany).toHaveBeenCalledWith({
      where: { ownerId: TEST_OWNER_ID },
      orderBy: { createdAt: 'desc' },
    });
  });

  // The N+1 guard for the list: participants of *every* meeting on the page
  // are resolved by one query, not one per meeting and certainly not one per
  // participant.
  it('resolves the participants of the whole page in a single query', async () => {
    findMany.mockResolvedValue([
      meetingRow({ id: 'meeting-1' }),
      meetingRow({
        id: 'meeting-2',
        participants: ['ada@example.com', 'linus@example.com'],
      }),
    ]);
    findManyUsers.mockResolvedValue([
      userRow({ name: 'Ada Lovelace', avatarPath: 'avatar-file.png' }),
    ]);

    const meetings = await handler.execute(new GetMeetingsQuery(TEST_OWNER_ID));

    expect(findManyUsers).toHaveBeenCalledTimes(1);
    expect(findManyUsers).toHaveBeenCalledWith({
      where: {
        email: {
          in: ['ada@example.com', 'grace@example.com', 'linus@example.com'],
        },
      },
      select: USER_SUMMARY_SELECT,
    });
    expect(meetings.map(({ participants }) => participants)).toEqual([
      [
        {
          email: 'ada@example.com',
          name: 'Ada Lovelace',
          avatarUrl: '/api/avatars/avatar-file.png',
        },
        { email: 'grace@example.com', name: null, avatarUrl: null },
      ],
      [
        {
          email: 'ada@example.com',
          name: 'Ada Lovelace',
          avatarUrl: '/api/avatars/avatar-file.png',
        },
        { email: 'linus@example.com', name: null, avatarUrl: null },
      ],
    ]);
  });

  it('marks every meeting in the owner-scoped list as owned', async () => {
    findMany.mockResolvedValue([meetingRow()]);

    const meetings = await handler.execute(new GetMeetingsQuery(TEST_OWNER_ID));

    expect(meetings.map(({ isOwner }) => isOwner)).toEqual([true]);
  });
});
