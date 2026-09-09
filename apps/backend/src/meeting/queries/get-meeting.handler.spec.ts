import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { USER_SUMMARY_SELECT } from '../../users/interfaces/user-summary.interface';
import { userRow } from '../../users/testing/user-row.fixture';
import {
  TEST_MEETING_ID,
  TEST_OWNER_ID,
  meetingRow,
} from '../testing/meeting-row.fixture';
import { GetMeetingHandler } from './get-meeting.handler';
import { GetMeetingQuery } from './get-meeting.query';

describe('GetMeetingHandler', () => {
  let findUnique: jest.Mock;
  let findMany: jest.Mock;
  let handler: GetMeetingHandler;

  const query = new GetMeetingQuery(
    TEST_OWNER_ID,
    'owner@example.com',
    TEST_MEETING_ID,
  );

  beforeEach(() => {
    findUnique = jest.fn().mockResolvedValue(meetingRow());
    findMany = jest.fn().mockResolvedValue([]);
    handler = new GetMeetingHandler({
      meeting: { findUnique },
      user: { findMany },
    } as unknown as PrismaService);
  });

  it('expands the participants into display summaries in one extra query', async () => {
    findMany.mockResolvedValue([
      userRow({ name: 'Ada Lovelace', avatarPath: 'avatar-file.png' }),
    ]);

    const meeting = await handler.execute(query);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({
      where: { email: { in: ['ada@example.com', 'grace@example.com'] } },
      select: USER_SUMMARY_SELECT,
    });
    expect(meeting.participants).toEqual([
      {
        email: 'ada@example.com',
        name: 'Ada Lovelace',
        avatarUrl: '/api/avatars/avatar-file.png',
      },
      { email: 'grace@example.com', name: null, avatarUrl: null },
    ]);
  });

  it('404s for a meeting that does not exist', async () => {
    findUnique.mockResolvedValue(null);

    await expect(handler.execute(query)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  // The participant lookup must not become a way to read a meeting the caller
  // can't see — access is asserted before anything else is fetched.
  it('403s before looking any participant up when the caller has no access', async () => {
    await expect(
      handler.execute(
        new GetMeetingQuery(
          'intruder',
          'intruder@example.com',
          TEST_MEETING_ID,
        ),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(findMany).not.toHaveBeenCalled();
  });
});
