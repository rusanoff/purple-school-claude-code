import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Bounds of the display name accepted by `PATCH /users/me`, applied to the
 * **trimmed** value, and the server-side source of truth for them.
 *
 * The frontend is a separate workspace app that cannot import from this one,
 * so its client-side length check keeps its own copy of these numbers (see
 * docs/plan-user-profile-page-and-editing.md, Фаза 4). That copy is a mirror,
 * not a derivation: changing a value here without updating it there leaves
 * the client validating against a stale limit and surfacing unexplained 400s,
 * so both must move in the same change.
 *
 * The minimum is 1 rather than something larger on purpose: it only has to
 * reject an empty (or whitespace-only) name, and single-character display
 * names are legitimate.
 */
export const USER_NAME_MIN_LENGTH = 1;
export const USER_NAME_MAX_LENGTH = 100;

export class UpdateUserProfileDto {
  // Trim before validating so a whitespace-only name fails `@MinLength`
  // instead of being stored as blank, and so padding can neither sneak an
  // over-long name past `@MaxLength` nor push a valid one over it. Same
  // pattern as `CreateMeetingDto.title`.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(USER_NAME_MIN_LENGTH)
  @MaxLength(USER_NAME_MAX_LENGTH)
  name: string;
}
