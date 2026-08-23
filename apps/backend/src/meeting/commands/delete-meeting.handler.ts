import { ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { MeetingFileStorageService } from '../../meeting-files/storage/meeting-file-storage.service';
import { isPrismaError } from '../../prisma/prisma-error.util';
import { PrismaService } from '../../prisma/prisma.service';
import { DeleteMeetingCommand } from './delete-meeting.command';

@CommandHandler(DeleteMeetingCommand)
export class DeleteMeetingHandler implements ICommandHandler<DeleteMeetingCommand> {
  private readonly logger = new Logger(DeleteMeetingHandler.name);

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

    // The DB row is deleted right after the snapshot above (not after disk
    // cleanup) for two reasons: it keeps the window where a concurrent
    // upload could slip in between the snapshot and the delete as small as
    // possible, and it means a mid-cleanup disk failure below can no longer
    // leave the meeting itself stuck undeleted — same DB-first reasoning as
    // DeleteMeetingFileHandler. `path` values are already captured in
    // `files` above, so disk cleanup below doesn't need the row to still
    // exist. (A file uploaded in the instant between the snapshot and this
    // delete is still cascade-removed from the DB by `onDelete: Cascade`,
    // but not from disk — a known, narrow race, accepted for now the same
    // way the `uploadedById` cascade tradeoff is in prisma/schema.prisma.)
    try {
      await this.prisma.meeting.delete({ where: { id: meetingId } });
    } catch (error) {
      // Two concurrent deletes of the same meeting both pass the ownership
      // check above before either reaches this call — the loser hits
      // Prisma's "record to delete not found" (P2025).
      if (isPrismaError(error, 'P2025')) {
        throw new NotFoundException('Meeting not found');
      }
      throw error;
    }

    // The meeting (and its MeetingFile rows) are already gone from the DB
    // at this point, so a failure here — one locked/permission-denied file
    // among several — must not look like the whole deletion failed;
    // `allSettled` lets every other file still get cleaned up, and a
    // failure just leaves that one file an orphan on disk (logged, not
    // thrown) rather than losing track of which files still need removal.
    const results = await Promise.allSettled(
      files.map((file) => this.storage.deleteFile(file.path)),
    );
    for (const result of results) {
      if (result.status === 'rejected') {
        this.logger.warn(
          `Failed to remove a disk file for deleted meeting ${meetingId}: ${String(result.reason)}`,
        );
      }
    }
  }
}
