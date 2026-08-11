import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { PrismaService } from '../../prisma/prisma.service';
import {
  MeetingResponse,
  toMeetingResponse,
} from '../interfaces/meeting.interface';
import { CreateMeetingCommand } from './create-meeting.command';

@CommandHandler(CreateMeetingCommand)
export class CreateMeetingHandler implements ICommandHandler<CreateMeetingCommand> {
  constructor(private readonly prisma: PrismaService) {}

  async execute({
    ownerId,
    title,
    date,
    participants,
  }: CreateMeetingCommand): Promise<MeetingResponse> {
    const meeting = await this.prisma.meeting.create({
      data: { ownerId, title, date: new Date(date), participants },
    });

    return toMeetingResponse(meeting);
  }
}
