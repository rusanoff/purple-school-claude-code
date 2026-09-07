import { Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AvatarStorageService } from '../storage/avatar-storage.service';
import { TEST_USER_ID, userRow } from '../testing/user-row.fixture';
import { ClearUserAvatarCommand } from './clear-user-avatar.command';
import { ClearUserAvatarHandler } from './clear-user-avatar.handler';

const STORED_FILENAME = '1111111111111111111111111111111a.png';

describe('ClearUserAvatarHandler', () => {
  let findUnique: jest.Mock;
  let update: jest.Mock;
  let deleteAvatar: jest.Mock;
  let handler: ClearUserAvatarHandler;

  beforeEach(() => {
    findUnique = jest.fn().mockResolvedValue({ avatarPath: STORED_FILENAME });
    update = jest.fn().mockResolvedValue(userRow({ avatarPath: null }));
    deleteAvatar = jest.fn().mockResolvedValue(undefined);
    handler = new ClearUserAvatarHandler(
      { user: { findUnique, update } } as unknown as PrismaService,
      { deleteAvatar } as unknown as AvatarStorageService,
    );
  });

  it("clears the caller's own avatar column and removes the stored file", async () => {
    const profile = await handler.execute(
      new ClearUserAvatarCommand(TEST_USER_ID),
    );

    // The `where` carries the stored filename as well as the id: the row is
    // what makes this request the one allowed to remove that file, so a
    // concurrent write that already moved it on must make this update miss.
    expect(update).toHaveBeenCalledWith({
      where: { id: TEST_USER_ID, avatarPath: STORED_FILENAME },
      data: { avatarPath: null },
    });
    expect(deleteAvatar).toHaveBeenCalledWith(STORED_FILENAME);
    // The profile comes back with the avatar already gone, so the client can
    // use it directly instead of re-fetching to find out.
    expect(profile).toEqual({
      id: TEST_USER_ID,
      email: 'ada@example.com',
      name: null,
      avatarUrl: null,
      createdAt: '2026-09-05T10:20:30.000Z',
    });
  });

  // Deleting an avatar that isn't there is the state the caller asked for, so
  // it succeeds — and with nothing on disk to remove there is nothing to fail
  // on either.
  it('is a no-op success when the user has no avatar', async () => {
    findUnique.mockResolvedValue({ avatarPath: null });

    const profile = await handler.execute(
      new ClearUserAvatarCommand(TEST_USER_ID),
    );

    expect(profile.avatarUrl).toBeNull();
    expect(deleteAvatar).not.toHaveBeenCalled();
  });

  it('clears the row before removing the file', async () => {
    await handler.execute(new ClearUserAvatarCommand(TEST_USER_ID));

    expect(update.mock.invocationCallOrder[0]).toBeLessThan(
      deleteAvatar.mock.invocationCallOrder[0],
    );
  });

  it('throws NotFoundException when the row is gone, without writing or deleting', async () => {
    findUnique.mockResolvedValue(null);

    await expect(
      handler.execute(new ClearUserAvatarCommand(TEST_USER_ID)),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(update).not.toHaveBeenCalled();
    expect(deleteAvatar).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when the row disappears between the read and the update', async () => {
    findUnique
      .mockResolvedValueOnce({ avatarPath: STORED_FILENAME })
      .mockResolvedValueOnce(null);
    update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Record to update not found', {
        code: 'P2025',
        clientVersion: '0.0.0',
      }),
    );

    await expect(
      handler.execute(new ClearUserAvatarCommand(TEST_USER_ID)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rethrows any other Prisma failure untouched', async () => {
    const failure = new Prisma.PrismaClientKnownRequestError('Timed out', {
      code: 'P2024',
      clientVersion: '0.0.0',
    });
    update.mockRejectedValue(failure);

    await expect(
      handler.execute(new ClearUserAvatarCommand(TEST_USER_ID)),
    ).rejects.toBe(failure);
  });

  // The row no longer references the file, so from the caller's side the
  // delete has already happened — a disk error here is logged, not turned
  // into a 500 that would suggest the avatar is still there.
  it('succeeds even when removing the file fails', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    deleteAvatar.mockRejectedValue(new Error('EBUSY'));

    await expect(
      handler.execute(new ClearUserAvatarCommand(TEST_USER_ID)),
    ).resolves.toMatchObject({ avatarUrl: null });
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });
});
