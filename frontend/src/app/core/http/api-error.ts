import { HttpErrorResponse } from '@angular/common/http';
import type { FormGroup } from '@angular/forms';

export interface ApiErrorDetail {
  field: string;
  issue: string;
}

export interface ApiError {
  code: string;
  message: string;
  details?: ApiErrorDetail[];
  traceId?: string;
}

const FRIENDLY_MESSAGES: Record<string, string> = {
  VALIDATION_ERROR: 'Verifique os dados informados.',
  UNAUTHENTICATED: 'Sessão inválida ou expirada. Faça login novamente.',
  FORBIDDEN: 'Você não tem permissão para realizar esta ação.',
  NOT_FOUND: 'Recurso não encontrado.',
  CONFLICT: 'Conflito com dados já existentes.',
  RATE_LIMITED: 'Muitas tentativas. Aguarde alguns instantes e tente novamente.',
  INTERNAL: 'Erro inesperado no servidor. Tente novamente mais tarde.',
};

/**
 * Extrai o envelope de erro padrão da API ({ error: { code, message, ... } }).
 * Sempre retorna um ApiError com mensagem amigável em pt-BR.
 */
export function extractApiError(err: unknown): ApiError {
  if (err instanceof HttpErrorResponse) {
    const body = err.error as { error?: ApiError } | null;
    if (body && typeof body === 'object' && body.error?.code) {
      return {
        ...body.error,
        message: body.error.message || FRIENDLY_MESSAGES[body.error.code] || 'Erro inesperado.',
      };
    }
    if (err.status === 0) {
      return { code: 'NETWORK', message: 'Sem conexão com o servidor. Verifique sua internet.' };
    }
    const code = statusToCode(err.status);
    return { code, message: FRIENDLY_MESSAGES[code] ?? 'Erro inesperado.' };
  }
  return { code: 'UNKNOWN', message: 'Erro inesperado. Tente novamente.' };
}

/**
 * Aplica os details[] de um 422 nos controls correspondentes do form
 * (erro `server` com a mensagem do backend). Retorna os details sem campo
 * correspondente no form.
 */
export function applyFieldErrors(form: FormGroup, error: ApiError): ApiErrorDetail[] {
  const unmatched: ApiErrorDetail[] = [];
  for (const detail of error.details ?? []) {
    const control = form.get(detail.field);
    if (control) {
      control.setErrors({ ...control.errors, server: detail.issue });
      control.markAsTouched();
    } else {
      unmatched.push(detail);
    }
  }
  return unmatched;
}

function statusToCode(status: number): string {
  switch (status) {
    case 401:
      return 'UNAUTHENTICATED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 422:
      return 'VALIDATION_ERROR';
    case 429:
      return 'RATE_LIMITED';
    default:
      return 'INTERNAL';
  }
}
