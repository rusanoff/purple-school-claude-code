import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const PASSWORD = 'Sup3rSecret!';

interface AuthResponseBody {
  accessToken: string;
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
});
