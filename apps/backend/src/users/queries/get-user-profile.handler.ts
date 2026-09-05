import { NotFoundException } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { PrismaService } from '../../prisma/prisma.service';
import {
  UserProfileResponse,
  toUserProfileResponse,
} from '../interfaces/user-profile.interface';
import { GetUserProfileQuery } from './get-user-profile.query';

@QueryHandler(GetUserProfileQuery)
export class GetUserProfileHandler implements IQueryHandler<GetUserProfileQuery> {
  constructor(private readonly prisma: PrismaService) {}

  async execute({ userId }: GetUserProfileQuery): Promise<UserProfileResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      // The token verified, so the caller was authenticated — their row just
      // no longer exists (deleted after the token was issued). That is a
      // missing resource, not a failed authentication: 404, not 401.
      throw new NotFoundException('User not found');
    }

    return toUserProfileResponse(user);
  }
}
