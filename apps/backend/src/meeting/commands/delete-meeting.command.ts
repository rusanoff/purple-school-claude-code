import { Command } from '@nestjs/cqrs';

/**
 * Intent: delete a meeting and everything that belongs to it. Owner-only —
 * a participant can read a meeting but must not be able to remove it, so
 * this is a stricter check than `assertMeetingAccess` (owner-or-participant)
 * and is applied directly in the handler rather than reused from there.
 */
export class DeleteMeetingCommand extends Command<void> {
  constructor(
    public readonly userId: string,
    public readonly meetingId: string,
  ) {
    super();
  }
}
