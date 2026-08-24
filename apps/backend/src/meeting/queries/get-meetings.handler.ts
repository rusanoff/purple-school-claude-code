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

    // This list is always owner-scoped (`where: { ownerId }` above), so
    // every meeting in it belongs to the caller — `isOwner` is trivially
    // true for all of them, unlike `GetMeetingHandler`'s owner-or-participant
    // case.
    return meetings.map((meeting) => toMeetingResponse(meeting, ownerId));
  }
}
