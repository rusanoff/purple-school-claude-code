import { Command } from '@nestjs/cqrs';
import { AuthResponse } from '../interfaces/auth-response.interface';

/**
 * Intent: authenticate an existing user and issue a token. Modeled as a command
 * (not a query) because it is a security action — it leaves room to emit
 * login-succeeded/failed events or audit records later.
 */
export class LoginCommand extends Command<AuthResponse> {
  constructor(
    public readonly email: string,
    public readonly password: string,
  ) {
    super();
  }
}
