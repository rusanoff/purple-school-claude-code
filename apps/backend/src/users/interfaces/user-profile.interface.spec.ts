import { User } from '@prisma/client';
import { toUserProfileResponse } from './user-profile.interface';

const CREATED_AT = new Date('2026-09-05T10:20:30.000Z');

function userRow(overrides: Partial<User> = {}): User {
  return {
    id: 'a3f1c0de-0000-4000-8000-000000000001',
    email: 'ada@example.com',
    passwordHash: '$2b$10$notarealhashatall',
    name: null,
    avatarPath: null,
    createdAt: CREATED_AT,
    updatedAt: new Date('2026-09-06T10:20:30.000Z'),
    ...overrides,
  };
}

describe('toUserProfileResponse', () => {
  it('maps a filled-in profile, turning the stored avatar filename into a URL', () => {
    const profile = toUserProfileResponse(
      userRow({ name: 'Ada Lovelace', avatarPath: 'avatar-file.png' }),
    );

    expect(profile).toEqual({
      id: 'a3f1c0de-0000-4000-8000-000000000001',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      // Spelled out rather than built from AVATAR_URL_PREFIX: the point is to
      // pin the URL a browser actually gets, `/api` prefix included — see the
      // constant's comment for who serves what part of that path.
      avatarUrl: '/api/avatars/avatar-file.png',
      createdAt: '2026-09-05T10:20:30.000Z',
    });
  });

  // Every user registered before the profile columns existed has both fields
  // null — `avatarUrl` must stay null rather than become a URL to nothing.
  it('keeps name and avatarUrl null for a user who never filled them in', () => {
    const profile = toUserProfileResponse(userRow());

    expect(profile.name).toBeNull();
    expect(profile.avatarUrl).toBeNull();
  });

  it('exposes no persistence-only fields', () => {
    const profile = toUserProfileResponse(
      userRow({ name: 'Ada Lovelace', avatarPath: 'avatar-file.png' }),
    );

    expect(Object.keys(profile).sort()).toEqual([
      'avatarUrl',
      'createdAt',
      'email',
      'id',
      'name',
    ]);
  });
});
