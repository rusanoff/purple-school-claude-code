import { existsSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AvatarStorageService } from './avatar-storage.service';

/**
 * These are real-filesystem tests against a throwaway temp directory rather
 * than mocks of `node:fs`: every behaviour this service owes its callers —
 * a partially written file being removed, exactly one file surviving a save,
 * a delete that actually frees the name — is a statement about what ends up
 * on disk, and a mocked `createWriteStream` could only ever assert that we
 * called it.
 */
let root: string;
let avatarDir: string;
let meetingFileDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'avatar-storage-'));
  // Siblings, never nested: that is the invariant the service asserts on
  // construction, so the fixture has to satisfy it for every other test.
  avatarDir = join(root, 'avatars');
  meetingFileDir = join(root, 'uploads');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function buildService(env: Record<string, string | undefined> = {}) {
  const config = {
    get: (key: string) =>
      ({
        AVATAR_STORAGE_DIR: avatarDir,
        FILE_STORAGE_DIR: meetingFileDir,
        ...env,
      })[key],
  } as ConfigService;

  return new AvatarStorageService(config);
}

/** `onModuleInit` is what creates the storage directory; no test should have
 * to remember to create it by hand. */
async function buildInitializedService(
  env: Record<string, string | undefined> = {},
) {
  const service = buildService(env);
  await service.onModuleInit();
  return service;
}

function streamOf(bytes: string): Readable {
  return Readable.from([Buffer.from(bytes)]);
}

describe('AvatarStorageService — construction', () => {
  it('refuses to start when the avatar directory is the meeting-file directory', () => {
    expect(() => buildService({ AVATAR_STORAGE_DIR: meetingFileDir })).toThrow(
      /must not be the meeting-file storage directory/,
    );
  });

  // The whole point of the separate directory: this one gets a public static
  // mount, so it must not sit anywhere that private meeting files live.
  it('refuses to start when the avatar directory is nested in the meeting-file directory', () => {
    expect(() =>
      buildService({ AVATAR_STORAGE_DIR: join(meetingFileDir, 'avatars') }),
    ).toThrow(/must not be inside the meeting-file storage directory/);
  });

  it('refuses to start when the meeting-file directory is nested in the avatar directory', () => {
    expect(() =>
      buildService({ FILE_STORAGE_DIR: join(avatarDir, 'uploads') }),
    ).toThrow(/must not be inside the publicly served avatar directory/);
  });

  // Regression: `?? DEFAULT` alone takes a blank value at face value, and
  // `resolve('')` is the process cwd — the app root, next to the source tree
  // — not the documented default directory.
  it.each(['', '   '])(
    'treats a blank AVATAR_STORAGE_DIR (%p) as unset rather than as cwd',
    (blank) => {
      const service = buildService({ AVATAR_STORAGE_DIR: blank });

      expect(service.storageDirectory).toBe(resolve('./uploads-avatars'));
      expect(service.storageDirectory).not.toBe(process.cwd());
    },
  );

  // The same blank, on the other side of the comparison: falling back to cwd
  // there would compare the avatar directory against the wrong thing and pass
  // a configuration that is in fact overlapping.
  it('treats a blank FILE_STORAGE_DIR as unset rather than as cwd', () => {
    expect(() =>
      buildService({
        AVATAR_STORAGE_DIR: resolve('./uploads'),
        FILE_STORAGE_DIR: '',
      }),
    ).toThrow(/must not be the meeting-file storage directory/);
  });

  // A lexical resolve cannot see through a symlink, and two paths to one
  // directory is precisely the arrangement this check exists to reject.
  it('refuses to start when the avatar directory is a symlink to the meeting-file one', async () => {
    await mkdir(meetingFileDir, { recursive: true });
    await symlink(meetingFileDir, avatarDir);

    expect(() => buildService()).toThrow(
      /must not be the meeting-file storage directory/,
    );
  });
});

describe('AvatarStorageService — max size resolution', () => {
  it('defaults to 2MB when AVATAR_MAX_SIZE_BYTES is unset', () => {
    expect(buildService().maxAvatarSizeBytes).toBe(2 * 1024 * 1024);
  });

  it('honors an explicit positive value', () => {
    expect(
      buildService({ AVATAR_MAX_SIZE_BYTES: '1024' }).maxAvatarSizeBytes,
    ).toBe(1024);
  });

  // Regression: "0" must be honored (reject-everything), not silently coerced
  // to the default the way a falsy-check would — same rule as
  // FILE_MAX_SIZE_BYTES.
  it('accepts an explicit "0" rather than falling back to the default', () => {
    expect(
      buildService({ AVATAR_MAX_SIZE_BYTES: '0' }).maxAvatarSizeBytes,
    ).toBe(0);
  });

  // Regression: `Number('  ')` is 0, so a whitespace-only value would pass
  // the integer guard and silently install a reject-everything limit.
  it.each(['   ', '\t'])('treats a whitespace-only %p as unset', (blank) => {
    expect(
      buildService({ AVATAR_MAX_SIZE_BYTES: blank }).maxAvatarSizeBytes,
    ).toBe(2 * 1024 * 1024);
  });

  it.each(['-1', 'not-a-number', '10.5'])(
    'throws for %p instead of silently using the default',
    (raw) => {
      expect(() => buildService({ AVATAR_MAX_SIZE_BYTES: raw })).toThrow(
        /non-negative integer/,
      );
    },
  );
});

