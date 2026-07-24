import { Origem, Role } from '@prisma/client';
import { Request } from 'express';

/** Identidade extraída do access token e injetada em `req.user` pelo AuthGuard. */
export interface AuthenticatedUser {
  sub: string;
  role: Role;
  origem: Origem;
  /** Id do ADMIN quando o token é de impersonação (visualização somente leitura). */
  impersonatedBy?: string;
}

export interface RequestWithUser extends Request {
  user?: AuthenticatedUser;
}
