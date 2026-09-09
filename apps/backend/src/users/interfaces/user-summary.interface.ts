import { User } from '@prisma/client';
import { toAvatarUrl } from './user-profile.interface';

/**
 * Public shape of *someone else* — the "who is this person" fields the API
 * embeds wherever a user shows up in another resource: the uploader of a
 * meeting file, a meeting's participants.
 *
 * Deliberately narrower than `UserProfileResponse`, which is what the caller
 * gets about themselves. There is no `id` here: a client that needs identity
 * (to decide who may delete a file, say) already has it as a sibling field on
 * the resource itself, and the summary exists purely to render a person.
 *
 * `email` is always present and `name`/`avatarUrl` are not: the profile
 * columns are optional, so the email is the only thing a client can reliably
 * fall back to for a user who never filled them in.
 */
export interface UserSummaryResponse {
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

/**
 * The columns a summary is built from, in Prisma `select` form. Passing this
 * instead of reading whole rows is what keeps the password hash out of the
 * query in the first place — `toUserSummary` can only drop fields it is
 * handed, this stops them being read at all.
 */
export const USER_SUMMARY_SELECT = {
  email: true,
  name: true,
  avatarPath: true,
} as const;

/** A row narrowed to `USER_SUMMARY_SELECT` — derived from the select rather
 * than spelled out again so the two can't drift. */
export type UserSummarySource = Pick<User, keyof typeof USER_SUMMARY_SELECT>;

export function toUserSummary(user: UserSummarySource): UserSummaryResponse {
  return {
    email: user.email,
    name: user.name,
    avatarUrl: toAvatarUrl(user.avatarPath),
  };
}
