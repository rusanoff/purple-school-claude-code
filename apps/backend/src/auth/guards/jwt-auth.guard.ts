import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { AuthUser } from '../interfaces/auth-user.interface';

interface JwtPayload {
  sub: string;
  email: string;
}

/**
 * Guards routes behind a `Bearer <jwt>` header. Verifies the token with the
 * same `JwtService`/secret used to sign it (see `TokenService`) and attaches
 * the resolved identity to `request.user` for `@CurrentUser` to read.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(
        header.slice('Bearer '.length),
      );
      const user: AuthUser = { userId: payload.sub, email: payload.email };
      (request as Request & { user: AuthUser }).user = user;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
