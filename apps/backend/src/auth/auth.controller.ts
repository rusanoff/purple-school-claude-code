import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { LoginCommand } from './commands/login.command';
import { RegisterCommand } from './commands/register.command';
import { AuthCredentialsDto } from './dto/auth-credentials.dto';
import { AuthResponse } from './interfaces/auth-response.interface';

@Controller('auth')
export class AuthController {
  constructor(private readonly commandBus: CommandBus) {}

  @Post('register')
  register(
    @Body() { email, password }: AuthCredentialsDto,
  ): Promise<AuthResponse> {
    return this.commandBus.execute(new RegisterCommand(email, password));
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(
    @Body() { email, password }: AuthCredentialsDto,
  ): Promise<AuthResponse> {
    return this.commandBus.execute(new LoginCommand(email, password));
  }
}
