import { DeleteMeetingFileHandler } from './delete-meeting-file.handler';
import { UploadMeetingFileHandler } from './upload-meeting-file.handler';

export const CommandHandlers = [
  UploadMeetingFileHandler,
  DeleteMeetingFileHandler,
];
