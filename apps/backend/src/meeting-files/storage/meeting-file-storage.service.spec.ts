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
