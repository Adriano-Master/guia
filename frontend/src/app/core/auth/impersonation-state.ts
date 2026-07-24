import { signal } from '@angular/core';

/**
 * Chaves e sinais da impersonação compartilhados entre AuthService e
 * ImpersonationService. Vivem em módulo próprio (fora do DI) para o
 * AuthService poder limpá-los em login()/clearSession() sem dependência
 * circular com o ImpersonationService.
 */

export interface ImpersonationState {
  alunoNome: string;
  adminNome: string;
}

export const IMPERSONATION_BACKUP_KEY = 'guia.impersonation-backup';
export const IMPERSONATION_STATE_KEY = 'guia.impersonation';

export const impersonationStateSignal = signal<ImpersonationState | null>(null);

/** Aviso pós-impersonação exibido no shell (ex.: visualização expirada). */
export const impersonationAvisoSignal = signal<string | null>(null);

/** Remove backup + flag do localStorage e desativa o estado em memória. */
export function limparImpersonacao(): void {
  localStorage.removeItem(IMPERSONATION_BACKUP_KEY);
  localStorage.removeItem(IMPERSONATION_STATE_KEY);
  impersonationStateSignal.set(null);
}
