import { ForbiddenException } from '@nestjs/common';

/** The subset of a Meeting row this check needs — not the full Prisma type,
 * so it can be called with either a real `Meeting` or a lightweight shape. */
export interface MeetingAccessSubject {
  ownerId: string;
  participants: string[];
}

/** The subset of the caller's identity this check needs. */
export interface MeetingAccessCaller {
  userId: string;
  email: string;
}

/**
 * Shared owner-or-participant access rule, reused by every handler that
 * needs to gate a meeting (and, from Phase 1 onward, its files) behind the
 * same policy — see `apps/backend/CLAUDE.md`'s "Authorization inside the
 * pattern" section for why this stays plain handler-side logic rather than
 * a Nest `Guard` (guards here are authentication-only).
 *
 * `Meeting.participants` is a free-form `String[]` of emails, not a relation
 * to `User` — so membership is checked by comparing the caller's JWT email
 * against that list case-insensitively, per the PRD's explicit requirement
 * that a case mismatch must not lock a legitimate participant out.
 *
 * Throws `ForbiddenException` (403) when neither check passes. Call this
 * only after confirming the meeting itself exists (404 first) — this
 * function never distinguishes "doesn't exist" from "exists but you can't
 * see it", that's the caller's job.
 */
export function assertMeetingAccess(
  meeting: MeetingAccessSubject,
  caller: MeetingAccessCaller,
): void {
  if (meeting.ownerId === caller.userId) {
    return;
  }

  const callerEmail = caller.email.toLowerCase();
  const isParticipant = meeting.participants.some(
    (participant) => participant.toLowerCase() === callerEmail,
  );

  if (!isParticipant) {
    throw new ForbiddenException('You do not have access to this meeting');
  }
}
