import { NotFoundException } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { PrismaService } from '../../prisma/prisma.service';
import { assertMeetingAccess } from '../access/meeting-access';
import { AssertMeetingAccessQuery } from './assert-meeting-access.query';

@QueryHandler(AssertMeetingAccessQuery)
export class AssertMeetingAccessHandler implements IQueryHandler<AssertMeetingAccessQuery> {
  constructor(private readonly prisma: PrismaService) {}

  async execute({
    userId,
    email,
    meetingId,
  }: AssertMeetingAccessQuery): Promise<void> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { ownerId: true, participants: true },
    });

    if (!meeting) {
      throw new NotFoundException('Meeting not found');
    }

    assertMeetingAccess(meeting, { userId, email });
  }
}
