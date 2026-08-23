import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { PrismaService } from '../../prisma/prisma.service';
import {
  MeetingFileRecord,
  toMeetingFileRecord,
} from '../interfaces/meeting-file.interface';
import { findMeetingFileOrThrow } from './find-meeting-file-or-throw';
import { GetMeetingFileQuery } from './get-meeting-file.query';

@QueryHandler(GetMeetingFileQuery)
export class GetMeetingFileHandler implements IQueryHandler<GetMeetingFileQuery> {
  constructor(private readonly prisma: PrismaService) {}

  async execute({
    meetingId,
    fileId,
  }: GetMeetingFileQuery): Promise<MeetingFileRecord> {
    const file = await findMeetingFileOrThrow(this.prisma, meetingId, fileId);

    return toMeetingFileRecord(file);
  }
}
