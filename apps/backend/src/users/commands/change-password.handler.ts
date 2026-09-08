import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import * as bcrypt from 'bcryptjs';
import { isPrismaError } from '../../prisma/prisma-error.util';
import { PrismaService } from '../../prisma/prisma.service';
import { PASSWORD_SALT_ROUNDS } from '../constants/password-hashing.constants';
import { UserRecord } from '../interfaces/user-record.interface';
import { ChangePasswordCommand } from './change-password.command';

@CommandHandler(ChangePasswordCommand)
export class ChangePasswordHandler implements ICommandHandler<ChangePasswordCommand> {
  constructor(private readonly prisma: PrismaService) {}

  async execute({
    userId,
    currentPassword,
    newPassword,
  }: ChangePasswordCommand): Promise<UserRecord> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      // The token verified, so the caller was authenticated — their row just
      // no longer exists. Missing resource, not failed authentication: 404,
      // the same answer `GetUserProfileHandler` gives for this.
      throw new NotFoundException('User not found');
    }

    const currentPasswordMatches = await bcrypt.compare(
      currentPassword,
      user.passwordHash,
    );
    if (!currentPasswordMatches) {
      // 400, deliberately *not* the 401 `LoginHandler` answers a bad password
      // with: the caller's token is valid and their session is fine — one
      // field of the body is wrong. Every frontend page treats a 401 as "the
      // session is over" and redirects to `/login` (see
      // `apps/frontend/app/profile/page.tsx`), so answering 401 here would
      // log a user out for a typo instead of showing them the error. The PRD
      // allows either status; this is the one the client can act on.
      throw new BadRequestException('Current password is incorrect');
    }

    // Hashed at the shared cost, so a changed password ends up protected
    // exactly as well as a registered one — see `PASSWORD_SALT_ROUNDS`.
    const passwordHash = await bcrypt.hash(newPassword, PASSWORD_SALT_ROUNDS);

    try {
      const updated = await this.prisma.user.update({
        // Compare-and-set on the hash just verified, the same trick — and for
        // the same reason — `writeUserAvatarPath` uses (a non-unique filter
        // alongside the unique one, which Prisma allows): verifying the old
        // password forces a read before the write, and two concurrent changes
        // from the same starting password would otherwise both verify, both
        // report success, and leave the user with whichever new password
        // happened to land second. Making the row the lock turns the loser of
        // that race into an error instead of a silently discarded change.
        where: { id: userId, passwordHash: user.passwordHash },
        data: { passwordHash },
      });

      return {
        id: updated.id,
        email: updated.email,
        passwordHash: updated.passwordHash,
      };
    } catch (error) {
      // P2025 here means the compound `where` matched nothing: either the row
      // was deleted in the window between the read and this write, or another
      // request changed the password first. The error alone can't tell those
      // apart, so re-read to say which — a deleted row is the same 404 the
      // missing-row branch returns, a lost race is a 409 the caller can retry
      // with the password that is actually current now. No retry loop, unlike
      // the avatar write: which password wins is the user's decision, not
      // something this handler may pick for them.
      if (isPrismaError(error, 'P2025')) {
        const current = await this.prisma.user.findUnique({
          where: { id: userId },
        });
        if (!current) {
          throw new NotFoundException('User not found');
        }
        throw new ConflictException('Password was changed by another request');
      }
      throw error;
    }
  }
}
