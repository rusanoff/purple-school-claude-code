import { ClearUserAvatarHandler } from './clear-user-avatar.handler';
import { CreateUserHandler } from './create-user.handler';
import { SetUserAvatarHandler } from './set-user-avatar.handler';
import { UpdateUserProfileHandler } from './update-user-profile.handler';

export const CommandHandlers = [
  CreateUserHandler,
  UpdateUserProfileHandler,
  SetUserAvatarHandler,
  ClearUserAvatarHandler,
];
