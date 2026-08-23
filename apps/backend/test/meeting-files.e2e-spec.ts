import { randomUUID } from 'crypto';
import { existsSync, readdirSync } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { registerMultipart } from '../src/multipart';

const PASSWORD = 'Sup3rSecret!';
// Small on purpose so the "exceeds size limit" case doesn't need a
// multi-megabyte buffer to trigger — see docs/research-meeting-upload.md §6
// on isolating e2e file storage from dev data.
const MAX_FILE_SIZE_BYTES = 5 * 1024; // 5KB

interface MeetingBody {
  id: string;
  title: string;
  date: string;
  participants: string[];
}

interface MeetingFileBody {
  id: string;
  meetingId: string;
  uploadedById: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

function uniqueEmail(): string {
  return `test-${randomUUID()}@example.com`;
}

function sampleMeeting(participants: string[] = ['alice@example.com']) {
  return {
    title: 'Sprint planning',
    date: '2026-09-01T10:00:00.000Z',
    participants,
  };
}

describe('Meeting files (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let storageDir: string;

  /** Registers a fresh user and returns both their email and bearer token. */
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

  async function createMeeting(
    token: string,
    participants?: string[],
  ): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/meetings')
      .set('Authorization', `Bearer ${token}`)
      .send(sampleMeeting(participants))
      .expect(201);

    return (response.body as MeetingBody).id;
  }

  /** Uploads a file to a meeting and returns the created row's response body
   * — shared setup for the list/download/delete tests below, which all need
   * an already-uploaded file to act on. */
  async function uploadFile(
    token: string,
    meetingId: string,
    overrides: {
      filename?: string;
      contentType?: string;
      content?: string;
    } = {},
  ): Promise<MeetingFileBody> {
    const response = await request(app.getHttpServer())
      .post(`/meetings/${meetingId}/files`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from(overrides.content ?? 'fake video content'), {
        filename: overrides.filename ?? 'recording.mp4',
        contentType: overrides.contentType ?? 'video/mp4',
      })
      .expect(201);

    return response.body as MeetingFileBody;
  }

  beforeAll(async () => {
    // Isolated temp storage dir + a small size limit, both read by
    // MeetingFileStorageService's constructor — set before the module is
    // compiled/instantiated below so ConfigModule/ConfigService pick them
    // up, and before app.init() so they're in effect for every request.
    storageDir = await mkdtemp(join(tmpdir(), 'meeting-files-e2e-'));
    process.env.FILE_STORAGE_DIR = storageDir;
    process.env.FILE_MAX_SIZE_BYTES = String(MAX_FILE_SIZE_BYTES);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const adapter = new FastifyAdapter();
    app = moduleFixture.createNestApplication(adapter);
    await registerMultipart(app);
    await app.init();
    // Fastify finishes registering routes/plugins asynchronously — supertest
    // needs the adapter's underlying instance to be ready before requests
    // against app.getHttpServer() are guaranteed to hit registered routes.
    await adapter.getInstance().ready();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
    await rm(storageDir, { recursive: true, force: true });
  });

