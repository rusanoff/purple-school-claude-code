import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyRequest } from 'fastify';
import { isAllowedMimeType } from '../constants/file-upload.constants';

const DEFAULT_STORAGE_DIR = './uploads';
const DEFAULT_MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

// Only a short alnum extension is kept from the original filename; anything
// else (no extension, a path-like or overly long suffix) is dropped rather
// than trusted verbatim — the disk filename is always randomUUID() + this,
// never the client-supplied name, per the path-traversal/collision warning
// in docs/research-meeting-upload.md §1.
const SAFE_EXTENSION_PATTERN = /^\.[a-zA-Z0-9]{1,10}$/;

export interface SavedFile {
  /** Original filename as sent by the client — display/Content-Disposition
   * only, never used to address the file on disk. */
  filename: string;
  mimeType: string;
  size: number;
  /** Generated filename on disk, relative to the storage directory. */
  path: string;
}

/**
 * Reads a single-file multipart request via `@fastify/multipart`, validates
 * it against the MIME allowlist and the configured size limit, and streams
 * it to disk without buffering the whole file in memory.
 *
 * Deliberately not part of the CQRS command that follows a successful
 * upload (see docs/research-meeting-upload.md §1, "open question" list):
 * a `FastifyRequest` isn't a sensible immutable command payload, and
 * validation/IO at the HTTP edge is a reasonable place for it to live —
 * `UploadMeetingFileCommand` only ever receives the already-validated
 * primitives this method returns.
 */
@Injectable()
export class MeetingFileStorageService implements OnModuleInit {
  private readonly storageDir: string;
  private readonly maxFileSizeBytes: number;

  constructor(private readonly config: ConfigService) {
    this.storageDir = resolve(
      this.config.get<string>('FILE_STORAGE_DIR') ?? DEFAULT_STORAGE_DIR,
    );
    this.maxFileSizeBytes = this.resolveMaxFileSizeBytes();
  }

  async onModuleInit(): Promise<void> {
    // Nothing writes here until the first upload, but a clean environment
    // (fresh clone, fresh e2e temp dir) has no ./uploads yet — create it
    // up front so the first request doesn't fail on that alone.
    await mkdir(this.storageDir, { recursive: true });
  }

  async saveUploadedFile(request: FastifyRequest): Promise<SavedFile> {
    if (!request.isMultipart()) {
      throw new BadRequestException('Expected a multipart/form-data request');
    }

    // Passing `limits.fileSize` per-call (rather than relying on the fixed
    // ceiling `@fastify/multipart` was registered with in src/multipart.ts)
    // is what lets FILE_MAX_SIZE_BYTES be the single source of truth for
    // "too large" — no second, independent limit to drift out of sync with
    // it. `throwFileSizeLimit: false` opts out of the plugin's own
    // error-on-limit machinery in favour of the `truncated` check below,
    // which works uniformly for both request.file() call sites.
    const data = await request.file({
      limits: { fileSize: this.maxFileSizeBytes },
      throwFileSizeLimit: false,
    });
    if (!data) {
      throw new BadRequestException('No file was uploaded');
    }

    if (!isAllowedMimeType(data.mimetype)) {
      // Drain the part instead of leaving it unread so Fastify can finish
      // parsing the rest of the request cleanly — reject before anything
      // touches disk.
      data.file.resume();
      throw new BadRequestException(`Unsupported file type: ${data.mimetype}`);
    }

    const diskFilename = this.generateDiskFilename(data.filename);
    const diskPath = join(this.storageDir, diskFilename);

    await pipeline(data.file, createWriteStream(diskPath));

    if (data.file.truncated) {
      // Busboy doesn't error the stream when the limit is hit — it just
      // stops it early and flags `truncated`, so the write above always
      // "succeeds" even for an oversized upload. The partial file has to be
      // removed explicitly here, after the fact.
      await rm(diskPath, { force: true });
      throw new BadRequestException(
        `File exceeds the maximum allowed size of ${this.maxFileSizeBytes} bytes`,
      );
    }

    const { size } = await stat(diskPath);

    return {
      filename: data.filename,
      mimeType: data.mimetype,
      size,
      path: diskFilename,
    };
  }

  /** Removes a previously saved file — used to undo `saveUploadedFile` when
   * a step after it (e.g. persisting metadata) fails, so a rejected upload
   * never leaves an orphaned file behind. */
  async deleteFile(diskFilename: string): Promise<void> {
    await rm(join(this.storageDir, diskFilename), { force: true });
  }

  private generateDiskFilename(originalFilename: string): string {
    const ext = extname(originalFilename);
    const safeExt = SAFE_EXTENSION_PATTERN.test(ext) ? ext : '';
    return `${randomUUID()}${safeExt}`;
  }

  /** `undefined`/empty means "not set" and falls back to the default; any
   * other value must be a non-negative integer or startup fails loudly —
   * silently coercing an invalid or zero value to the default would hide a
   * real misconfiguration (including "0" meaning "reject every upload"). */
  private resolveMaxFileSizeBytes(): number {
    const raw = this.config.get<string>('FILE_MAX_SIZE_BYTES');
    if (raw === undefined || raw === '') {
      return DEFAULT_MAX_FILE_SIZE_BYTES;
    }

    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new Error(
        `FILE_MAX_SIZE_BYTES must be a non-negative integer, got: "${raw}"`,
      );
    }

    return parsed;
  }
}
