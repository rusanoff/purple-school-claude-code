/**
 * Full persisted user shape, shared with other modules only via CQRS
 * messages (CreateUserCommand's result, FindUserByEmailQuery's result).
 * Includes the password hash — never map this straight onto an HTTP response.
 */
export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
}