  // тест #1
  describe('POST /meetings/:meetingId/files', () => {
    it('rejects an unauthenticated upload', async () => {
      const { token } = await registerUserWithEmail();
      const meetingId = await createMeeting(token);

      await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/files`)
        .attach('file', Buffer.from('video bytes'), {
          filename: 'recording.mp4',
          contentType: 'video/mp4',
        })
        .expect(401);
    });

    it('lets the owner upload a valid audio/video file and creates a DB row and a disk file', async () => {
      const { token: ownerToken } = await registerUserWithEmail();
      const meetingId = await createMeeting(ownerToken);

      const response = await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/files`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .attach('file', Buffer.from('fake video content'), {
          filename: 'recording.mp4',
          contentType: 'video/mp4',
        })
        .expect(201);

      const body = response.body as MeetingFileBody;
      expect(body.meetingId).toBe(meetingId);
      expect(body.filename).toBe('recording.mp4');
      expect(body.mimeType).toBe('video/mp4');
      expect(body.size).toBe(Buffer.byteLength('fake video content'));

      const row = await prisma.meetingFile.findUnique({
        where: { id: body.id },
      });
      expect(row).not.toBeNull();
      expect(existsSync(join(storageDir, row!.path))).toBe(true);
    });

    it('lets the owner upload a document', async () => {
      const { token: ownerToken } = await registerUserWithEmail();
      const meetingId = await createMeeting(ownerToken);

      const response = await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/files`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .attach('file', Buffer.from('%PDF-1.4 fake pdf content'), {
          filename: 'agenda.pdf',
          contentType: 'application/pdf',
        })
        .expect(201);

      expect((response.body as MeetingFileBody).mimeType).toBe(
        'application/pdf',
      );
    });

    it('lets a participant upload a valid file', async () => {
      const { token: ownerToken } = await registerUserWithEmail();
      const { email: participantEmail, token: participantToken } =
        await registerUserWithEmail();
      const meetingId = await createMeeting(ownerToken, [participantEmail]);

      await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/files`)
        .set('Authorization', `Bearer ${participantToken}`)
        .attach('file', Buffer.from('doc bytes'), {
          filename: 'notes.txt',
          contentType: 'text/plain',
        })
        .expect(201);
    });

    it('rejects an upload from someone who is neither owner nor participant', async () => {
      const { token: ownerToken } = await registerUserWithEmail();
      const { token: strangerToken } = await registerUserWithEmail();
      const meetingId = await createMeeting(ownerToken);

      await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/files`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .attach('file', Buffer.from('video bytes'), {
          filename: 'recording.mp4',
          contentType: 'video/mp4',
        })
        .expect(403);
    });

    it('returns 404 for a non-existent meeting', async () => {
      const { token } = await registerUserWithEmail();

      await request(app.getHttpServer())
        .post(`/meetings/${randomUUID()}/files`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('video bytes'), {
          filename: 'recording.mp4',
          contentType: 'video/mp4',
        })
        .expect(404);
    });

    it('rejects a disallowed MIME type without creating a DB row', async () => {
      const { token } = await registerUserWithEmail();
      const meetingId = await createMeeting(token);

      await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/files`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('#!/bin/sh\necho hi'), {
          filename: 'script.sh',
          contentType: 'application/x-sh',
        })
        .expect(400);

      const files = await prisma.meetingFile.findMany({
        where: { meetingId },
      });
      expect(files).toHaveLength(0);
    });

