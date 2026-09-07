import { resolve, sep } from 'node:path';
import {
  assertAvatarStorageDirIsSeparate,
  DEFAULT_AVATAR_MAX_SIZE_BYTES,
  DEFAULT_AVATAR_STORAGE_DIR,
  isAllowedAvatarMimeType,
} from './avatar-upload.constants';

describe('isAllowedAvatarMimeType', () => {
  it('allows every image type on the avatar allowlist', () => {
    expect(isAllowedAvatarMimeType('image/jpeg')).toBe(true);
    expect(isAllowedAvatarMimeType('image/png')).toBe(true);
    expect(isAllowedAvatarMimeType('image/webp')).toBe(true);
  });

  it('matches MIME types case-insensitively', () => {
    expect(isAllowedAvatarMimeType('Image/JPEG')).toBe(true);
    expect(isAllowedAvatarMimeType('IMAGE/PNG')).toBe(true);
  });

  // The allowlist is a fixed set of types, not an `image/` prefix check: an
  // avatar is served publicly and inline, so `image/svg+xml` (scriptable) and
  // formats no browser is guaranteed to render must not slip through.
  it('rejects image types that are not on the allowlist', () => {
    expect(isAllowedAvatarMimeType('image/svg+xml')).toBe(false);
    expect(isAllowedAvatarMimeType('image/gif')).toBe(false);
    expect(isAllowedAvatarMimeType('image/bmp')).toBe(false);
  });

  // Regression against reusing `isAllowedMimeType` from meeting files: that
  // allowlist accepts audio/video/documents and no images at all, which is
  // exactly the wrong set for an avatar.
  it('rejects the meeting-file types entirely', () => {
    expect(isAllowedAvatarMimeType('video/mp4')).toBe(false);
    expect(isAllowedAvatarMimeType('audio/mpeg')).toBe(false);
    expect(isAllowedAvatarMimeType('application/pdf')).toBe(false);
    expect(isAllowedAvatarMimeType('text/plain')).toBe(false);
  });

  it('rejects a blank or malformed MIME type', () => {
    expect(isAllowedAvatarMimeType('')).toBe(false);
    expect(isAllowedAvatarMimeType('image')).toBe(false);
    expect(isAllowedAvatarMimeType('image/png; charset=utf-8')).toBe(false);
  });
});

describe('DEFAULT_AVATAR_MAX_SIZE_BYTES', () => {
  it('is 2MB', () => {
    expect(DEFAULT_AVATAR_MAX_SIZE_BYTES).toBe(2 * 1024 * 1024);
  });

  // The point of a separate constant is that an avatar limit is much smaller
  // than the meeting-file one (50MB, spelled out here rather than imported:
  // the assertion should fail if either default moves, not silently follow).
  it('is far smaller than the meeting-file size limit', () => {
    expect(DEFAULT_AVATAR_MAX_SIZE_BYTES).toBeLessThan(50 * 1024 * 1024);
  });
});

describe('DEFAULT_AVATAR_STORAGE_DIR', () => {
  // Hard requirement from the PRD: avatars are served publicly by
  // `@fastify/static`, meeting files are access-checked per request. If the
  // avatar directory were FILE_STORAGE_DIR — or lived inside it — that static
  // mount would expose every private meeting file.
  it('is neither the meeting-file storage directory nor nested inside it', () => {
    const avatarDir = resolve(DEFAULT_AVATAR_STORAGE_DIR);
    // './uploads' is FILE_STORAGE_DIR's default, spelled out for the same
    // reason as the size limit above.
    const meetingFileDir = resolve('./uploads');

    expect(avatarDir).not.toBe(meetingFileDir);
    expect(avatarDir.startsWith(`${meetingFileDir}${sep}`)).toBe(false);
    expect(meetingFileDir.startsWith(`${avatarDir}${sep}`)).toBe(false);
  });
});

describe('assertAvatarStorageDirIsSeparate', () => {
  it('accepts two sibling directories', () => {
    expect(() =>
      assertAvatarStorageDirIsSeparate('/srv/uploads-avatars', '/srv/uploads'),
    ).not.toThrow();
  });

  it('accepts the shipped defaults', () => {
    expect(() =>
      assertAvatarStorageDirIsSeparate(DEFAULT_AVATAR_STORAGE_DIR, './uploads'),
    ).not.toThrow();
  });

  // The failure this exists to prevent: the public @fastify/static mount
  // ending up on a directory that holds private meeting files.
  it('rejects the same directory', () => {
    expect(() =>
      assertAvatarStorageDirIsSeparate('/srv/uploads', '/srv/uploads'),
    ).toThrow(/AVATAR_STORAGE_DIR/);
  });

  it('rejects an avatar directory nested inside the meeting-file one', () => {
    expect(() =>
      assertAvatarStorageDirIsSeparate('/srv/uploads/avatars', '/srv/uploads'),
    ).toThrow(/AVATAR_STORAGE_DIR/);
  });

  // The other nesting direction is just as fatal: a static mount on the
  // parent serves everything under it, meeting files included.
  it('rejects a meeting-file directory nested inside the avatar one', () => {
    expect(() =>
      assertAvatarStorageDirIsSeparate('/srv/data', '/srv/data/uploads'),
    ).toThrow(/FILE_STORAGE_DIR/);
  });

  // Both values arrive straight from env, so they may be relative, may carry
  // a trailing separator, and may reach the same place by different spellings
  // — comparing raw strings would let all of those through.
  it('resolves both paths before comparing them', () => {
    expect(() =>
      assertAvatarStorageDirIsSeparate('./uploads/', './uploads'),
    ).toThrow(/AVATAR_STORAGE_DIR/);
    expect(() =>
      assertAvatarStorageDirIsSeparate('./uploads/avatars/..', './uploads'),
    ).toThrow(/AVATAR_STORAGE_DIR/);
  });

  // A shared *prefix* is not nesting: `/srv/uploads-avatars` starts with
  // `/srv/uploads` as a string but is a sibling directory.
  it('does not mistake a shared name prefix for nesting', () => {
    expect(() =>
      assertAvatarStorageDirIsSeparate('/srv/uploads-avatars', '/srv/uploads'),
    ).not.toThrow();
    expect(() =>
      assertAvatarStorageDirIsSeparate('/srv/uploads', '/srv/uploads-avatars'),
    ).not.toThrow();
  });
});
