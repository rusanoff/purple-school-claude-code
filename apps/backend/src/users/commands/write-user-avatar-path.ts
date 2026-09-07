import { Logger, NotFoundException } from '@nestjs/common';
import { User } from '@prisma/client';
import { isPrismaError } from '../../prisma/prisma-error.util';
import { PrismaService } from '../../prisma/prisma.service';
import {
  UserProfileResponse,
  toUserProfileResponse,
} from '../interfaces/user-profile.interface';
import { AvatarStorageService } from '../storage/avatar-storage.service';

/**
 * Points a user's row at `avatarPath` (a generated filename, or `null` to
 * clear it) and removes the file the row pointed at before.
 *
 * Shared by `SetUserAvatarHandler` and `ClearUserAvatarHandler` — the same
 * factoring `findMeetingFileOrThrow` gets, and for the same reason: setting
 * and clearing differ only in the value written, while everything that makes
 * them correct (the self-scoped `where`, the 404 translation, the ordering of
 * the row write against the disk removal) has to behave identically in both.
 * Two copies would be two places for "the old file must go" to drift.
 *
 * Takes the caller's `logger` rather than owning one so a warning names the
 * handler it actually came from.
 */
export async function writeUserAvatarPath(
  prisma: PrismaService,
  storage: AvatarStorageService,
  logger: Logger,
  userId: string,
  avatarPath: string | null,
): Promise<UserProfileResponse> {
  // Read first, purely to learn which file to remove afterwards — `update`
  // hands back the new row, never the value it replaced. Unlike
  // `UpdateUserProfileHandler`, which can skip a preceding read precisely
  // because it needs nothing from the old row, this leaves a check-then-write
  // gap; both halves land on the same 404, so all a concurrent delete can
  // cost is which of the two statements reports it.
  const previous = await prisma.user.findUnique({
    where: { id: userId },
    select: { avatarPath: true },
  });

  if (!previous) {
    // The token verified, so the caller was authenticated — their row just no
    // longer exists (deleted after the token was issued). A missing resource,
    // not a failed authentication: 404, not 401, same as
    // `GetUserProfileHandler`.
    throw new NotFoundException('User not found');
  }

  let user: User;
  try {
    user = await prisma.user.update({
      where: { id: userId },
      data: { avatarPath },
    });
  } catch (error) {
    // The row can also go away inside the gap above, which Prisma reports as
    // "record to update not found" (P2025) — the same 404 a retry would see,
    // instead of a raw 500.
    if (isPrismaError(error, 'P2025')) {
      throw new NotFoundException('User not found');
    }
    throw error;
  }

  // Row first, then the disk file — `DeleteMeetingFileHandler`'s ordering, for
  // the same reason: a failed removal here leaves an orphaned file (a leak,
  // but one no request can reach, since the profile no longer hands out its
  // URL and the name is 128 unguessable bits) rather than a row pointing at
  // bytes that are already gone.
  //
  // The `!==` guard is not just an optimization: a caller that somehow wrote
  // the path already stored must not be answered by deleting the very file it
  // just installed.
  if (previous.avatarPath && previous.avatarPath !== avatarPath) {
    try {
      await storage.deleteAvatar(previous.avatarPath);
    } catch (error) {
      // The write has already taken effect from the caller's perspective, so
      // a real failure here — a permission error, a busy handle, a stored
      // value `deleteAvatar` refuses as not-a-bare-filename — is logged
      // rather than turned into a 500 that would wrongly suggest the new
      // avatar didn't stick and invite a retry that orphans another file.
      logger.warn(
        `Failed to remove the previous avatar file "${previous.avatarPath}" of user ${userId}: ${String(error)}`,
      );
    }
  }

  return toUserProfileResponse(user);
}
