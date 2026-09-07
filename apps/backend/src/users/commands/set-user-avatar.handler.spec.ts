import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AvatarStorageService } from '../storage/avatar-storage.service';
import { TEST_USER_ID, userRow } from '../testing/user-row.fixture';
import { SetUserAvatarCommand } from './set-user-avatar.command';
import { SetUserAvatarHandler } from './set-user-avatar.handler';

const PREVIOUS_FILENAME = '1111111111111111111111111111111a.png';
const NEW_FILENAME = '2222222222222222222222222222222b.webp';

/** What Prisma raises when the compare-and-set `where` matches no row —
 * either the row is gone, or another write changed the avatar first. */
function notFoundOnUpdate(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'Record to update not found',
    {
      code: 'P2025',
      clientVersion: '0.0.0',
    },
  );
}

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
      where: { id: TEST_USER_ID, avatarPath: null },
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

  // The row can also disappear in the gap between that read and the update.
  // The compare-and-set reports that as P2025 — the same code a lost race
  // gets — so it is the re-read that tells the two apart, and this one has to
  // end up as the same 404 rather than a raw 500.
  it('throws NotFoundException when the row disappears between the read and the update', async () => {
    findUnique
      .mockResolvedValueOnce({ avatarPath: null })
      .mockResolvedValueOnce(null);
    update.mockRejectedValue(notFoundOnUpdate());

    await expect(
      handler.execute(new SetUserAvatarCommand(TEST_USER_ID, NEW_FILENAME)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  // Losing the compare-and-set means a concurrent write moved the row on
  // between this request's read and its update, so the previous filename it
  // was about to delete is no longer the one stored — re-read and compare
  // against the new one instead of deleting a file this request doesn't own.
  it('re-reads and retries against the new previous filename after losing the race', async () => {
    const RACED_FILENAME = '3333333333333333333333333333333c.jpg';
    findUnique
      .mockResolvedValueOnce({ avatarPath: PREVIOUS_FILENAME })
      .mockResolvedValueOnce({ avatarPath: RACED_FILENAME });
    update
      .mockRejectedValueOnce(notFoundOnUpdate())
      .mockResolvedValue(userRow({ avatarPath: NEW_FILENAME }));

    await handler.execute(new SetUserAvatarCommand(TEST_USER_ID, NEW_FILENAME));

    expect(update).toHaveBeenLastCalledWith({
      where: { id: TEST_USER_ID, avatarPath: RACED_FILENAME },
      data: { avatarPath: NEW_FILENAME },
    });
    // The file the losing attempt read is now someone else's to remove — only
    // the write that actually replaced `RACED_FILENAME` may delete it.
    expect(deleteAvatar).toHaveBeenCalledTimes(1);
    expect(deleteAvatar).toHaveBeenCalledWith(RACED_FILENAME);
  });

  // Retrying forever would let a client hold a request open indefinitely, and
  // writing unconditionally would orphan the very file the compare-and-set
  // exists to keep track of.
  it('gives up with a ConflictException when every attempt loses the race', async () => {
    findUnique.mockResolvedValue({ avatarPath: PREVIOUS_FILENAME });
    update.mockRejectedValue(notFoundOnUpdate());

    await expect(
      handler.execute(new SetUserAvatarCommand(TEST_USER_ID, NEW_FILENAME)),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(deleteAvatar).not.toHaveBeenCalled();
  });

  // The guard against deleting the file just written, rather than the one it
  // replaced. Unreachable through the routes (`saveAvatar` never reuses a
  // name), which is exactly why it needs a test — nothing else would notice
  // the guard going away.
  it('does not delete the stored file when the path written is the one already there', async () => {
    findUnique.mockResolvedValue({ avatarPath: NEW_FILENAME });

    await handler.execute(new SetUserAvatarCommand(TEST_USER_ID, NEW_FILENAME));

    expect(deleteAvatar).not.toHaveBeenCalled();
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
