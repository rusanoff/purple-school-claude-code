import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const PASSWORD = 'Sup3rSecret!';
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

interface AuthResponseBody {
  accessToken: string;
}

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

describe('Users (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  async function registerUser(): Promise<{ email: string; token: string }> {
    const email = uniqueEmail();
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: PASSWORD })
      .expect(201);

    return { email, token: (response.body as AuthResponseBody).accessToken };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const adapter = new FastifyAdapter();
    app = moduleFixture.createNestApplication(adapter);
    await app.init();
    // Fastify finishes registering routes/plugins asynchronously — supertest
    // needs the adapter's underlying instance to be ready before requests
    // against app.getHttpServer() are guaranteed to hit registered routes.
    await adapter.getInstance().ready();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('User profile columns', () => {
    it('leaves name and avatarPath null for a freshly registered user', async () => {
      const { email } = await registerUser();

      const user = await prisma.user.findUnique({ where: { email } });

      expect(user).not.toBeNull();
      expect(user?.name).toBeNull();
      expect(user?.avatarPath).toBeNull();
    });

    it('stores a name and an avatar path when they are set', async () => {
      const { email } = await registerUser();

      const updated = await prisma.user.update({
        where: { email },
        data: { name: 'Ada Lovelace', avatarPath: `${randomUUID()}.png` },
      });

      expect(updated.name).toBe('Ada Lovelace');
      expect(updated.avatarPath).toMatch(/\.png$/);
    });

    it('clears the profile fields back to null', async () => {
      const { email } = await registerUser();
      await prisma.user.update({
        where: { email },
        data: { name: 'Ada Lovelace', avatarPath: 'avatar.png' },
      });

      const cleared = await prisma.user.update({
        where: { email },
        data: { name: null, avatarPath: null },
      });

      expect(cleared.name).toBeNull();
      expect(cleared.avatarPath).toBeNull();
    });
  });

  describe('GET /users/me', () => {
    it("returns the signed-in user's profile", async () => {
      const { email, token } = await registerUser();
      const stored = await prisma.user.findUnique({ where: { email } });

      const response = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = response.body as UserProfileBody;
      // Asserting the exact key set, not just the values: the password hash
      // and the persistence-only updatedAt must not leak into the response.
      expect(Object.keys(body).sort()).toEqual([
        'avatarUrl',
        'createdAt',
        'email',
        'id',
        'name',
      ]);
      expect(body.id).toBe(stored?.id);
      expect(body.email).toBe(email);
      expect(body.createdAt).toMatch(ISO_TIMESTAMP);
    });

    it('returns null name and avatarUrl for a user who never filled them in', async () => {
      const { token } = await registerUser();

      const response = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = response.body as UserProfileBody;
      expect(body.name).toBeNull();
      expect(body.avatarUrl).toBeNull();
    });

    it('returns the name and an avatar URL once the profile columns are set', async () => {
      const { email, token } = await registerUser();
      const avatarPath = `${randomUUID()}.png`;
      await prisma.user.update({
        where: { email },
        data: { name: 'Ada Lovelace', avatarPath },
      });

      const response = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = response.body as UserProfileBody;
      expect(body.name).toBe('Ada Lovelace');
      // The stored value is an on-disk filename; the API contract is a URL
      // under the frontend's rewrite prefix. Spelled out literally rather
      // than rebuilt from AVATAR_URL_PREFIX, so a change to the constant
      // shows up here as a failing test instead of silently following along.
      expect(body.avatarUrl).toBe(`/api/avatars/${avatarPath}`);
    });

    it("scopes the profile to the caller's own token", async () => {
      const first = await registerUser();
      const second = await registerUser();

      const [firstResponse, secondResponse] = await Promise.all([
        request(app.getHttpServer())
          .get('/users/me')
          .set('Authorization', `Bearer ${first.token}`)
          .expect(200),
        request(app.getHttpServer())
          .get('/users/me')
          .set('Authorization', `Bearer ${second.token}`)
          .expect(200),
      ]);

      expect((firstResponse.body as UserProfileBody).email).toBe(first.email);
      expect((secondResponse.body as UserProfileBody).email).toBe(second.email);
    });

    it('404s when the user row was deleted after the token was issued', async () => {
      const { email, token } = await registerUser();
      await prisma.user.delete({ where: { email } });

      // Authentication still succeeds — the JWT is valid and self-contained —
      // so the missing row is a missing resource, not a failed login.
      const response = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      // The handler's own 404, not Fastify's route-not-found 404 — without
      // this the test would still pass if the route disappeared entirely.
      expect((response.body as { message: string }).message).toBe(
        'User not found',
      );
    });

    it('rejects a request without an Authorization header', async () => {
      await request(app.getHttpServer()).get('/users/me').expect(401);
    });

    it('rejects an Authorization header without the Bearer scheme', async () => {
      const { token } = await registerUser();

      await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', token)
        .expect(401);
    });

    it('rejects a malformed bearer token', async () => {
      await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', 'Bearer not-a-real-jwt')
        .expect(401);
    });

    it('rejects a well-formed token signed with a different secret', async () => {
      // Structurally valid JWT, wrong signature — the guard must reject it
      // rather than trusting the `sub` claim it carries.
      const forged = await new JwtService({
        secret: 'definitely-not-the-app-secret',
      }).signAsync({ sub: randomUUID(), email: uniqueEmail() });

      await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${forged}`)
        .expect(401);
    });
  });
});
