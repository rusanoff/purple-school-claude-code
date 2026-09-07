import { Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AvatarStorageService } from '../storage/avatar-storage.service';
import { TEST_USER_ID, userRow } from '../testing/user-row.fixture';
import { SetUserAvatarCommand } from './set-user-avatar.command';
import { SetUserAvatarHandler } from './set-user-avatar.handler';

const PREVIOUS_FILENAME = '1111111111111111111111111111111a.png';
const NEW_FILENAME = '2222222222222222222222222222222b.webp';

describe('SetUserAvatarHandler', () => {
  let findUnique: jest.Mock;
  let update: jest.Mock;
  let deleteAvatar: jest.Mock;
  let handler: SetUserAvatarHandler;

  beforeEach(() => {
    findUnique = jest.fn().mockResolvedValue({ avatarPath: null });
    update = jest.fn().mockResolvedValue(userRow({ avatarPath: NEW_FILENAME }));
    deleteAvatar = jest.fn().mockResolvedValue(undefined);
    handler = new SetUserAvatarHandler(
      { user: { findUnique, update } } as unknown as PrismaService,
      { deleteAvatar } as unknown as AvatarStorageService,
    );
  });

  it("stores the generated filename on the caller's own row and returns the updated profile", async () => {
    const profile = await handler.execute(
      new SetUserAvatarCommand(TEST_USER_ID, NEW_FILENAME),
    );

    // The id comes from the caller's own JWT, so this `where` is the whole
    // authorization story — a user can only ever point their own row at a
    // file they just uploaded.
    expect(update).toHaveBeenCalledWith({
      where: { id: TEST_USER_ID },
      data: { avatarPath: NEW_FILENAME },
    });
    expect(profile).toEqual({
      id: TEST_USER_ID,
      email: 'ada@example.com',
      name: null,
      avatarUrl: `/api/avatars/${NEW_FILENAME}`,
      createdAt: '2026-09-05T10:20:30.000Z',
    });
  });

  it('returns the same public shape as GET /users/me, password hash excluded', async () => {
    const profile = await handler.execute(
      new SetUserAvatarCommand(TEST_USER_ID, NEW_FILENAME),
    );

    expect(Object.keys(profile).sort()).toEqual([
      'avatarUrl',
      'createdAt',
      'email',
      'id',
      'name',
    ]);
  });

  // Replacing an avatar is the case the phase is explicit about: the old
  // image must stop existing, or it stays fetchable at its public URL forever
  // and the directory grows a file per upload.
  it('removes the previously stored file when replacing an avatar', async () => {
    findUnique.mockResolvedValue({ avatarPath: PREVIOUS_FILENAME });

    await handler.execute(new SetUserAvatarCommand(TEST_USER_ID, NEW_FILENAME));

    expect(deleteAvatar).toHaveBeenCalledWith(PREVIOUS_FILENAME);
  });

  it('touches no file when the user had no avatar yet', async () => {
    await handler.execute(new SetUserAvatarCommand(TEST_USER_ID, NEW_FILENAME));

    expect(deleteAvatar).not.toHaveBeenCalled();
  });

  // Row first, disk second: a failed disk removal then leaves an orphaned
  // file (a leak, but one nobody can reach through the API) rather than a row
  // pointing at bytes that are already gone.
  it('updates the row before removing the old file', async () => {
    findUnique.mockResolvedValue({ avatarPath: PREVIOUS_FILENAME });

    await handler.execute(new SetUserAvatarCommand(TEST_USER_ID, NEW_FILENAME));

    expect(update.mock.invocationCallOrder[0]).toBeLessThan(
      deleteAvatar.mock.invocationCallOrder[0],
    );
  });

  // A valid token whose user row is gone (deleted after the token was
  // issued). Same 404 GetUserProfileHandler gives for the same situation —
  // and nothing may be removed from disk on the way out, since the file the
  // command names was just written for this request and the controller is the
  // one that cleans it up.
  it('throws NotFoundException when the row is gone, without writing or deleting', async () => {
    findUnique.mockResolvedValue(null);

    await expect(
      handler.execute(new SetUserAvatarCommand(TEST_USER_ID, NEW_FILENAME)),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(update).not.toHaveBeenCalled();
    expect(deleteAvatar).not.toHaveBeenCalled();
  });

  // The row can also disappear in the gap between that read and the update —
  // Prisma reports it as P2025, which has to end up as the same 404 rather
  // than a raw 500.
  it('throws NotFoundException when the row disappears between the read and the update', async () => {
    update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Record to update not found', {
        code: 'P2025',
        clientVersion: '0.0.0',
      }),
    );

    await expect(
      handler.execute(new SetUserAvatarCommand(TEST_USER_ID, NEW_FILENAME)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rethrows any other Prisma failure untouched', async () => {
    const failure = new Prisma.PrismaClientKnownRequestError('Timed out', {
      code: 'P2024',
      clientVersion: '0.0.0',
    });
    update.mockRejectedValue(failure);

    await expect(
      handler.execute(new SetUserAvatarCommand(TEST_USER_ID, NEW_FILENAME)),
    ).rejects.toBe(failure);
  });

  // The new avatar is already persisted by the time the old file is removed:
  // failing the request over that would tell the client the upload didn't
  // take effect when it did, and a retry would only orphan another file.
  it('succeeds even when removing the old file fails', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    findUnique.mockResolvedValue({ avatarPath: PREVIOUS_FILENAME });
    deleteAvatar.mockRejectedValue(new Error('EBUSY'));

    await expect(
      handler.execute(new SetUserAvatarCommand(TEST_USER_ID, NEW_FILENAME)),
    ).resolves.toMatchObject({ avatarUrl: `/api/avatars/${NEW_FILENAME}` });
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });
});
