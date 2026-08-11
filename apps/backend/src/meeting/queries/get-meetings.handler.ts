import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { PrismaService } from '../../prisma/prisma.service';
import {
  MeetingResponse,
  toMeetingResponse,
} from '../interfaces/meeting.interface';
import { GetMeetingsQuery } from './get-meetings.query';

@QueryHandler(GetMeetingsQuery)
export class GetMeetingsHandler implements IQueryHandler<GetMeetingsQuery> {
  constructor(private readonly prisma: PrismaService) {}

  async execute({ ownerId }: GetMeetingsQuery): Promise<MeetingResponse[]> {
    const meetings = await this.prisma.meeting.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'desc' },
    });

    return meetings.map(toMeetingResponse);
  }
}
