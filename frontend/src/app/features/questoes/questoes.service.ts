import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import type { Paginated } from '../../core/auth/auth.models';
import type {
  CreateRegistroInput,
  Desempenho,
  DesempenhoParams,
  QuestoesListParams,
  RegistroQuestoes,
  UpdateRegistroInput,
} from './questoes.models';

const API = '/api/v1';

interface RegistroResponse {
  registro: RegistroQuestoes;
}

@Injectable({ providedIn: 'root' })
export class QuestoesService {
  private readonly http = inject(HttpClient);

  create(input: CreateRegistroInput): Observable<RegistroQuestoes> {
    return this.http
      .post<RegistroResponse>(`${API}/questoes`, input)
      .pipe(map((res) => res.registro));
  }

  list(params: QuestoesListParams): Observable<Paginated<RegistroQuestoes>> {
    return this.http.get<Paginated<RegistroQuestoes>>(`${API}/questoes`, {
      params: toHttpParams(params),
    });
  }

  get(id: string): Observable<RegistroQuestoes> {
    return this.http
      .get<RegistroResponse>(`${API}/questoes/${id}`)
      .pipe(map((res) => res.registro));
  }

  update(id: string, input: UpdateRegistroInput): Observable<RegistroQuestoes> {
    return this.http
      .patch<RegistroResponse>(`${API}/questoes/${id}`, input)
      .pipe(map((res) => res.registro));
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${API}/questoes/${id}`);
  }

  desempenho(params: DesempenhoParams = {}): Observable<Desempenho> {
    return this.http.get<Desempenho>(`${API}/questoes/desempenho`, {
      params: toHttpParams(params),
    });
  }
}

function toHttpParams(params: QuestoesListParams | DesempenhoParams): HttpParams {
  let httpParams = new HttpParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      httpParams = httpParams.set(key, String(value));
    }
  }
  return httpParams;
}
