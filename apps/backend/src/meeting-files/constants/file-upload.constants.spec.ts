import { isAllowedMimeType } from './file-upload.constants';

describe('isAllowedMimeType', () => {
  it('allows an audio/video MIME type', () => {
    expect(isAllowedMimeType('video/mp4')).toBe(true);
    expect(isAllowedMimeType('audio/mpeg')).toBe(true);
  });

  it('allows a document MIME type from the allowlist', () => {
    expect(isAllowedMimeType('application/pdf')).toBe(true);
  });

  it('rejects a MIME type not on the allowlist', () => {
    expect(isAllowedMimeType('application/x-sh')).toBe(false);
  });

  // Regression: MIME tokens are case-insensitive (RFC 2045/6838) — a
  // differently-cased Content-Type must still match.
  it('matches MIME types case-insensitively', () => {
    expect(isAllowedMimeType('Video/MP4')).toBe(true);
    expect(isAllowedMimeType('APPLICATION/PDF')).toBe(true);
    expect(isAllowedMimeType('Audio/Mpeg')).toBe(true);
  });
});
