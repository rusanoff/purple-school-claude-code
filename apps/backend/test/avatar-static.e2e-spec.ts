import { randomUUID } from 'crypto';
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
import { PrismaService } from '../src/prisma/prisma.service';
import { AVATAR_URL_PREFIX } from '../src/users/interfaces/user-profile.interface';

const PASSWORD = 'Sup3rSecret!';

/** The `/api` half of `avatarUrl` belongs to the frontend's rewrite, not to
 * this backend — a browser asks its own origin for `/api/avatars/x.png` and
 * Next proxies it here with that prefix stripped. supertest talks to the
 * backend directly, so every request below has to strip it the same way; if
 * this constant ever stopped matching `AVATAR_URL_PREFIX`'s first segment the
 * two halves would have drifted apart, which is what these tests pin down. */
const FRONTEND_REWRITE_PREFIX = '/api';

/** What a client actually requests against this backend for a given
 * `avatarUrl` — the frontend rewrite's job, done by hand. */
function backendPathFor(avatarUrl: string): string {
  return avatarUrl.slice(FRONTEND_REWRITE_PREFIX.length);
}

// A real 1x1 PNG rather than arbitrary bytes: the point of these tests is
// that a browser can render what comes back, and the response's
// `content-type` is derived from the extension the storage service chose.
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function uniqueEmail(): string {
  return `test-${randomUUID()}@example.com`;
}

describe('Avatar static serving (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tempRoot: string;
  let avatarDir: string;
  let meetingFileDir: string;

  /** Writes a file straight into the avatar directory, standing in for an
   * upload — the upload route doesn't exist yet, and what is being tested
   * here is the mount, not how the bytes got there. */
  async function storeAvatarFile(
    filename: string,
    bytes: Buffer = PNG_BYTES,
  ): Promise<void> {
    await writeFile(join(avatarDir, filename), bytes);
  }

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

  beforeAll(async () => {
    // Two sibling directories under one temp root, matching the layout the
    // app requires: the avatar directory is served publicly, the
    // meeting-file one must stay unreachable through that mount, and
    // `assertAvatarStorageDirIsSeparate` refuses to start if they overlap.
    tempRoot = await mkdtemp(join(tmpdir(), 'avatar-static-e2e-'));
    avatarDir = join(tempRoot, 'avatars');
    meetingFileDir = join(tempRoot, 'uploads');
    await mkdir(avatarDir);
    await mkdir(meetingFileDir);
    // Set before the module is compiled so ConfigService — and through it
    // both storage services' constructors — pick them up.
    process.env.AVATAR_STORAGE_DIR = avatarDir;
    process.env.FILE_STORAGE_DIR = meetingFileDir;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const adapter = new FastifyAdapter();
    app = moduleFixture.createNestApplication(adapter);
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
  });

  describe('GET /avatars/:filename', () => {
    it('serves a stored avatar without an Authorization header', async () => {
      const filename = `${randomUUID().replace(/-/g, '')}.png`;
      await storeAvatarFile(filename);

      const response = await request(app.getHttpServer())
        .get(`/avatars/${filename}`)
        .expect(200);

      expect(response.headers['content-type']).toContain('image/png');
      expect(Buffer.from(response.body as Buffer).equals(PNG_BYTES)).toBe(true);
    });

    it('serves the exact path GET /users/me hands back, once the frontend rewrite prefix is stripped', async () => {
      const { email, token } = await registerUser();
      const filename = `${randomUUID().replace(/-/g, '')}.png`;
      await storeAvatarFile(filename);
      await prisma.user.update({
        where: { email },
        data: { avatarPath: filename },
      });

      const profile = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const { avatarUrl } = profile.body as { avatarUrl: string };
      expect(avatarUrl).toBe(`${AVATAR_URL_PREFIX}/${filename}`);
      // The backend serves the path without `/api`: the profile response
      // adds that prefix for the frontend proxy, and nobody adds it twice.
      await request(app.getHttpServer())
        .get(backendPathFor(avatarUrl))
        .expect(200);
      await request(app.getHttpServer()).get(avatarUrl).expect(404);
    });

    it('404s for a filename that is not stored', async () => {
      await request(app.getHttpServer())
        .get(`/avatars/${randomUUID().replace(/-/g, '')}.png`)
        .expect(404);
    });

    it('does not serve a dotfile', async () => {
      // Nothing this app writes starts with a dot — the guard is against a
      // stray `.env`/editor backup landing in the directory and becoming
      // world-readable through the mount. 404 rather than 403, so it reads
      // like any other name that was never stored.
      await storeAvatarFile('.env.backup', Buffer.from('DATABASE_URL=secret'));

      await request(app.getHttpServer())
        .get('/avatars/.env.backup')
        .expect(404);
    });

    it('does not list the avatar directory', async () => {
      const filename = `${randomUUID().replace(/-/g, '')}.png`;
      await storeAvatarFile(filename);

      // A generated filename is 128 unguessable bits, and that unguessability
      // is the entire access control on a publicly served file — a directory
      // listing would hand every one of them out. Asserted on the response
      // body rather than on a status code, because "no listing" is the
      // requirement and the plugin is free to spell the refusal 403 or 404.
      for (const path of ['/avatars/', '/avatars']) {
        const response = await request(app.getHttpServer()).get(path);
        // 404, not 403: `@fastify/send` answers a directory request with a
        // Forbidden that the plugin hands to Nest's exception layer, logging
        // a stack trace at ERROR for a request anyone can repeat — the mount
        // turns that into a plain not-found instead.
        expect(response.status).toBe(404);
        expect(response.text ?? '').not.toContain(filename);
      }
    });

    it('does not reach outside the avatar directory', async () => {
      await writeFile(join(meetingFileDir, 'private-recording.mp4'), 'secret');

      for (const path of [
        '/avatars/../uploads/private-recording.mp4',
        '/avatars/..%2Fuploads%2Fprivate-recording.mp4',
        '/avatars/%2e%2e/uploads/private-recording.mp4',
      ]) {
        const response = await request(app.getHttpServer()).get(path);
        expect(response.status).not.toBe(200);
      }
    });
  });

  describe('the mount does not loosen anything else', () => {
    it('still requires a token for a meeting file download', async () => {
      await request(app.getHttpServer())
        .get(`/meetings/${randomUUID()}/files/${randomUUID()}`)
        .expect(401);
    });

    it('still requires a token for the profile the avatar belongs to', async () => {
      await request(app.getHttpServer()).get('/users/me').expect(401);
    });
  });
});
