import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';

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

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
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
});
