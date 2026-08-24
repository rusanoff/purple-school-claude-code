import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { AuthModule } from '../auth/auth.module';
import { CommandHandlers } from './commands';
import { MeetingFilesController } from './meeting-files.controller';
import { QueryHandlers } from './queries';
import { MeetingFileStorageService } from './storage/meeting-file-storage.service';

@Module({
  // No import of MeetingModule: MeetingFilesController dispatches
  // AssertMeetingAccessQuery through the shared CommandBus/QueryBus rather
  // than depending on MeetingModule directly — same cross-module dispatch
  // pattern as Auth <-> Users, see apps/backend/CLAUDE.md.
  imports: [CqrsModule, AuthModule],
  controllers: [MeetingFilesController],
  providers: [...CommandHandlers, ...QueryHandlers, MeetingFileStorageService],
  // Exported, not dispatched via the bus: unlike the CQRS handlers above,
  // deleting a meeting needs the storage service's actual disk-IO methods
  // (delete a batch of files by their on-disk names), not a single
  // message/result exchange — DeleteMeetingHandler (meeting module) imports
  // this module directly to inject it, the same way every feature module
  // imports AuthModule to reuse JwtAuthGuard rather than going through the
  // bus for authentication.
  exports: [MeetingFileStorageService],
})
export class MeetingFilesModule {}
