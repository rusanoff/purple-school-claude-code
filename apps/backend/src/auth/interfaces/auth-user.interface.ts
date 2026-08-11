/** Identity extracted from a verified JWT and attached to the request. */
export interface AuthUser {
  userId: string;
  email: string;
}
