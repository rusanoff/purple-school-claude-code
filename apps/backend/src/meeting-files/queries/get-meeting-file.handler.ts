import { NotFoundException } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { PrismaService } from '../../prisma/prisma.service';
import {
  MeetingFileRecord,
  toMeetingFileRecord,
} from '../interfaces/meeting-file.interface';
import { GetMeetingFileQuery } from './get-meeting-file.query';

@QueryHandler(GetMeetingFileQuery)
export class GetMeetingFileHandler implements IQueryHandler<GetMeetingFileQuery> {
  constructor(private readonly prisma: PrismaService) {}

  async execute({
    meetingId,
    fileId,
  }: GetMeetingFileQuery): Promise<MeetingFileRecord> {
    const file = await this.prisma.meetingFile.findUnique({
      where: { id: fileId },
    });

    // A file that exists but belongs to a different meeting 404s the same
    // as one that doesn't exist at all — the URL's :meetingId is a scope,
    // not just a label, so it must not leak "this file exists elsewhere".
    if (!file || file.meetingId !== meetingId) {
      throw new NotFoundException('File not found');
    }

    return toMeetingFileRecord(file);
  }
}