    it('rejects a file over the size limit and leaves no partial file on disk', async () => {
      const { token } = await registerUserWithEmail();
      const meetingId = await createMeeting(token);
      const entriesBefore = readdirSync(storageDir).length;

      await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/files`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.alloc(MAX_FILE_SIZE_BYTES + 1, 'a'), {
          filename: 'recording.mp4',
          contentType: 'video/mp4',
        })
        .expect(400);

      const files = await prisma.meetingFile.findMany({
        where: { meetingId },
      });
      expect(files).toHaveLength(0);
      // The partially-written file must be cleaned up, not left behind.
      expect(readdirSync(storageDir).length).toBe(entriesBefore);
    });

    // Regression: MIME allowlist matching used to be case-sensitive.
    it('accepts a differently-cased but otherwise allowed Content-Type', async () => {
      const { token } = await registerUserWithEmail();
      const meetingId = await createMeeting(token);

      const response = await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/files`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('fake video content'), {
          filename: 'recording.mp4',
          contentType: 'Video/MP4',
        })
        .expect(201);

      // The 201 above is the actual regression check — a case-sensitive
      // allowlist would 400 this. `busboy` itself lower-cases the part's
      // Content-Type by the time it reaches us, so the stored value isn't
      // expected to preserve the client's original casing.
      expect((response.body as MeetingFileBody).mimeType.toLowerCase()).toBe(
        'video/mp4',
      );
    });

    // Regression: a failure persisting metadata after the file was already
    // written to disk used to leave the file orphaned (no DB row, no cleanup).
    it('removes the disk file if persisting its metadata fails', async () => {
      const { token } = await registerUserWithEmail();
      const meetingId = await createMeeting(token);
      const entriesBefore = readdirSync(storageDir).length;

      const createSpy = jest
        .spyOn(prisma.meetingFile, 'create')
        .mockRejectedValueOnce(new Error('simulated DB failure'));

      try {
        await request(app.getHttpServer())
          .post(`/meetings/${meetingId}/files`)
          .set('Authorization', `Bearer ${token}`)
          .attach('file', Buffer.from('fake video content'), {
            filename: 'recording.mp4',
            contentType: 'video/mp4',
          })
          .expect(500);
      } finally {
        createSpy.mockRestore();
      }

      expect(readdirSync(storageDir).length).toBe(entriesBefore);
    });
  });

  // тест #2
  describe('GET /meetings/:meetingId/files', () => {
    it('rejects an unauthenticated request', async () => {
      const { token } = await registerUserWithEmail();
      const meetingId = await createMeeting(token);

      await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files`)
        .expect(401);
    });

    it('lists an uploaded file with its metadata for the owner', async () => {
      const { token } = await registerUserWithEmail();
      const meetingId = await createMeeting(token);
      const uploaded = await uploadFile(token, meetingId);

      const response = await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = response.body as MeetingFileBody[];
      expect(body).toHaveLength(1);
      expect(body[0]).toEqual(uploaded);
    });

    it('is visible to a participant, not just the owner', async () => {
      const { token: ownerToken } = await registerUserWithEmail();
      const { email: participantEmail, token: participantToken } =
        await registerUserWithEmail();
      const meetingId = await createMeeting(ownerToken, [participantEmail]);
      await uploadFile(ownerToken, meetingId);

      const response = await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files`)
        .set('Authorization', `Bearer ${participantToken}`)
        .expect(200);

      expect(response.body as MeetingFileBody[]).toHaveLength(1);
    });

    it('rejects someone who is neither owner nor participant', async () => {
      const { token: ownerToken } = await registerUserWithEmail();
      const { token: strangerToken } = await registerUserWithEmail();
      const meetingId = await createMeeting(ownerToken);

      await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(403);
    });

    it('returns 404 for a non-existent meeting', async () => {
      const { token } = await registerUserWithEmail();

      await request(app.getHttpServer())
        .get(`/meetings/${randomUUID()}/files`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('returns an empty list when no files have been uploaded', async () => {
      const { token } = await registerUserWithEmail();
      const meetingId = await createMeeting(token);

      const response = await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it('does not leak files belonging to another meeting', async () => {
      const { token } = await registerUserWithEmail();
      const meetingIdA = await createMeeting(token);
      const meetingIdB = await createMeeting(token);
      await uploadFile(token, meetingIdA);

      const response = await request(app.getHttpServer())
        .get(`/meetings/${meetingIdB}/files`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body).toEqual([]);
    });
  });

  // тест #3
  describe('GET /meetings/:meetingId/files/:fileId', () => {
    it('rejects an unauthenticated request', async () => {
      const { token } = await registerUserWithEmail();
      const meetingId = await createMeeting(token);
      const file = await uploadFile(token, meetingId);

      await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files/${file.id}`)
        .expect(401);
    });

    it('streams the file back to the owner with the right content and headers', async () => {
      const { token } = await registerUserWithEmail();
      const meetingId = await createMeeting(token);
      const content = 'plain text file content';
      const file = await uploadFile(token, meetingId, {
        content,
        filename: 'notes.txt',
        contentType: 'text/plain',
      });

      const response = await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files/${file.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.headers['content-type']).toContain('text/plain');
      expect(response.headers['content-disposition']).toContain('notes.txt');
      expect(response.text).toBe(content);
    });

    it('lets a participant download the file', async () => {
      const { token: ownerToken } = await registerUserWithEmail();
      const { email: participantEmail, token: participantToken } =
        await registerUserWithEmail();
      const meetingId = await createMeeting(ownerToken, [participantEmail]);
      const file = await uploadFile(ownerToken, meetingId);

      await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files/${file.id}`)
        .set('Authorization', `Bearer ${participantToken}`)
        .expect(200);
    });

    it('rejects someone who is neither owner nor participant', async () => {
      const { token: ownerToken } = await registerUserWithEmail();
      const { token: strangerToken } = await registerUserWithEmail();
      const meetingId = await createMeeting(ownerToken);
      const file = await uploadFile(ownerToken, meetingId);

      await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files/${file.id}`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(403);
    });

    it('returns 404 for a non-existent meeting', async () => {
      const { token } = await registerUserWithEmail();

      await request(app.getHttpServer())
        .get(`/meetings/${randomUUID()}/files/${randomUUID()}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('returns 404 for a file that does not belong to the meeting', async () => {
      const { token } = await registerUserWithEmail();
      const meetingIdA = await createMeeting(token);
      const meetingIdB = await createMeeting(token);
      const file = await uploadFile(token, meetingIdA);

      await request(app.getHttpServer())
        .get(`/meetings/${meetingIdB}/files/${file.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  // тест #4
  describe('DELETE /meetings/:meetingId/files/:fileId', () => {
    it('rejects an unauthenticated request', async () => {
      const { token } = await registerUserWithEmail();
      const meetingId = await createMeeting(token);
      const file = await uploadFile(token, meetingId);

      await request(app.getHttpServer())
        .delete(`/meetings/${meetingId}/files/${file.id}`)
        .expect(401);
    });

    it('lets the owner delete their own file, removing the DB row and the disk file', async () => {
      const { token } = await registerUserWithEmail();
      const meetingId = await createMeeting(token);
      const file = await uploadFile(token, meetingId);
      const row = await prisma.meetingFile.findUnique({
        where: { id: file.id },
      });

      await request(app.getHttpServer())
        .delete(`/meetings/${meetingId}/files/${file.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      expect(
        await prisma.meetingFile.findUnique({ where: { id: file.id } }),
      ).toBeNull();
      expect(existsSync(join(storageDir, row!.path))).toBe(false);
    });

    it('lets the owner delete a file uploaded by a participant', async () => {
      const { token: ownerToken } = await registerUserWithEmail();
      const { email: participantEmail, token: participantToken } =
        await registerUserWithEmail();
      const meetingId = await createMeeting(ownerToken, [participantEmail]);
      const file = await uploadFile(participantToken, meetingId);

      await request(app.getHttpServer())
        .delete(`/meetings/${meetingId}/files/${file.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(204);

      expect(
        await prisma.meetingFile.findUnique({ where: { id: file.id } }),
      ).toBeNull();
    });

    it('lets a participant delete a file they uploaded themselves', async () => {
      const { token: ownerToken } = await registerUserWithEmail();
      const { email: participantEmail, token: participantToken } =
        await registerUserWithEmail();
      const meetingId = await createMeeting(ownerToken, [participantEmail]);
      const file = await uploadFile(participantToken, meetingId);

      await request(app.getHttpServer())
        .delete(`/meetings/${meetingId}/files/${file.id}`)
        .set('Authorization', `Bearer ${participantToken}`)
        .expect(204);
    });

    it('rejects a participant deleting a file they did not upload', async () => {
      const { token: ownerToken } = await registerUserWithEmail();
      const { email: participantEmail, token: participantToken } =
        await registerUserWithEmail();
      const meetingId = await createMeeting(ownerToken, [participantEmail]);
      const file = await uploadFile(ownerToken, meetingId);

      await request(app.getHttpServer())
        .delete(`/meetings/${meetingId}/files/${file.id}`)
        .set('Authorization', `Bearer ${participantToken}`)
        .expect(403);

      expect(
        await prisma.meetingFile.findUnique({ where: { id: file.id } }),
      ).not.toBeNull();
    });

    it('rejects someone who is neither owner nor participant', async () => {
      const { token: ownerToken } = await registerUserWithEmail();
      const { token: strangerToken } = await registerUserWithEmail();
      const meetingId = await createMeeting(ownerToken);
      const file = await uploadFile(ownerToken, meetingId);

      await request(app.getHttpServer())
        .delete(`/meetings/${meetingId}/files/${file.id}`)
        .set('Authorization', `Bearer ${strangerToken}`)
        .expect(403);
    });

    it('returns 404 for a file that does not belong to the meeting', async () => {
      const { token } = await registerUserWithEmail();
      const meetingIdA = await createMeeting(token);
      const meetingIdB = await createMeeting(token);
      const file = await uploadFile(token, meetingIdA);

      await request(app.getHttpServer())
        .delete(`/meetings/${meetingIdB}/files/${file.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  // тест #5
  describe('DELETE /meetings/:id (cascade file cleanup)', () => {
    it('removes uploaded files from disk when their meeting is deleted', async () => {
      const { token } = await registerUserWithEmail();
      const meetingId = await createMeeting(token);
      const file = await uploadFile(token, meetingId);
      const row = await prisma.meetingFile.findUnique({
        where: { id: file.id },
      });

      await request(app.getHttpServer())
        .delete(`/meetings/${meetingId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      expect(
        await prisma.meetingFile.findMany({ where: { meetingId } }),
      ).toHaveLength(0);
      expect(existsSync(join(storageDir, row!.path))).toBe(false);
    });
  });
});
