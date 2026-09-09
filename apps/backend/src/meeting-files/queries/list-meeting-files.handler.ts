import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { PrismaService } from '../../prisma/prisma.service';
import {
  MEETING_FILE_UPLOADER_INCLUDE,
  MeetingFileResponse,
  toMeetingFileResponse,
} from '../interfaces/meeting-file.interface';
import { ListMeetingFilesQuery } from './list-meeting-files.query';

@QueryHandler(ListMeetingFilesQuery)
export class ListMeetingFilesHandler implements IQueryHandler<ListMeetingFilesQuery> {
  constructor(private readonly prisma: PrismaService) {}

  async execute({
    meetingId,
  }: ListMeetingFilesQuery): Promise<MeetingFileResponse[]> {
    const files = await this.prisma.meetingFile.findMany({
      where: { meetingId },
      orderBy: { createdAt: 'desc' },
      // One query for the whole list, uploaders included — see the
      // constant's docs on why this can't be a per-file lookup.
      include: MEETING_FILE_UPLOADER_INCLUDE,
    });

    return files.map(toMeetingFileResponse);
  }
}
