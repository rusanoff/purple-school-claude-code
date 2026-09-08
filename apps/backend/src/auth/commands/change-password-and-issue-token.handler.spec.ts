import { BadRequestException } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { ChangePasswordCommand } from '../../users/commands/change-password.command';
import { UserRecord } from '../../users/interfaces/user-record.interface';
import { TokenService } from '../services/token.service';
import { ChangePasswordAndIssueTokenCommand } from './change-password-and-issue-token.command';
import { ChangePasswordAndIssueTokenHandler } from './change-password-and-issue-token.handler';

const USER_ID = 'a3f1c0de-0000-4000-8000-000000000001';
const CURRENT_PASSWORD = ' old-password ';
const NEW_PASSWORD = 'new-password';
const ACCESS_TOKEN = 'signed.jwt.token';

/** What `ChangePasswordCommand` resolves to once the row is rewritten. */
const STORED: UserRecord = {
  id: USER_ID,
  email: 'ada@example.com',
  passwordHash: '$2b$10$notarealhashatall',
};

describe('ChangePasswordAndIssueTokenHandler', () => {
  let execute: jest.Mock;
  let sign: jest.Mock;
  let handler: ChangePasswordAndIssueTokenHandler;

  beforeEach(() => {
    execute = jest.fn().mockResolvedValue(STORED);
    sign = jest.fn().mockResolvedValue(ACCESS_TOKEN);
    handler = new ChangePasswordAndIssueTokenHandler(
      { execute } as unknown as CommandBus,
      { sign } as unknown as TokenService,
    );
  });

  const run = () =>
    handler.execute(
      new ChangePasswordAndIssueTokenCommand(
        USER_ID,
        CURRENT_PASSWORD,
        NEW_PASSWORD,
      ),
    );

  // The whole point of this layer: password *storage* stays a users concern,
  // reached over the bus exactly like `RegisterHandler` reaches
  // `CreateUserCommand` — this handler must not touch Prisma or bcrypt itself.
  it('delegates the password change to UsersModule over the bus', async () => {
    await run();

    expect(execute).toHaveBeenCalledTimes(1);
    const [dispatched] = execute.mock.calls[0] as [ChangePasswordCommand];
    expect(dispatched).toBeInstanceOf(ChangePasswordCommand);
    // Both passwords are passed through byte for byte: whitespace is part of
    // a secret, so anything trimmed here would be stored — and later compared
    // against — as something other than what the user typed.
    expect({ ...dispatched }).toEqual({
      userId: USER_ID,
      currentPassword: CURRENT_PASSWORD,
      newPassword: NEW_PASSWORD,
    });
  });

  // The reason the phase exists: a stateless JWT can't be revoked, so instead
  // of logging the user out the response hands them a fresh token.
  it('answers with a token signed for the stored record', async () => {
    await expect(run()).resolves.toEqual({ accessToken: ACCESS_TOKEN });

    // Identity taken from what the command resolved to, not from the request:
    // the same contract `RegisterHandler` has with `CreateUserCommand`.
    expect(sign).toHaveBeenCalledWith(STORED.id, STORED.email);
  });

  it('signs only after the change is persisted', async () => {
    let persisted = false;
    execute.mockImplementation(() => {
      persisted = true;
      return Promise.resolve(STORED);
    });
    sign.mockImplementation(() => {
      // A token signed before the write would be handed out even if the write
      // then failed, leaving the client believing a change that never landed.
      expect(persisted).toBe(true);
      return Promise.resolve(ACCESS_TOKEN);
    });

    await run();

    expect(sign).toHaveBeenCalledTimes(1);
  });

  // Every rejection the users-side handler raises (400 wrong current password,
  // 404 missing row, 409 lost race) is already the answer the client should
  // get, so this handler adds nothing to it — and issues no token.
  it('propagates a rejected change untouched and issues no token', async () => {
    const failure = new BadRequestException('Current password is incorrect');
    execute.mockRejectedValue(failure);

    await expect(run()).rejects.toBe(failure);
    expect(sign).not.toHaveBeenCalled();
  });
});
