import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { FastifyRequest } from 'fastify';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { ClearUserAvatarCommand } from './commands/clear-user-avatar.command';
import { SetUserAvatarCommand } from './commands/set-user-avatar.command';
import { UpdateUserProfileCommand } from './commands/update-user-profile.command';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import { UserProfileResponse } from './interfaces/user-profile.interface';
import { GetUserProfileQuery } from './queries/get-user-profile.query';
import { AvatarStorageService } from './storage/avatar-storage.service';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
    private readonly avatarStorage: AvatarStorageService,
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

  /**
   * Sets or replaces the caller's avatar from a `multipart/form-data` body
   * with one file part. Self-scoped like every route here: the request
   * carries an image and no id.
   *
   * Not a one-liner-per-route bus call, for the reason `MeetingFilesController`
   * isn't either (see that controller and the CQRS section of
   * `apps/backend/CLAUDE.md`): a multipart stream is not a sensible immutable
   * command payload, so the file has to be validated and written to disk
   * before anything about it can go into one. The steps below are the HTTP
   * edge only — the actual state change, including removing the file this one
   * replaces, is `SetUserAvatarCommand`'s.
   *
   * 200 rather than Nest's POST default of 201: the avatar is a singleton
   * sub-resource of the profile, so a second upload creates nothing, and the
   * body is the same `UserProfileResponse` `PATCH /users/me` returns — the
   * client renders the new `avatarUrl` without a follow-up `GET`.
   */
  @Post('me/avatar')
  @HttpCode(HttpStatus.OK)
  async uploadAvatar(
    @CurrentUser() user: AuthUser,
    @Req() request: FastifyRequest,
  ): Promise<UserProfileResponse> {
    if (!request.isMultipart()) {
      throw new BadRequestException('Expected a multipart/form-data request');
    }

    // The limit comes from the storage service rather than being written here
    // or left to the plugin-wide ceiling in `src/multipart.ts`, so busboy
    // stops reading at exactly the number `saveAvatar` enforces —
    // `AVATAR_MAX_SIZE_BYTES` stays the single source of "too large".
    // `throwFileSizeLimit: false` hands an over-limit part to `saveAvatar` as
    // a `truncated` stream, which is the case it checks for.
    const data = await request.file({
      limits: { fileSize: this.avatarStorage.maxAvatarSizeBytes },
      throwFileSizeLimit: false,
    });
    if (!data) {
      throw new BadRequestException('No file was uploaded');
    }

    // Type allowlist, size enforcement and the generated filename all live in
    // the service — this route deliberately re-checks none of them.
    const saved = await this.avatarStorage.saveAvatar(data.file, data.mimetype);

    try {
      return await this.commandBus.execute(
        new SetUserAvatarCommand(user.userId, saved.path),
      );
    } catch (error) {
      // The file is already on disk. If persisting it fails — the user row
      // was deleted mid-request, the database is down — remove it rather than
      // leave a file no row references and nothing will ever come back for.
      await this.avatarStorage.deleteAvatar(saved.path);
      throw error;
    }
  }

  /**
   * Clears the caller's avatar, file included. A plain bus call: unlike the
   * upload there is no request body to parse and no disk write to sequence,
   * and which file to remove is knowable only from the row — so that belongs
   * to `ClearUserAvatarCommand`, not here.
   *
   * Returns the updated profile rather than 204 (which
   * `DELETE /meetings/:id/files/:fileId` uses): that route deletes a resource
   * the caller already had the id of, while this one leaves a profile behind
   * whose `avatarUrl` the client needs — and getting it back matches what
   * every other write on this controller does.
   */
  @Delete('me/avatar')
  removeAvatar(@CurrentUser() user: AuthUser): Promise<UserProfileResponse> {
    return this.commandBus.execute(new ClearUserAvatarCommand(user.userId));
  }
}
