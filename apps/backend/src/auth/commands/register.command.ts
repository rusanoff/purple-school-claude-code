import { Command } from '@nestjs/cqrs';
import { AuthResponse } from '../interfaces/auth-response.interface';

/**
 * Intent: create a new user from the given credentials and issue a token.
 * Typed via `Command<AuthResponse>` so `commandBus.execute` infers the result.
 */
export class RegisterCommand extends Command<AuthResponse> {
  constructor(
    public readonly email: string,
    public readonly password: string,
  ) {
    super();
  }
}
