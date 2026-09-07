import { Logger } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { PrismaService } from '../../prisma/prisma.service';
import { UserProfileResponse } from '../interfaces/user-profile.interface';
import { AvatarStorageService } from '../storage/avatar-storage.service';
import { SetUserAvatarCommand } from './set-user-avatar.command';
import { writeUserAvatarPath } from './write-user-avatar-path';

@CommandHandler(SetUserAvatarCommand)
export class SetUserAvatarHandler implements ICommandHandler<SetUserAvatarCommand> {
  private readonly logger = new Logger(SetUserAvatarHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: AvatarStorageService,
  ) {}

  execute({
    userId,
    avatarPath,
  }: SetUserAvatarCommand): Promise<UserProfileResponse> {
    return writeUserAvatarPath(
      this.prisma,
      this.storage,
      this.logger,
      userId,
      avatarPath,
    );
  }
}
