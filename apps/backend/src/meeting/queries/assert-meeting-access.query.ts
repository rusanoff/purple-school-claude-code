import { Query } from '@nestjs/cqrs';

/**
 * Intent: verify the caller can access a meeting (owner or participant) —
 * a narrower sibling of `GetMeetingQuery` for callers that only need the
 * access check, not the mapped `MeetingResponse` (e.g.
 * `MeetingFilesController` before it processes an upload). Kept as its own
 * query, rather than the file controller reusing `GetMeetingQuery`, so a
 * future read-specific addition to `GetMeetingHandler` doesn't
 * unintentionally also run on every file upload, and so the file upload
 * path isn't paying for a `MeetingResponse` mapping it never uses.
 */
export class AssertMeetingAccessQuery extends Query<void> {
  constructor(
    public readonly userId: string,
    public readonly email: string,
    public readonly meetingId: string,
  ) {
    super();
  }
}
