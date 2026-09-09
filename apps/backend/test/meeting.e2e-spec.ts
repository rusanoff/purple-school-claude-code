import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomBytes, randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const PASSWORD = 'Sup3rSecret!';

/**
 * The "who is this person" shape the API embeds in other resources. A
 * meeting's `participants` are sent as plain emails and answered as these —
 * the asymmetry is the point: the request carries what the organizer typed,
 * the response says who that turned out to be.
 */
interface ParticipantBody {
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

interface MeetingBody {
  id: string;
  title: string;
  date: string;
  participants: ParticipantBody[];
  isOwner: boolean;
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

/** A stored `avatarPath` in the shape `AvatarStorageService` generates them:
 * 16 random bytes as hex plus the extension of the validated MIME type. */
function generatedAvatarPath(): string {
  return `${randomBytes(16).toString('hex')}.png`;
}

describe('Meeting (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

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

  /** Fills in a user's display name, so their participant summary has
   * something to answer with other than the email. */
  async function setName(token: string, name: string): Promise<void> {
    await request(app.getHttpServer())
      .patch('/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ name })
      .expect(200);
  }

  /**
   * Points a user's row at a stored avatar and returns the `avatarUrl` their
   * participant summary must therefore carry.
   *
   * Written straight to the row rather than through `POST /users/me/avatar`,
   * the same stand-in `avatar-static.e2e-spec.ts` makes: what is under test
   * here is a meeting answering with an avatar, not the route that stores one
   * — that route is `avatar-upload.e2e-spec.ts`'s subject. No file is put on
   * disk either, since nothing on this path reads one: the summary maps the
   * stored filename to a URL and never opens it.
   */
  async function setAvatar(email: string): Promise<string> {
    const avatarPath = generatedAvatarPath();
    await prisma.user.update({ where: { email }, data: { avatarPath } });

    return `/api/avatars/${avatarPath}`;
  }

  /** Creates a meeting with the given participant emails and returns its id. */
  async function createMeeting(
    token: string,
    participants: string[],
  ): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/meetings')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...sampleMeeting(), participants })
      .expect(201);

    return (response.body as MeetingBody).id;
  }

  /** The meeting as its owner reads it back. */
  async function getMeeting(
    token: string,
    meetingId: string,
  ): Promise<MeetingBody> {
    const response = await request(app.getHttpServer())
      .get(`/meetings/${meetingId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    return response.body as MeetingBody;
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
      // Sent as plain emails, answered as summaries — `sampleMeeting`'s
      // participants are made-up addresses with no account behind them, so
      // every one of them comes back with nothing filled in but the email.
      expect(body.participants).toEqual(
        payload.participants.map((email) => ({
          email,
          name: null,
          avatarUrl: null,
        })),
      );
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
        'isOwner',
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
      expect(body.isOwner).toBe(true);
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

      const body = response.body as MeetingBody;
      expect(body.id).toBe(createdId);
      // A participant reads the same meeting the owner does, but must not
      // be told they're the owner — this is what
      // components/meeting-files.tsx on the frontend uses to decide who
      // can delete which file.
      expect(body.isOwner).toBe(false);
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

    it('reports isOwner: true even when the owner lists their own email as a participant', async () => {
      // Nothing on the backend stops an owner's own email from ending up in
      // `participants` (CreateMeetingDto doesn't check for it, and
      // assertMeetingAccess grants access via ownerId first regardless) —
      // isOwner has to come from ownerId, not from participants membership,
      // or this case would wrongly read as "not the owner".
      const { email: ownerEmail, token: ownerToken } =
        await registerUserWithEmail();

      const created = await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ ...sampleMeeting(), participants: [ownerEmail] })
        .expect(201);
      const createdId = (created.body as MeetingBody).id;

      const response = await request(app.getHttpServer())
        .get(`/meetings/${createdId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect((response.body as MeetingBody).isOwner).toBe(true);
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
        title: payload.title,
        date: payload.date,
        // Same expansion the create response does — that the two agree is
        // half of what "round-trips unchanged" means here.
        participants: payload.participants.map((email) => ({
          email,
          name: null,
          avatarUrl: null,
        })),
        isOwner: true,
      });
    });
  });

  // тест #4
  describe('participant profiles', () => {
    it('answers with a registered participant’s name and avatar', async () => {
      const ownerToken = await registerUser();
      const { email, token } = await registerUserWithEmail();
      await setName(token, 'Ada Lovelace');
      const avatarUrl = await setAvatar(email);

      const meetingId = await createMeeting(ownerToken, [email]);
      const meeting = await getMeeting(ownerToken, meetingId);

      // The point of the phase: enough to render a person, so the meeting
      // page never has to show a bare address. `avatarUrl` arrives with the
      // frontend rewrite's `/api` already on it, ready for an `<img src>` —
      // it is `user-profile.interface.ts` that puts it there, and nothing
      // downstream may add it a second time.
      expect(meeting.participants).toEqual([
        { email, name: 'Ada Lovelace', avatarUrl },
      ]);
      expect(avatarUrl).toMatch(/^\/api\/avatars\/[0-9a-f]{32}\.png$/);
    });

    it('falls back to the bare email for a registered participant who filled in no profile, and for one with no account at all', async () => {
      const ownerToken = await registerUser();
      const { email: registeredEmail } = await registerUserWithEmail();
      const strangerEmail = uniqueEmail();

      const meetingId = await createMeeting(ownerToken, [
        registeredEmail,
        strangerEmail,
      ]);
      const meeting = await getMeeting(ownerToken, meetingId);

      // The two are deliberately indistinguishable: an email nobody
      // registered isn't an error, it's a participant whose profile is as
      // empty as it can get, and answering with the same shape means a client
      // renders one kind of thing for every participant.
      expect(meeting.participants).toEqual([
        { email: registeredEmail, name: null, avatarUrl: null },
        { email: strangerEmail, name: null, avatarUrl: null },
      ]);
    });

    it('keeps the participants in the order they were sent', async () => {
      const ownerToken = await registerUser();
      const { email: firstEmail, token: firstToken } =
        await registerUserWithEmail();
      const { email: secondEmail, token: secondToken } =
        await registerUserWithEmail();
      await setName(firstToken, 'First Participant');
      await setName(secondToken, 'Second Participant');

      // Sent second-then-first on purpose: the summaries are looked up in one
      // batched query, so the response must follow the meeting's own list
      // rather than whatever order the database answered that query in.
      const meetingId = await createMeeting(ownerToken, [
        secondEmail,
        firstEmail,
      ]);
      const meeting = await getMeeting(ownerToken, meetingId);

      expect(meeting.participants.map((p) => p.name)).toEqual([
        'Second Participant',
        'First Participant',
      ]);
      expect(meeting.participants.map((p) => p.email)).toEqual([
        secondEmail,
        firstEmail,
      ]);
    });

    it('recognizes a participant whose email the organizer typed in another case', async () => {
      const ownerToken = await registerUser();
      const { email, token } = await registerUserWithEmail();
      await setName(token, 'Ada Lovelace');

      const meetingId = await createMeeting(ownerToken, [email.toUpperCase()]);
      const meeting = await getMeeting(ownerToken, meetingId);

      // `assertMeetingAccess` already lets this person into the meeting
      // whatever case their email is spelled in — showing them as a stranger
      // here would contradict that. A match answers with the address as their
      // *account* spells it, not as the organizer typed it.
      expect(meeting.participants).toEqual([
        { email, name: 'Ada Lovelace', avatarUrl: null },
      ]);
    });

    it('echoes an unregistered participant’s email exactly as it was typed', async () => {
      const ownerToken = await registerUser();
      const mixedCaseEmail = `Test-${randomUUID()}@Example.com`;

      const meetingId = await createMeeting(ownerToken, [mixedCaseEmail]);
      const meeting = await getMeeting(ownerToken, meetingId);

      // Lowercasing is a matching detail. With no account to answer with,
      // normalizing the fallback would show an address nobody entered.
      expect(meeting.participants).toEqual([
        { email: mixedCaseEmail, name: null, avatarUrl: null },
      ]);
    });

    it('expands the participants of every meeting in the list, not just the first', async () => {
      const ownerToken = await registerUser();
      const { email: firstEmail, token: firstToken } =
        await registerUserWithEmail();
      const { email: secondEmail, token: secondToken } =
        await registerUserWithEmail();
      await setName(firstToken, 'First Participant');
      await setName(secondToken, 'Second Participant');

      await createMeeting(ownerToken, [firstEmail]);
      await createMeeting(ownerToken, [secondEmail]);

      const response = await request(app.getHttpServer())
        .get('/meetings')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      // `GET /meetings` resolves every meeting's participants in one shared
      // lookup, so a list is where "each meeting gets its own people" can
      // actually go wrong — newest first, hence the second meeting leading.
      expect(
        (response.body as MeetingBody[]).map((meeting) =>
          meeting.participants.map((p) => p.name),
        ),
      ).toEqual([['Second Participant'], ['First Participant']]);
    });
  });

  // тест #5
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
