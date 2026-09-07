import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { AuthModule } from '../auth/auth.module';
import { CommandHandlers } from './commands';
import { QueryHandlers } from './queries';
import { AvatarStorageService } from './storage/avatar-storage.service';
import { UsersController } from './users.controller';

/**
 * Owns user persistence: creating and looking up users. Exports no providers —
 * other feature modules (e.g. AuthModule) interact with it only through
 * CommandBus/QueryBus, per the app's CQRS convention (see root/backend
 * CLAUDE.md). `CqrsModule` is a shared singleton across the app (Nest dedupes
 * the module by class reference), so handlers registered here are reachable
 * from any other module's CommandBus/QueryBus as long as this module is part
 * of the app graph (registered in AppModule).
 *
 * `UsersController` is its only HTTP surface, and only for the caller's own
 * profile. AuthModule is imported for the JwtModule + JwtAuthGuard that route
 * is protected with — the same wiring MeetingModule uses, and not a cycle:
 * AuthModule reaches this module through the bus, never by importing it.
 *
 * `AvatarStorageService` is registered here as an ordinary provider, not
 * dispatched through the bus: disk IO on a stream is not a message/result
 * exchange, the same reasoning that has MeetingModule inject
 * `MeetingFileStorageService` directly. Nothing injects it yet — it is
 * registered now rather than alongside its first caller because its
 * constructor is what asserts the publicly served avatar directory is
 * disjoint from the private meeting-file one, and that check is only worth
 * anything if it runs on every startup.
 */
@Module({
  imports: [CqrsModule, AuthModule],
  controllers: [UsersController],
  providers: [...CommandHandlers, ...QueryHandlers, AvatarStorageService],
})
export class UsersModule {}
