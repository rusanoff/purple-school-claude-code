import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { AuthModule } from '../auth/auth.module';
import { CommandHandlers } from './commands';
import { MeetingFilesController } from './meeting-files.controller';
import { MeetingFileStorageService } from './storage/meeting-file-storage.service';

@Module({
  // No import of MeetingModule: MeetingFilesController dispatches
  // GetMeetingQuery through the shared CommandBus/QueryBus rather than
  // depending on MeetingModule directly — same cross-module dispatch
  // pattern as Auth <-> Users, see apps/backend/CLAUDE.md.
  imports: [CqrsModule, AuthModule],
  controllers: [MeetingFilesController],
  providers: [...CommandHandlers, MeetingFileStorageService],
})
export class MeetingFilesModule {}
