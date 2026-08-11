import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { AuthUser } from '../interfaces/auth-user.interface';

/**
 * Reads the identity that `JwtAuthGuard` attached to the request. Only
 * meaningful on routes protected by that guard.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser => {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user: AuthUser }>();
    return request.user;
  },
);
