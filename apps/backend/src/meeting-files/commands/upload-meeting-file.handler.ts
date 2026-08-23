import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { PrismaService } from '../../prisma/prisma.service';
import {
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
    });

    return toMeetingFileResponse(file);
  }
}
