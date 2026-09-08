import { Command } from '@nestjs/cqrs';
import { UserRecord } from '../interfaces/user-record.interface';

/**
 * Intent: replace the signed-in user's password, proving the old one first.
 *
 * `userId` always comes from the caller's JWT (`@CurrentUser()`) and never
 * from the request body — like `UpdateUserProfileCommand`, that is what makes
 * the operation self-scoped: there is no way to name, and therefore no way to
 * rewrite, someone else's credentials. `currentPassword` is the second half
 * of that: a stolen token alone must not be enough to lock the real owner out
 * of their account.
 *
 * Both passwords arrive as the user typed them (`ChangePasswordDto` does not
 * trim them); the handler is what hashes and compares.
 *
 * Typed via `Command<UserRecord>` so `commandBus.execute` infers the result.
 * It resolves to the stored record for the same reason `CreateUserCommand`
 * does — `AuthModule` needs the id and email to sign a fresh token for the
 * caller, and issuing tokens is its concern, not this module's.
 */
export class ChangePasswordCommand extends Command<UserRecord> {
  constructor(
    public readonly userId: string,
    public readonly currentPassword: string,
    public readonly newPassword: string,
  ) {
    super();
  }
}
