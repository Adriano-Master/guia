import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import type { Paginated } from '../../core/auth/auth.models';
import type { Matricula, MatriculaStatus, MatriculasListParams } from './turmas.models';

const API = '/api/v1';

interface MatriculaResponse {
  matricula: Matricula;
}

@Injectable({ providedIn: 'root' })
export class MatriculasService {
  private readonly http = inject(HttpClient);

  /**
   * Matrícula por código (só ALUNO). 201 criada / 200 reativada — o corpo é o
   * mesmo. Erros: 404 código inválido, 409 turma inativa ou já matriculado.
   */
  matricular(codigoConvite: string): Observable<Matricula> {
    return this.http
      .post<MatriculaResponse>(`${API}/matriculas`, { codigoConvite })
      .pipe(map((res) => res.matricula));
  }

  listMe(params: MatriculasListParams): Observable<Paginated<Matricula>> {
    return this.http.get<Paginated<Matricula>>(`${API}/matriculas/me`, {
      params: toHttpParams(params),
    });
  }

  listByTurma(turmaId: string, params: MatriculasListParams): Observable<Paginated<Matricula>> {
    return this.http.get<Paginated<Matricula>>(`${API}/turmas/${turmaId}/matriculas`, {
      params: toHttpParams(params),
    });
  }

  /** Dono da turma (remover/readmitir) ou o próprio aluno (sair). */
  updateStatus(id: string, status: MatriculaStatus): Observable<Matricula> {
    return this.http
      .patch<MatriculaResponse>(`${API}/matriculas/${id}`, { status })
      .pipe(map((res) => res.matricula));
  }
}

function toHttpParams(params: MatriculasListParams): HttpParams {
  let httpParams = new HttpParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      httpParams = httpParams.set(key, String(value));
    }
  }
  return httpParams;
}
