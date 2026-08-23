import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { CreateMeetingCommand } from './commands/create-meeting.command';
import { CreateMeetingDto } from './dto/create-meeting.dto';
import { MeetingResponse } from './interfaces/meeting.interface';
import { GetMeetingQuery } from './queries/get-meeting.query';
import { GetMeetingsQuery } from './queries/get-meetings.query';

@Controller('meetings')
@UseGuards(JwtAuthGuard)
export class MeetingController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() { title, date, participants }: CreateMeetingDto,
  ): Promise<MeetingResponse> {
    return this.commandBus.execute(
      new CreateMeetingCommand(user.userId, title, date, participants),
    );
  }

  @Get()
  findAll(@CurrentUser() user: AuthUser): Promise<MeetingResponse[]> {
    return this.queryBus.execute(new GetMeetingsQuery(user.userId));
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<MeetingResponse> {
    return this.queryBus.execute(
      new GetMeetingQuery(user.userId, user.email, id),
    );
  }
}
