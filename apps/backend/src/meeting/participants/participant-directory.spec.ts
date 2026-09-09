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
      where: {
        email: {
          in: ['ada@example.com', 'grace@example.com'],
          mode: 'insensitive',
        },
      },
      select: USER_SUMMARY_SELECT,
    });
  });

  // Neither side of the comparison is normalized at write time: an organizer
  // types participant emails by hand, and registration stores an email exactly
  // as it was typed too. Matching them byte for byte would leave a registered
  // participant looking like a stranger over nothing but a capital letter —
  // the same rule `assertMeetingAccess` already applies to decide who may read
  // the meeting at all, so a participant who is let in must also be recognized.
  it('asks for the emails case-insensitively and lowercased', async () => {
    const findMany = jest.fn().mockResolvedValue([]);

    await loadParticipantDirectory(prismaWith(findMany), ['Ada@Example.COM']);

    expect(findMany).toHaveBeenCalledWith({
      where: { email: { in: ['ada@example.com'], mode: 'insensitive' } },
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
      where: {
        email: {
          in: ['ada@example.com', 'grace@example.com'],
          mode: 'insensitive',
        },
      },
      select: USER_SUMMARY_SELECT,
    });
  });

  // Deduplication has to happen on the same normalized form the lookup uses,
  // or two spellings of one person would each take a slot in the `in` list.
  it('collapses emails that differ only in case', async () => {
    const findMany = jest.fn().mockResolvedValue([]);

    await loadParticipantDirectory(prismaWith(findMany), [
      'ada@example.com',
      'ADA@example.com',
    ]);

    expect(findMany).toHaveBeenCalledWith({
      where: { email: { in: ['ada@example.com'], mode: 'insensitive' } },
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

  // Registration never normalized anything either, so the insensitive filter
  // can legitimately come back with two accounts for one participant email.
  // The pair has to collapse to one summary; what matters is that the same
  // pair always collapses to the *same* summary.
  it('resolves a case-only duplicate account the same way every time', async () => {
    const rows = [
      userRow({ email: 'ADA@example.com', name: 'Impostor' }),
      userRow({ email: 'ada@example.com', name: 'Ada Lovelace' }),
    ];
    // `orderBy` is the database's job; the tie-break must not additionally
    // depend on the order the rows happen to arrive in.
    const findMany = jest.fn().mockResolvedValue(rows);
    const reversed = jest.fn().mockResolvedValue([...rows].reverse());

    const directory = await loadParticipantDirectory(prismaWith(findMany), [
      'ada@example.com',
    ]);
    const again = await loadParticipantDirectory(prismaWith(reversed), [
      'ada@example.com',
    ]);

    expect(directory.size).toBe(1);
    expect(directory.get('ada@example.com')).toEqual(
      again.get('ada@example.com'),
    );
  });

  // A case-insensitive `in` matches rows whose stored email is spelled
  // differently from the participant entry, so keying the map by the row's
  // own email would produce a key no lookup ever asks for.
  it('keys the directory by the lowercased email, whatever case the row is stored in', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValue([userRow({ email: 'Ada@Example.COM' })]);

    const directory = await loadParticipantDirectory(prismaWith(findMany), [
      'ada@example.com',
    ]);

    expect(directory.get('ada@example.com')).toEqual({
      // The summary itself still carries the email as the account owns it —
      // only the key is normalized.
      email: 'Ada@Example.COM',
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

  // The other half of the normalization: the meeting stores the email as the
  // organizer typed it, so the lookup key has to be normalized on the way in
  // too — otherwise a directory that *did* find the user is missed anyway.
  it('finds the user when the meeting spells the email in a different case', () => {
    const summary = {
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      avatarUrl: null,
    };

    expect(
      toParticipantSummary(
        'ADA@Example.com',
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

  // Nothing is known about an unregistered participant beyond the string the
  // organizer typed, so that string is echoed back untouched: lowercasing it
  // would show the participant an address that is not the one on the meeting.
  it('echoes an unregistered email back in its original case', () => {
    expect(toParticipantSummary('Nobody@Example.COM', new Map())).toEqual({
      email: 'Nobody@Example.COM',
      name: null,
      avatarUrl: null,
    });
  });
});
