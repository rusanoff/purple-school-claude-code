import { CommandBus, CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { ChangePasswordCommand } from '../../users/commands/change-password.command';
import { AuthResponse } from '../interfaces/auth-response.interface';
import { TokenService } from '../services/token.service';
import { ChangePasswordAndIssueTokenCommand } from './change-password-and-issue-token.command';

@CommandHandler(ChangePasswordAndIssueTokenCommand)
export class ChangePasswordAndIssueTokenHandler implements ICommandHandler<ChangePasswordAndIssueTokenCommand> {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly tokenService: TokenService,
  ) {}

  async execute({
    userId,
    currentPassword,
    newPassword,
  }: ChangePasswordAndIssueTokenCommand): Promise<AuthResponse> {
    // Like `RegisterHandler`, this handler touches neither Prisma nor bcrypt:
    // UsersModule owns verifying the old password, hashing the new one and the
    // compare-and-set write, and every rejection it raises (400 wrong current
    // password, 404 missing row, 409 lost race) is already the answer the
    // client should get, so none of them is caught here.
    const user = await this.commandBus.execute(
      new ChangePasswordCommand(userId, currentPassword, newPassword),
    );

    // Signed only once the new hash is stored, and for the identity the write
    // resolved to rather than anything from the request — `CreateUserCommand`'s
    // contract with `RegisterHandler`, exactly. JWTs here are stateless and
    // never revoked, so this token replaces the caller's old one rather than
    // invalidating it: sessions already issued stay valid until they expire
    // (an accepted trade-off, see the PRD).
    return { accessToken: await this.tokenService.sign(user.id, user.email) };
  }
}
