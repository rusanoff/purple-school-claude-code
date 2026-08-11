import { Transform } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsString,
} from 'class-validator';

export class CreateMeetingDto {
  // Trim before validating so a whitespace-only title fails `@IsNotEmpty`
  // instead of being stored as blank.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  title: string;

  /** ISO-8601 date-time string, e.g. `2026-09-01T10:00:00.000Z`. */
  @IsDateString()
  date: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  participants: string[];
}
