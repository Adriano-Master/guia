import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import type { Paginated } from '../../core/auth/auth.models';
import type {
  ManualSessaoInput,
  Sessao,
  SessoesListParams,
  StartCronometroInput,
  UpdateSessaoInput,
} from './sessoes.models';

const API = '/api/v1';

interface SessaoResponse {
  sessao: Sessao;
}

@Injectable({ providedIn: 'root' })
export class SessaoService {
  private readonly http = inject(HttpClient);

  start(input: StartCronometroInput): Observable<Sessao> {
    return this.http
      .post<SessaoResponse>(`${API}/sessoes/cronometro/start`, input)
      .pipe(map((res) => res.sessao));
  }

  /** Reidratação do cronômetro (CB-3): 404 quando não há sessão em andamento. */
  getAtiva(): Observable<Sessao> {
    return this.http.get<SessaoResponse>(`${API}/sessoes/ativa`).pipe(map((res) => res.sessao));
  }

  pause(): Observable<Sessao> {
    return this.http
      .post<SessaoResponse>(`${API}/sessoes/ativa/pause`, {})
      .pipe(map((res) => res.sessao));
  }

  resume(): Observable<Sessao> {
    return this.http
      .post<SessaoResponse>(`${API}/sessoes/ativa/resume`, {})
      .pipe(map((res) => res.sessao));
  }

  stop(pausaMin: number): Observable<Sessao> {
    return this.http
      .post<SessaoResponse>(`${API}/sessoes/ativa/stop`, { pausaMin })
      .pipe(map((res) => res.sessao));
  }

  discard(): Observable<void> {
    return this.http.delete<void>(`${API}/sessoes/ativa`);
  }

  manual(input: ManualSessaoInput): Observable<Sessao> {
    return this.http
      .post<SessaoResponse>(`${API}/sessoes/manual`, input)
      .pipe(map((res) => res.sessao));
  }

  list(params: SessoesListParams): Observable<Paginated<Sessao>> {
    let httpParams = new HttpParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        httpParams = httpParams.set(key, String(value));
      }
    }
    return this.http.get<Paginated<Sessao>>(`${API}/sessoes`, { params: httpParams });
  }

  update(id: string, input: UpdateSessaoInput): Observable<Sessao> {
    return this.http
      .patch<SessaoResponse>(`${API}/sessoes/${id}`, input)
      .pipe(map((res) => res.sessao));
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${API}/sessoes/${id}`);
  }
}
