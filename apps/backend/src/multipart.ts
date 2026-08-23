import multipart from '@fastify/multipart';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { MULTIPART_PLUGIN_FILE_SIZE_LIMIT_BYTES } from './meeting-files/constants/file-upload.constants';

/**
 * Registers `@fastify/multipart` once on the underlying Fastify instance.
 * This is Fastify plugin registration, not a Nest provider — it can't live
 * in a module's `providers`, and it must run before the app starts
 * accepting requests: in `main.ts`, before `app.listen()`; in a
 * `*.e2e-spec.ts`, before `app.init()` (mirrors this app's existing
 * `FastifyAdapter` + `adapter.getInstance().ready()` e2e pattern — see
 * `apps/backend/CLAUDE.md`). Any `*.e2e-spec.ts` exercising a file-upload
 * route must call this too, or `request.file()` won't exist.
 *
 * `FileInterceptor`/`multer` are Express-only and unusable on this app's
 * Fastify adapter — this plugin is the Fastify-native replacement (see
 * docs/research-meeting-upload.md §1).
 */
export async function registerMultipart(
  app: NestFastifyApplication,
): Promise<void> {
  await app.register(multipart, {
    limits: { fileSize: MULTIPART_PLUGIN_FILE_SIZE_LIMIT_BYTES, files: 1 },
  });
}
