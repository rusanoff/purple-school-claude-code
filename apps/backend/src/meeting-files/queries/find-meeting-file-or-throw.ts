import { NotFoundException } from '@nestjs/common';
import { MeetingFile } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** A `MeetingFile` row plus its parent meeting's `ownerId` — the shape both
 * `GetMeetingFileHandler` (download) and `DeleteMeetingFileHandler` need,
 * the latter to decide who's allowed to delete it. */
export type MeetingFileWithMeetingOwner = MeetingFile & {
  meeting: { ownerId: string };
};

/**
 * Shared lookup for "the file with this id, scoped to this meeting" — used
 * by both the download and delete-file handlers so the 404-scoping rule
 * (a file that exists but belongs to a *different* meeting must 404 the
 * same as one that doesn't exist at all, never leaked as "exists
 * elsewhere") can't drift between the two call sites.
 */
export async function findMeetingFileOrThrow(
  prisma: PrismaService,
  meetingId: string,
  fileId: string,
): Promise<MeetingFileWithMeetingOwner> {
  const file = await prisma.meetingFile.findUnique({
    where: { id: fileId },
    include: { meeting: { select: { ownerId: true } } },
  });

  if (!file || file.meetingId !== meetingId) {
    throw new NotFoundException('File not found');
  }

  return file;
}
