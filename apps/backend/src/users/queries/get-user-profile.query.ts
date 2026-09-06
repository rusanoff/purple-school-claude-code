import { Query } from '@nestjs/cqrs';
import { UserProfileResponse } from '../interfaces/user-profile.interface';

/**
 * Intent: read the signed-in user's own profile. `userId` always comes from
 * the caller's JWT (`@CurrentUser()`), never from the request — there is no
 * "read someone else's profile" query, so the id *is* the authorization.
 *
 * Unlike `FindUserByEmailQuery`, this one does not resolve to `null` on a
 * miss: the caller is already authenticated, so a missing row is an
 * exceptional case the handler reports as 404 rather than a normal outcome
 * every call site has to branch on.
 */
export class GetUserProfileQuery extends Query<UserProfileResponse> {
  constructor(public readonly userId: string) {
    super();
  }
}
