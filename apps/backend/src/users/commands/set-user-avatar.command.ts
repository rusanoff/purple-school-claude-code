import { Command } from '@nestjs/cqrs';
import { UserProfileResponse } from '../interfaces/user-profile.interface';

/**
 * Intent: point the signed-in user's own row at an avatar file that has
 * **already** been validated and written to disk by `AvatarStorageService` —
 * the same division of labour `UploadMeetingFileCommand` has, since a
 * multipart stream is not a sensible immutable command payload.
 *
 * Beyond persisting the new filename the handler also removes whatever file
 * the row pointed at before: replacing an avatar has to leave exactly one
 * file per user on disk, and the previous filename is knowable only from the
 * row being overwritten.
 *
 * Like `UpdateUserProfileCommand`, `userId` always comes from the caller's
 * JWT and never from the request, so there is no way to name — and therefore
 * no way to overwrite — someone else's avatar. The result is the full updated
 * profile, identical to a following `GET /users/me`, so the client can render
 * the new `avatarUrl` without re-fetching.
 */
export class SetUserAvatarCommand extends Command<UserProfileResponse> {
  constructor(
    public readonly userId: string,
    /** Generated on-disk filename from `SavedAvatar.path` — never the name
     * the client uploaded under, and never a path. */
    public readonly avatarPath: string,
  ) {
    super();
  }
}
