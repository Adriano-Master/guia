import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedUser, RequestWithUser } from './authenticated-user';
import { IS_PUBLIC_KEY } from './public.decorator';
import { TokenService } from '../../modules/auth/token.service';

// Métodos permitidos em modo de visualização (impersonação): somente leitura.
const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Guard global: exige `Authorization: Bearer <access token>` em toda rota que
 * não esteja marcada com @Public(); injeta `req.user` (sub/role/origem).
 *
 * Também aplica o modo somente-leitura da impersonação: token com a claim
 * `impersonatedBy` só passa em GET/HEAD/OPTIONS — qualquer escrita em qualquer
 * rota autenticada (inclusive /auth/logout) é negada aqui, no ponto central,
 * sem depender de lista de rotas.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokenService: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = this.extractBearerToken(request);
    if (!token) {
      throw new UnauthorizedException('Não autenticado.');
    }

    let payload;
    try {
      payload = await this.tokenService.verifyAccessToken(token);
    } catch {
      throw new UnauthorizedException('Token de acesso inválido ou expirado.');
    }

    if (payload.impersonatedBy && !READ_ONLY_METHODS.has(request.method.toUpperCase())) {
      throw new ForbiddenException('Modo de visualização é somente leitura.');
    }

    const user: AuthenticatedUser = {
      sub: payload.sub,
      role: payload.role,
      origem: payload.origem,
      ...(payload.impersonatedBy ? { impersonatedBy: payload.impersonatedBy } : {}),
    };
    request.user = user;
    return true;
  }

  private extractBearerToken(request: RequestWithUser): string | undefined {
    const header = request.headers.authorization;
    if (!header) {
      return undefined;
    }
    const [scheme, token] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
  }
}
