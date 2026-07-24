export type Role = 'ADMIN' | 'MODERADOR' | 'PROFESSOR' | 'ALUNO';
export type UserStatus = 'ATIVO' | 'INATIVO' | 'PENDENTE';
export type UserOrigem = 'PROPRIO' | 'HOTMART';

export interface User {
  id: string;
  nome: string;
  email: string;
  role: Role;
  status: UserStatus;
  origem: UserOrigem;
  ultimoLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
}

export interface UserResponse {
  user: User;
}

export interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface UsersListParams {
  page?: number;
  pageSize?: number;
  sort?: string;
  role?: Role;
  status?: UserStatus;
  q?: string;
}
