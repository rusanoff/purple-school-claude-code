import { Prisma } from '@prisma/client';

/**
 * True if `error` is a Prisma "known request" error with the given code —
 * e.g. `'P2025'` (record to update/delete not found) or `'P2003'` (foreign
 * key constraint violation). There is no global Prisma exception filter in
 * this app (`app.module.ts` registers only `APP_PIPE`), so a handful of
 * expected Prisma failure modes — a delete racing another delete of the
 * same row, an insert racing a delete of its parent — need to be
 * translated into the right HTTP status by hand at the handler that can
 * hit them, instead of surfacing as a raw 500.
 */
export function isPrismaError(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}
