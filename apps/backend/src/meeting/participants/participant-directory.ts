import { PrismaService } from '../../prisma/prisma.service';
import {
  USER_SUMMARY_SELECT,
  UserSummaryResponse,
  toUserSummary,
} from '../../users/interfaces/user-summary.interface';

/**
 * The registered users behind a set of participant emails, keyed by email.
 *
 * `Meeting.participants` is a free-form `String[]` of emails rather than a
 * relation to `User` (see `assertMeetingAccess`), so "who is this
 * participant" can only be answered by looking the emails up — and an email
 * that isn't in here simply belongs to someone who never registered, which
 * is a normal case, not a missing row.
 */
export type ParticipantDirectory = ReadonlyMap<string, UserSummaryResponse>;

/**
 * Resolves every participant email to a user summary in **one** query.
 *
 * Callers pass the flattened emails of every meeting they are about to
 * respond with, not one meeting at a time: that is what keeps listing a page
 * of meetings at two queries total instead of one lookup per meeting (or,
 * worse, per participant). Duplicates across meetings collapse here too,
 * since meetings routinely share participants.
 */
export async function loadParticipantDirectory(
  prisma: PrismaService,
  emails: readonly string[],
): Promise<ParticipantDirectory> {
  const unique = [...new Set(emails)];

  if (unique.length === 0) {
    return new Map();
  }

  const users = await prisma.user.findMany({
    where: { email: { in: unique } },
    select: USER_SUMMARY_SELECT,
  });

  return new Map(users.map((user) => [user.email, toUserSummary(user)]));
}

/**
 * The display shape for one participant: the registered user if there is
 * one, otherwise the bare email with nothing filled in.
 *
 * The fallback is deliberately the same `UserSummaryResponse` shape a
 * registered user gets rather than a plain string, so a client renders one
 * kind of thing for every participant and only has to treat `name` and
 * `avatarUrl` as optional — which it already must, since a registered user
 * can have neither.
 */
export function toParticipantSummary(
  email: string,
  directory: ParticipantDirectory,
): UserSummaryResponse {
  return directory.get(email) ?? { email, name: null, avatarUrl: null };
}
