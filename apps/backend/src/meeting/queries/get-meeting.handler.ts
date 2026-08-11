import { NotFoundException } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { PrismaService } from '../../prisma/prisma.service';
import {
  MeetingResponse,
  toMeetingResponse,
} from '../interfaces/meeting.interface';
import { GetMeetingQuery } from './get-meeting.query';

@QueryHandler(GetMeetingQuery)
export class GetMeetingHandler implements IQueryHandler<GetMeetingQuery> {
  constructor(private readonly prisma: PrismaService) {}

  async execute({ ownerId, id }: GetMeetingQuery): Promise<MeetingResponse> {
    // Scoping by ownerId means another user's meeting is indistinguishable
    // from a non-existent one — both surface as 404, never 403.
    const meeting = await this.prisma.meeting.findFirst({
      where: { id, ownerId },
    });

    if (!meeting) {
      throw new NotFoundException('Meeting not found');
    }

    return toMeetingResponse(meeting);
  }
}
