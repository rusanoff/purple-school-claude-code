import { AssertMeetingAccessHandler } from './assert-meeting-access.handler';
import { GetMeetingHandler } from './get-meeting.handler';
import { GetMeetingsHandler } from './get-meetings.handler';

export const QueryHandlers = [
  GetMeetingsHandler,
  GetMeetingHandler,
  AssertMeetingAccessHandler,
];
