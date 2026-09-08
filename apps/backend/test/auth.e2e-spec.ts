import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PASSWORD_SALT_ROUNDS } from '../src/users/constants/password-hashing.constants';

const PASSWORD = 'Sup3rSecret!';
const JWT_SHAPE = /^[\w-]+\.[\w-]+\.[\w-]+$/;

interface AuthResponseBody {
  accessToken: string;
}

function uniqueEmail(): string {
  return `test-${randomUUID()}@example.com`;
}

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;

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
    jwtService = app.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /auth/register', () => {
    it('creates a new user and returns a JWT access token', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: uniqueEmail(), password: PASSWORD })
        .expect(201);

      const body = response.body as AuthResponseBody;
      expect(Object.keys(body)).toEqual(['accessToken']);
      expect(body.accessToken).toMatch(JWT_SHAPE);
    });

    it('rejects registration when the email is already taken', async () => {
      const email = uniqueEmail();
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password: PASSWORD })
        .expect(201);

      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password: PASSWORD })
        .expect(409);
    });

    it('rejects registration without an email', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ password: PASSWORD })
        .expect(400);
    });

    it('rejects registration without a password', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: uniqueEmail() })
        .expect(400);
    });

    it('rejects registration with a malformed email', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'not-an-email', password: PASSWORD })
        .expect(400);
    });
  });

  describe('POST /auth/login', () => {
    it('finds the existing user and returns a JWT access token', async () => {
      const email = uniqueEmail();
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password: PASSWORD })
        .expect(201);

      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200);

      const body = response.body as AuthResponseBody;
      expect(Object.keys(body)).toEqual(['accessToken']);
      expect(body.accessToken).toMatch(JWT_SHAPE);
    });

    it('does not create a user on login — registering the same email afterwards still succeeds once', async () => {
      const email = uniqueEmail();
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password: PASSWORD })
        .expect(201);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200);

      // If login had created another user record, this would either succeed again
      // (no uniqueness enforced) or fail for the wrong reason. It must fail as a duplicate.
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password: PASSWORD })
        .expect(409);
    });

    it('rejects login for an email that was never registered', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: uniqueEmail(), password: PASSWORD })
        .expect(401);
    });

    it('rejects login with an incorrect password', async () => {
      const email = uniqueEmail();
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password: PASSWORD })
        .expect(201);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'wrong-password' })
        .expect(401);
    });

    it('rejects login without an email', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ password: PASSWORD })
        .expect(400);
    });

    it('rejects login without a password', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: uniqueEmail() })
        .expect(400);
    });
  });

  describe('POST /auth/change-password', () => {
    const NEW_PASSWORD = 'Ev3nMoreSecret!';

    async function passwordHashOf(email: string): Promise<string> {
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        throw new Error(`Expected a user row for ${email}`);
      }
      return user.passwordHash;
    }

    it('changes the password and returns a fresh JWT access token', async () => {
      const { token } = await registerUser();

      const response = await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
        .expect(200);

      const body = response.body as AuthResponseBody;
      // Same shape register and login answer with — nothing about the user,
      // and above all no password hash, rides along.
      expect(Object.keys(body)).toEqual(['accessToken']);
      expect(body.accessToken).toMatch(JWT_SHAPE);
    });

    it('replaces the stored hash rather than re-hashing the same password', async () => {
      const { email, token } = await registerUser();
      const hashBefore = await passwordHashOf(email);

      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
        .expect(200);

      // Both halves matter: bcrypt salts randomly, so a *different* hash alone
      // would also be satisfied by re-hashing the current password. Only the
      // compare pins that the stored hash is the new password's.
      const hashAfter = await passwordHashOf(email);
      expect(hashAfter).not.toBe(hashBefore);
      expect(await bcrypt.compare(NEW_PASSWORD, hashAfter)).toBe(true);
    });

    it('stops accepting the old password at login', async () => {
      const { email, token } = await registerUser();

      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
        .expect(200);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: PASSWORD })
        .expect(401);
    });

    it('accepts the new password at login', async () => {
      const { email, token } = await registerUser();

      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
        .expect(200);

      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: NEW_PASSWORD })
        .expect(200);

      expect((response.body as AuthResponseBody).accessToken).toMatch(
        JWT_SHAPE,
      );
    });

    it('issues a token that works on a guarded route', async () => {
      const { token } = await registerUser();

      const response = await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
        .expect(200);

      // The point of handing back a token at all: the caller stays signed in
      // instead of being bounced to /login by the next guarded request.
      await request(app.getHttpServer())
        .get('/users/me')
        .set(
          'Authorization',
          `Bearer ${(response.body as AuthResponseBody).accessToken}`,
        )
        .expect(200);
    });

    it('leaves a token issued before the change valid — JWTs are never revoked', async () => {
      const { token } = await registerUser();

      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
        .expect(200);

      // Pinning an accepted trade-off, not an aspiration: these JWTs are
      // stateless and there is no revocation list, so every session issued
      // before the change keeps working until it expires. If a later phase
      // adds revocation, this expectation is the one that must change.
      await request(app.getHttpServer())
        .get('/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });

    it('rejects an incorrect current password with 400 and leaves the stored hash untouched', async () => {
      const { email, token } = await registerUser();
      const hashBefore = await passwordHashOf(email);

      // 400 and not 401 on purpose: the session is fine, one body field is
      // wrong, and a 401 would log the caller out over a typo.
      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: 'wrong-password', newPassword: NEW_PASSWORD })
        .expect(400);

      expect(await passwordHashOf(email)).toBe(hashBefore);
    });

    it('still accepts the old password at login after a rejected change', async () => {
      const { email, token } = await registerUser();

      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: 'wrong-password', newPassword: NEW_PASSWORD })
        .expect(400);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: NEW_PASSWORD })
        .expect(401);
    });

    it('rejects a new password shorter than the minimum and leaves the stored hash untouched', async () => {
      const { email, token } = await registerUser();
      const hashBefore = await passwordHashOf(email);

      // Five characters — one under PASSWORD_MIN_LENGTH, spelled out rather
      // than rebuilt from the constant so moving the limit fails this test
      // instead of silently following it.
      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: PASSWORD, newPassword: 'short' })
        .expect(400);

      expect(await passwordHashOf(email)).toBe(hashBefore);
    });

    it('accepts a new password of exactly the minimum length', async () => {
      const { email, token } = await registerUser();

      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: PASSWORD, newPassword: 'sixchr' })
        .expect(200);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'sixchr' })
        .expect(200);
    });

    it('accepts a short current password that predates the length rule', async () => {
      // The minimum applies to the new password only: the current one was
      // accepted at some point in the past, possibly under a laxer rule, and
      // rejecting it here would 400 a caller whose input is in fact correct.
      // The row is seeded through Prisma and the token signed directly,
      // because neither POST /auth/register nor POST /auth/login would take a
      // three-character password today — which is exactly the account this
      // test needs to exist.
      const email = uniqueEmail();
      const shortPassword = 'abc';
      const user = await prisma.user.create({
        data: {
          email,
          passwordHash: await bcrypt.hash(shortPassword, PASSWORD_SALT_ROUNDS),
        },
      });
      const token = await jwtService.signAsync({ sub: user.id, email });

      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: shortPassword, newPassword: NEW_PASSWORD })
        .expect(200);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: NEW_PASSWORD })
        .expect(200);
    });

    it('rejects a request without a token', async () => {
      const { email } = await registerUser();
      const hashBefore = await passwordHashOf(email);

      await request(app.getHttpServer())
        .post('/auth/change-password')
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
        .expect(401);

      expect(await passwordHashOf(email)).toBe(hashBefore);
    });

    it('rejects a request whose token is malformed', async () => {
      const { email } = await registerUser();
      const hashBefore = await passwordHashOf(email);

      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', 'Bearer not-a-jwt')
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
        .expect(401);

      expect(await passwordHashOf(email)).toBe(hashBefore);
    });

    it('runs the guard before validating the body', async () => {
      // An unauthenticated caller must not learn which fields the route wants.
      await request(app.getHttpServer())
        .post('/auth/change-password')
        .send({})
        .expect(401);
    });

    it('rejects a body without a current password', async () => {
      const { token } = await registerUser();

      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ newPassword: NEW_PASSWORD })
        .expect(400);
    });

    it('rejects a body without a new password', async () => {
      const { token } = await registerUser();

      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: PASSWORD })
        .expect(400);
    });

    it('rejects a body naming another account', async () => {
      const { token } = await registerUser();
      const other = await registerUser();
      const otherHashBefore = await passwordHashOf(other.email);

      // The route is self-scoped: there is no field for an email or an id, and
      // forbidNonWhitelisted 400s a client that tries to add one.
      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({
          email: other.email,
          currentPassword: PASSWORD,
          newPassword: NEW_PASSWORD,
        })
        .expect(400);

      expect(await passwordHashOf(other.email)).toBe(otherHashBefore);
    });

    it("changes only the caller's own password when another user exists", async () => {
      const { token } = await registerUser();
      const other = await registerUser();
      const otherHashBefore = await passwordHashOf(other.email);

      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
        .expect(200);

      expect(await passwordHashOf(other.email)).toBe(otherHashBefore);
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: other.email, password: PASSWORD })
        .expect(200);
    });

    it('404s when the caller row was deleted after the token was issued', async () => {
      const { email, token } = await registerUser();
      await prisma.user.delete({ where: { email } });

      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
        .expect(404);
    });
  });
});
