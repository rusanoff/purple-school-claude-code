import { Meeting } from '@prisma/client';

/** Public shape of a meeting returned by the API. */
export interface MeetingResponse {
  id: string;
  title: string;
  date: string;
  participants: string[];
}

/** Strips persistence-only fields (ownerId, timestamps) from a Prisma row. */
export function toMeetingResponse(meeting: Meeting): MeetingResponse {
  return {
    id: meeting.id,
    title: meeting.title,
    date: meeting.date.toISOString(),
    participants: meeting.participants,
  };
}
