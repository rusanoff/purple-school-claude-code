import { userRow } from '../testing/user-row.fixture';
import { USER_SUMMARY_SELECT, toUserSummary } from './user-summary.interface';

describe('toUserSummary', () => {
  it('maps a filled-in profile, turning the stored avatar filename into a URL', () => {
    const summary = toUserSummary(
      userRow({ name: 'Ada Lovelace', avatarPath: 'avatar-file.png' }),
    );

    expect(summary).toEqual({
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      // Same `/api`-prefixed value `GET /users/me` returns, deliberately:
      // both come from `toAvatarUrl`, so a summary avatar drops into an
      // `<img src>` exactly like the signed-in user's own.
      avatarUrl: '/api/avatars/avatar-file.png',
    });
  });

  it('keeps name and avatarUrl null for a user who never filled them in', () => {
    const summary = toUserSummary(userRow());

    expect(summary.name).toBeNull();
    expect(summary.avatarUrl).toBeNull();
  });

  // This shape describes *other* people, not the caller — anything beyond
  // the three display fields is either useless to a client or actively
  // shouldn't be handed out about someone else.
  it('exposes nothing beyond the three display fields', () => {
    const summary = toUserSummary(
      userRow({ name: 'Ada Lovelace', avatarPath: 'avatar-file.png' }),
    );

    expect(Object.keys(summary).sort()).toEqual(['avatarUrl', 'email', 'name']);
  });
});

describe('USER_SUMMARY_SELECT', () => {
  // The select is what actually keeps the password hash out of the rows a
  // summary is built from: `toUserSummary` can only drop fields it is
  // handed, whereas this stops them being read at all.
  it('selects exactly the columns toUserSummary reads, hash excluded', () => {
    expect(USER_SUMMARY_SELECT).toEqual({
      email: true,
      name: true,
      avatarPath: true,
    });
  });
});
