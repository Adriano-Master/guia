import { Origem, Role, User, UserStatus } from '@prisma/client';

export interface UserResponse {
  id: string;
  nome: string;
  email: string;
  role: Role;
  status: UserStatus;
  origem: Origem;
  ultimoLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Serialização única do User para respostas HTTP: camelCase, datas ISO-8601
 * UTC e NUNCA inclui senhaHash/deletedAt (por whitelist, não por omissão).
 */
export function toUserResponse(user: User): UserResponse {
  return {
    id: user.id,
    nome: user.nome,
    email: user.email,
    role: user.role,
    status: user.status,
    origem: user.origem,
    ultimoLoginAt: user.ultimoLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
