import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { MeetingFileStorageService } from '../../meeting-files/storage/meeting-file-storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DeleteMeetingCommand } from './delete-meeting.command';

@CommandHandler(DeleteMeetingCommand)
export class DeleteMeetingHandler implements ICommandHandler<DeleteMeetingCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: MeetingFileStorageService,
  ) {}

  async execute({ userId, meetingId }: DeleteMeetingCommand): Promise<void> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { ownerId: true },
    });

    if (!meeting) {
      throw new NotFoundException('Meeting not found');
    }

    if (meeting.ownerId !== userId) {
      throw new ForbiddenException('Only the meeting owner can delete it');
    }

    const files = await this.prisma.meetingFile.findMany({
      where: { meetingId },
      select: { path: true },
    });

    // Disk files removed *before* the meeting row — the DB cascade on
    // `MeetingFile.meetingId` wipes those rows (and their `path` column)
    // the instant `meeting.delete` below runs, so this is the last point
    // any of these paths are still readable. The DB cascade only ever
    // touches Postgres; it can't reach the filesystem, hence this explicit
    // step (see docs/plan-meeting-file-upload-and-display.md's scope note).
    await Promise.all(files.map((file) => this.storage.deleteFile(file.path)));

    await this.prisma.meeting.delete({ where: { id: meetingId } });
  }
}
