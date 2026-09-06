import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { AuthModule } from '../auth/auth.module';
import { CommandHandlers } from './commands';
import { QueryHandlers } from './queries';
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
 */
@Module({
  imports: [CqrsModule, AuthModule],
  controllers: [UsersController],
  providers: [...CommandHandlers, ...QueryHandlers],
})
export class UsersModule {}
