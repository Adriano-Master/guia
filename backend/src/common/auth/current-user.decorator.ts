import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser, RequestWithUser } from './authenticated-user';

/** Injeta o usuário autenticado (`req.user`) no handler. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser | undefined => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    return request.user;
  },
);
