import { Query } from '@nestjs/cqrs';
import { UserRecord } from '../interfaces/user-record.interface';

/** Intent: look up a user by email; result is null when no such user exists. */
export class FindUserByEmailQuery extends Query<UserRecord | null> {
  constructor(public readonly email: string) {
    super();
  }
}
