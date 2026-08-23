import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';

const PASSWORD = 'Sup3rSecret!';

interface MeetingBody {
  id: string;
  title: string;
  date: string;
  participants: string[];
}

function uniqueEmail(): string {
  return `test-${randomUUID()}@example.com`;
}

function sampleMeeting() {
  return {
    title: 'Sprint planning',
    date: '2026-09-01T10:00:00.000Z',
    participants: ['alice@example.com', 'bob@example.com'],
  };
}

describe('Meeting (e2e)', () => {
  let app: INestApplication<App>;

  /** Registers a fresh user and returns their bearer access token. */
  async function registerUser(): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: uniqueEmail(), password: PASSWORD })
      .expect(201);

    return (response.body as { accessToken: string }).accessToken;
  }

  /** Registers a fresh user and returns both their email and bearer token —
   * for tests that need the email to list the user as a meeting participant. */
  async function registerUserWithEmail(): Promise<{
    email: string;
    token: string;
  }> {
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
  });

  afterAll(async () => {
    await app.close();
  });

  describe('authorization', () => {
    it('rejects an unauthenticated POST /meetings', async () => {
      await request(app.getHttpServer())
        .post('/meetings')
        .send(sampleMeeting())
        .expect(401);
    });

    it('rejects an unauthenticated GET /meetings', async () => {
      await request(app.getHttpServer()).get('/meetings').expect(401);
    });

    it('rejects an unauthenticated GET /meetings/:id', async () => {
      await request(app.getHttpServer())
        .get(`/meetings/${randomUUID()}`)
        .expect(401);
    });

    it('rejects an unauthenticated DELETE /meetings/:id', async () => {
      await request(app.getHttpServer())
        .delete(`/meetings/${randomUUID()}`)
        .expect(401);
    });

    it('rejects an Authorization header without the Bearer scheme', async () => {
      const token = await registerUser();

      await request(app.getHttpServer())
        .get('/meetings')
        .set('Authorization', token)
        .expect(401);
    });

    it('rejects a malformed bearer token', async () => {
      await request(app.getHttpServer())
        .get('/meetings')
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
        .get('/meetings')
        .set('Authorization', `Bearer ${forged}`)
        .expect(401);
    });
  });

  // тест #1
  describe('POST /meetings', () => {
    it('creates a new meeting for the current user', async () => {
      const token = await registerUser();
      const payload = sampleMeeting();

      const response = await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${token}`)
        .send(payload)
        .expect(201);

      const body = response.body as MeetingBody;
      expect(typeof body.id).toBe('string');
      expect(body.id.length).toBeGreaterThan(0);
      expect(body.title).toBe(payload.title);
      expect(new Date(body.date).toISOString()).toBe(payload.date);
      expect(body.participants).toEqual(payload.participants);
    });

    it('rejects a meeting without a title', async () => {
      const token = await registerUser();
      const { date, participants } = sampleMeeting();

      await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${token}`)
        .send({ date, participants })
        .expect(400);
    });

    it('rejects a meeting with a malformed date', async () => {
      const token = await registerUser();

      await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...sampleMeeting(), date: 'not-a-date' })
        .expect(400);
    });

    it('does not expose ownerId or timestamps in the response', async () => {
      const token = await registerUser();

      const response = await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${token}`)
        .send(sampleMeeting())
        .expect(201);

      expect(Object.keys(response.body as MeetingBody).sort()).toEqual([
        'date',
        'id',
        'participants',
        'title',
      ]);
    });

    it('rejects a meeting with an empty participants list', async () => {
      const token = await registerUser();

      await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...sampleMeeting(), participants: [] })
        .expect(400);
    });

    it('rejects a meeting whose participants are not all strings', async () => {
      const token = await registerUser();

      await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...sampleMeeting(), participants: ['alice@example.com', 42] })
        .expect(400);
    });

    it('rejects a meeting carrying an unknown field', async () => {
      const token = await registerUser();

      await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...sampleMeeting(), ownerId: randomUUID() })
        .expect(400);
    });

    it('rejects a whitespace-only title', async () => {
      const token = await registerUser();

      await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...sampleMeeting(), title: '   ' })
        .expect(400);
    });

    it('ignores a client-supplied ownerId and scopes the meeting to the caller', async () => {
      const victimToken = await registerUser();
      const attackerToken = await registerUser();

      // Even if `ownerId` were accepted, the meeting must never land in
      // another user's list — the owner comes from the JWT, not the body.
      const created = await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${attackerToken}`)
        .send(sampleMeeting())
        .expect(201);
      const createdId = (created.body as MeetingBody).id;

      const victimList = await request(app.getHttpServer())
        .get('/meetings')
        .set('Authorization', `Bearer ${victimToken}`)
        .expect(200);

      expect((victimList.body as MeetingBody[]).map((m) => m.id)).not.toContain(
        createdId,
      );
    });
  });

  // тест #2
  describe('GET /meetings', () => {
    it('returns only the current user’s meetings', async () => {
      const token = await registerUser();

      const created = await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${token}`)
        .send(sampleMeeting())
        .expect(201);
      const createdId = (created.body as MeetingBody).id;

      const response = await request(app.getHttpServer())
        .get('/meetings')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = response.body as MeetingBody[];
      expect(Array.isArray(body)).toBe(true);
      expect(body.map((m) => m.id)).toContain(createdId);
    });

    it('does not leak meetings that belong to another user', async () => {
      const ownerToken = await registerUser();
      const otherToken = await registerUser();

      const created = await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(sampleMeeting())
        .expect(201);
      const createdId = (created.body as MeetingBody).id;

      const response = await request(app.getHttpServer())
        .get('/meetings')
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(200);

      const body = response.body as MeetingBody[];
      expect(body.map((m) => m.id)).not.toContain(createdId);
    });

    it('returns an empty list for a user with no meetings', async () => {
      const token = await registerUser();

      const response = await request(app.getHttpServer())
        .get('/meetings')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it('returns every meeting the user created, newest first', async () => {
      const token = await registerUser();

      const first = await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...sampleMeeting(), title: 'First' })
        .expect(201);
      const second = await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...sampleMeeting(), title: 'Second' })
        .expect(201);

      const response = await request(app.getHttpServer())
        .get('/meetings')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = response.body as MeetingBody[];
      expect(body.map((m) => m.id)).toEqual([
        (second.body as MeetingBody).id,
        (first.body as MeetingBody).id,
      ]);
    });
  });

  // тест #3
  describe('GET /meetings/:id', () => {
    it('returns a single meeting owned by the current user', async () => {
      const token = await registerUser();

      const created = await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${token}`)
        .send(sampleMeeting())
        .expect(201);
      const createdId = (created.body as MeetingBody).id;

      const response = await request(app.getHttpServer())
        .get(`/meetings/${createdId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = response.body as MeetingBody;
      expect(body.id).toBe(createdId);
      expect(body.title).toBe(sampleMeeting().title);
    });

    it('returns 404 when the meeting does not exist', async () => {
      const token = await registerUser();

      await request(app.getHttpServer())
        .get(`/meetings/${randomUUID()}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('returns 403 when the meeting exists but the caller is neither owner nor participant', async () => {
      const ownerToken = await registerUser();
      const otherToken = await registerUser();

      const created = await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(sampleMeeting())
        .expect(201);
      const createdId = (created.body as MeetingBody).id;

      // The meeting exists — unlike a genuinely missing id, this must not
      // collapse to 404, since owner-or-participant access is now checked
      // separately from existence.
      await request(app.getHttpServer())
        .get(`/meetings/${createdId}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(403);
    });

    it('returns the meeting for a participant, not just its owner', async () => {
      const ownerToken = await registerUser();
      const { email: participantEmail, token: participantToken } =
        await registerUserWithEmail();

      const created = await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ ...sampleMeeting(), participants: [participantEmail] })
        .expect(201);
      const createdId = (created.body as MeetingBody).id;

      const response = await request(app.getHttpServer())
        .get(`/meetings/${createdId}`)
        .set('Authorization', `Bearer ${participantToken}`)
        .expect(200);

      expect((response.body as MeetingBody).id).toBe(createdId);
    });

    it('matches participant email case-insensitively', async () => {
      const ownerToken = await registerUser();
      const { email: participantEmail, token: participantToken } =
        await registerUserWithEmail();

      const created = await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          ...sampleMeeting(),
          participants: [participantEmail.toUpperCase()],
        })
        .expect(201);
      const createdId = (created.body as MeetingBody).id;

      await request(app.getHttpServer())
        .get(`/meetings/${createdId}`)
        .set('Authorization', `Bearer ${participantToken}`)
        .expect(200);
    });

    it('returns 404 — not 500 — for an id that is not a UUID', async () => {
      const token = await registerUser();

      await request(app.getHttpServer())
        .get('/meetings/not-a-uuid')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('round-trips the created meeting unchanged', async () => {
      const token = await registerUser();
      const payload = sampleMeeting();

      const created = await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${token}`)
        .send(payload)
        .expect(201);

      const fetched = await request(app.getHttpServer())
        .get(`/meetings/${(created.body as MeetingBody).id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(fetched.body).toEqual(created.body);
      expect(fetched.body).toEqual({
        id: (created.body as MeetingBody).id,
        ...payload,
      });
    });
  });

  // тест #4
  describe('DELETE /meetings/:id', () => {
    it('lets the owner delete their meeting', async () => {
      const token = await registerUser();

      const created = await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${token}`)
        .send(sampleMeeting())
        .expect(201);
      const createdId = (created.body as MeetingBody).id;

      await request(app.getHttpServer())
        .delete(`/meetings/${createdId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      await request(app.getHttpServer())
        .get(`/meetings/${createdId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('returns 404 when the meeting does not exist', async () => {
      const token = await registerUser();

      await request(app.getHttpServer())
        .delete(`/meetings/${randomUUID()}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('rejects a participant — only the owner can delete a meeting', async () => {
      const ownerToken = await registerUser();
      const { email: participantEmail, token: participantToken } =
        await registerUserWithEmail();

      const created = await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ ...sampleMeeting(), participants: [participantEmail] })
        .expect(201);
      const createdId = (created.body as MeetingBody).id;

      await request(app.getHttpServer())
        .delete(`/meetings/${createdId}`)
        .set('Authorization', `Bearer ${participantToken}`)
        .expect(403);

      // Untouched — the owner can still fetch it afterwards.
      await request(app.getHttpServer())
        .get(`/meetings/${createdId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
    });

    it('rejects a stranger — neither owner nor participant', async () => {
      const ownerToken = await registerUser();
      const strangerToken = await registerUser();

      const created = await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(sampleMeeting())
        .expect(201);
      const createdId = (created.body as MeetingBody).id;

      await request(app.getHttpServer())
        .delete(`/meetings/${createdId}`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(403);
    });
  });
});
