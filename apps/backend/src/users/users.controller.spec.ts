import { Readable } from 'node:stream';
import { BadRequestException, Logger } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { FastifyRequest } from 'fastify';
import { AuthUser } from '../auth/interfaces/auth-user.interface';
import { ClearUserAvatarCommand } from './commands/clear-user-avatar.command';
import { SetUserAvatarCommand } from './commands/set-user-avatar.command';
import { UpdateUserProfileCommand } from './commands/update-user-profile.command';
import { UserProfileResponse } from './interfaces/user-profile.interface';
import { GetUserProfileQuery } from './queries/get-user-profile.query';
import { AvatarStorageService } from './storage/avatar-storage.service';
import { UsersController } from './users.controller';

const CALLER: AuthUser = {
  userId: 'a3f1c0de-0000-4000-8000-000000000001',
  email: 'ada@example.com',
};

const PROFILE: UserProfileResponse = {
  id: CALLER.userId,
  email: CALLER.email,
  name: null,
  avatarUrl: null,
  createdAt: '2026-09-05T10:20:30.000Z',
};

const MAX_AVATAR_SIZE_BYTES = 2048;
const SAVED_FILENAME = '2222222222222222222222222222222b.png';

describe('UsersController', () => {
  let executeCommand: jest.Mock;
  let executeQuery: jest.Mock;
  let saveAvatar: jest.Mock;
  let deleteAvatar: jest.Mock;
  let controller: UsersController;

  beforeEach(() => {
    executeCommand = jest.fn().mockResolvedValue(PROFILE);
    executeQuery = jest.fn().mockResolvedValue(PROFILE);
    saveAvatar = jest.fn().mockResolvedValue({
      path: SAVED_FILENAME,
      mimeType: 'image/png',
      size: 12,
    });
    deleteAvatar = jest.fn().mockResolvedValue(undefined);
    controller = new UsersController(
      { execute: executeCommand } as unknown as CommandBus,
      { execute: executeQuery } as unknown as QueryBus,
      {
        maxAvatarSizeBytes: MAX_AVATAR_SIZE_BYTES,
        saveAvatar,
        deleteAvatar,
      } as unknown as AvatarStorageService,
    );
  });

  /** A multipart request carrying exactly one file part, which is all the
   * upload route ever reads. `file` is a `jest.Mock` so a test can assert the
   * limits it was called with, and the stream is a real `Readable` because
   * that is what the route hands to `saveAvatar`. Pass `undefined` for a
   * body `@fastify/multipart` finds no file part in. */
  function multipartRequest(
    part: unknown = { file: Readable.from(['bytes']), mimetype: 'image/png' },
  ): FastifyRequest & { file: jest.Mock } {
    return {
      isMultipart: () => true,
      file: jest.fn().mockResolvedValue(part),
    } as unknown as FastifyRequest & { file: jest.Mock };
  }

  /** A multipart body `@fastify/multipart` finds no file part in — spelled
   * out rather than passed as `undefined` to the helper above, which would
   * only re-select its default. */
  function multipartRequestWithoutFilePart(): FastifyRequest {
    return {
      isMultipart: () => true,
      file: jest.fn().mockResolvedValue(undefined),
    } as unknown as FastifyRequest;
  }

  describe('findMe', () => {
    it('returns whatever the query bus resolves, unmapped', async () => {
      await expect(controller.findMe(CALLER)).resolves.toBe(PROFILE);
    });

    // The route takes no id of its own — the only user it can ever read is the
    // one the token identifies. Asserted here rather than left to e2e because
    // this is the route's entire authorization story.
    it('dispatches GetUserProfileQuery carrying the caller id from the token', async () => {
      await controller.findMe(CALLER);

      expect(executeQuery).toHaveBeenCalledTimes(1);
      const [query] = executeQuery.mock.calls[0] as [GetUserProfileQuery];
      expect(query).toBeInstanceOf(GetUserProfileQuery);
      expect(query.userId).toBe(CALLER.userId);
    });
  });

  describe('updateMe', () => {
    it('returns whatever the command bus resolves, unmapped', async () => {
      await expect(
        controller.updateMe(CALLER, { name: 'Ada Lovelace' }),
      ).resolves.toBe(PROFILE);
    });

    // Same authorization story as findMe, and the reason it matters more here:
    // the body carries the new name but never the id it is written to, so a
    // caller cannot rename anyone but themselves.
    it('dispatches UpdateUserProfileCommand with the caller id from the token and the name from the body', async () => {
      await controller.updateMe(CALLER, { name: 'Ada Lovelace' });

      expect(executeCommand).toHaveBeenCalledTimes(1);
      const [command] = executeCommand.mock.calls[0] as [
        UpdateUserProfileCommand,
      ];
      expect(command).toBeInstanceOf(UpdateUserProfileCommand);
      expect(command.userId).toBe(CALLER.userId);
      expect(command.name).toBe('Ada Lovelace');
    });
  });

  describe('uploadAvatar', () => {
    it('stores the uploaded part and returns the profile the command bus resolves', async () => {
      const request = multipartRequest();

      await expect(controller.uploadAvatar(CALLER, request)).resolves.toBe(
        PROFILE,
      );
      expect(saveAvatar).toHaveBeenCalledTimes(1);
      // The MIME type is handed over untouched — the allowlist lives in the
      // storage service, and re-checking it here would be a second copy to
      // drift.
      const [, mimeType] = saveAvatar.mock.calls[0] as [Readable, string];
      expect(mimeType).toBe('image/png');
    });

    // Same self-scoping as every other route on this controller: the request
    // body carries an image and no id, so the only row that can end up
    // pointing at the new file is the caller's own.
    it('dispatches SetUserAvatarCommand with the caller id from the token and the generated filename', async () => {
      await controller.uploadAvatar(CALLER, multipartRequest());

      expect(executeCommand).toHaveBeenCalledTimes(1);
      const [command] = executeCommand.mock.calls[0] as [SetUserAvatarCommand];
      expect(command).toBeInstanceOf(SetUserAvatarCommand);
      expect(command.userId).toBe(CALLER.userId);
      expect(command.avatarPath).toBe(SAVED_FILENAME);
    });

    // Busboy has to stop reading at the same number the storage service
    // enforces, or the two disagree about what "too large" means: pass a
    // bigger one and an oversized body is fully read before being rejected,
    // a smaller one and the service never sees the overrun at all.
    it("caps the part at the storage service's configured limit", async () => {
      const request = multipartRequest();

      await controller.uploadAvatar(CALLER, request);

      expect(request.file).toHaveBeenCalledWith({
        limits: { fileSize: MAX_AVATAR_SIZE_BYTES },
        throwFileSizeLimit: false,
      });
    });

    it('rejects a request that is not multipart before reading anything', async () => {
      const request = {
        isMultipart: () => false,
        file: jest.fn(),
      } as unknown as FastifyRequest;

      await expect(
        controller.uploadAvatar(CALLER, request),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(saveAvatar).not.toHaveBeenCalled();
    });

    it('rejects a multipart request with no file part', async () => {
      await expect(
        controller.uploadAvatar(CALLER, multipartRequestWithoutFilePart()),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(saveAvatar).not.toHaveBeenCalled();
      expect(executeCommand).not.toHaveBeenCalled();
    });

    // The file is on disk before the command runs, so a failed command would
    // otherwise leave a file no row references and nothing will ever collect.
    it('removes the just-written file when persisting it fails, and rethrows', async () => {
      const failure = new Error('user row vanished');
      executeCommand.mockRejectedValue(failure);

      await expect(
        controller.uploadAvatar(CALLER, multipartRequest()),
      ).rejects.toBe(failure);
      expect(deleteAvatar).toHaveBeenCalledWith(SAVED_FILENAME);
    });

    // The cleanup is compensation for a failure that already happened —
    // letting an `rm` problem escape would hide the real cause behind an
    // opaque 500 and skip the rethrow entirely.
    it('still reports the original failure when the cleanup itself fails', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const failure = new Error('user row vanished');
      executeCommand.mockRejectedValue(failure);
      deleteAvatar.mockRejectedValue(new Error('EBUSY'));

      await expect(
        controller.uploadAvatar(CALLER, multipartRequest()),
      ).rejects.toBe(failure);
      expect(warn).toHaveBeenCalled();

      warn.mockRestore();
    });
  });

  describe('removeAvatar', () => {
    it('returns whatever the command bus resolves, unmapped', async () => {
      await expect(controller.removeAvatar(CALLER)).resolves.toBe(PROFILE);
    });

    it('dispatches ClearUserAvatarCommand carrying the caller id from the token', async () => {
      await controller.removeAvatar(CALLER);

      expect(executeCommand).toHaveBeenCalledTimes(1);
      const [command] = executeCommand.mock.calls[0] as [
        ClearUserAvatarCommand,
      ];
      expect(command).toBeInstanceOf(ClearUserAvatarCommand);
      expect(command.userId).toBe(CALLER.userId);
    });

    // Removing the file is the command handler's job (it is the only place
    // that knows which file the row pointed at) — the route must not reach
    // into storage on its own.
    it('does not touch storage itself', async () => {
      await controller.removeAvatar(CALLER);

      expect(deleteAvatar).not.toHaveBeenCalled();
    });
  });
});
