import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { registerAvatarStatic } from './avatar-static';
import { registerMultipart } from './multipart';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  await registerMultipart(app);
  await registerAvatarStatic(app);
  // Fastify defaults to binding 127.0.0.1 only — '0.0.0.0' keeps the same
  // all-interfaces behaviour the previous Express adapter had by default.
  await app.listen(process.env.PORT ?? 3001, '0.0.0.0');
}
bootstrap();
