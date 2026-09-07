import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { UpdateUserProfileCommand } from './commands/update-user-profile.command';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import { UserProfileResponse } from './interfaces/user-profile.interface';
import { GetUserProfileQuery } from './queries/get-user-profile.query';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  /**
   * `me` is a literal path segment, not a `:id` param — the route exposes no
   * way to name another user, so the guard-verified token is the only source
   * of the id being read and no ownership check is needed downstream.
   */
  @Get('me')
  findMe(@CurrentUser() user: AuthUser): Promise<UserProfileResponse> {
    return this.queryBus.execute(new GetUserProfileQuery(user.userId));
  }

  /**
   * Same self-scoping as `findMe`, and it is what makes this route safe: the
   * body carries the new name but no id, so the only row a caller can write
   * is the one their own token identifies.
   *
   * `PATCH` rather than `PUT` because the body is a partial profile — it names
   * `name` alone and leaves the avatar (and everything else) untouched. The
   * response is the full updated profile, identical to what a following
   * `GET /users/me` would return, so the client need not re-fetch.
   */
  @Patch('me')
  updateMe(
    @CurrentUser() user: AuthUser,
    @Body() { name }: UpdateUserProfileDto,
  ): Promise<UserProfileResponse> {
    return this.commandBus.execute(
      new UpdateUserProfileCommand(user.userId, name),
    );
  }
}
