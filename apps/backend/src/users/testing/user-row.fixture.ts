import { User } from '@prisma/client';

/** Stands in for the id a caller's JWT carries. Fixed rather than random so a
 * failing assertion prints the same value the `where` clause was built from. */
export const TEST_USER_ID = 'a3f1c0de-0000-4000-8000-000000000001';

/**
 * A complete Prisma `User` row for unit tests, overridable field by field.
 *
 * Shared rather than re-declared per spec because it is the *full* row shape:
 * every handler spec that stubs `prisma.user` has to produce one, and each
 * private copy is a place where a new column can be forgotten — the compiler
 * catches that here, once, for all of them.
 */
export function userRow(overrides: Partial<User> = {}): User {
  return {
    id: TEST_USER_ID,
    email: 'ada@example.com',
    passwordHash: '$2b$10$notarealhashatall',
    name: null,
    avatarPath: null,
    createdAt: new Date('2026-09-05T10:20:30.000Z'),
    updatedAt: new Date('2026-09-06T10:20:30.000Z'),
    ...overrides,
  };
}
