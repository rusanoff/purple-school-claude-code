import { Logger } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { PrismaService } from '../../prisma/prisma.service';
import { UserProfileResponse } from '../interfaces/user-profile.interface';
import { AvatarStorageService } from '../storage/avatar-storage.service';
import { ClearUserAvatarCommand } from './clear-user-avatar.command';
import { writeUserAvatarPath } from './write-user-avatar-path';

@CommandHandler(ClearUserAvatarCommand)
export class ClearUserAvatarHandler implements ICommandHandler<ClearUserAvatarCommand> {
  private readonly logger = new Logger(ClearUserAvatarHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: AvatarStorageService,
  ) {}

  /**
   * `null` is the whole difference from `SetUserAvatarHandler`: clearing an
   * avatar the user doesn't have is the state they asked for, so it succeeds
   * with nothing to remove rather than 404-ing on a missing file.
   */
  execute({ userId }: ClearUserAvatarCommand): Promise<UserProfileResponse> {
    return writeUserAvatarPath(
      this.prisma,
      this.storage,
      this.logger,
      userId,
      null,
    );
  }
}
