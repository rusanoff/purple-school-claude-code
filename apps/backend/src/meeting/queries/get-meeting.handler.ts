import { NotFoundException } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { PrismaService } from '../../prisma/prisma.service';
import { assertMeetingAccess } from '../access/meeting-access';
import {
  MeetingResponse,
  toMeetingResponse,
} from '../interfaces/meeting.interface';
import { loadParticipantDirectory } from '../participants/participant-directory';
import { GetMeetingQuery } from './get-meeting.query';

@QueryHandler(GetMeetingQuery)
export class GetMeetingHandler implements IQueryHandler<GetMeetingQuery> {
  constructor(private readonly prisma: PrismaService) {}

  async execute({
    userId,
    email,
    id,
  }: GetMeetingQuery): Promise<MeetingResponse> {
    // Looked up by id alone (not scoped to ownerId) — a non-existent meeting
    // still 404s, but an existing one the caller can't access 403s via
    // assertMeetingAccess below, instead of both cases collapsing to 404.
    const meeting = await this.prisma.meeting.findUnique({ where: { id } });

    if (!meeting) {
      throw new NotFoundException('Meeting not found');
    }

    // Before the participant lookup, not after: nobody who fails this gets
    // to learn anything about the people on a meeting they can't read.
    assertMeetingAccess(meeting, { userId, email });

    const participants = await loadParticipantDirectory(
      this.prisma,
      meeting.participants,
    );

    return toMeetingResponse(meeting, userId, participants);
  }
}
