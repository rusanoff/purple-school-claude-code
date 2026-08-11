import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CqrsModule } from '@nestjs/cqrs';
import { JwtModule, JwtModuleOptions, JwtSignOptions } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { CommandHandlers } from './commands';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { TokenService } from './services/token.service';

@Module({
  imports: [
    CqrsModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService): JwtModuleOptions => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: (config.get<string>('JWT_EXPIRES_IN') ??
            '1d') as JwtSignOptions['expiresIn'],
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [TokenService, JwtAuthGuard, ...CommandHandlers],
  // Exported so other feature modules (e.g. MeetingModule) can protect their
  // routes with the same guard/secret without re-wiring JWT config.
  exports: [JwtModule, JwtAuthGuard],
})
export class AuthModule {}
