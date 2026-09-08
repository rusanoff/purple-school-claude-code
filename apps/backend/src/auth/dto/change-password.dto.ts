import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { PASSWORD_MIN_LENGTH } from './auth-credentials.dto';

/**
 * Body of the change-password route: the caller proves they know the current
 * password and names the one replacing it. No email and no id — like every
 * other self-scoped route, the account being written is the one the
 * guard-verified token identifies.
 *
 * Neither field is trimmed (unlike `UpdateUserProfileDto.name`): a password is
 * an opaque secret whose leading and trailing whitespace is part of it, so
 * trimming here would silently store — and later compare against — something
 * other than what the user typed.
 */
export class ChangePasswordDto {
  /**
   * Only required to be present. The real check is `bcrypt.compare` against
   * the stored hash, and the length rule deliberately does not apply: this
   * password was accepted at some point in the past, possibly under an older
   * `PASSWORD_MIN_LENGTH`, and rejecting it here with a 400 would tell the
   * caller their input is malformed when the honest answer is 401.
   */
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  /** Held to the same rule registration applies — see `PASSWORD_MIN_LENGTH`. */
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  newPassword: string;
}
