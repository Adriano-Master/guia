import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, of, catchError, shareReplay, tap } from 'rxjs';

import { extractApiError } from '../../core/http/api-error';
import type { Bloco, BlocoStatus, Cronograma, GerarCronogramaInput } from './cronograma.models';

const API = '/api/v1';

interface CronogramaResponse {
  cronograma: Cronograma;
}
interface BlocosResponse {
  blocos: Bloco[];
}
interface BlocoResponse {
  bloco: Bloco;
}

/**
 * Prioridade de auto-seleção de plano nos módulos (depois do query
 * param/prefill da própria página): plano do cronograma ativo SE estiver
 * entre os planos acessíveis carregados → senão, o plano único.
 */
export function planoPadraoEntre(
  planos: readonly { id: string }[],
  padraoId: string | null,
): string | null {
  if (padraoId && planos.some((p) => p.id === padraoId)) return padraoId;
  return planos.length === 1 ? planos[0].id : null;
}

@Injectable({ providedIn: 'root' })
export class CronogramaService {
  private readonly http = inject(HttpClient);

  /** Cache por sessão de navegação do planoId do cronograma ativo. */
  private planoPadrao$: Observable<string | null> | null = null;

  gerar(input: GerarCronogramaInput): Observable<Cronograma> {
    return this.http.post<CronogramaResponse>(`${API}/cronogramas`, input).pipe(
      map((res) => res.cronograma),
      // Novo cronograma → o plano padrão passa a ser o dele (invalida o cache
      // com o valor fresco, sem novo GET).
      tap((cronograma) => {
        this.planoPadrao$ = of(cronograma.planoId);
      }),
    );
  }

  getAtivo(): Observable<Cronograma> {
    return this.http
      .get<CronogramaResponse>(`${API}/cronogramas/ativo`)
      .pipe(map((res) => res.cronograma));
  }

  /**
   * Plano do cronograma ativo do aluno como SELEÇÃO PADRÃO nos módulos
   * (Estudar/Progresso/Questões/config do cronograma). 404 (sem cronograma)
   * → null, cacheado; outros erros também emitem null, mas sem cachear (a
   * próxima chamada tenta de novo) — o padrão é conveniência, nunca bloqueia
   * a página. Nunca erra: seguro para forkJoin com outras chamadas.
   */
  planoPadraoId(): Observable<string | null> {
    this.planoPadrao$ ??= this.getAtivo().pipe(
      map((cronograma) => cronograma.planoId),
      catchError((err: unknown) => {
        if (extractApiError(err).code !== 'NOT_FOUND') this.planoPadrao$ = null;
        return of(null);
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    return this.planoPadrao$;
  }

  listBlocos(cronogramaId: string, from?: string, to?: string): Observable<Bloco[]> {
    let params = new HttpParams();
    if (from) params = params.set('from', from);
    if (to) params = params.set('to', to);
    return this.http
      .get<BlocosResponse>(`${API}/cronogramas/${cronogramaId}/blocos`, { params })
      .pipe(map((res) => res.blocos));
  }

  updateBlocoStatus(blocoId: string, status: BlocoStatus): Observable<Bloco> {
    return this.http
      .patch<BlocoResponse>(`${API}/blocos/${blocoId}`, { status })
      .pipe(map((res) => res.bloco));
  }
}
