import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { PrismaService } from '../../prisma/prisma.service';
import {
  MEETING_FILE_UPLOADER_INCLUDE,
  MeetingFileResponse,
  toMeetingFileResponse,
} from '../interfaces/meeting-file.interface';
import { UploadMeetingFileCommand } from './upload-meeting-file.command';

@CommandHandler(UploadMeetingFileCommand)
export class UploadMeetingFileHandler implements ICommandHandler<UploadMeetingFileCommand> {
  constructor(private readonly prisma: PrismaService) {}

  async execute({
    meetingId,
    uploadedById,
    filename,
    mimeType,
    size,
    path,
  }: UploadMeetingFileCommand): Promise<MeetingFileResponse> {
    const file = await this.prisma.meetingFile.create({
      data: { meetingId, uploadedById, filename, mimeType, size, path },
      // The frontend prepends this response to its file list without
      // refetching, so it has to be the same shape the list returns —
      // uploader summary included, or the new row would render nameless
      // until a reload.
      include: MEETING_FILE_UPLOADER_INCLUDE,
    });

    return toMeetingFileResponse(file);
  }
}
