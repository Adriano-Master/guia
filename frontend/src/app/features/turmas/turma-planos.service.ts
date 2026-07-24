import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import type { Paginated } from '../../core/auth/auth.models';
import type { TurmaPlano } from './turmas.models';

const API = '/api/v1';

interface TurmaPlanoResponse {
  turmaPlano: TurmaPlano;
}

@Injectable({ providedIn: 'root' })
export class TurmaPlanosService {
  private readonly http = inject(HttpClient);

  /** RN-06: só plano OFICIAL publicado → senão 422; duplicado → 409. */
  vincular(turmaId: string, planoId: string): Observable<TurmaPlano> {
    return this.http
      .post<TurmaPlanoResponse>(`${API}/turmas/${turmaId}/planos`, { planoId })
      .pipe(map((res) => res.turmaPlano));
  }

  list(
    turmaId: string,
    params: { page?: number; pageSize?: number; sort?: string } = {},
  ): Observable<Paginated<TurmaPlano>> {
    let httpParams = new HttpParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        httpParams = httpParams.set(key, String(value));
      }
    }
    return this.http.get<Paginated<TurmaPlano>>(`${API}/turmas/${turmaId}/planos`, {
      params: httpParams,
    });
  }

  desvincular(turmaId: string, planoId: string): Observable<void> {
    return this.http.delete<void>(`${API}/turmas/${turmaId}/planos/${planoId}`);
  }
}
