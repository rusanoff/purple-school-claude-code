import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DEFAULT_FILE_STORAGE_DIR } from '../../meeting-files/constants/file-upload.constants';
import {
  assertAvatarStorageDirIsSeparate,
  avatarExtensionForMimeType,
  DEFAULT_AVATAR_MAX_SIZE_BYTES,
  DEFAULT_AVATAR_STORAGE_DIR,
  isAllowedAvatarMimeType,
} from '../constants/avatar-upload.constants';

/**
 * Bytes of randomness in a generated avatar filename. The file is served by
 * `@fastify/static` with no `Authorization` header in front of it, so the
 * name *is* the access control: 16 bytes (128 bits, hex-encoded to 32
 * characters) is not enumerable, and unlike a name derived from the user id
 * or a hash of the email it cannot be reconstructed by someone who already
 * knows who they are looking for. Don't shrink this.
 */
const AVATAR_FILENAME_RANDOM_BYTES = 16;

/**
 * A generated avatar filename and nothing else — the shape callers persist in
 * `User.avatarPath` and hand back to `deleteAvatar` later.
 *
 * There is no `filename` field mirroring `SavedFile`'s: the client's original
 * filename is never displayed for an avatar and never reaches disk, so
 * keeping it would only invite someone to start trusting it.
 */
export interface SavedAvatar {
  /** Generated filename on disk, relative to the avatar storage directory. */
  path: string;
  mimeType: string;
  size: number;
}

/**
 * A source of avatar bytes. Normally the file stream `@fastify/multipart`
 * hands over, which is a plain `Readable` plus a `truncated` flag — see
 * `saveAvatar` for why that flag has to be honoured on top of this service's
 * own byte counting.
 */
export type AvatarSource = Readable & { readonly truncated?: boolean };

/** Thrown by the counting transform below and never escapes `saveAvatar`,
 * which translates it into the client-facing `BadRequestException`. A named
 * class rather than a flag so an unrelated stream failure — a full disk, a
 * dropped connection — can't be mistaken for "too large" and reported to the
 * client as their fault. */
class AvatarTooLargeError extends Error {}

/**
 * Owns the avatar directory on disk: writes an uploaded image stream to it
 * under a generated name, and removes a file by that name.
 *
 * Separate from `MeetingFileStorageService` rather than a second method on
 * it, because the two directories have opposite access rules — this one is
 * mounted publicly by `@fastify/static`, meeting files are access-checked per
 * request — and that difference has to be visible in the type a caller
 * injects, not buried in an argument. The constructor enforces the same split
 * on the configured paths via `assertAvatarStorageDirIsSeparate`.
 *
 * Takes an already-parsed stream rather than a `FastifyRequest` the way
 * `saveUploadedFile` does: the multipart parsing and the "delete the previous
 * avatar" bookkeeping belong to the upload command, and keeping them out of
 * here is what lets this service be exercised against a plain `Readable`.
 */
@Injectable()
export class AvatarStorageService implements OnModuleInit {
  /** The resolved avatar directory. Public because it is the one value the
   * `@fastify/static` mount and this service must agree on exactly — reading
   * `AVATAR_STORAGE_DIR` a second time over there would re-implement the
   * blank-means-unset rule below and could quietly resolve somewhere else. */
  readonly storageDirectory: string;

  /** Public so the upload route can pass the same number to
   * `request.file({ limits: { fileSize } })` — one configured limit, applied
   * both by busboy and by the byte count below, rather than two that can
   * disagree. */
  readonly maxAvatarSizeBytes: number;

  constructor(private readonly config: ConfigService) {
    this.storageDirectory = resolve(
      this.configuredDir('AVATAR_STORAGE_DIR') ?? DEFAULT_AVATAR_STORAGE_DIR,
    );
    // Both effective directories, defaults included: a misconfiguration that
    // would put publicly served avatars and private meeting files under one
    // roof has to abort startup here, not surface later as leaked files.
    assertAvatarStorageDirIsSeparate(
      this.storageDirectory,
      this.configuredDir('FILE_STORAGE_DIR') ?? DEFAULT_FILE_STORAGE_DIR,
    );
    this.maxAvatarSizeBytes = this.resolveMaxAvatarSizeBytes();
  }

  /** A configured directory, or `undefined` when the variable is absent or
   * blank. `??` alone would take an empty `AVATAR_STORAGE_DIR=` at face value
   * and `resolve('')` it to the process cwd — the app root, next to the
   * source tree — instead of falling back to the documented default. Blank
   * means unset for the size limit below too; the two must not disagree on
   * what the same misconfiguration means. */
  private configuredDir(key: string): string | undefined {
    return this.config.get<string>(key)?.trim() || undefined;
  }

  async onModuleInit(): Promise<void> {
    // Nothing writes here until the first upload, but a clean environment
    // (fresh clone, fresh e2e temp dir) has no avatar directory yet — create
    // it up front so the first request doesn't fail on that alone. Only this
    // one: the meeting-file directory is `MeetingFileStorageService`'s to
    // create, and creating it from here would mask a path typo that the
    // assertion above is meant to catch.
    await mkdir(this.storageDirectory, { recursive: true });
  }

