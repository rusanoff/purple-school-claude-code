import {
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { AssertMeetingAccessQuery } from '../meeting/queries/assert-meeting-access.query';
import { isPrismaError } from '../prisma/prisma-error.util';
import { DeleteMeetingFileCommand } from './commands/delete-meeting-file.command';
import { UploadMeetingFileCommand } from './commands/upload-meeting-file.command';
import { MeetingFileResponse } from './interfaces/meeting-file.interface';
import { GetMeetingFileQuery } from './queries/get-meeting-file.query';
import { ListMeetingFilesQuery } from './queries/list-meeting-files.query';
import { MeetingFileStorageService } from './storage/meeting-file-storage.service';

/**
 * Deliberately not a one-liner-per-route controller like `MeetingController`
 * — a multipart body doesn't fit the "controller hands a message straight
 * to a bus" pattern (see docs/research-meeting-upload.md §1): access must
 * be checked before the file is read off the wire, and the file itself has
 * to be validated/written to disk before anything about it can go into an
 * immutable command payload. `UploadMeetingFileCommand` still owns the one
 * piece of actual business logic (persisting metadata) — this controller
 * only sequences the HTTP-edge steps that have to happen before that.
 * The download route has the same "not just a bus call" shape, for a
 * different reason: streaming a file back needs `@Res()` to write headers
 * and pipe bytes directly, which Nest can't infer from a plain return value.
 */
@Controller('meetings/:meetingId/files')
@UseGuards(JwtAuthGuard)
export class MeetingFilesController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
    private readonly storage: MeetingFileStorageService,
  ) {}

  @Post()
  async upload(
    @CurrentUser() user: AuthUser,
    @Param('meetingId') meetingId: string,
    @Req() request: FastifyRequest,
  ): Promise<MeetingFileResponse> {
    // Reuses the same owner-or-participant check GET /meetings/:id uses —
    // 404 for a non-existent meeting, 403 for one the caller can't access —
    // before the multipart body is even read off the wire.
    await this.queryBus.execute(
      new AssertMeetingAccessQuery(user.userId, user.email, meetingId),
    );

    const saved = await this.storage.saveUploadedFile(request);

    try {
      return await this.commandBus.execute(
        new UploadMeetingFileCommand(
          meetingId,
          user.userId,
          saved.filename,
          saved.mimeType,
          saved.size,
          saved.path,
        ),
      );
    } catch (error) {
      // The file is already on disk at this point — if persisting its
      // metadata fails, remove it rather than leaving an orphaned file with
      // no corresponding MeetingFile row.
      await this.storage.deleteFile(saved.path);

      // The meeting can be deleted by its owner in the window between the
      // access check above and this insert — the access check passed
      // against a meeting that no longer exists by the time
      // meetingFile.create() runs, which fails the FK constraint on
      // meetingId (P2003) rather than a plain DB error. Surfaced as the
      // same 404 a retry would see, instead of a raw 500 that doesn't
      // explain what actually happened.
      if (isPrismaError(error, 'P2003')) {
        throw new NotFoundException('Meeting not found');
      }
      throw error;
    }
  }

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Param('meetingId') meetingId: string,
  ): Promise<MeetingFileResponse[]> {
    await this.queryBus.execute(
      new AssertMeetingAccessQuery(user.userId, user.email, meetingId),
    );

    return this.queryBus.execute(new ListMeetingFilesQuery(meetingId));
  }

  @Get(':fileId')
  async download(
    @CurrentUser() user: AuthUser,
    @Param('meetingId') meetingId: string,
    @Param('fileId') fileId: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.queryBus.execute(
      new AssertMeetingAccessQuery(user.userId, user.email, meetingId),
    );

    const file = await this.queryBus.execute(
      new GetMeetingFileQuery(meetingId, fileId),
    );

    // A concurrent DELETE (of this file, or of the whole meeting) can win
    // the race between the DB read above and opening the stream below —
    // checked explicitly, and *before* `reply.send()`, because a raw
    // stream error past that point wouldn't go through Nest's exception
    // zone (this route uses `@Res()`) and would surface as an unhandled
    // 500 instead of a clean 404.
    if (!(await this.storage.fileExists(file.path))) {
      throw new NotFoundException('File not found');
    }

    reply
      .header('Content-Disposition', contentDisposition(file.filename))
      .type(file.mimeType)
      .send(this.storage.createReadStream(file.path));
  }

  @Delete(':fileId')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('meetingId') meetingId: string,
    @Param('fileId') fileId: string,
  ): Promise<void> {
    // Only the owner-or-participant meeting check runs here — who is
    // *allowed to delete* (meeting owner, or the file's own uploader) is a
    // narrower rule than meeting access, and lives inside
    // DeleteMeetingFileCommand's handler itself (see that command's docs).
    await this.queryBus.execute(
      new AssertMeetingAccessQuery(user.userId, user.email, meetingId),
    );

    await this.commandBus.execute(
      new DeleteMeetingFileCommand(meetingId, fileId, user.userId),
    );
  }
}

/**
 * Builds a `Content-Disposition` header value from a client-supplied
 * filename. `filename` is user-controlled (the original upload name, never
 * sanitized beyond MIME/size checks) — CR/LF are stripped to prevent header
 * injection. The quoted `filename` parameter is further restricted to a
 * printable-ASCII fallback (any other byte becomes `_`): HTTP header values
 * are Latin-1-only at the Node/Fastify level, so a Cyrillic/CJK/emoji name
 * placed there verbatim throws `ERR_INVALID_CHAR` and 500s the whole
 * download — the real name survives losslessly in the RFC 5987 `filename*`
 * parameter alongside it, which every modern client prefers anyway.
 */
function contentDisposition(filename: string): string {
  const stripped = filename.replace(/[\r\n]/g, '');
  const asciiFallback = stripped.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(stripped)}`;
}
