import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { Transform, TransformCallback } from 'node:stream';
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

class FileTooLargeError extends Error {}

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
    const configuredMax = Number(
      this.config.get<string>('FILE_MAX_SIZE_BYTES'),
    );
    this.maxFileSizeBytes =
      Number.isFinite(configuredMax) && configuredMax > 0
        ? configuredMax
        : DEFAULT_MAX_FILE_SIZE_BYTES;
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

    const data = await request.file();
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

    try {
      await pipeline(
        data.file,
        this.createSizeLimiter(this.maxFileSizeBytes),
        createWriteStream(diskPath),
      );
    } catch (error) {
      // pipeline() awaits every stream closing before settling, so the
      // partially-written file is safe to remove immediately here.
      await rm(diskPath, { force: true });
      if (error instanceof FileTooLargeError) {
        throw new BadRequestException(
          `File exceeds the maximum allowed size of ${this.maxFileSizeBytes} bytes`,
        );
      }
      throw error;
    }

    const { size } = await stat(diskPath);

    return {
      filename: data.filename,
      mimeType: data.mimetype,
      size,
      path: diskFilename,
    };
  }

  private generateDiskFilename(originalFilename: string): string {
    const ext = extname(originalFilename);
    const safeExt = SAFE_EXTENSION_PATTERN.test(ext) ? ext : '';
    return `${randomUUID()}${safeExt}`;
  }

  /** Aborts the pipeline once more than `maxBytes` has streamed through —
   * an independent, per-call-configurable check, not tied to the fixed
   * limit `@fastify/multipart` itself was registered with. */
  private createSizeLimiter(maxBytes: number): Transform {
    let received = 0;
    return new Transform({
      transform(
        chunk: Buffer,
        _encoding: BufferEncoding,
        callback: TransformCallback,
      ) {
        received += chunk.length;
        if (received > maxBytes) {
          callback(new FileTooLargeError());
          return;
        }
        callback(null, chunk);
      },
    });
  }
}
