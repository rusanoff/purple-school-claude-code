import { Meeting } from '@prisma/client';
import { TEST_USER_ID } from '../../users/testing/user-row.fixture';

export const TEST_MEETING_ID = 'b7c2d1ef-0000-4000-8000-000000000010';
/** Same id `userRow` carries, so a meeting built from this fixture is owned
 * by the user the other fixtures describe. */
export const TEST_OWNER_ID = TEST_USER_ID;

/**
 * A complete Prisma `Meeting` row for unit tests, overridable field by field
 * — the same "full row shape in one place" reasoning as `userRow` in
 * `src/users/testing/`: every spec that stubs `prisma.meeting` needs one, and
 * a private copy per spec is a place a new column can be forgotten.
 */
export function meetingRow(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: TEST_MEETING_ID,
    title: 'Sprint planning',
    date: new Date('2026-09-01T10:00:00.000Z'),
    participants: ['ada@example.com', 'grace@example.com'],
    ownerId: TEST_OWNER_ID,
    createdAt: new Date('2026-09-05T10:20:30.000Z'),
    updatedAt: new Date('2026-09-06T10:20:30.000Z'),
    ...overrides,
  };
}
