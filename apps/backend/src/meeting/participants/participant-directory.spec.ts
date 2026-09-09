import { PrismaService } from '../../prisma/prisma.service';
import { USER_SUMMARY_SELECT } from '../../users/interfaces/user-summary.interface';
import { userRow } from '../../users/testing/user-row.fixture';
import {
  loadParticipantDirectory,
  toParticipantSummary,
} from './participant-directory';

function prismaWith(findMany: jest.Mock): PrismaService {
  return { user: { findMany } } as unknown as PrismaService;
}

describe('loadParticipantDirectory', () => {
  // The N+1 guard: however many participants (or meetings) are in play, the
  // directory costs one query, never one lookup per email.
  it('looks the whole participant list up in a single query', async () => {
    const findMany = jest.fn().mockResolvedValue([]);

    await loadParticipantDirectory(prismaWith(findMany), [
      'ada@example.com',
      'grace@example.com',
    ]);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({
      where: { email: { in: ['ada@example.com', 'grace@example.com'] } },
      select: USER_SUMMARY_SELECT,
    });
  });

  // Meetings share participants, so the flattened list of a whole page of
  // meetings repeats emails — asking the database about each repeat is waste.
  it('asks about each email once even when it repeats', async () => {
    const findMany = jest.fn().mockResolvedValue([]);

    await loadParticipantDirectory(prismaWith(findMany), [
      'ada@example.com',
      'grace@example.com',
      'ada@example.com',
    ]);

    expect(findMany).toHaveBeenCalledWith({
      where: { email: { in: ['ada@example.com', 'grace@example.com'] } },
      select: USER_SUMMARY_SELECT,
    });
  });

  it('skips the query entirely when there are no participants', async () => {
    const findMany = jest.fn().mockResolvedValue([]);

    const directory = await loadParticipantDirectory(prismaWith(findMany), []);

    expect(findMany).not.toHaveBeenCalled();
    expect(directory.size).toBe(0);
  });

  it('keys every registered participant by email', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValue([
        userRow({ name: 'Ada Lovelace', avatarPath: 'avatar-file.png' }),
        userRow({ email: 'grace@example.com' }),
      ]);

    const directory = await loadParticipantDirectory(prismaWith(findMany), [
      'ada@example.com',
      'grace@example.com',
    ]);

    expect(directory.get('ada@example.com')).toEqual({
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      avatarUrl: '/api/avatars/avatar-file.png',
    });
    expect(directory.get('grace@example.com')).toEqual({
      email: 'grace@example.com',
      name: null,
      avatarUrl: null,
    });
  });
});

describe('toParticipantSummary', () => {
  it('returns the registered user summary when the email is in the directory', () => {
    const summary = {
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      avatarUrl: '/api/avatars/avatar-file.png',
    };

    expect(
      toParticipantSummary(
        'ada@example.com',
        new Map([['ada@example.com', summary]]),
      ),
    ).toEqual(summary);
  });

  // Participants are free-form emails, not user references — most of them
  // will never have an account, and those still have to render as *someone*.
  it('falls back to the bare email for an unregistered participant', () => {
    expect(toParticipantSummary('nobody@example.com', new Map())).toEqual({
      email: 'nobody@example.com',
      name: null,
      avatarUrl: null,
    });
  });
});
