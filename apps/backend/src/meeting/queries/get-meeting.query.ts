import { Query } from '@nestjs/cqrs';
import { MeetingResponse } from '../interfaces/meeting.interface';

/**
 * Intent: fetch a single meeting by id, accessible to its owner or any of
 * its participants (see `assertMeetingAccess`) — not scoped to `ownerId`
 * the way `GetMeetingsQuery` (the list) still is.
 */
export class GetMeetingQuery extends Query<MeetingResponse> {
  constructor(
    public readonly userId: string,
    public readonly email: string,
    public readonly id: string,
  ) {
    super();
  }
}
