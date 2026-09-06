import { Controller, Get, UseGuards } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { UserProfileResponse } from './interfaces/user-profile.interface';
import { GetUserProfileQuery } from './queries/get-user-profile.query';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly queryBus: QueryBus) {}

  /**
   * `me` is a literal path segment, not a `:id` param — the route exposes no
   * way to name another user, so the guard-verified token is the only source
   * of the id being read and no ownership check is needed downstream.
   */
  @Get('me')
  findMe(@CurrentUser() user: AuthUser): Promise<UserProfileResponse> {
    return this.queryBus.execute(new GetUserProfileQuery(user.userId));
  }
}
