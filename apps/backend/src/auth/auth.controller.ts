import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { ChangePasswordAndIssueTokenCommand } from './commands/change-password-and-issue-token.command';
import { LoginCommand } from './commands/login.command';
import { RegisterCommand } from './commands/register.command';
import { CurrentUser } from './decorators/current-user.decorator';
import { AuthCredentialsDto } from './dto/auth-credentials.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthResponse } from './interfaces/auth-response.interface';
import type { AuthUser } from './interfaces/auth-user.interface';

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

  /**
   * Self-scoped like the `/users/me` routes: the account written is the one
   * the guard-verified token identifies, and the body carries no email or id
   * to name another (the global `forbidNonWhitelisted` pipe 400s one if a
   * client tries). Knowing `currentPassword` is what keeps a stolen token
   * from being enough to lock the real owner out.
   *
   * It lives on `AuthController` rather than next to the profile routes
   * because it answers with credentials, not with a profile: JWTs here are
   * stateless and never revoked, so the caller gets a freshly signed token to
   * replace the one they hold instead of being signed out — and every session
   * issued before the change keeps working until it expires (an accepted
   * trade-off, see the PRD). This is also the one route here that needs an
   * identity, so the guard is per-method; register and login must stay
   * reachable without one.
   *
   * 200 rather than the POST default of 201: nothing is created.
   */
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body() { currentPassword, newPassword }: ChangePasswordDto,
  ): Promise<AuthResponse> {
    return this.commandBus.execute(
      new ChangePasswordAndIssueTokenCommand(
        user.userId,
        currentPassword,
        newPassword,
      ),
    );
  }
}
