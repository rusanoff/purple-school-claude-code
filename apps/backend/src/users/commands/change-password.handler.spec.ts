import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { PASSWORD_SALT_ROUNDS } from '../constants/password-hashing.constants';
import { TEST_USER_ID as USER_ID, userRow } from '../testing/user-row.fixture';
import { ChangePasswordCommand } from './change-password.command';
import { ChangePasswordHandler } from './change-password.handler';

const CURRENT_PASSWORD = 'old-password';
const NEW_PASSWORD = 'new-password';

// A real bcrypt hash, not a stub string: the whole point of the handler is
// that `bcrypt.compare` decides whether the write happens, so mocking bcrypt
// out would leave exactly that untested.
const CURRENT_HASH = bcrypt.hashSync(CURRENT_PASSWORD, PASSWORD_SALT_ROUNDS);

/** The single `prisma.user.update` call this handler is allowed to make. */
interface UpdateArgs {
  where: { id: string; passwordHash: string };
  data: { passwordHash: string };
}

/** What Prisma throws when an `update`'s `where` matches no row. */
const recordToUpdateNotFound = (): Error =>
  new Prisma.PrismaClientKnownRequestError('Record to update not found', {
    code: 'P2025',
    clientVersion: '0.0.0',
  });

describe('ChangePasswordHandler', () => {
  let findUnique: jest.Mock;
  let update: jest.Mock;
  let written: UpdateArgs | undefined;
  let handler: ChangePasswordHandler;

  /** The hash `prisma.user.update` was asked to store. */
  const writtenHash = (): string => {
    if (!written) {
      throw new Error('prisma.user.update was never called');
    }
    return written.data.passwordHash;
  };

  beforeEach(() => {
    written = undefined;
    findUnique = jest
      .fn()
      .mockResolvedValue(userRow({ passwordHash: CURRENT_HASH }));
    update = jest.fn().mockImplementation((args: UpdateArgs) => {
      written = args;
      return Promise.resolve(userRow({ passwordHash: args.data.passwordHash }));
    });
    handler = new ChangePasswordHandler({
      user: { findUnique, update },
    } as unknown as PrismaService);
  });

  const execute = (
    currentPassword = CURRENT_PASSWORD,
    newPassword = NEW_PASSWORD,
  ) =>
    handler.execute(
      new ChangePasswordCommand(USER_ID, currentPassword, newPassword),
    );

  it("replaces the hash on the caller's own row when the current password matches", async () => {
    await execute();

    // The id comes from the caller's own JWT, so both of these `where`s are
    // the whole authorization story: a user can only ever read and rewrite
    // their own row.
    expect(findUnique).toHaveBeenCalledWith({ where: { id: USER_ID } });
    // Both halves of the `where` matter: the id (a caller can only rewrite
    // their own row) and the hash just verified (a concurrent change of the
    // same password can't be silently overwritten).
    expect(written?.where).toEqual({ id: USER_ID, passwordHash: CURRENT_HASH });
    expect(Object.keys(written?.data ?? {})).toEqual(['passwordHash']);
    expect(await bcrypt.compare(NEW_PASSWORD, writtenHash())).toBe(true);
    expect(await bcrypt.compare(CURRENT_PASSWORD, writtenHash())).toBe(false);
  });

  it('hashes the new password with the same cost registration uses', async () => {
    await execute();

    expect(bcrypt.getRounds(writtenHash())).toBe(PASSWORD_SALT_ROUNDS);
  });

  it('returns the stored record, so the caller can issue a fresh token for it', async () => {
    const user = await handler.execute(
      new ChangePasswordCommand(USER_ID, CURRENT_PASSWORD, NEW_PASSWORD),
    );

    expect(user).toEqual({
      id: USER_ID,
      email: 'ada@example.com',
      passwordHash: writtenHash(),
    });
  });

  // The distinguishing property of a wrong current password: nothing is
  // written. A 401 that still rewrote the hash would be far worse than the
  // status code being debatable.
  it('rejects a wrong current password without writing anything', async () => {
    // 400, not 401: the token is valid, one body field is wrong. The
    // frontend ends the session on any 401, so a 401 here would log a user
    // out over a typo.
    await expect(execute('not-the-current-password')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(update).not.toHaveBeenCalled();
  });

  it('rejects an empty current password against a real hash', async () => {
    await expect(execute('')).rejects.toBeInstanceOf(BadRequestException);

    expect(update).not.toHaveBeenCalled();
  });

  // A valid token whose user row is gone (deleted after the token was
  // issued): a missing resource, not a failed authentication — the same 404
  // `GetUserProfileHandler` and `UpdateUserProfileHandler` return for it.
  it('throws NotFoundException when the row is already gone', async () => {
    findUnique.mockResolvedValue(null);

    await expect(execute()).rejects.toBeInstanceOf(NotFoundException);
    expect(update).not.toHaveBeenCalled();
  });

  // A compound `where` that matched nothing means one of two things, and the
  // handler re-reads the row to tell them apart. Row gone: the delete landed
  // in the window between this handler's read and its write — same 404.
  it('throws NotFoundException when the row disappears between read and write', async () => {
    update.mockRejectedValue(recordToUpdateNotFound());
    findUnique
      .mockResolvedValueOnce(userRow({ passwordHash: CURRENT_HASH }))
      .mockResolvedValueOnce(null);

    await expect(execute()).rejects.toBeInstanceOf(NotFoundException);
  });

  // Row still there: another request changed the password first, so this one
  // lost the race. Reporting it beats silently discarding one of the two
  // changes — the user would be left with a password they never chose.
  it('throws ConflictException when another request changed the password first', async () => {
    update.mockRejectedValue(recordToUpdateNotFound());
    findUnique
      .mockResolvedValueOnce(userRow({ passwordHash: CURRENT_HASH }))
      .mockResolvedValueOnce(userRow({ passwordHash: 'someone-elses-hash' }));

    await expect(execute()).rejects.toBeInstanceOf(ConflictException);
  });

  it('rethrows any other Prisma failure untouched', async () => {
    const failure = new Prisma.PrismaClientKnownRequestError('Timed out', {
      code: 'P2024',
      clientVersion: '0.0.0',
    });
    update.mockRejectedValue(failure);

    await expect(execute()).rejects.toBe(failure);
  });
});
