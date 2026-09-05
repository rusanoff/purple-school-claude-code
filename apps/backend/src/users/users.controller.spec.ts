import { QueryBus } from '@nestjs/cqrs';
import { AuthUser } from '../auth/interfaces/auth-user.interface';
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
  let execute: jest.Mock;
  let controller: UsersController;

  beforeEach(() => {
    execute = jest.fn().mockResolvedValue(PROFILE);
    controller = new UsersController({ execute } as unknown as QueryBus);
  });

  it('returns whatever the query bus resolves, unmapped', async () => {
    await expect(controller.findMe(CALLER)).resolves.toBe(PROFILE);
  });

  // The route takes no id of its own — the only user it can ever read is the
  // one the token identifies. Asserted here rather than left to e2e because
  // this is the route's entire authorization story.
  it('dispatches GetUserProfileQuery carrying the caller id from the token', async () => {
    await controller.findMe(CALLER);

    expect(execute).toHaveBeenCalledTimes(1);
    const [query] = execute.mock.calls[0] as [GetUserProfileQuery];
    expect(query).toBeInstanceOf(GetUserProfileQuery);
    expect(query.userId).toBe(CALLER.userId);
  });
});
