import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import type { Paginated } from '../../core/auth/auth.models';
import type {
  Disciplina,
  PesoDisciplina,
  PesoInput,
  Plano,
  PlanoTipo,
  PlanoTree,
  PlanosListParams,
  Subtema,
  Tema,
} from './planos.models';

const API = '/api/v1';

interface PlanoResponse {
  plano: Plano;
}
interface PlanoTreeResponse {
  plano: PlanoTree;
}
interface DisciplinaResponse {
  disciplina: Disciplina;
}
interface TemaResponse {
  tema: Tema;
}
interface SubtemaResponse {
  subtema: Subtema;
}
interface PesosResponse {
  pesos: PesoDisciplina[];
}

@Injectable({ providedIn: 'root' })
export class PlanosService {
  private readonly http = inject(HttpClient);

  list(params: PlanosListParams): Observable<Paginated<Plano>> {
    let httpParams = new HttpParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        httpParams = httpParams.set(key, String(value));
      }
    }
    return this.http.get<Paginated<Plano>>(`${API}/planos`, { params: httpParams });
  }

  get(id: string): Observable<PlanoTree> {
    return this.http
      .get<PlanoTreeResponse>(`${API}/planos/${id}`)
      .pipe(map((res) => sortTree(res.plano)));
  }

  create(payload: { titulo: string; descricao?: string; tipo: PlanoTipo }): Observable<Plano> {
    return this.http.post<PlanoResponse>(`${API}/planos`, payload).pipe(map((res) => res.plano));
  }

  update(id: string, payload: { titulo?: string; descricao?: string }): Observable<Plano> {
    return this.http
      .patch<PlanoResponse>(`${API}/planos/${id}`, payload)
      .pipe(map((res) => res.plano));
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${API}/planos/${id}`);
  }

  publicar(id: string): Observable<Plano> {
    return this.http
      .post<PlanoResponse>(`${API}/planos/${id}/publicar`, {})
      .pipe(map((res) => res.plano));
  }

  derivar(id: string, titulo?: string): Observable<Plano> {
    return this.http
      .post<PlanoResponse>(`${API}/planos/${id}/derivar`, titulo ? { titulo } : {})
      .pipe(map((res) => res.plano));
  }

  createDisciplina(
    planoId: string,
    payload: { nome: string; ordem: number },
  ): Observable<Disciplina> {
    return this.http
      .post<DisciplinaResponse>(`${API}/planos/${planoId}/disciplinas`, payload)
      .pipe(map((res) => res.disciplina));
  }

  updateDisciplina(id: string, payload: { nome?: string; ordem?: number }): Observable<Disciplina> {
    return this.http
      .patch<DisciplinaResponse>(`${API}/disciplinas/${id}`, payload)
      .pipe(map((res) => res.disciplina));
  }

  deleteDisciplina(id: string): Observable<void> {
    return this.http.delete<void>(`${API}/disciplinas/${id}`);
  }

  createTema(disciplinaId: string, payload: { nome: string; ordem: number }): Observable<Tema> {
    return this.http
      .post<TemaResponse>(`${API}/disciplinas/${disciplinaId}/temas`, payload)
      .pipe(map((res) => res.tema));
  }

  updateTema(id: string, payload: { nome?: string; ordem?: number }): Observable<Tema> {
    return this.http
      .patch<TemaResponse>(`${API}/temas/${id}`, payload)
      .pipe(map((res) => res.tema));
  }

  deleteTema(id: string): Observable<void> {
    return this.http.delete<void>(`${API}/temas/${id}`);
  }

  createSubtema(
    temaId: string,
    payload: { nome: string; ordem: number; duracaoEstimadaMin?: number },
  ): Observable<Subtema> {
    return this.http
      .post<SubtemaResponse>(`${API}/temas/${temaId}/subtemas`, payload)
      .pipe(map((res) => res.subtema));
  }

  updateSubtema(
    id: string,
    payload: { nome?: string; ordem?: number; duracaoEstimadaMin?: number | null },
  ): Observable<Subtema> {
    return this.http
      .patch<SubtemaResponse>(`${API}/subtemas/${id}`, payload)
      .pipe(map((res) => res.subtema));
  }

  deleteSubtema(id: string): Observable<void> {
    return this.http.delete<void>(`${API}/subtemas/${id}`);
  }

  getPesos(planoId: string): Observable<PesoDisciplina[]> {
    return this.http
      .get<PesosResponse>(`${API}/planos/${planoId}/pesos`)
      .pipe(map((res) => res.pesos));
  }

  setPesos(planoId: string, pesos: PesoInput[]): Observable<PesoDisciplina[]> {
    return this.http
      .put<PesosResponse>(`${API}/planos/${planoId}/pesos`, { pesos })
      .pipe(map((res) => res.pesos));
  }
}

/** Ordena a árvore por `ordem` (RN-07) sem depender da ordenação do backend. */
function sortTree(plano: PlanoTree): PlanoTree {
  const byOrdem = <T extends { ordem: number }>(items: T[]): T[] =>
    [...(items ?? [])].sort((a, b) => a.ordem - b.ordem);
  return {
    ...plano,
    pesos: plano.pesos ?? [],
    disciplinas: byOrdem(plano.disciplinas ?? []).map((d) => ({
      ...d,
      temas: byOrdem(d.temas ?? []).map((t) => ({
        ...t,
        subtemas: byOrdem(t.subtemas ?? []),
      })),
    })),
  };
}
