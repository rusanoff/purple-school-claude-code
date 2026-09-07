import { randomUUID } from 'crypto';
import { existsSync, readdirSync } from 'fs';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { registerAvatarStatic } from '../src/avatar-static';
import { registerMultipart } from '../src/multipart';
import { PrismaService } from '../src/prisma/prisma.service';

const PASSWORD = 'Sup3rSecret!';

// Small on purpose, like `meeting-files.e2e-spec.ts`'s limit: the over-limit
// case then needs a 4KB buffer instead of a multi-megabyte one to trigger the
// same code path.
const MAX_AVATAR_SIZE_BYTES = 4 * 1024; // 4KB

/** The `/api` half of `avatarUrl` belongs to the frontend's rewrite, not to
 * this backend — see `avatar-static.e2e-spec.ts`, which pins that split. Here
 * it is only needed to turn a URL the API handed back into the path supertest
 * has to ask this backend for. */
const FRONTEND_REWRITE_PREFIX = '/api';

// A real 1x1 PNG: these tests assert that what a browser fetches back is byte
// for byte what was uploaded, so the bytes have to be something a browser
// would actually render.
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Every name `AvatarStorageService` generates: 16 random bytes as hex, plus
 * the extension of the MIME type it validated. Spelled out rather than
 * imported so a change to either half fails here instead of following along. */
const GENERATED_PNG_NAME = /^[0-9a-f]{32}\.png$/;

interface UserProfileBody {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

function uniqueEmail(): string {
  return `test-${randomUUID()}@example.com`;
}

/** What a client requests against this backend for a given `avatarUrl` — the
 * frontend rewrite's job, done by hand. */
function backendPathFor(avatarUrl: string): string {
  return avatarUrl.slice(FRONTEND_REWRITE_PREFIX.length);
}

/** The filename inside an `avatarUrl`, i.e. the value stored in `avatarPath`. */
function filenameFrom(avatarUrl: string): string {
  return avatarUrl.slice(avatarUrl.lastIndexOf('/') + 1);
}

describe('Avatar upload (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tempRoot: string;
  let avatarDir: string;
  let meetingFileDir: string;

  async function registerUser(): Promise<{ email: string; token: string }> {
    const email = uniqueEmail();
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: PASSWORD })
      .expect(201);

