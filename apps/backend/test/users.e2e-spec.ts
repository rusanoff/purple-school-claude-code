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

/**
 * `ValidationPipe` reports every failed constraint as a string in `message`,
 * which is an array when validation fails and a plain string for the
 * hand-thrown exceptions elsewhere in this suite. Narrowed here so the
 * assertions can read the strings without repeating the cast.
 */
function validationMessages(body: unknown): string[] {
  const { message } = body as { message: string[] | string };
  return Array.isArray(message) ? message : [message];
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
      const avatarPath = `${randomUUID()}.png`;

      const updated = await prisma.user.update({
        where: { email },
        data: { name: 'Ada Lovelace', avatarPath },
      });

      expect(updated.name).toBe('Ada Lovelace');
      expect(updated.avatarPath).toBe(avatarPath);
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
      // Pinned to the row's own value rather than only shape-checked by the
      // regex above. It does not prove createdAt isn't updatedAt in disguise:
      // this user has just been registered, so Prisma wrote @default(now())
      // and @updatedAt in the same statement and the two are equal. The
      // avatar test below, which reads the timestamp before writing to the
      // row, is what catches that swap.
      expect(body.createdAt).toBe(stored?.createdAt.toISOString());
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
      const beforeUpdate = await prisma.user.findUnique({ where: { email } });
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
      // This is the one place the createdAt/updatedAt swap is actually
      // catchable: the row was written to after registration, so its two
      // timestamps have diverged — and the value compared against was read
      // *before* that write, so serving updatedAt (or letting createdAt move
      // on update) fails here instead of matching a moved target.
      expect(body.createdAt).toBe(beforeUpdate?.createdAt.toISOString());
    });

    it("scopes the profile to the caller's own token", async () => {
      const first = await registerUser();
      const second = await registerUser();

      // Sequential on purpose: supertest gives the first Test built off an
      // unlistening app ownership of the ephemeral server and closes it when
      // that request's own response lands, so running the two in parallel can
      // pull the socket out from under the second one. The test only compares
      // the two emails — it needs no concurrency.
      const firstResponse = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${first.token}`)
        .expect(200);
      const secondResponse = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${second.token}`)
        .expect(200);

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

  describe('PATCH /users/me', () => {
    // The DTO's bounds are spelled out here as literals rather than imported
    // from `UpdateUserProfileDto`, for the same reason the avatar URL prefix
    // is above: importing them would make the test follow a changed limit
    // silently, and these numbers are a published part of the API contract
    // the frontend mirrors. Changing them must break a test.
    const MAX_LENGTH = 100;

    it("changes the signed-in user's name and returns the updated profile", async () => {
      const { email, token } = await registerUser();
      const stored = await prisma.user.findUnique({ where: { email } });

      const response = await request(app.getHttpServer())
        .patch('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Ada Lovelace' })
        .expect(200);

      const body = response.body as UserProfileBody;
      // Same key set as GET /users/me: the response is the full profile, so a
      // client that just renamed itself never has to re-fetch — and the
      // password hash must not leak through this route either.
      expect(Object.keys(body).sort()).toEqual([
        'avatarUrl',
        'createdAt',
        'email',
        'id',
        'name',
      ]);
      expect(body.name).toBe('Ada Lovelace');
      expect(body.id).toBe(stored?.id);
      expect(body.email).toBe(email);
      // Read before the write, so a createdAt that silently moves on update
      // (or an updatedAt served in its place) fails here.
      expect(body.createdAt).toBe(stored?.createdAt.toISOString());
    });

    it('persists the new name so a following GET /users/me returns it', async () => {
      const { token } = await registerUser();

      await request(app.getHttpServer())
        .patch('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Ada Lovelace' })
        .expect(200);

      const response = await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect((response.body as UserProfileBody).name).toBe('Ada Lovelace');
    });

    it('trims surrounding whitespace before storing the name', async () => {
      const { email, token } = await registerUser();

      const response = await request(app.getHttpServer())
        .patch('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: '  Ada Lovelace  ' })
        .expect(200);

      expect((response.body as UserProfileBody).name).toBe('Ada Lovelace');
      // Asserted against the row too, not only the response: the trim has to
      // happen before persistence, not on the way out.
      const stored = await prisma.user.findUnique({ where: { email } });
      expect(stored?.name).toBe('Ada Lovelace');
    });

    it('renames an already-named user', async () => {
      const { email, token } = await registerUser();
      await prisma.user.update({
        where: { email },
        data: { name: 'Ada Lovelace' },
      });

      const response = await request(app.getHttpServer())
        .patch('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Grace Hopper' })
        .expect(200);

      expect((response.body as UserProfileBody).name).toBe('Grace Hopper');
    });

    it('leaves the avatar untouched — the body is a partial profile', async () => {
      const { email, token } = await registerUser();
      const avatarPath = `${randomUUID()}.png`;
      await prisma.user.update({ where: { email }, data: { avatarPath } });

      const response = await request(app.getHttpServer())
        .patch('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Ada Lovelace' })
        .expect(200);

      expect((response.body as UserProfileBody).avatarUrl).toBe(
        `/api/avatars/${avatarPath}`,
      );
      const stored = await prisma.user.findUnique({ where: { email } });
      expect(stored?.avatarPath).toBe(avatarPath);
    });

    it('accepts a single-character name', async () => {
      const { token } = await registerUser();

      const response = await request(app.getHttpServer())
        .patch('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'A' })
        .expect(200);

      expect((response.body as UserProfileBody).name).toBe('A');
    });

    it('accepts a name of exactly the maximum length', async () => {
      const { token } = await registerUser();
      const name = 'a'.repeat(MAX_LENGTH);

      const response = await request(app.getHttpServer())
        .patch('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ name })
        .expect(200);

      expect((response.body as UserProfileBody).name).toBe(name);
    });

    it('rejects an empty name with a message naming the length rule', async () => {
      const { email, token } = await registerUser();

      const response = await request(app.getHttpServer())
        .patch('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: '' })
        .expect(400);

      // The frontend renders these strings verbatim, so a bare 400 is not
      // enough: the body must say which field failed and why.
      expect(validationMessages(response.body)).toContainEqual(
        expect.stringContaining('name must be longer than or equal to 1'),
      );
      const stored = await prisma.user.findUnique({ where: { email } });
      expect(stored?.name).toBeNull();
    });

    it('rejects a whitespace-only name — it is empty once trimmed', async () => {
      const { email, token } = await registerUser();

      const response = await request(app.getHttpServer())
        .patch('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: '   ' })
        .expect(400);

      expect(validationMessages(response.body)).toContainEqual(
        expect.stringContaining('name must be longer than or equal to 1'),
      );
      // The point of trimming before validating: blanks must not be stored.
      const stored = await prisma.user.findUnique({ where: { email } });
      expect(stored?.name).toBeNull();
    });

    it('rejects a name one character over the maximum', async () => {
      const { email, token } = await registerUser();

      const response = await request(app.getHttpServer())
        .patch('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'a'.repeat(MAX_LENGTH + 1) })
        .expect(400);

      expect(validationMessages(response.body)).toContainEqual(
        expect.stringContaining(
          `name must be shorter than or equal to ${MAX_LENGTH}`,
        ),
      );
      const stored = await prisma.user.findUnique({ where: { email } });
      expect(stored?.name).toBeNull();
    });

    it('accepts a name that only fits once its padding is trimmed off', async () => {
      const { token } = await registerUser();

      // Trimming happens before the length check, so padding can neither push
      // a valid name over the limit nor sneak an over-long one under it. This
      // is the second half of that: the raw string is longer than the limit
      // but its trimmed content is not, and it must be accepted.
      const response = await request(app.getHttpServer())
        .patch('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: `  ${'a'.repeat(MAX_LENGTH)}  ` })
        .expect(200);

      expect((response.body as UserProfileBody).name).toBe(
        'a'.repeat(MAX_LENGTH),
      );
    });

    it('rejects a body with no name at all', async () => {
      const { token } = await registerUser();

      await request(app.getHttpServer())
        .patch('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(400);
    });

    it('rejects a name that is not a string', async () => {
      const { token } = await registerUser();

      await request(app.getHttpServer())
        .patch('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 42 })
        .expect(400);
    });

    it('rejects a body carrying an unknown field', async () => {
      const { token } = await registerUser();

      await request(app.getHttpServer())
        .patch('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Ada Lovelace', avatarUrl: '/api/avatars/evil.png' })
        .expect(400);
    });

    it("ignores a client-supplied id and renames only the caller's own row", async () => {
      const victim = await registerUser();
      const attacker = await registerUser();
      const victimRow = await prisma.user.findUnique({
        where: { email: victim.email },
      });

      // The route takes no id — `whitelist`/`forbidNonWhitelisted` reject the
      // smuggled one outright — but the assertion that matters is the one
      // below: the victim's row is untouched either way.
      await request(app.getHttpServer())
        .patch('/users/me')
        .set('Authorization', `Bearer ${attacker.token}`)
        .send({ name: 'Mallory', id: victimRow?.id })
        .expect(400);

      const victimAfter = await prisma.user.findUnique({
        where: { email: victim.email },
      });
      expect(victimAfter?.name).toBeNull();
    });

    it('404s when the user row was deleted after the token was issued', async () => {
      const { email, token } = await registerUser();
      await prisma.user.delete({ where: { email } });

      const response = await request(app.getHttpServer())
        .patch('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Ada Lovelace' })
        .expect(404);

      expect((response.body as { message: string }).message).toBe(
        'User not found',
      );
    });

    it('rejects a request without an Authorization header', async () => {
      await request(app.getHttpServer())
        .patch('/users/me')
        .send({ name: 'Ada Lovelace' })
        .expect(401);
    });

    it('rejects an Authorization header without the Bearer scheme', async () => {
      const { token } = await registerUser();

      await request(app.getHttpServer())
        .patch('/users/me')
        .set('Authorization', token)
        .send({ name: 'Ada Lovelace' })
        .expect(401);
    });

    it('rejects a malformed bearer token', async () => {
      await request(app.getHttpServer())
        .patch('/users/me')
        .set('Authorization', 'Bearer not-a-real-jwt')
        .send({ name: 'Ada Lovelace' })
        .expect(401);
    });

    it('rejects a well-formed token signed with a different secret', async () => {
      const forged = await new JwtService({
        secret: 'definitely-not-the-app-secret',
      }).signAsync({ sub: randomUUID(), email: uniqueEmail() });

      await request(app.getHttpServer())
        .patch('/users/me')
        .set('Authorization', `Bearer ${forged}`)
        .send({ name: 'Ada Lovelace' })
        .expect(401);
    });

    it('checks the token before the body — an unauthenticated bad body is still 401', async () => {
      // Order matters: a 400 here would tell an anonymous caller that their
      // payload was the only thing wrong with the request.
      await request(app.getHttpServer())
        .patch('/users/me')
        .send({ name: '' })
        .expect(401);
    });
  });
});
