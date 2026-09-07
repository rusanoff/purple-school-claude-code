import fastifyStatic from '@fastify/static';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AVATAR_STATIC_ROUTE_PREFIX } from './users/interfaces/user-profile.interface';
import { AvatarStorageService } from './users/storage/avatar-storage.service';

/**
 * How long a browser may cache an avatar it has already fetched. Effectively
 * forever, and `immutable` on top of it, because a stored avatar file is
 * write-once: `saveAvatar` generates a fresh random name for every upload
 * including a replacement, and `deleteAvatar` never lets a name come back, so
 * the bytes behind any URL that ever resolved cannot change. The flip side —
 * a client keeping a deleted avatar in its cache — costs nothing, since the
 * profile response stops handing out that URL the moment the row is updated.
 */
const AVATAR_CACHE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Mounts the avatar directory — and *only* that directory — on
 * `@fastify/static`, so an `<img src>` can fetch an avatar with no
 * `Authorization` header.
 *
 * Like `registerMultipart`, this is Fastify plugin registration rather than a
 * Nest provider, so it can't live in a module's `providers` and must run
 * before the app starts serving: in `main.ts` before `app.listen()`, in a
 * `*.e2e-spec.ts` before `app.init()`. An `*.e2e-spec.ts` that asserts
 * anything about avatar URLs has to call it, or `/avatars/*` won't exist.
 *
 * The public mount is the reason `AvatarStorageService` keeps its own
 * directory, disjoint from `FILE_STORAGE_DIR` (its constructor enforces
 * that): meeting files are access-checked per request against
 * owner/participant, and a mount pointed at a directory holding them — or at
 * any ancestor of it — would publish every one. Nothing else in the app is
 * served this way; there is no second, wider static mount to add a file to by
 * accident.
 */
export async function registerAvatarStatic(
  app: NestFastifyApplication,
): Promise<void> {
  const avatarStorage = app.get(AvatarStorageService);
  // The service is the single source of the resolved directory — reading
  // `AVATAR_STORAGE_DIR` again here would re-implement its blank-means-unset
  // rule and could land somewhere else entirely.
  const root = avatarStorage.storageDirectory;
  // `@fastify/static` only warns when `root` doesn't exist, then 404s every
  // request against a mount that can never work. The service creates the
  // directory in `onModuleInit`, which runs during `app.init()` — after this
  // registration — so create it here too rather than register against a path
  // that isn't there yet. Idempotent (`mkdir -p`), so the later hook is a
  // no-op.
  await avatarStorage.ensureStorageDirectory();

  await app.register(fastifyStatic, {
    root,
    prefix: AVATAR_STATIC_ROUTE_PREFIX,
    // Serve stored files and nothing more: no directory listing (the default,
    // restated because it is a security property here — the filenames are
    // unguessable by design and a listing would hand them all out), no
    // `index.html` fallback for a directory request, and no dotfiles.
    // `dotfiles`, not `serveDotFiles`: the latter is only consulted on the
    // `wildcard: false` glob path, so on this (default) route it would read
    // like a restriction while changing nothing, leaving the plugin's
    // `'allow'` default in place. `'ignore'` rather than `'deny'` so a
    // dotfile is indistinguishable from a name that was never stored.
    // Avatars are the only thing under `root`, but the mount should stay this
    // narrow even if something else ever lands there.
    list: false,
    index: false,
    dotfiles: 'ignore',
    // A request for the directory itself would otherwise reach
    // `@fastify/send`, which answers a trailing slash with a 403 that the
    // plugin hands to Nest's exception layer — a full stack trace logged at
    // ERROR for an unauthenticated request anyone can repeat. Refusing it
    // here instead routes it through `reply.callNotFound()`: same non-answer
    // to the client, quietly.
    allowedPath: (pathname) => !pathname.endsWith('/'),
    // `reply.sendFile` would be added to *every* reply in the app, including
    // routes that have no business reading from this directory. Nothing uses
    // it — the meeting-file download route streams through its own service —
    // so don't decorate.
    decorateReply: false,
    maxAge: AVATAR_CACHE_MAX_AGE_MS,
    immutable: true,
  });
}
