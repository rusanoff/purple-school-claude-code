import { ConflictException } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { UserRecord } from '../interfaces/user-record.interface';
import { CreateUserCommand } from './create-user.command';

const SALT_ROUNDS = 10;

@CommandHandler(CreateUserCommand)
export class CreateUserHandler implements ICommandHandler<CreateUserCommand> {
  constructor(private readonly prisma: PrismaService) {}

  async execute({ email, password }: CreateUserCommand): Promise<UserRecord> {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('Email is already registered');
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await this.prisma.user.create({
      data: { email, passwordHash },
    });

    return {
      id: user.id,
      email: user.email,
      passwordHash: user.passwordHash,
    };
  }
}
