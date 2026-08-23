import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { AuthUser } from '../interfaces/auth-user.interface';

/**
 * Reads the identity that `JwtAuthGuard` attached to the request. Only
 * meaningful on routes protected by that guard.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => {
    const request = context
      .switchToHttp()
      .getRequest<FastifyRequest & { user: AuthUser }>();
    return request.user;
  },
);
