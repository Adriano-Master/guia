import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import type { Paginated } from '../../core/auth/auth.models';
import type { MinhaPontuacao, RankingEntry, RankingListParams } from './gamificacao.models';

const API = '/api/v1/ranking';

@Injectable({ providedIn: 'root' })
export class RankingService {
  private readonly http = inject(HttpClient);

  global(params: RankingListParams = {}): Observable<Paginated<RankingEntry>> {
    return this.http.get<Paginated<RankingEntry>>(`${API}/global`, {
      params: toHttpParams(params),
    });
  }

  /** 403 sem matrícula ATIVA / não-professor da turma; 404 turma inexistente (CA-05). */
  porTurma(turmaId: string, params: RankingListParams = {}): Observable<Paginated<RankingEntry>> {
    return this.http.get<Paginated<RankingEntry>>(`${API}/turmas/${turmaId}`, {
      params: toHttpParams(params),
    });
  }

  me(): Observable<MinhaPontuacao> {
    return this.http.get<MinhaPontuacao>(`${API}/me`);
  }
}

function toHttpParams(params: RankingListParams): HttpParams {
  let httpParams = new HttpParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      httpParams = httpParams.set(key, String(value));
    }
  }
  return httpParams;
}
