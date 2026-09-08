import { HttpStatus, RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { CommandBus } from '@nestjs/cqrs';
import { AuthController } from './auth.controller';
import { ChangePasswordAndIssueTokenCommand } from './commands/change-password-and-issue-token.command';
import { LoginCommand } from './commands/login.command';
import { RegisterCommand } from './commands/register.command';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthUser } from './interfaces/auth-user.interface';

const CALLER: AuthUser = {
  userId: 'a3f1c0de-0000-4000-8000-000000000001',
  email: 'ada@example.com',
};

const TOKEN = { accessToken: 'signed.jwt.token' };

/**
 * Reads a decorator's metadata off one of the controller's route handlers.
 * Goes through the property descriptor rather than
 * `AuthController.prototype[route]` because naming a method as a value trips
 * `@typescript-eslint/unbound-method`.
 */
const routeMetadata = (key: string, route: keyof AuthController): unknown =>
  Reflect.getMetadata(
    key,
    Object.getOwnPropertyDescriptor(AuthController.prototype, route)
      ?.value as object,
  );

describe('AuthController', () => {
  let execute: jest.Mock;
  let controller: AuthController;

  beforeEach(() => {
    execute = jest.fn().mockResolvedValue(TOKEN);
    controller = new AuthController({ execute } as unknown as CommandBus);
  });

  describe('register', () => {
    it('dispatches a RegisterCommand and returns its token', async () => {
      await expect(
        controller.register({ email: CALLER.email, password: 'sekret1' }),
      ).resolves.toBe(TOKEN);
      expect(execute).toHaveBeenCalledWith(
        new RegisterCommand(CALLER.email, 'sekret1'),
      );
      // `toHaveBeenCalledWith` compares structurally, and every command here
      // is a bag of strings — without this the assertion above is satisfied
      // by any command carrying the same values.
      expect(execute).toHaveBeenCalledWith(expect.any(RegisterCommand));
    });
  });

  describe('login', () => {
    it('dispatches a LoginCommand and returns its token', async () => {
      await expect(
        controller.login({ email: CALLER.email, password: 'sekret1' }),
      ).resolves.toBe(TOKEN);
      expect(execute).toHaveBeenCalledWith(
        new LoginCommand(CALLER.email, 'sekret1'),
      );
      expect(execute).toHaveBeenCalledWith(expect.any(LoginCommand));
    });
  });

  describe('changePassword', () => {
    it('takes the account from the token and the passwords from the body', async () => {
      await expect(
        controller.changePassword(CALLER, {
          currentPassword: 'old-secret',
          newPassword: 'new-secret',
        }),
      ).resolves.toBe(TOKEN);

      expect(execute).toHaveBeenCalledWith(
        new ChangePasswordAndIssueTokenCommand(
          CALLER.userId,
          'old-secret',
          'new-secret',
        ),
      );
      // Not the users-side `ChangePasswordCommand`, whose result is a `User`
      // row: dispatching that one structurally satisfies the expectation
      // above and would answer with the password hash.
      expect(execute).toHaveBeenCalledWith(
        expect.any(ChangePasswordAndIssueTokenCommand),
      );
    });

    it('passes both passwords through untouched, whitespace included', async () => {
      await controller.changePassword(CALLER, {
        currentPassword: ' old ',
        newPassword: ' new ',
      });

      expect(execute).toHaveBeenCalledWith(
        new ChangePasswordAndIssueTokenCommand(CALLER.userId, ' old ', ' new '),
      );
    });

    it('lets the command bus rejection through', async () => {
      const failure = new Error('wrong current password');
      execute.mockRejectedValueOnce(failure);

      await expect(
        controller.changePassword(CALLER, {
          currentPassword: 'wrong',
          newPassword: 'new-secret',
        }),
      ).rejects.toBe(failure);
    });

    /**
     * The only route on this controller that requires an identity — register
     * and login must stay reachable without one, so the guard is per-method
     * here rather than on the class the way `UsersController` has it.
     */
    it('is protected by JwtAuthGuard, unlike register and login', () => {
      expect(routeMetadata(GUARDS_METADATA, 'changePassword')).toContain(
        JwtAuthGuard,
      );
      expect(routeMetadata(GUARDS_METADATA, 'register')).toBeUndefined();
      expect(routeMetadata(GUARDS_METADATA, 'login')).toBeUndefined();
    });

    /**
     * Pinned because nothing else in this suite would notice a typo'd path or
     * a `@Patch` slipping in — the handler is called directly here, not
     * through the router.
     */
    it('is POST /auth/change-password', () => {
      expect(Reflect.getMetadata(PATH_METADATA, AuthController)).toBe('auth');
      expect(routeMetadata(PATH_METADATA, 'changePassword')).toBe(
        'change-password',
      );
      expect(routeMetadata(METHOD_METADATA, 'changePassword')).toBe(
        RequestMethod.POST,
      );
    });

    /** A password change creates nothing, so it answers 200, not Nest's 201. */
    it('answers 200 rather than the POST default', () => {
      expect(routeMetadata(HTTP_CODE_METADATA, 'changePassword')).toBe(
        HttpStatus.OK,
      );
    });
  });
});
