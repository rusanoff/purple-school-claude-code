import { Command } from '@nestjs/cqrs';
import { AuthResponse } from '../interfaces/auth-response.interface';

/**
 * Intent: replace the caller's password and hand them a token signed for the
 * account afterwards, so a successful change leaves them signed in.
 *
 * The auth-side counterpart of `users/commands/ChangePasswordCommand`, split
 * the same way `RegisterCommand` is split from `CreateUserCommand`: storing
 * (and verifying) a password hash is a users concern, issuing a JWT is an auth
 * one. The longer name is deliberate — the two commands would otherwise be
 * indistinguishable at a glance, and this is the one that also mints a token.
 *
 * `userId` comes from the caller's JWT and never from the request body, which
 * is what makes the operation self-scoped; `currentPassword` is what keeps a
 * stolen token from being enough to lock the real owner out. Both passwords
 * are carried exactly as typed — see `ChangePasswordDto` on why neither is
 * trimmed.
 *
 * Typed via `Command<AuthResponse>` so `commandBus.execute` infers the result,
 * the same `{ accessToken }` register and login answer with.
 */
export class ChangePasswordAndIssueTokenCommand extends Command<AuthResponse> {
  constructor(
    public readonly userId: string,
    public readonly currentPassword: string,
    public readonly newPassword: string,
  ) {
    super();
  }
}
