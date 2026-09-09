import {
  meetingFileRow,
  meetingFileRowWithUploader,
} from '../testing/meeting-file-row.fixture';
import {
  toMeetingFileRecord,
  toMeetingFileResponse,
} from './meeting-file.interface';

describe('toMeetingFileResponse', () => {
  it('maps the row and embeds the uploader as a display summary', () => {
    const response = toMeetingFileResponse(
      meetingFileRowWithUploader(
        {},
        { name: 'Ada Lovelace', avatarPath: 'avatar-file.png' },
      ),
    );

    expect(response).toEqual({
      id: 'c8d3e2fa-0000-4000-8000-000000000020',
      meetingId: 'b7c2d1ef-0000-4000-8000-000000000010',
      uploadedById: 'a3f1c0de-0000-4000-8000-000000000001',
      filename: 'recording.mp4',
      mimeType: 'video/mp4',
      size: 2048,
      createdAt: '2026-09-05T10:20:30.000Z',
      uploadedBy: {
        email: 'ada@example.com',
        name: 'Ada Lovelace',
        avatarUrl: '/api/avatars/avatar-file.png',
      },
    });
  });

  // The whole point of the nested summary for the frontend: a user who never
  // filled in a name still has an email to fall back to, so the file list
  // never has to invent "Meeting participant".
  it('still carries the uploader email when they have no name or avatar', () => {
    const response = toMeetingFileResponse(meetingFileRowWithUploader());

    expect(response.uploadedBy).toEqual({
      email: 'ada@example.com',
      name: null,
      avatarUrl: null,
    });
  });

  it('keeps uploadedById alongside the summary, and never leaks the on-disk path', () => {
    const response = toMeetingFileResponse(meetingFileRowWithUploader());

    // `uploadedById` is the identity field the frontend compares against the
    // signed-in user to decide who may delete a file; `uploadedBy` is purely
    // for display. Dropping either would break one of the two.
    expect(response.uploadedById).toBe('a3f1c0de-0000-4000-8000-000000000001');
    expect(response).not.toHaveProperty('path');
  });
});

describe('toMeetingFileRecord', () => {
  it('carries the on-disk path and needs no uploader join', () => {
    const record = toMeetingFileRecord(meetingFileRow());

    expect(record.path).toBe('generated-on-disk-name.mp4');
    // The download/delete paths only ever address the file on disk, so the
    // record shape deliberately does *not* extend the response shape any
    // more — otherwise every download would pay for a join it never reads.
    expect(record).not.toHaveProperty('uploadedBy');
  });
});
