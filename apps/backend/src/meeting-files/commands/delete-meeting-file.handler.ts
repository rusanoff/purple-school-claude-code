import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { PrismaService } from '../../prisma/prisma.service';
import { MeetingFileStorageService } from '../storage/meeting-file-storage.service';
import { DeleteMeetingFileCommand } from './delete-meeting-file.command';

@CommandHandler(DeleteMeetingFileCommand)
export class DeleteMeetingFileHandler implements ICommandHandler<DeleteMeetingFileCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: MeetingFileStorageService,
  ) {}

  async execute({
    meetingId,
    fileId,
    requesterId,
  }: DeleteMeetingFileCommand): Promise<void> {
    const file = await this.prisma.meetingFile.findUnique({
      where: { id: fileId },
      include: { meeting: { select: { ownerId: true } } },
    });

    // Same "belongs to a different meeting" 404 as GetMeetingFileHandler —
    // the URL's :meetingId scopes the lookup, not just labels it.
    if (!file || file.meetingId !== meetingId) {
      throw new NotFoundException('File not found');
    }

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
    await this.prisma.meetingFile.delete({ where: { id: fileId } });
    await this.storage.deleteFile(file.path);
  }
}
