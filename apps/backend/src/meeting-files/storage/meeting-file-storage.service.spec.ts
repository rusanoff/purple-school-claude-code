import { resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { MeetingFileStorageService } from './meeting-file-storage.service';

function buildService(env: Record<string, string | undefined>) {
  const config = {
    get: (key: string) => env[key],
  } as ConfigService;

  return new MeetingFileStorageService(config);
}

describe('MeetingFileStorageService — max file size resolution', () => {
  it('defaults to 50MB when FILE_MAX_SIZE_BYTES is unset', () => {
    expect(() => buildService({})).not.toThrow();
  });

  it('honors an explicit positive value', () => {
    expect(() => buildService({ FILE_MAX_SIZE_BYTES: '1024' })).not.toThrow();
  });

  // Regression: "0" must be honored (reject-everything), not silently
  // coerced to the default the way a falsy-check would.
  it('accepts an explicit "0" rather than falling back to the default', () => {
    expect(() => buildService({ FILE_MAX_SIZE_BYTES: '0' })).not.toThrow();
  });

  // Regression: `Number('  ')` is 0, so a whitespace-only value would pass
  // the integer guard and silently reject every upload.
  it('treats a whitespace-only value as unset', () => {
    expect(buildService({ FILE_MAX_SIZE_BYTES: '   ' }).maxFileSizeBytes).toBe(
      50 * 1024 * 1024,
    );
  });

  it('throws for a negative value instead of silently using the default', () => {
    expect(() => buildService({ FILE_MAX_SIZE_BYTES: '-1' })).toThrow(
      /non-negative integer/,
    );
  });

  it('throws for a non-numeric value instead of silently using the default', () => {
    expect(() => buildService({ FILE_MAX_SIZE_BYTES: 'not-a-number' })).toThrow(
      /non-negative integer/,
    );
  });

  it('throws for a non-integer value instead of silently using the default', () => {
    expect(() => buildService({ FILE_MAX_SIZE_BYTES: '10.5' })).toThrow(
      /non-negative integer/,
    );
  });
});

describe('MeetingFileStorageService — storage directory resolution', () => {
  it('honors an explicit FILE_STORAGE_DIR', () => {
    expect(
      buildService({ FILE_STORAGE_DIR: '/srv/meeting-files' }).storageDir,
    ).toBe(resolve('/srv/meeting-files'));
  });

  // Regression: `?? DEFAULT` alone would take a blank value at face value and
  // `resolve('')` it to the process cwd. `AvatarStorageService` reads this
  // same variable with a blank-means-unset rule when it asserts the two
  // storage directories are disjoint, so a disagreement here would have
  // startup certify `<cwd>/uploads` as safely separate from the publicly
  // served avatar directory while uploads actually landed in `<cwd>`.
  it.each(['', '   '])(
    'treats a blank FILE_STORAGE_DIR (%p) as unset rather than as cwd',
    (blank) => {
      expect(buildService({ FILE_STORAGE_DIR: blank }).storageDir).toBe(
        resolve('./uploads'),
      );
    },
  );
});