    return {
      email,
      token: (response.body as { accessToken: string }).accessToken,
    };
  }

  /** One upload attempt, left un-`expect`ed so both the accepted and the
   * rejected cases can share it. */
  function uploadAvatar(
    token: string,
    overrides: {
      bytes?: Buffer;
      filename?: string;
      contentType?: string;
    } = {},
  ) {
    return request(app.getHttpServer())
      .post('/users/me/avatar')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', overrides.bytes ?? PNG_BYTES, {
        filename: overrides.filename ?? 'selfie.png',
        contentType: overrides.contentType ?? 'image/png',
      });
  }

  /** Uploads and returns the profile the route hands back. */
  async function uploadAvatarOk(token: string): Promise<UserProfileBody> {
    const response = await uploadAvatar(token).expect(200);
    return response.body as UserProfileBody;
  }

  /**
   * Files that appeared in the avatar directory since `before` was taken.
   * One directory holds every user's avatar, and a stored file records
   * nothing about who owns it — so "exactly one file per user" is only
   * assertable as the delta around that user's own requests, which is what
   * this measures.
   */
  function filesAddedSince(before: string[]): string[] {
    return readdirSync(avatarDir).filter((name) => !before.includes(name));
  }

  function storedFileExists(avatarUrl: string): boolean {
    return existsSync(join(avatarDir, filenameFrom(avatarUrl)));
  }

  async function storedAvatarPath(email: string): Promise<string | null> {
    const user = await prisma.user.findUnique({ where: { email } });
    return user?.avatarPath ?? null;
  }

  beforeAll(async () => {
    // Two sibling directories under one temp root: the avatar one is served
    // publicly, the meeting-file one must stay unreachable, and
    // `assertAvatarStorageDirIsSeparate` refuses to start unless they are
    // disjoint. Set — together with the small size limit — before the module
    // is compiled, so `ConfigService` and both storage services pick them up.
    tempRoot = await mkdtemp(join(tmpdir(), 'avatar-upload-e2e-'));
    avatarDir = join(tempRoot, 'avatars');
    meetingFileDir = join(tempRoot, 'uploads');
    await mkdir(avatarDir);
    await mkdir(meetingFileDir);
    process.env.AVATAR_STORAGE_DIR = avatarDir;
    process.env.FILE_STORAGE_DIR = meetingFileDir;
    process.env.AVATAR_MAX_SIZE_BYTES = String(MAX_AVATAR_SIZE_BYTES);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const adapter = new FastifyAdapter();
    app = moduleFixture.createNestApplication(adapter);
    // Both plugins, both before `app.init()`: without the first `request.file()`
    // doesn't exist and every upload 500s, without the second the URL the
    // upload hands back resolves nowhere.
    await registerMultipart(app);
    await registerAvatarStatic(app);
    await app.init();
    // Fastify finishes registering routes/plugins asynchronously — supertest
    // needs the adapter's underlying instance to be ready before requests
    // against app.getHttpServer() are guaranteed to hit registered routes.
    await adapter.getInstance().ready();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
    await rm(tempRoot, { recursive: true, force: true });
    delete process.env.AVATAR_STORAGE_DIR;
    delete process.env.FILE_STORAGE_DIR;
    delete process.env.AVATAR_MAX_SIZE_BYTES;
  });

  describe('POST /users/me/avatar', () => {
    it('stores the image, points the row at it and returns the updated profile', async () => {
      const { email, token } = await registerUser();
      const before = readdirSync(avatarDir);

      const profile = await uploadAvatarOk(token);

      expect(profile.email).toBe(email);
      expect(profile.avatarUrl).not.toBeNull();
      const filename = filenameFrom(profile.avatarUrl as string);
      // Neither the name nor the extension may come from the client: the
      // upload above called the part `selfie.png` and the stored name is
      // generated from scratch.
      expect(filename).toMatch(GENERATED_PNG_NAME);
      expect(profile.avatarUrl).toBe(`/api/avatars/${filename}`);
      expect(await storedAvatarPath(email)).toBe(filename);
      // Exactly one file for this user, and it is the one just announced.
      expect(filesAddedSince(before)).toEqual([filename]);
    });

    it('hands back the same profile a following GET /users/me does', async () => {
      const { token } = await registerUser();

      const uploaded = await uploadAvatarOk(token);
      const reread = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // The response being re-fetchable is the reason the route returns a
      // profile at all instead of 204.
      expect(reread.body).toEqual(uploaded);
    });

    it('leaves the name alone', async () => {
      const { token } = await registerUser();
      await request(app.getHttpServer())
        .patch('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Ada Lovelace' })
        .expect(200);

      const profile = await uploadAvatarOk(token);

      expect(profile.name).toBe('Ada Lovelace');
    });

    it('replaces an existing avatar, leaving exactly one file for that user', async () => {
      const { email, token } = await registerUser();
      const before = readdirSync(avatarDir);

      const first = await uploadAvatarOk(token);
      const second = await uploadAvatarOk(token);

      expect(second.avatarUrl).not.toBe(first.avatarUrl);
      expect(await storedAvatarPath(email)).toBe(
        filenameFrom(second.avatarUrl as string),
      );
      // The old file is gone from disk, not merely unreferenced — and the
      // delta is a single name, so a replacement never accumulates.
      expect(storedFileExists(first.avatarUrl as string)).toBe(false);
      expect(storedFileExists(second.avatarUrl as string)).toBe(true);
      expect(filesAddedSince(before)).toEqual([
        filenameFrom(second.avatarUrl as string),
      ]);
    });

    it('stops serving a replaced avatar at its old URL', async () => {
      const { token } = await registerUser();

      const first = await uploadAvatarOk(token);
      await request(app.getHttpServer())
        .get(backendPathFor(first.avatarUrl as string))
        .expect(200);

      const second = await uploadAvatarOk(token);

      // The URL a client was already handed must stop resolving, or the
      // previous image stays publicly fetchable forever.
      await request(app.getHttpServer())
        .get(backendPathFor(first.avatarUrl as string))
        .expect(404);
      await request(app.getHttpServer())
        .get(backendPathFor(second.avatarUrl as string))
        .expect(200);
    });

    it('accepts the other allowed image types and names the file from the declared type', async () => {
      // The bytes are not sniffed — the extension comes from the MIME type
      // the allowlist accepted, which is exactly what makes the
      // `Content-Type` `@fastify/static` infers from it trustworthy.
      for (const [contentType, extension] of [
        ['image/jpeg', 'jpg'],
        ['image/webp', 'webp'],
      ]) {
        const { token } = await registerUser();

        const response = await uploadAvatar(token, { contentType }).expect(200);

        const { avatarUrl } = response.body as UserProfileBody;
        expect(filenameFrom(avatarUrl as string)).toMatch(
          new RegExp(`^[0-9a-f]{32}\\.${extension}$`),
        );
        const served = await request(app.getHttpServer())
          .get(backendPathFor(avatarUrl as string))
          .expect(200);
        expect(served.headers['content-type']).toContain(contentType);
      }
    });

    it('rejects a disallowed type without writing anything or touching the row', async () => {
      // `image/svg+xml` is the one that matters: it is an image a browser
      // renders inline and it can carry script, which is why the allowlist is
      // a fixed set rather than an `image/` prefix check.
      for (const contentType of [
        'image/svg+xml',
        'image/gif',
        'text/plain',
        'application/pdf',
        'video/mp4',
      ]) {
        const { email, token } = await registerUser();
        const before = readdirSync(avatarDir);

        await uploadAvatar(token, { contentType }).expect(400);

        expect(await storedAvatarPath(email)).toBeNull();
        expect(filesAddedSince(before)).toEqual([]);
      }
    });

    it('rejects a file over the size limit and leaves nothing on disk', async () => {
      const { email, token } = await registerUser();
      const before = readdirSync(avatarDir);

      await uploadAvatar(token, {
        bytes: Buffer.alloc(MAX_AVATAR_SIZE_BYTES + 1, 'a'),
      }).expect(400);

      expect(await storedAvatarPath(email)).toBeNull();
      // The partial write must be cleaned up: the bytes were streamed to disk
      // before the limit was crossed, and nothing would ever come back for
      // them.
      expect(filesAddedSince(before)).toEqual([]);
    });

    it('accepts a file of exactly the size limit', async () => {
      const { token } = await registerUser();

      // The limit is a maximum, not an exclusive bound — the counterpart of
      // the case above, pinned so a `>=` creeping into the byte counter (or a
      // busboy `limits.fileSize` off by one) fails here.
      const response = await uploadAvatar(token, {
        bytes: Buffer.alloc(MAX_AVATAR_SIZE_BYTES, 'a'),
      }).expect(200);

      expect((response.body as UserProfileBody).avatarUrl).not.toBeNull();
    });

    it('leaves an existing avatar intact when a later upload is rejected', async () => {
      const { email, token } = await registerUser();
      const stored = await uploadAvatarOk(token);

      await uploadAvatar(token, { contentType: 'image/svg+xml' }).expect(400);
      await uploadAvatar(token, {
        bytes: Buffer.alloc(MAX_AVATAR_SIZE_BYTES + 1, 'a'),
      }).expect(400);

      // A rejected replacement must not cost the user the avatar they had.
      expect(await storedAvatarPath(email)).toBe(
        filenameFrom(stored.avatarUrl as string),
      );
      expect(storedFileExists(stored.avatarUrl as string)).toBe(true);
      await request(app.getHttpServer())
        .get(backendPathFor(stored.avatarUrl as string))
        .expect(200);
    });

    it('rejects a request that is not multipart', async () => {
      const { email, token } = await registerUser();
      const before = readdirSync(avatarDir);

      await request(app.getHttpServer())
        .post('/users/me/avatar')
        .set('Authorization', `Bearer ${token}`)
        .send({ avatar: 'https://example.com/me.png' })
        .expect(400);

      expect(await storedAvatarPath(email)).toBeNull();
      expect(filesAddedSince(before)).toEqual([]);
    });

    it('rejects a multipart request carrying no file part', async () => {
      const { email, token } = await registerUser();
      const before = readdirSync(avatarDir);

      await request(app.getHttpServer())
        .post('/users/me/avatar')
        .set('Authorization', `Bearer ${token}`)
        .field('name', 'Ada Lovelace')
        .expect(400);

      expect(await storedAvatarPath(email)).toBeNull();
      expect(filesAddedSince(before)).toEqual([]);
    });

    it('removes the file it just wrote if persisting the path fails', async () => {
      const { email, token } = await registerUser();
      const before = readdirSync(avatarDir);

      const updateSpy = jest
        .spyOn(prisma.user, 'update')
        .mockRejectedValueOnce(new Error('simulated DB failure'));

      try {
        await uploadAvatar(token).expect(500);
      } finally {
        updateSpy.mockRestore();
      }

      // The file reached disk before the row was written, so a failed write
      // has to take it back out — nothing references it and the name is never
      // reused.
      expect(await storedAvatarPath(email)).toBeNull();
      expect(filesAddedSince(before)).toEqual([]);
    });

    it('touches only the caller, not another user with an avatar of their own', async () => {
      const other = await registerUser();
      const otherProfile = await uploadAvatarOk(other.token);
      const { email, token } = await registerUser();

      const mine = await uploadAvatarOk(token);

      expect(mine.avatarUrl).not.toBe(otherProfile.avatarUrl);
      expect(await storedAvatarPath(email)).toBe(
        filenameFrom(mine.avatarUrl as string),
      );
      expect(await storedAvatarPath(other.email)).toBe(
        filenameFrom(otherProfile.avatarUrl as string),
      );
      expect(storedFileExists(otherProfile.avatarUrl as string)).toBe(true);
    });

    it('rejects an unauthenticated upload without writing anything', async () => {
      const before = readdirSync(avatarDir);

      await request(app.getHttpServer())
        .post('/users/me/avatar')
        .attach('file', PNG_BYTES, {
          filename: 'selfie.png',
          contentType: 'image/png',
        })
        .expect(401);

      // The guard runs before the body is read, so nothing should have been
      // streamed anywhere.
      expect(filesAddedSince(before)).toEqual([]);
    });
  });

  describe('DELETE /users/me/avatar', () => {
    it('clears the row, removes the file and returns the profile without an avatar', async () => {
      const { email, token } = await registerUser();
      const before = readdirSync(avatarDir);
      const stored = await uploadAvatarOk(token);

      const response = await request(app.getHttpServer())
        .delete('/users/me/avatar')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect((response.body as UserProfileBody).avatarUrl).toBeNull();
      expect(await storedAvatarPath(email)).toBeNull();
      expect(storedFileExists(stored.avatarUrl as string)).toBe(false);
      // Not one file for this user any more — none.
      expect(filesAddedSince(before)).toEqual([]);
    });

    it('stops serving the avatar at its URL', async () => {
      const { token } = await registerUser();
      const stored = await uploadAvatarOk(token);

      await request(app.getHttpServer())
        .delete('/users/me/avatar')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      await request(app.getHttpServer())
        .get(backendPathFor(stored.avatarUrl as string))
        .expect(404);
    });

    it('succeeds for a user who has no avatar', async () => {
      const { email, token } = await registerUser();

      const response = await request(app.getHttpServer())
        .delete('/users/me/avatar')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Clearing what isn't there is the state the caller asked for, so it is
      // a success with nothing to remove — not a 404.
      expect((response.body as UserProfileBody).avatarUrl).toBeNull();
      expect(await storedAvatarPath(email)).toBeNull();
    });

    it('is idempotent', async () => {
      const { token } = await registerUser();
      await uploadAvatarOk(token);

      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await request(app.getHttpServer())
          .delete('/users/me/avatar')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);
        expect((response.body as UserProfileBody).avatarUrl).toBeNull();
      }
    });

    it('leaves the name alone', async () => {
      const { token } = await registerUser();
      await request(app.getHttpServer())
        .patch('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Ada Lovelace' })
        .expect(200);
      await uploadAvatarOk(token);

      const response = await request(app.getHttpServer())
        .delete('/users/me/avatar')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect((response.body as UserProfileBody).name).toBe('Ada Lovelace');
    });

    it('rejects an unauthenticated request and leaves the avatar in place', async () => {
      const { email, token } = await registerUser();
      const stored = await uploadAvatarOk(token);

      await request(app.getHttpServer()).delete('/users/me/avatar').expect(401);

      expect(await storedAvatarPath(email)).toBe(
        filenameFrom(stored.avatarUrl as string),
      );
      expect(storedFileExists(stored.avatarUrl as string)).toBe(true);
    });

    it("does not touch another user's avatar", async () => {
      const other = await registerUser();
      const otherProfile = await uploadAvatarOk(other.token);
      const { token } = await registerUser();
      await uploadAvatarOk(token);

      await request(app.getHttpServer())
        .delete('/users/me/avatar')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(await storedAvatarPath(other.email)).toBe(
        filenameFrom(otherProfile.avatarUrl as string),
      );
      await request(app.getHttpServer())
        .get(backendPathFor(otherProfile.avatarUrl as string))
        .expect(200);
    });
  });

  describe('what the upload publishes, and what it does not', () => {
    it('serves an uploaded avatar with no Authorization header, byte for byte', async () => {
      const { token } = await registerUser();

      const profile = await uploadAvatarOk(token);

      // The whole point of the feature: an `<img src>` carries no token.
      const response = await request(app.getHttpServer())
        .get(backendPathFor(profile.avatarUrl as string))
        .expect(200);
      expect(response.headers['content-type']).toContain('image/png');
      expect(Buffer.from(response.body as Buffer).equals(PNG_BYTES)).toBe(true);
    });

    it('still requires a token for a meeting file download', async () => {
      const { token } = await registerUser();
      await uploadAvatarOk(token);

      // Uploading an avatar publishes exactly one file. Meeting files live in
      // a sibling directory that no mount points at, and their route is still
      // access-checked per request.
      await request(app.getHttpServer())
        .get(`/meetings/${randomUUID()}/files/${randomUUID()}`)
        .expect(401);
    });

    it('still requires a token for the profile the avatar belongs to', async () => {
      const { token } = await registerUser();
      await uploadAvatarOk(token);

      await request(app.getHttpServer()).get('/users/me').expect(401);
    });

    it('does not publish the meeting-file directory alongside the avatar one', async () => {
      const { token } = await registerUser();
      await uploadAvatarOk(token);
      // A real file in the sibling directory, so a 404 below means "not
      // served" rather than "not there".
      await writeFile(join(meetingFileDir, 'private-recording.mp4'), 'secret');

      // The upload created the first real file under the avatar mount; the
      // sibling directory holding private meeting files must stay unreachable
      // through it.
      // A raw `/avatars/../uploads/...` is deliberately not in this list:
      // superagent normalizes it to `/uploads/...` before sending, so it would
      // never reach the mount as a traversal and would only duplicate the
      // first entry. The percent-encoded spelling does arrive intact.
      for (const path of [
        '/uploads/private-recording.mp4',
        '/avatars/..%2Fuploads%2Fprivate-recording.mp4',
      ]) {
        await request(app.getHttpServer()).get(path).expect(404);
      }
    });
  });
});
