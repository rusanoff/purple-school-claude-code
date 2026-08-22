import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { CommandHandlers } from './commands';
import { QueryHandlers } from './queries';

/**
 * Owns user persistence: creating and looking up users. Has no controller and
 * exports no providers — other feature modules (e.g. AuthModule) interact
 * with it only through CommandBus/QueryBus, per the app's CQRS convention
 * (see root/backend CLAUDE.md). `CqrsModule` is a shared singleton across the
 * app (Nest dedupes the module by class reference), so handlers registered
 * here are reachable from any other module's CommandBus/QueryBus as long as
 * this module is part of the app graph (registered in AppModule).
 */
@Module({
  imports: [CqrsModule],
  providers: [...CommandHandlers, ...QueryHandlers],
})
export class UsersModule {}
