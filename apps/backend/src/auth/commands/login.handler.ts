import { UnauthorizedException } from '@nestjs/common';
import { CommandHandler, ICommandHandler, QueryBus } from '@nestjs/cqrs';
import * as bcrypt from 'bcryptjs';
import { FindUserByEmailQuery } from '../../users/queries/find-user-by-email.query';
import { AuthResponse } from '../interfaces/auth-response.interface';
import { TokenService } from '../services/token.service';
import { LoginCommand } from './login.command';

@CommandHandler(LoginCommand)
export class LoginHandler implements ICommandHandler<LoginCommand> {
  constructor(
    private readonly queryBus: QueryBus,
    private readonly tokenService: TokenService,
  ) {}

  async execute({ email, password }: LoginCommand): Promise<AuthResponse> {
    const user = await this.queryBus.execute(new FindUserByEmailQuery(email));
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return { accessToken: await this.tokenService.sign(user.id, user.email) };
  }
}
