import { TEST_OWNER_ID, meetingRow } from '../testing/meeting-row.fixture';
import { toMeetingResponse } from './meeting.interface';

const ADA = {
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  avatarUrl: '/api/avatars/avatar-file.png',
};

describe('toMeetingResponse', () => {
  it('maps the row and expands every participant into a display summary', () => {
    const response = toMeetingResponse(
      meetingRow(),
      TEST_OWNER_ID,
      new Map([['ada@example.com', ADA]]),
    );

    expect(response).toEqual({
      id: 'b7c2d1ef-0000-4000-8000-000000000010',
      title: 'Sprint planning',
      date: '2026-09-01T10:00:00.000Z',
      participants: [
        ADA,
        { email: 'grace@example.com', name: null, avatarUrl: null },
      ],
      isOwner: true,
    });
  });

  // Order is the meeting's own participant list, not whatever order the
  // directory query happened to return users in.
  it('keeps the meeting participant order', () => {
    const response = toMeetingResponse(
      meetingRow({ participants: ['grace@example.com', 'ada@example.com'] }),
      TEST_OWNER_ID,
      new Map([['ada@example.com', ADA]]),
    );

    expect(response.participants.map(({ email }) => email)).toEqual([
      'grace@example.com',
      'ada@example.com',
    ]);
  });

  it('reports isOwner false for a caller who is only a participant', () => {
    const response = toMeetingResponse(meetingRow(), 'someone-else', new Map());

    expect(response.isOwner).toBe(false);
  });
});
