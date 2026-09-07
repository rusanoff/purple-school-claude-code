import { Command } from '@nestjs/cqrs';
import { UserProfileResponse } from '../interfaces/user-profile.interface';

/**
 * Intent: drop the signed-in user's avatar — clear the column *and* remove
 * the file, so the image stops being fetchable at its public URL rather than
 * merely stopping being linked.
 *
 * Carries no payload beyond the caller's own id (from the JWT, as ever): the
 * route names no file, the row is the only record of which one to remove.
 * Returns the updated profile — `avatarUrl: null` — for the same reason
 * `SetUserAvatarCommand` returns one.
 */
export class ClearUserAvatarCommand extends Command<UserProfileResponse> {
  constructor(public readonly userId: string) {
    super();
  }
}
