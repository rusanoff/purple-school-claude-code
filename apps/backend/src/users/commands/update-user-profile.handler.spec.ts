import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TEST_USER_ID as USER_ID, userRow } from '../testing/user-row.fixture';
import { UpdateUserProfileCommand } from './update-user-profile.command';
import { UpdateUserProfileHandler } from './update-user-profile.handler';

describe('UpdateUserProfileHandler', () => {
  let update: jest.Mock;
  let handler: UpdateUserProfileHandler;

  beforeEach(() => {
    update = jest.fn();
    handler = new UpdateUserProfileHandler({
      user: { update },
    } as unknown as PrismaService);
  });

  it("writes the new name to the caller's own row and returns the updated profile", async () => {
    update.mockResolvedValue(userRow({ name: 'Ada Lovelace' }));

    const profile = await handler.execute(
      new UpdateUserProfileCommand(USER_ID, 'Ada Lovelace'),
    );

    // The id comes from the caller's own JWT, so — as with
    // GetUserProfileHandler — this `where` is the whole authorization story:
    // a user can only ever write their own row.
    expect(update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { name: 'Ada Lovelace' },
    });
    expect(profile).toEqual({
      id: USER_ID,
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      avatarUrl: null,
      createdAt: '2026-09-05T10:20:30.000Z',
    });
  });

  it('returns the same public shape as GET /users/me, password hash excluded', async () => {
    update.mockResolvedValue(
      userRow({ name: 'Ada Lovelace', avatarPath: 'avatar-file.png' }),
    );

    const profile = await handler.execute(
      new UpdateUserProfileCommand(USER_ID, 'Ada Lovelace'),
    );

    expect(Object.keys(profile).sort()).toEqual([
      'avatarUrl',
      'createdAt',
      'email',
      'id',
      'name',
    ]);
    expect(profile.avatarUrl).toBe('/api/avatars/avatar-file.png');
  });

  // A valid token whose user row is gone (deleted between issuing the token
  // and this request): Prisma reports "record to update not found" (P2025),
  // which is a missing resource, not a failed authentication — same 404 as
  // GetUserProfileHandler returns for the same situation.
  it('throws NotFoundException when the row to update is gone', async () => {
    update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Record to update not found', {
        code: 'P2025',
        clientVersion: '0.0.0',
      }),
    );

    await expect(
      handler.execute(new UpdateUserProfileCommand(USER_ID, 'Ada Lovelace')),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rethrows any other Prisma failure untouched', async () => {
    const failure = new Prisma.PrismaClientKnownRequestError('Timed out', {
      code: 'P2024',
      clientVersion: '0.0.0',
    });
    update.mockRejectedValue(failure);

    await expect(
      handler.execute(new UpdateUserProfileCommand(USER_ID, 'Ada Lovelace')),
    ).rejects.toBe(failure);
  });
});
