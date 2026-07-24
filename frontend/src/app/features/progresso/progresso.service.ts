import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import type {
  ProgressoMarcacao,
  ProgressoPlano,
  ProgressoSubtemaFlat,
  ProgressoSubtemasListParams,
} from './progresso.models';

const API = '/api/v1';

interface SubtemasResponse {
  subtemas: ProgressoSubtemaFlat[];
}

@Injectable({ providedIn: 'root' })
export class ProgressoService {
  private readonly http = inject(HttpClient);

  /** Upsert idempotente (PUT); 404 subtema inexistente, 403 fora do escopo. */
  setConcluido(subtemaId: string, concluido: boolean): Observable<ProgressoMarcacao> {
    return this.http.put<ProgressoMarcacao>(`${API}/progresso/subtemas/${subtemaId}`, {
      concluido,
    });
  }

  getPlano(planoId: string): Observable<ProgressoPlano> {
    return this.http.get<ProgressoPlano>(`${API}/progresso/planos/${planoId}`);
  }

  listSubtemas(params: ProgressoSubtemasListParams): Observable<ProgressoSubtemaFlat[]> {
    let httpParams = new HttpParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        httpParams = httpParams.set(key, String(value));
      }
    }
    return this.http
      .get<SubtemasResponse>(`${API}/progresso/subtemas`, { params: httpParams })
      .pipe(map((res) => res.subtemas));
  }
}
