import { Query } from '@nestjs/cqrs';
import { MeetingResponse } from '../interfaces/meeting.interface';

/** Intent: fetch a single meeting by id, scoped to its owner. */
export class GetMeetingQuery extends Query<MeetingResponse> {
  constructor(
    public readonly ownerId: string,
    public readonly id: string,
  ) {
    super();
  }
}
