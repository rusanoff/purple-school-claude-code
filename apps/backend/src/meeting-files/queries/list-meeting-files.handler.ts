import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { PrismaService } from '../../prisma/prisma.service';
import {
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
    });

    return files.map(toMeetingFileResponse);
  }
}
