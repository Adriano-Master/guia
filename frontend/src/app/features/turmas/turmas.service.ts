import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import type { Paginated } from '../../core/auth/auth.models';
import type { Turma, TurmasListParams } from './turmas.models';

const API = '/api/v1';

interface TurmaResponse {
  turma: Turma;
}
interface CodigoConviteResponse {
  codigoConvite: string;
}

@Injectable({ providedIn: 'root' })
export class TurmasService {
  private readonly http = inject(HttpClient);

  list(params: TurmasListParams): Observable<Paginated<Turma>> {
    let httpParams = new HttpParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        httpParams = httpParams.set(key, String(value));
      }
    }
    return this.http.get<Paginated<Turma>>(`${API}/turmas`, { params: httpParams });
  }

  get(id: string): Observable<Turma> {
    return this.http.get<TurmaResponse>(`${API}/turmas/${id}`).pipe(map((res) => res.turma));
  }

  create(payload: { nome: string; descricao?: string }): Observable<Turma> {
    return this.http.post<TurmaResponse>(`${API}/turmas`, payload).pipe(map((res) => res.turma));
  }

  update(
    id: string,
    payload: { nome?: string; descricao?: string; ativa?: boolean },
  ): Observable<Turma> {
    return this.http
      .patch<TurmaResponse>(`${API}/turmas/${id}`, payload)
      .pipe(map((res) => res.turma));
  }

  /** Invalida o código anterior (RN-02); matrículas existentes permanecem. */
  regenerarCodigo(id: string): Observable<string> {
    return this.http
      .post<CodigoConviteResponse>(`${API}/turmas/${id}/regenerar-codigo`, {})
      .pipe(map((res) => res.codigoConvite));
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${API}/turmas/${id}`);
  }
}
