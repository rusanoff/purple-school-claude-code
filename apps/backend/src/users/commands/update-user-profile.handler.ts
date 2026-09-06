import { NotFoundException } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { isPrismaError } from '../../prisma/prisma-error.util';
import { PrismaService } from '../../prisma/prisma.service';
import {
  UserProfileResponse,
  toUserProfileResponse,
} from '../interfaces/user-profile.interface';
import { UpdateUserProfileCommand } from './update-user-profile.command';

@CommandHandler(UpdateUserProfileCommand)
export class UpdateUserProfileHandler implements ICommandHandler<UpdateUserProfileCommand> {
  constructor(private readonly prisma: PrismaService) {}

  async execute({
    userId,
    name,
  }: UpdateUserProfileCommand): Promise<UserProfileResponse> {
    try {
      const user = await this.prisma.user.update({
        where: { id: userId },
        data: { name },
      });

      return toUserProfileResponse(user);
    } catch (error) {
      // The token verified, so the caller was authenticated — their row just
      // no longer exists (deleted after the token was issued), which Prisma
      // reports as "record to update not found" (P2025). That is a missing
      // resource, not a failed authentication: 404, not 401 — the same call
      // `GetUserProfileHandler` makes for the same situation, just detected
      // from the write instead of a preceding read (one query, and no
      // check-then-write gap for a concurrent delete to slip into).
      if (isPrismaError(error, 'P2025')) {
        throw new NotFoundException('User not found');
      }
      throw error;
    }
  }
}