describe('AvatarStorageService — onModuleInit', () => {
  it('creates the avatar directory so the first upload does not fail on that alone', async () => {
    expect(existsSync(avatarDir)).toBe(false);

    await buildInitializedService();

    expect(existsSync(avatarDir)).toBe(true);
  });

  it('does not create the meeting-file directory', async () => {
    await buildInitializedService();

    expect(existsSync(meetingFileDir)).toBe(false);
  });
});

describe('AvatarStorageService — saveAvatar', () => {
  it('writes the stream to disk and reports its size', async () => {
    const service = await buildInitializedService();

    const saved = await service.saveAvatar(streamOf('png-bytes'), 'image/png');

    expect(saved.size).toBe('png-bytes'.length);
    expect(saved.mimeType).toBe('image/png');
    await expect(readFile(join(avatarDir, saved.path), 'utf8')).resolves.toBe(
      'png-bytes',
    );
  });

  // Callers persist this in `User.avatarPath` and later hand it back to
  // `deleteAvatar` — a bare filename, the same convention as
  // `MeetingFile.path`, so the storage directory can move without rewriting
  // every stored row.
  it('returns a bare filename, not a path and not an absolute location', async () => {
    const service = await buildInitializedService();

    const saved = await service.saveAvatar(streamOf('x'), 'image/png');

    expect(saved.path).not.toContain('/');
    expect(saved.path).not.toContain('\\');
  });

  // The requirement this issue exists for: the file is served publicly with
  // no `Authorization` header, so the generated name is the only thing
  // between a stranger and someone else's avatar. A name built from the user
  // id or a hash of the email would be reconstructable by anyone who already
  // knows either — this one is nothing but CSPRNG bytes plus the extension.
  it('names the file from randomness alone, with at least 128 bits of it', async () => {
    const service = await buildInitializedService();

    const saved = await service.saveAvatar(streamOf('x'), 'image/png');

    // Hex, so two characters per byte: 32 characters is 16 random bytes.
    // Anything materially shorter is brute-forceable for a resource that is
    // public and unauthenticated.
    expect(saved.path).toMatch(/^[0-9a-f]{32,}\.png$/);
  });

  it('generates a different name for every save, even byte-identical ones', async () => {
    const service = await buildInitializedService();

    const first = await service.saveAvatar(streamOf('same'), 'image/png');
    const second = await service.saveAvatar(streamOf('same'), 'image/png');

    expect(first.path).not.toBe(second.path);
    await expect(readdir(avatarDir)).resolves.toHaveLength(2);
  });

  // The extension comes from the validated MIME type, never from the client's
  // filename: `@fastify/static` picks the response Content-Type off the
  // extension, so a `.svg` name on bytes we accepted as `image/png` would be
  // served back to a browser as scriptable SVG.
  it.each([
    ['image/jpeg', '.jpg'],
    ['image/png', '.png'],
    ['image/webp', '.webp'],
  ])('gives a %s upload the %s extension', async (mimeType, extension) => {
    const service = await buildInitializedService();

    const saved = await service.saveAvatar(streamOf('x'), mimeType);

    expect(saved.path.endsWith(extension)).toBe(true);
  });

  it('rejects a MIME type that is not on the avatar allowlist', async () => {
    const service = await buildInitializedService();

    await expect(
      service.saveAvatar(streamOf('<svg/>'), 'image/svg+xml'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('writes nothing to disk when the MIME type is rejected', async () => {
    const service = await buildInitializedService();

    await expect(
      service.saveAvatar(streamOf('<svg/>'), 'image/svg+xml'),
    ).rejects.toThrow();

    await expect(readdir(avatarDir)).resolves.toEqual([]);
  });

  it('drains the rejected stream so the request can finish parsing', async () => {
    const service = await buildInitializedService();
    const source = streamOf('<svg/>');
    const drained = new Promise<void>((resolve) =>
      source.on('close', () => resolve()),
    );

    await expect(service.saveAvatar(source, 'image/svg+xml')).rejects.toThrow();

    // Resolving at all is the assertion: an undrained part would leave this
    // pending until the test times out.
    await expect(drained).resolves.toBeUndefined();
  });
});

describe('AvatarStorageService — size limit', () => {
  it('accepts a file exactly at the limit', async () => {
    const service = await buildInitializedService({
      AVATAR_MAX_SIZE_BYTES: '10',
    });

    const saved = await service.saveAvatar(streamOf('0123456789'), 'image/png');

    expect(saved.size).toBe(10);
  });

  it('rejects a file one byte over the limit', async () => {
    const service = await buildInitializedService({
      AVATAR_MAX_SIZE_BYTES: '10',
    });

    await expect(
      service.saveAvatar(streamOf('01234567890'), 'image/png'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // The explicit ask in this issue: the write is already under way by the
  // time the limit is crossed, so the partial file has to be removed —
  // otherwise every oversized upload leaks disk no later request reclaims.
  it('leaves no partially written file behind when the limit is exceeded', async () => {
    const service = await buildInitializedService({
      AVATAR_MAX_SIZE_BYTES: '10',
    });

    await expect(
      service.saveAvatar(streamOf('x'.repeat(5_000)), 'image/png'),
    ).rejects.toThrow();

    await expect(readdir(avatarDir)).resolves.toEqual([]);
  });

  it('cleans up even when the overflow arrives across several chunks', async () => {
    const service = await buildInitializedService({
      AVATAR_MAX_SIZE_BYTES: '10',
    });
    const chunked = Readable.from(
      Array.from({ length: 20 }, () => Buffer.from('xxx')),
    );

    await expect(service.saveAvatar(chunked, 'image/png')).rejects.toThrow();

    await expect(readdir(avatarDir)).resolves.toEqual([]);
  });

  it('reports the configured limit in the error message', async () => {
    const service = await buildInitializedService({
      AVATAR_MAX_SIZE_BYTES: '10',
    });

    await expect(
      service.saveAvatar(streamOf('01234567890'), 'image/png'),
    ).rejects.toThrow(/10 bytes/);
  });

  // `@fastify/multipart` does not error an oversized part: busboy stops the
  // stream early and flags `truncated`, so a stream cut off at exactly the
  // limit looks like a complete, in-limit file to a byte counter alone.
  it('rejects and cleans up a stream busboy already truncated', async () => {
    const service = await buildInitializedService({
      AVATAR_MAX_SIZE_BYTES: '10',
    });
    const truncated = Object.assign(streamOf('0123456789'), {
      truncated: true,
    });

    await expect(
      service.saveAvatar(truncated, 'image/png'),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(readdir(avatarDir)).resolves.toEqual([]);
  });

  it('rejects every upload when the limit is configured to 0', async () => {
    const service = await buildInitializedService({
      AVATAR_MAX_SIZE_BYTES: '0',
    });

    await expect(
      service.saveAvatar(streamOf('x'), 'image/png'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('AvatarStorageService — deleteAvatar', () => {
  it('removes a previously saved file', async () => {
    const service = await buildInitializedService();
    const saved = await service.saveAvatar(streamOf('x'), 'image/png');

    await service.deleteAvatar(saved.path);

    await expect(readdir(avatarDir)).resolves.toEqual([]);
  });

  // Delete is what a replacement and an explicit removal both end with; a
  // file already gone (a retried request, a wiped volume) is the outcome the
  // caller wanted, not something worth failing their request over.
  it('is a no-op for a file that no longer exists', async () => {
    const service = await buildInitializedService();

    await expect(
      service.deleteAvatar('deadbeefdeadbeefdeadbeefdeadbeef.png'),
    ).resolves.toBeUndefined();
  });

  it('leaves other users avatars alone', async () => {
    const service = await buildInitializedService();
    const mine = await service.saveAvatar(streamOf('mine'), 'image/png');
    const theirs = await service.saveAvatar(streamOf('theirs'), 'image/png');

    await service.deleteAvatar(mine.path);

    await expect(readdir(avatarDir)).resolves.toEqual([theirs.path]);
  });

  // `avatarPath` is a value we generated, but a stored value is only ever as
  // trustworthy as whatever last wrote it — refuse to resolve outside the
  // avatar directory rather than let a `../` reach the meeting-file storage
  // or anything else on the box.
  // '.' is in the list for its own reason: it names the storage directory
  // itself, which `rm` would reject with a raw EISDIR instead of the
  // descriptive error the others get.
  it.each(['../secret.png', 'nested/avatar.png', '/etc/passwd', '..', '.', ''])(
    'refuses to delete through the path %p',
    async (path) => {
      const service = await buildInitializedService();
      const outside = join(root, 'secret.png');
      await writeFile(outside, 'secret');

      // Asserting the *descriptive* rejection, not merely that something
      // threw: '.' would reach `rm` and fail with a raw EISDIR without the
      // validation, which a bare `toThrow()` could not tell apart.
      await expect(service.deleteAvatar(path)).rejects.toThrow(
        /Not a valid avatar filename/,
      );

      expect(existsSync(outside)).toBe(true);
    },
  );
});
