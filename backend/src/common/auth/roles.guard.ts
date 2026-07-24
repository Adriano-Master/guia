import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { RequestWithUser } from './authenticated-user';
import { ROLES_KEY } from './roles.decorator';

/** Guard global: aplica as restrições de role declaradas com @Roles(...). */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest<RequestWithUser>();
    if (!user) {
      throw new UnauthorizedException('Não autenticado.');
    }
    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException('Acesso negado para o seu perfil.');
    }
    return true;
  }
}
