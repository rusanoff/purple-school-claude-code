import { IsEmail, IsString, MinLength } from 'class-validator';

/**
 * Minimum length every password this app accepts must have, and the
 * server-side source of truth for it.
 *
 * Exported rather than inlined so `ChangePasswordDto` validates a *new*
 * password by exactly the rule registration applied to the original one — a
 * password that could not be registered must not be reachable by changing an
 * existing one either, and two hand-kept copies of `6` would eventually
 * disagree about that.
 *
 * The frontend is a separate workspace app that cannot import this, so its
 * client-side check keeps a mirror of this number
 * (`PASSWORD_MIN_LENGTH` in `apps/frontend/lib/auth.ts`, checked through
 * `validatePassword` by both the register page and the profile page's
 * change-password form). Same rule as `USER_NAME_MIN_LENGTH`:
 * a mirror, not a derivation — raising the value here without updating it
 * there leaves the client validating against a stale limit and surfacing
 * unexplained 400s, so both must move in the same change.
 */
export const PASSWORD_MIN_LENGTH = 6;

export class AuthCredentialsDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  password: string;
}
