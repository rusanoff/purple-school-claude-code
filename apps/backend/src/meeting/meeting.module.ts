import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { AuthModule } from '../auth/auth.module';
import { MeetingFilesModule } from '../meeting-files/meeting-files.module';
import { CommandHandlers } from './commands';
import { MeetingController } from './meeting.controller';
import { QueryHandlers } from './queries';

@Module({
  // AuthModule exports JwtModule + JwtAuthGuard so these routes can be
  // protected with the same JWT secret used to sign auth tokens.
  // MeetingFilesModule exports MeetingFileStorageService — DeleteMeetingHandler
  // injects it directly (not via the CQRS bus) to remove a deleted meeting's
  // files from disk; see the "exports" comment in meeting-files.module.ts.
  // Not circular: MeetingFilesModule itself never imports MeetingModule.
  imports: [CqrsModule, AuthModule, MeetingFilesModule],
  controllers: [MeetingController],
  providers: [...CommandHandlers, ...QueryHandlers],
})
export class MeetingModule {}
