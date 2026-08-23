import { Command } from '@nestjs/cqrs';
import { MeetingFileResponse } from '../interfaces/meeting-file.interface';

/**
 * Intent: persist metadata for a file already validated and written to disk
 * by `MeetingFileStorageService` — access to `meetingId` must already have
 * been confirmed (owner-or-participant) before this is dispatched, this
 * handler does not re-check it.
 */
export class UploadMeetingFileCommand extends Command<MeetingFileResponse> {
  constructor(
    public readonly meetingId: string,
    public readonly uploadedById: string,
    public readonly filename: string,
    public readonly mimeType: string,
    public readonly size: number,
    public readonly path: string,
  ) {
    super();
  }
}
