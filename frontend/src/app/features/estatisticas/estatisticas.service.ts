import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import type {
  AgruparPor,
  DesempenhoQuestoesAgregado,
  HorasPorDisciplina,
  PeriodoParams,
  ProgressoEstatisticas,
  ResumoEstatisticas,
  SerieTemporal,
  SerieTemporalParams,
} from './estatisticas.models';

const API = '/api/v1/estatisticas';

@Injectable({ providedIn: 'root' })
export class EstatisticasService {
  private readonly http = inject(HttpClient);

  resumo(): Observable<ResumoEstatisticas> {
    return this.http.get<ResumoEstatisticas>(`${API}/resumo`);
  }

  horasPorDisciplina(params: PeriodoParams = {}): Observable<HorasPorDisciplina> {
    return this.http.get<HorasPorDisciplina>(`${API}/horas-por-disciplina`, {
      params: toHttpParams(params),
    });
  }

  serieTemporal(params: SerieTemporalParams = {}): Observable<SerieTemporal> {
    return this.http.get<SerieTemporal>(`${API}/serie-temporal`, {
      params: toHttpParams(params),
    });
  }

  progresso(porDisciplina = false): Observable<ProgressoEstatisticas> {
    return this.http.get<ProgressoEstatisticas>(`${API}/progresso`, {
      params: toHttpParams(porDisciplina ? { porDisciplina: 'true' } : {}),
    });
  }

  desempenhoQuestoes(agruparPor?: AgruparPor): Observable<DesempenhoQuestoesAgregado> {
    return this.http.get<DesempenhoQuestoesAgregado>(`${API}/desempenho-questoes`, {
      params: toHttpParams({ agruparPor }),
    });
  }
}

function toHttpParams(
  params: PeriodoParams | SerieTemporalParams | Record<string, string | undefined>,
): HttpParams {
  let httpParams = new HttpParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      httpParams = httpParams.set(key, value);
    }
  }
  return httpParams;
}
