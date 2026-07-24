import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, map } from 'rxjs';

import type { Role, User } from './auth.models';
import { AuthService } from './auth.service';
import type { ImpersonationState } from './impersonation-state';
import {
  IMPERSONATION_BACKUP_KEY,
  IMPERSONATION_STATE_KEY,
  impersonationAvisoSignal,
  impersonationStateSignal,
  limparImpersonacao,
} from './impersonation-state';
import { TokenStorage, decodeJwtPayload } from './token-storage';

export type { ImpersonationState } from './impersonation-state';

export const AVISO_IMPERSONACAO_EXPIRADA =
  'A visualização expirou. Você voltou ao seu perfil de admin.';

interface ImpersonationBackup {
  accessToken: string;
  refreshToken: string;
  user: User;
}

interface ImpersonateResponse {
  accessToken: string;
  user: { id: string; nome: string; email: string; role: Role };
}

/**
 * Modo de visualização de aluno (ADMIN): troca a sessão local pela do aluno
 * (token de ALUNO sem refresh, ~15min, somente leitura no backend) guardando
 * a sessão do admin em backup no localStorage. Sobrevive a F5; se o token do
 * aluno expirar (401 no interceptor ou já no boot), restaura o admin com aviso.
 * Estado/aviso vivem em impersonation-state.ts para o AuthService poder
 * limpá-los em login()/clearSession() sem dependência circular.
 */
@Injectable({ providedIn: 'root' })
export class ImpersonationService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly tokens = inject(TokenStorage);
  private readonly router = inject(Router);

  readonly state = impersonationStateSignal.asReadonly();
  readonly ativo = computed(() => impersonationStateSignal() !== null);
  readonly aviso = impersonationAvisoSignal.asReadonly();

  constructor() {
    impersonationAvisoSignal.set(null);
    impersonationStateSignal.set(this.restore());
  }

  entrar(aluno: User): Observable<void> {
    return this.http
      .post<ImpersonateResponse>(`/api/v1/users/${aluno.id}/impersonate`, {})
      .pipe(map((res) => this.ativar(aluno, res)));
  }

  /** Restaura a sessão do admin; com `aviso`, exibe-o no shell após voltar. */
  sair(aviso?: string): void {
    const backup = this.readBackup();
    limparImpersonacao();
    if (!backup) {
      // backup perdido/corrompido: sem como voltar ao admin — sessão encerra
      // (clearSession também zera o aviso: nada vaza para o próximo login)
      this.auth.clearSession();
      this.auth.redirectToLogin();
      return;
    }
    this.tokens.setTokens(backup.accessToken, backup.refreshToken);
    this.auth.setUser(backup.user);
    impersonationAvisoSignal.set(aviso ?? null);
    void this.router.navigate(['/admin/usuarios']);
  }

  limparAviso(): void {
    impersonationAvisoSignal.set(null);
  }

  private ativar(aluno: User, res: ImpersonateResponse): void {
    const admin = this.auth.currentUser();
    const accessToken = this.tokens.accessToken;
    const refreshToken = this.tokens.refreshToken;
    if (!admin || !accessToken || !refreshToken) {
      // sessão local incompleta: sem backup íntegro não há como voltar ao
      // admin — erro no envelope padrão para a tela exibir via extractApiError
      throw new HttpErrorResponse({
        status: 409,
        error: {
          error: {
            code: 'IMPERSONATION_INVALID_SESSION',
            message:
              'Sua sessão de admin não está íntegra para iniciar a visualização. ' +
              'Faça login novamente.',
          },
        },
      });
    }

    const backup: ImpersonationBackup = { accessToken, refreshToken, user: admin };
    const state: ImpersonationState = { alunoNome: res.user.nome, adminNome: admin.nome };
    localStorage.setItem(IMPERSONATION_BACKUP_KEY, JSON.stringify(backup));
    localStorage.setItem(IMPERSONATION_STATE_KEY, JSON.stringify(state));

    this.tokens.setAccessTokenOnly(res.accessToken);
    this.auth.setUser({ ...aluno, ...res.user });
    impersonationStateSignal.set(state);
    impersonationAvisoSignal.set(null);
    void this.router.navigate(['/dashboard']);
  }

  /**
   * Reidratação no bootstrap. Só considera a impersonação ativa se a sessão
   * atual é de fato a impersonada: sem refresh token (impersonação nunca tem)
   * e com a claim `impersonatedBy` no access token. Chaves órfãs sobre uma
   * sessão real (ex.: login feito após um backup abandonado) são descartadas
   * sem tocar na sessão. Sem sessão utilizável, o token impersonado expirou:
   * restaura o admin do backup, sem navegar — os guards resolvem a rota.
   */
  private restore(): ImpersonationState | null {
    const state = this.parse<ImpersonationState>(IMPERSONATION_STATE_KEY);
    const backup = this.readBackup();
    if (!state || !backup) {
      if (state || backup) limparImpersonacao();
      return null;
    }
    if (this.tokens.refreshToken) {
      limparImpersonacao();
      return null;
    }
    const accessToken = this.tokens.accessToken;
    if (accessToken && !this.tokens.isAccessTokenExpired()) {
      if (decodeJwtPayload(accessToken)?.['impersonatedBy']) return state;
      limparImpersonacao();
      return null;
    }
    limparImpersonacao();
    this.tokens.setTokens(backup.accessToken, backup.refreshToken);
    this.auth.setUser(backup.user);
    impersonationAvisoSignal.set(AVISO_IMPERSONACAO_EXPIRADA);
    return null;
  }

  private readBackup(): ImpersonationBackup | null {
    const backup = this.parse<ImpersonationBackup>(IMPERSONATION_BACKUP_KEY);
    return backup?.accessToken && backup.refreshToken && backup.user ? backup : null;
  }

  private parse<T>(key: string): T | null {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
}
