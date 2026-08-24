import { Query } from '@nestjs/cqrs';
import { MeetingFileResponse } from '../interfaces/meeting-file.interface';

/**
 * Intent: list a meeting's files, newest first. Only takes `meetingId` —
 * access (owner-or-participant) is checked by the controller dispatching
 * `AssertMeetingAccessQuery` first, same as the upload route, so this
 * handler doesn't re-check it.
 */
export class ListMeetingFilesQuery extends Query<MeetingFileResponse[]> {
  constructor(public readonly meetingId: string) {
    super();
  }
}
