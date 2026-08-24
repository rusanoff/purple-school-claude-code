import { ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { findMeetingFileOrThrow } from '../queries/find-meeting-file-or-throw';
import { isPrismaError } from '../../prisma/prisma-error.util';
import { PrismaService } from '../../prisma/prisma.service';
import { MeetingFileStorageService } from '../storage/meeting-file-storage.service';
import { DeleteMeetingFileCommand } from './delete-meeting-file.command';

@CommandHandler(DeleteMeetingFileCommand)
export class DeleteMeetingFileHandler implements ICommandHandler<DeleteMeetingFileCommand> {
  private readonly logger = new Logger(DeleteMeetingFileHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: MeetingFileStorageService,
  ) {}

  async execute({
    meetingId,
    fileId,
    requesterId,
  }: DeleteMeetingFileCommand): Promise<void> {
    const file = await findMeetingFileOrThrow(this.prisma, meetingId, fileId);

    const isMeetingOwner = file.meeting.ownerId === requesterId;
    const isUploader = file.uploadedById === requesterId;
    if (!isMeetingOwner && !isUploader) {
      throw new ForbiddenException(
        'You can only delete files you uploaded yourself',
      );
    }

    // DB row first, then the disk file: if the disk removal below ever
    // failed, we'd be left with an orphaned file on disk (a leak, but a
    // safe one) rather than a DB row pointing at a file that's already
    // gone (a broken reference other requests could trip over).
    try {
      await this.prisma.meetingFile.delete({ where: { id: fileId } });
    } catch (error) {
      // Two concurrent deletes of the same file both pass the check above
      // before either reaches this call — the loser hits Prisma's "record
      // to delete not found" (P2025), which without this translation would
      // surface as a raw 500 instead of the 404 a retry would see anyway.
      if (isPrismaError(error, 'P2025')) {
        throw new NotFoundException('File not found');
      }
      throw error;
    }

    try {
      await this.storage.deleteFile(file.path);
    } catch (error) {
      // The DB row is already gone at this point — the delete has already
      // logically happened from the caller's perspective (a retry would
      // now see 404), so a real disk I/O error here (permissions, a busy
      // handle — anything past the ENOENT `saveUploadedFile`'s `force`
      // already swallows) is logged rather than turned into a 500 that
      // would misleadingly suggest the delete didn't take effect.
      this.logger.warn(
        `Failed to remove disk file for deleted MeetingFile ${fileId}: ${String(error)}`,
      );
    }
  }
}
