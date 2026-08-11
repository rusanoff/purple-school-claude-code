import { Query } from '@nestjs/cqrs';
import { MeetingResponse } from '../interfaces/meeting.interface';

/** Intent: list every meeting owned by `ownerId`. */
export class GetMeetingsQuery extends Query<MeetingResponse[]> {
  constructor(public readonly ownerId: string) {
    super();
  }
}
