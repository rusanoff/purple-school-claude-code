import { Command } from '@nestjs/cqrs';
import { UserProfileResponse } from '../interfaces/user-profile.interface';

/**
 * Intent: change the signed-in user's own profile. Like
 * `GetUserProfileQuery`, `userId` always comes from the caller's JWT
 * (`@CurrentUser()`) and never from the request body, so there is no way to
 * name — and therefore no way to write — someone else's row.
 *
 * `name` is expected to arrive already trimmed and length-checked by
 * `UpdateUserProfileDto`; the handler stores it as given.
 *
 * Typed via `Command<UserProfileResponse>` so `commandBus.execute` infers the
 * result, and so the response of a successful update is byte-for-byte the
 * same shape `GET /users/me` returns — the client can reuse the value it gets
 * back instead of re-fetching.
 */
export class UpdateUserProfileCommand extends Command<UserProfileResponse> {
  constructor(
    public readonly userId: string,
    public readonly name: string,
  ) {
    super();
  }
}
