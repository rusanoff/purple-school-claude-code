import { NotFoundException } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GetUserProfileHandler } from './get-user-profile.handler';
import { GetUserProfileQuery } from './get-user-profile.query';

const USER_ID = 'a3f1c0de-0000-4000-8000-000000000001';

function userRow(overrides: Partial<User> = {}): User {
  return {
    id: USER_ID,
    email: 'ada@example.com',
    passwordHash: '$2b$10$notarealhashatall',
    name: null,
    avatarPath: null,
    createdAt: new Date('2026-09-05T10:20:30.000Z'),
    updatedAt: new Date('2026-09-06T10:20:30.000Z'),
    ...overrides,
  };
}

describe('GetUserProfileHandler', () => {
  let findUnique: jest.Mock;
  let handler: GetUserProfileHandler;

  beforeEach(() => {
    findUnique = jest.fn();
    handler = new GetUserProfileHandler({
      user: { findUnique },
    } as unknown as PrismaService);
  });

  it('looks the user up by id and returns the mapped profile', async () => {
    findUnique.mockResolvedValue(
      userRow({ name: 'Ada Lovelace', avatarPath: 'avatar-file.png' }),
    );

    const profile = await handler.execute(new GetUserProfileQuery(USER_ID));

    // The id comes from the caller's own JWT, so this is the whole
    // authorization story: a user can only ever read their own row.
    expect(findUnique).toHaveBeenCalledWith({ where: { id: USER_ID } });
    expect(profile).toEqual({
      id: USER_ID,
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      avatarUrl: '/api/avatars/avatar-file.png',
      createdAt: '2026-09-05T10:20:30.000Z',
    });
  });

  it('keeps name and avatarUrl null for a user who never filled them in', async () => {
    findUnique.mockResolvedValue(userRow());

    const profile = await handler.execute(new GetUserProfileQuery(USER_ID));

    expect(profile.name).toBeNull();
    expect(profile.avatarUrl).toBeNull();
  });

  it('returns no persistence-only fields, password hash included', async () => {
    findUnique.mockResolvedValue(userRow());

    const profile = await handler.execute(new GetUserProfileQuery(USER_ID));

    expect(Object.keys(profile).sort()).toEqual([
      'avatarUrl',
      'createdAt',
      'email',
      'id',
      'name',
    ]);
  });

  // A valid token whose user row is gone (deleted between issuing the token
  // and this request): authentication succeeded, the resource just isn't
  // there any more — 404, not 401.
  it('throws NotFoundException when no user matches the id', async () => {
    findUnique.mockResolvedValue(null);

    await expect(
      handler.execute(new GetUserProfileQuery(USER_ID)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
