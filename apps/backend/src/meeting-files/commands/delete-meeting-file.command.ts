import { Command } from '@nestjs/cqrs';

/**
 * Intent: delete a single meeting file — both its DB row and its disk file.
 * Unlike `UploadMeetingFileCommand`, this command *does* carry out its own
 * authorization check (owner-of-the-meeting-or-uploader-of-the-file):
 * that rule isn't the plain owner-or-participant meeting access the
 * controller already asserted before dispatching this (a participant who
 * can see the meeting may still not be allowed to delete someone else's
 * file), so it can't be factored out to a shared `AssertMeetingAccessQuery`
 * call the way upload/list/download's access check is.
 */
export class DeleteMeetingFileCommand extends Command<void> {
  constructor(
    public readonly meetingId: string,
    public readonly fileId: string,
    public readonly requesterId: string,
  ) {
    super();
  }
}