  /**
   * Streams `source` into the avatar directory under a freshly generated
   * name and returns it. Nothing about the result is derived from the
   * uploader: not the name (see `AVATAR_FILENAME_RANDOM_BYTES`) and not the
   * extension, which comes from the MIME type this method just validated so
   * that what `@fastify/static` infers as the response `Content-Type` is
   * always the type that was actually allowed.
   *
   * Callers get a fresh name on every save, including a replacement of the
   * same user's existing avatar — removing the previous file is the caller's
   * job (`deleteAvatar`), and doing it that way means a failed replacement
   * leaves the old avatar intact instead of overwriting it with a partial.
   */
  async saveAvatar(
    source: AvatarSource,
    mimeType: string,
  ): Promise<SavedAvatar> {
    if (!isAllowedAvatarMimeType(mimeType)) {
      // Drain rather than leave the part unread, so Fastify can finish
      // parsing the rest of the request cleanly — and reject before anything
      // touches disk.
      source.resume();
      throw new BadRequestException(`Unsupported image type: ${mimeType}`);
    }

    const diskFilename = this.generateDiskFilename(mimeType);
    const diskPath = join(this.storageDirectory, diskFilename);

    let size = 0;
    const limit = this.maxAvatarSizeBytes;
    // Counting here, in the pipeline, rather than `stat`-ing afterwards: the
    // point is to stop *writing* once the limit is crossed, so an oversized
    // upload can't put its full length on disk before being rejected.
    const countingBytes = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        if (size > limit) {
          callback(new AvatarTooLargeError());
          return;
        }
        callback(null, chunk);
      },
    });

    try {
      await pipeline(source, countingBytes, createWriteStream(diskPath));

      // `@fastify/multipart` does not error an oversized part: busboy stops
      // the stream early and sets `truncated`, so a file cut off at exactly
      // the caller's `limits.fileSize` arrives here as a complete, in-limit
      // stream that the counter above has no way to fault. Without this
      // check a too-large upload would be silently stored, mangled.
      if (source.truncated) {
        throw new AvatarTooLargeError();
      }
    } catch (error) {
      // Whatever went wrong — over the limit, a broken source, a failed
      // write — the file at `diskPath` is partial and belongs to nobody: no
      // row references it yet, and the name is never reused, so nothing will
      // ever come back for it. `force` because the pipeline may well have
      // failed before creating it at all.
      await rm(diskPath, { force: true });

      if (error instanceof AvatarTooLargeError) {
        throw new BadRequestException(
          `Avatar exceeds the maximum allowed size of ${limit} bytes`,
        );
      }
      throw error;
    }

    return { path: diskFilename, mimeType, size };
  }

  /**
   * Removes a stored avatar — used both when replacing one and when clearing
   * it, so that neither leaves the previous image readable at its old public
   * URL.
   *
   * Missing is success: a retried delete, a wiped volume or a row whose file
   * was already cleaned up all leave the caller exactly where they wanted to
   * be, and failing the request over it would only turn a stale row into an
   * unclearable one.
   */
  async deleteAvatar(diskFilename: string): Promise<void> {
    await rm(
      join(this.storageDirectory, this.assertBareFilename(diskFilename)),
      {
        force: true,
      },
    );
  }

  private generateDiskFilename(mimeType: string): string {
    return `${randomBytes(AVATAR_FILENAME_RANDOM_BYTES).toString('hex')}${avatarExtensionForMimeType(mimeType)}`;
  }

  /**
   * Every name this service hands out is bare hex plus an extension, so
   * anything else arriving at `deleteAvatar` is a stored value that something
   * other than `saveAvatar` wrote. Refuse it instead of letting `join`
   * resolve a `../` back out of the avatar directory and into the
   * meeting-file storage — a stored value is only ever as trustworthy as
   * whatever last wrote it, and `rm` is not a call to find that out on.
   */
  private assertBareFilename(diskFilename: string): string {
    // The two dot rules cover two different hazards: `..` walks out of the
    // storage directory, and a lone `.` names the storage directory *itself*,
    // which `rm` would fail on with a raw EISDIR rather than the descriptive
    // rejection intended here. Requiring at least one non-dot character
    // handles the latter, and every name this service generates — hex plus an
    // extension — satisfies it.
    if (
      !/^[0-9a-zA-Z._-]+$/.test(diskFilename) ||
      diskFilename.includes('..') ||
      !/[^.]/.test(diskFilename)
    ) {
      throw new Error(`Not a valid avatar filename: "${diskFilename}"`);
    }

    return diskFilename;
  }

  /** `undefined`/empty means "not set" and falls back to the default; any
   * other value must be a non-negative integer or startup fails loudly —
   * silently coercing an invalid or zero value to the default would hide a
   * real misconfiguration (including "0" meaning "reject every upload").
   * Same contract as `FILE_MAX_SIZE_BYTES`, deliberately: two size limits
   * that behave differently on a typo would be a trap. */
  private resolveMaxAvatarSizeBytes(): number {
    // Trimmed before both checks: `Number('  ')` is 0, which would sail
    // through the integer guard below and silently install a limit that
    // rejects every upload — a misconfiguration surfacing only as mystifying
    // 400s at runtime, which is exactly what failing loudly here prevents.
    const raw = this.config.get<string>('AVATAR_MAX_SIZE_BYTES')?.trim();
    if (raw === undefined || raw === '') {
      return DEFAULT_AVATAR_MAX_SIZE_BYTES;
    }

    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new Error(
        `AVATAR_MAX_SIZE_BYTES must be a non-negative integer, got: "${raw}"`,
      );
    }

    return parsed;
  }
}
