import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  // Fastify defaults to binding 127.0.0.1 only — '0.0.0.0' keeps the same
  // all-interfaces behaviour the previous Express adapter had by default.
  await app.listen(process.env.PORT ?? 3001, '0.0.0.0');
}
bootstrap();
