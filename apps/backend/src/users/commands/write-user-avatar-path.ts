import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { User } from '@prisma/client';
import { isPrismaError } from '../../prisma/prisma-error.util';
import { PrismaService } from '../../prisma/prisma.service';
import {
  UserProfileResponse,
  toUserProfileResponse,
} from '../interfaces/user-profile.interface';
import { AvatarStorageService } from '../storage/avatar-storage.service';

/**
 * How many times a write re-reads and retries after losing the compare-and-set
 * below. Losing it once means another avatar write for the *same user* landed
 * in the microseconds between this one's read and its update; losing it three
 * times running is not something a person with one browser tab can produce, so
 * exhausting these attempts is reported rather than papered over with an
 * unconditional write.
 */
const AVATAR_WRITE_ATTEMPTS = 3;

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
  for (let attempt = 1; attempt <= AVATAR_WRITE_ATTEMPTS; attempt++) {
    // Read first, purely to learn which file to remove afterwards — `update`
    // hands back the new row, never the value it replaced.
    // `UpdateUserProfileHandler` can skip a preceding read precisely because
    // it needs nothing from the old row; this one can't, so the update below
    // has to close the gap the read opens.
    const previous = await prisma.user.findUnique({
      where: { id: userId },
      select: { avatarPath: true },
    });

    if (!previous) {
      // The token verified, so the caller was authenticated — their row just
      // no longer exists (deleted after the token was issued). A missing
      // resource, not a failed authentication: 404, not 401, same as
      // `GetUserProfileHandler`.
      throw new NotFoundException('User not found');
    }

    let user: User;
    try {
      user = await prisma.user.update({
        // A compare-and-set, not a plain by-id write: `avatarPath` in the
        // `where` (Prisma allows non-unique filters alongside a unique one)
        // makes the update land only while the row still holds the file this
        // request is about to delete. Without it, two concurrent writes both
        // read the same previous filename, both delete it, and whichever one
        // lost still has its own file referenced by nobody — publicly
        // fetchable at a URL a client was already handed, and never cleaned
        // up. The row is the lock, so the request that flips A→B is the only
        // one that may remove A.
        where: { id: userId, avatarPath: previous.avatarPath },
        data: { avatarPath },
      });
    } catch (error) {
      // P2025 here means the filter above matched nothing: either the row is
      // gone or someone else changed the avatar first. The two are
      // indistinguishable from the error alone, so re-read — a deleted row
      // comes back as the 404 above, a concurrent write as a fresh previous
      // filename to compare against.
      if (isPrismaError(error, 'P2025')) {
        continue;
      }
      throw error;
    }

    // Row first, then the disk file — `DeleteMeetingFileHandler`'s ordering,
    // for the same reason: a failed removal here leaves an orphaned file (a
    // leak, but one no request can reach, since the profile no longer hands
    // out its URL and the name is 128 unguessable bits) rather than a row
    // pointing at bytes that are already gone.
    //
    // The `!==` guard is not just an optimization: a caller that somehow
    // wrote the path already stored must not be answered by deleting the very
    // file it just installed.
    if (previous.avatarPath && previous.avatarPath !== avatarPath) {
      try {
        await storage.deleteAvatar(previous.avatarPath);
      } catch (error) {
        // The write has already taken effect from the caller's perspective,
        // so a real failure here — a permission error, a busy handle, a
        // stored value `deleteAvatar` refuses as not-a-bare-filename — is
        // logged rather than turned into a 500 that would wrongly suggest the
        // new avatar didn't stick and invite a retry that orphans another
        // file.
        logger.warn(
          `Failed to remove the previous avatar file "${previous.avatarPath}" of user ${userId}: ${String(error)}`,
        );
      }
    }

    return toUserProfileResponse(user);
  }

  // Every attempt lost the compare-and-set to a different write of the same
  // user's avatar. Retrying forever would let one client hold a request open
  // indefinitely, and writing unconditionally would reintroduce exactly the
  // orphaned file the compare-and-set exists to prevent — so say so, and let
  // the caller retry a request that will almost certainly win.
  throw new ConflictException(
    'The avatar was changed by another request; please try again',
  );
}
