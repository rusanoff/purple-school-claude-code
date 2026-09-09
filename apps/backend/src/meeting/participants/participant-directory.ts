import { PrismaService } from '../../prisma/prisma.service';
import {
  USER_SUMMARY_SELECT,
  UserSummaryResponse,
  UserSummarySource,
  toUserSummary,
} from '../../users/interfaces/user-summary.interface';

/**
 * The registered users behind a set of participant emails, keyed by
 * **lowercased** email.
 *
 * `Meeting.participants` is a free-form `String[]` of emails rather than a
 * relation to `User` (see `assertMeetingAccess`), so "who is this
 * participant" can only be answered by looking the emails up — and an email
 * that isn't in here simply belongs to someone who never registered, which
 * is a normal case, not a missing row.
 *
 * The key is normalized because neither side of that comparison is: an
 * organizer types participant emails by hand and registration stores an email
 * exactly as it was typed, so the same person can be `Ada@Example.com` on the
 * meeting and `ada@example.com` on their account. Go through
 * `toParticipantSummary` rather than reading the map directly — it applies the
 * same normalization to the lookup key.
 */
export type ParticipantDirectory = ReadonlyMap<string, UserSummaryResponse>;

/**
 * Resolves every participant email to a user summary in **one** query.
 *
 * Callers pass the flattened emails of every meeting they are about to
 * respond with, not one meeting at a time: that is what keeps listing a page
 * of meetings at two queries total instead of one lookup per meeting (or,
 * worse, per participant). Duplicates across meetings collapse here too,
 * since meetings routinely share participants — including duplicates that
 * differ only in case, which the normalized dedupe folds into one slot of the
 * `in` list.
 *
 * The lookup is case-insensitive for the reason spelled out on
 * `ParticipantDirectory`, and mirrors `assertMeetingAccess`: a participant
 * whose case doesn't match is still let *into* the meeting, so failing to
 * recognize them here would show a legitimate participant as a stranger.
 * Prisma renders `mode: 'insensitive'` on an `in` filter as
 * `LOWER(email) IN (LOWER($1), ...)`, so the emails are passed lowercased
 * only to make the deduplication and the comparison agree — not because the
 * query depends on it. That wrapped column also means the unique index on
 * `users.email` can't serve this filter, the same index-less trade-off
 * `docs/research-meeting-upload.md` already accepted for the case-insensitive
 * participant check: at this app's scale one sequential scan per response
 * beats a `lower(email)` functional index that Prisma's schema language can't
 * express (raw-SQL-only, and then permanently reported as drift).
 */
export async function loadParticipantDirectory(
  prisma: PrismaService,
  emails: readonly string[],
): Promise<ParticipantDirectory> {
  const unique = [...new Set(emails.map(normalizeEmail))];

  if (unique.length === 0) {
    return new Map();
  }

  const users = await prisma.user.findMany({
    where: { email: { in: unique, mode: 'insensitive' } },
    select: USER_SUMMARY_SELECT,
  });

  const directory = new Map<string, UserSummarySource>();

  for (const user of users) {
    const key = normalizeEmail(user.email);
    const rival = directory.get(key);

    // Registration is case-sensitive (`users.email` is uniquely indexed on the
    // raw string), so `Ada@example.com` and `ada@example.com` can be two real
    // accounts that this insensitive filter returns together, and the map has
    // to collapse them into one key. Which of the two a participant "is" can't
    // be known from an email that matches both — but answering differently on
    // identical data would be worse than answering arbitrarily, so the winner
    // is picked from the rows themselves rather than from the order the
    // database happened to return them in.
    if (!rival || user.email < rival.email) {
      directory.set(key, user);
    }
  }

  return new Map(
    [...directory].map(([key, user]) => [key, toUserSummary(user)]),
  );
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
 *
 * Note which email survives: a match answers with the address as the *account*
 * spells it, while the fallback echoes the meeting's own string untouched.
 * Normalization is a matching detail, and lowercasing an unregistered
 * participant would show an address nobody entered.
 */
export function toParticipantSummary(
  email: string,
  directory: ParticipantDirectory,
): UserSummaryResponse {
  return (
    directory.get(normalizeEmail(email)) ?? {
      email,
      name: null,
      avatarUrl: null,
    }
  );
}

/** The single spelling of an email both sides of the match are reduced to. */
function normalizeEmail(email: string): string {
  return email.toLowerCase();
}
