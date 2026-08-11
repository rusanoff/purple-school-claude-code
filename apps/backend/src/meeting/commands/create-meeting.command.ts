import { Command } from '@nestjs/cqrs';
import { MeetingResponse } from '../interfaces/meeting.interface';

/** Intent: create a meeting owned by `ownerId`. */
export class CreateMeetingCommand extends Command<MeetingResponse> {
  constructor(
    public readonly ownerId: string,
    public readonly title: string,
    public readonly date: string,
    public readonly participants: string[],
  ) {
    super();
  }
}
