import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { AuthUser } from '../auth/interfaces/auth-user.interface';
import { UpdateUserProfileCommand } from './commands/update-user-profile.command';
import { UserProfileResponse } from './interfaces/user-profile.interface';
import { GetUserProfileQuery } from './queries/get-user-profile.query';
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

describe('UsersController', () => {
  let executeCommand: jest.Mock;
  let executeQuery: jest.Mock;
  let controller: UsersController;

  beforeEach(() => {
    executeCommand = jest.fn().mockResolvedValue(PROFILE);
    executeQuery = jest.fn().mockResolvedValue(PROFILE);
    controller = new UsersController(
      { execute: executeCommand } as unknown as CommandBus,
      { execute: executeQuery } as unknown as QueryBus,
    );
  });

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
});
