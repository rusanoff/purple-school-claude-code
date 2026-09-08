import { ChangePasswordAndIssueTokenHandler } from './change-password-and-issue-token.handler';
import { LoginHandler } from './login.handler';
import { RegisterHandler } from './register.handler';

export const CommandHandlers = [
  RegisterHandler,
  LoginHandler,
  ChangePasswordAndIssueTokenHandler,
];

export * from './change-password-and-issue-token.command';
export * from './login.command';
export * from './register.command';
