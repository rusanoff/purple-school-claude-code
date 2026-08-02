import { LoginHandler } from './login.handler';
import { RegisterHandler } from './register.handler';

export const CommandHandlers = [RegisterHandler, LoginHandler];

export * from './login.command';
export * from './register.command';
