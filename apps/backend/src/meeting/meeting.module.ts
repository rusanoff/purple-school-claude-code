import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { AuthModule } from '../auth/auth.module';
import { CommandHandlers } from './commands';
import { MeetingController } from './meeting.controller';
import { QueryHandlers } from './queries';

@Module({
  // AuthModule exports JwtModule + JwtAuthGuard so these routes can be
  // protected with the same JWT secret used to sign auth tokens.
  imports: [CqrsModule, AuthModule],
  controllers: [MeetingController],
  providers: [...CommandHandlers, ...QueryHandlers],
})
export class MeetingModule {}
