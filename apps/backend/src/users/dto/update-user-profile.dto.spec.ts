import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  USER_NAME_MAX_LENGTH,
  USER_NAME_MIN_LENGTH,
  UpdateUserProfileDto,
} from './update-user-profile.dto';

function validate(payload: unknown) {
  const dto = plainToInstance(UpdateUserProfileDto, payload);
  return { dto, errors: validateSync(dto) };
}

describe('UpdateUserProfileDto', () => {
  it('accepts a name within the allowed length', () => {
    const { dto, errors } = validate({ name: 'Ada Lovelace' });

    expect(errors).toHaveLength(0);
    expect(dto.name).toBe('Ada Lovelace');
  });

  it('trims surrounding whitespace before validating and storing', () => {
    const { dto, errors } = validate({ name: '  Ada Lovelace  ' });

    expect(errors).toHaveLength(0);
    expect(dto.name).toBe('Ada Lovelace');
  });

  it('rejects a whitespace-only name, which trims down to empty', () => {
    const { errors } = validate({ name: '   ' });

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('minLength');
  });

  it('rejects an empty name', () => {
    const { errors } = validate({ name: '' });

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('minLength');
  });

  it('rejects a missing name', () => {
    const { errors } = validate({});

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('isString');
  });

  it('rejects a non-string name without letting the trim transform throw', () => {
    const { errors } = validate({ name: 42 });

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('isString');
  });

  it('accepts a name of exactly the maximum length', () => {
    const { errors } = validate({ name: 'a'.repeat(USER_NAME_MAX_LENGTH) });

    expect(errors).toHaveLength(0);
  });

  it('rejects a name longer than the maximum length', () => {
    const { errors } = validate({ name: 'a'.repeat(USER_NAME_MAX_LENGTH + 1) });

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('maxLength');
  });

  // The trim runs first, so padding must not let an over-long name through
  // and must not push a valid one over the limit either.
  it('applies the length limits to the trimmed value', () => {
    expect(
      validate({ name: `  ${'a'.repeat(USER_NAME_MAX_LENGTH)}  ` }).errors,
    ).toHaveLength(0);
    expect(
      validate({ name: ` ${'a'.repeat(USER_NAME_MAX_LENGTH + 1)} ` }).errors,
    ).toHaveLength(1);
  });

  it('accepts a name of exactly the minimum length', () => {
    const { errors } = validate({ name: 'a'.repeat(USER_NAME_MIN_LENGTH) });

    expect(errors).toHaveLength(0);
  });
});
