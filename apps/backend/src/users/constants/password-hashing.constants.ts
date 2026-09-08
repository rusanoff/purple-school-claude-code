/**
 * bcrypt cost factor every password in this app is hashed with — the single
 * source of truth for it.
 *
 * Exported rather than inlined because a password is hashed in two places:
 * when the account is created (`CreateUserHandler`) and when its owner
 * changes it (`ChangePasswordHandler`). Those two must agree — a change that
 * silently re-hashed at a different cost would leave accounts protected
 * differently depending on whether their password had ever been changed, and
 * nothing about the stored hash makes that visible in review.
 *
 * Raising it is safe and needs no migration: bcrypt stores the cost inside
 * the hash, so existing hashes keep verifying at the cost they were made
 * with and get the new one the next time their password is written.
 */
export const PASSWORD_SALT_ROUNDS = 10;
