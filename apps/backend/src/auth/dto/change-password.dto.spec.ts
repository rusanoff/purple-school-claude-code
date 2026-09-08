import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PASSWORD_MIN_LENGTH } from './auth-credentials.dto';
import { ChangePasswordDto } from './change-password.dto';

function validate(payload: unknown) {
  const dto = plainToInstance(ChangePasswordDto, payload);
  return { dto, errors: validateSync(dto) };
}

function errorFor(errors: ReturnType<typeof validateSync>, property: string) {
  return errors.find((error) => error.property === property);
}

const VALID = {
  currentPassword: 'current-password',
  newPassword: 'new-password',
};

describe('ChangePasswordDto', () => {
  it('accepts a current and a new password', () => {
    const { dto, errors } = validate(VALID);

    expect(errors).toHaveLength(0);
    expect(dto.currentPassword).toBe('current-password');
    expect(dto.newPassword).toBe('new-password');
  });

  it('rejects a missing current password', () => {
    const { errors } = validate({ newPassword: 'new-password' });

    expect(errors).toHaveLength(1);
    expect(errorFor(errors, 'currentPassword')?.constraints).toHaveProperty(
      'isString',
    );
  });

  it('rejects a non-string current password', () => {
    const { errors } = validate({ ...VALID, currentPassword: 42 });

    expect(errors).toHaveLength(1);
    expect(errorFor(errors, 'currentPassword')?.constraints).toHaveProperty(
      'isString',
    );
  });

  it('rejects an empty current password without waiting for a hash comparison', () => {
    const { errors } = validate({ ...VALID, currentPassword: '' });

    expect(errors).toHaveLength(1);
    expect(errorFor(errors, 'currentPassword')?.constraints).toHaveProperty(
      'isNotEmpty',
    );
  });

  // The current password predates whatever the length rule is now, so it is
  // checked against the stored hash, not against `PASSWORD_MIN_LENGTH`.
  it('does not apply the minimum length to the current password', () => {
    const { errors } = validate({
      ...VALID,
      currentPassword: 'a'.repeat(PASSWORD_MIN_LENGTH - 1),
    });

    expect(errors).toHaveLength(0);
  });

  it('rejects a missing new password', () => {
    const { errors } = validate({ currentPassword: 'current-password' });

    expect(errors).toHaveLength(1);
    expect(errorFor(errors, 'newPassword')?.constraints).toHaveProperty(
      'isString',
    );
  });

  it('rejects a non-string new password', () => {
    const { errors } = validate({ ...VALID, newPassword: 42 });

    expect(errors).toHaveLength(1);
    expect(errorFor(errors, 'newPassword')?.constraints).toHaveProperty(
      'isString',
    );
  });

  it('rejects a new password shorter than the minimum length', () => {
    const { errors } = validate({
      ...VALID,
      newPassword: 'a'.repeat(PASSWORD_MIN_LENGTH - 1),
    });

    expect(errors).toHaveLength(1);
    expect(errorFor(errors, 'newPassword')?.constraints).toHaveProperty(
      'minLength',
    );
  });

  it('accepts a new password of exactly the minimum length', () => {
    const { errors } = validate({
      ...VALID,
      newPassword: 'a'.repeat(PASSWORD_MIN_LENGTH),
    });

    expect(errors).toHaveLength(0);
  });

  // Passwords are opaque secrets: surrounding whitespace is part of them, so
  // neither field may be trimmed the way `UpdateUserProfileDto.name` is.
  it('keeps surrounding whitespace in both passwords', () => {
    const { dto, errors } = validate({
      currentPassword: '  current-password  ',
      newPassword: '  new-password  ',
    });

    expect(errors).toHaveLength(0);
    expect(dto.currentPassword).toBe('  current-password  ');
    expect(dto.newPassword).toBe('  new-password  ');
  });

  // Whitespace counts toward the length for the same reason it is not
  // trimmed — but a password that is only spaces is still long enough.
  it('counts whitespace toward the new password length', () => {
    expect(
      validate({ ...VALID, newPassword: ' '.repeat(PASSWORD_MIN_LENGTH) })
        .errors,
    ).toHaveLength(0);
    expect(
      validate({
        ...VALID,
        newPassword: ` ${'a'.repeat(PASSWORD_MIN_LENGTH)} `,
      }).errors,
    ).toHaveLength(0);
  });
});
