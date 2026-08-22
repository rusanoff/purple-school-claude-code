import { CommandBus, CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { CreateUserCommand } from '../../users/commands/create-user.command';
import { AuthResponse } from '../interfaces/auth-response.interface';
import { TokenService } from '../services/token.service';
import { RegisterCommand } from './register.command';

@CommandHandler(RegisterCommand)
export class RegisterHandler implements ICommandHandler<RegisterCommand> {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly tokenService: TokenService,
  ) {}

  async execute({ email, password }: RegisterCommand): Promise<AuthResponse> {
    const user = await this.commandBus.execute(
      new CreateUserCommand(email, password),
    );

    return { accessToken: await this.tokenService.sign(user.id, user.email) };
  }
}
