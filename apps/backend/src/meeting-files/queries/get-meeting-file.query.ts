import { Query } from '@nestjs/cqrs';
import { MeetingFileRecord } from '../interfaces/meeting-file.interface';

/**
 * Intent: fetch a single meeting file by id, scoped to `meetingId` — a file
 * that exists but belongs to a different meeting is treated as not found
 * (never leaked as "exists elsewhere"). Returns the internal
 * `MeetingFileRecord` (includes `path`) rather than `MeetingFileResponse`
 * because both call sites (download, delete) need the on-disk path; neither
 * ever returns this value straight to an HTTP client.
 *
 * Like `UploadMeetingFileCommand`, this does not itself check
 * owner-or-participant access to the meeting — the controller dispatches
 * `AssertMeetingAccessQuery` first, same as every other route in this
 * controller.
 */
export class GetMeetingFileQuery extends Query<MeetingFileRecord> {
  constructor(
    public readonly meetingId: string,
    public readonly fileId: string,
  ) {
    super();
  }
}
