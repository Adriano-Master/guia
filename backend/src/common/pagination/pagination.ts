import { UnprocessableEntityException } from '@nestjs/common';
import { PaginationQueryDto } from './pagination.dto';

export interface PaginatedResponse<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface SortCriteria {
  field: string;
  direction: 'asc' | 'desc';
}

export function paginated<T>(
  data: T[],
  { page, pageSize }: Pick<PaginationQueryDto, 'page' | 'pageSize'>,
  total: number,
): PaginatedResponse<T> {
  return { data, page, pageSize, total };
}

/** Converte page/pageSize em skip/take para consultas Prisma. */
export function toSkipTake({ page, pageSize }: Pick<PaginationQueryDto, 'page' | 'pageSize'>): {
  skip: number;
  take: number;
} {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

/**
 * Interpreta `?sort=campo` (asc) / `?sort=-campo` (desc), restrito a uma
 * allowlist de campos ordenáveis do recurso.
 */
export function parseSort(sort: string | undefined, allowedFields: string[]): SortCriteria | undefined {
  if (!sort) {
    return undefined;
  }

  const direction: SortCriteria['direction'] = sort.startsWith('-') ? 'desc' : 'asc';
  const field = sort.startsWith('-') ? sort.slice(1) : sort;

  if (!allowedFields.includes(field)) {
    throw new UnprocessableEntityException({
      message: 'Parâmetro de ordenação inválido.',
      details: [{ field: 'sort', issue: `campo deve ser um de: ${allowedFields.join(', ')}` }],
    });
  }

  return { field, direction };
}

/** Converte SortCriteria em orderBy do Prisma: { campo: 'asc' | 'desc' }. */
export function toPrismaOrderBy(
  criteria: SortCriteria | undefined,
): Record<string, 'asc' | 'desc'> | undefined {
  return criteria ? { [criteria.field]: criteria.direction } : undefined;
}

/**
 * orderBy ESTÁVEL para listagens paginadas: sort escolhido (ou o default do
 * recurso) sempre desempatado por createdAt desc e id asc. Sem ordem total,
 * linhas empatadas no campo ordenado flutuam entre páginas no offset/limit
 * do Postgres (itens duplicados/ausentes ao paginar).
 */
export function toStableOrderBy(
  criteria: SortCriteria | undefined,
  fallback: Record<string, 'asc' | 'desc'>,
): Record<string, 'asc' | 'desc'>[] {
  const primary = toPrismaOrderBy(criteria) ?? fallback;
  const orderBy: Record<string, 'asc' | 'desc'>[] = [primary];
  if (!('createdAt' in primary)) {
    orderBy.push({ createdAt: 'desc' });
  }
  orderBy.push({ id: 'asc' });
  return orderBy;
}
