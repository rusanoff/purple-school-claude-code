import { Command } from '@nestjs/cqrs';
import { UserRecord } from '../interfaces/user-record.interface';

/**
 * Intent: create a new user from the given credentials.
 * Typed via `Command<UserRecord>` so `commandBus.execute` infers the result.
 */
export class CreateUserCommand extends Command<UserRecord> {
  constructor(
    public readonly email: string,
    public readonly password: string,
  ) {
    super();
  }
}
