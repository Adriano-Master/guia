import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { extractApiError } from '../../core/http/api-error';
import type { AgruparPor, DesempenhoQuestoesAgregado } from './estatisticas.models';
import { EstatisticasService } from './estatisticas.service';

/**
 * Tabela de desempenho em questões (US-05, CA-05) — GET
 * /estatisticas/desempenho-questoes. A tabela É a alternativa textual do
 * desempenho: taxa sempre em número, agrupável por disciplina ou tema.
 */
@Component({
  selector: 'app-tabela-desempenho-questoes',
  imports: [DecimalPipe, FormsModule],
  template: `
    <div class="field tdq__filtro">
      <label for="tdq-agrupar">Agrupar por</label>
      <select id="tdq-agrupar" [ngModel]="agruparPor()" (ngModelChange)="setAgruparPor($event)">
        <option value="disciplina">Disciplina</option>
        <option value="tema">Tema</option>
      </select>
    </div>

    @if (error()) {
      <p class="alert alert--error" role="alert">{{ error() }}</p>
    }

    @if (loading()) {
      <p class="tdq__state">Carregando desempenho…</p>
    } @else if (result(); as res) {
      @if (res.total === 0) {
        <p class="tdq__state">Nenhuma questão registrada ainda.</p>
      } @else {
        <div class="tdq__scroll">
          <table class="table">
            <thead>
              <tr>
                <th scope="col">{{ agruparPor() === 'tema' ? 'Tema' : 'Disciplina' }}</th>
                <th scope="col" class="tdq__num">Questões</th>
                <th scope="col" class="tdq__num">Erros</th>
                <th scope="col" class="tdq__num">Taxa de erro</th>
              </tr>
            </thead>
            <tbody>
              @for (grupo of grupos(); track grupo.disciplinaId ?? grupo.temaId ?? grupo.nome) {
                <tr>
                  <td class="tdq__nome">{{ grupo.nome }}</td>
                  <td class="tdq__num">{{ grupo.total }}</td>
                  <td class="tdq__num">{{ grupo.erros }}</td>
                  <td class="tdq__num">{{ grupo.taxaErro * 100 | number: '1.0-1' }}%</td>
                </tr>
              }
            </tbody>
            <tfoot>
              <tr class="tdq__total">
                <th scope="row">Total</th>
                <td class="tdq__num">{{ res.total }}</td>
                <td class="tdq__num">{{ res.erros }}</td>
                <td class="tdq__num">{{ res.taxaErro * 100 | number: '1.0-1' }}%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      }
    }
  `,
  styles: `
    .tdq__filtro {
      max-width: 14rem;
      margin-bottom: 0.75rem;
    }
    .tdq__state {
      margin: 0;
      padding: 1.5rem 0;
      text-align: center;
      color: var(--text-secondary);
    }
    /* Tabela dentro do card da página: sem vidro próprio (§6), só scroll. */
    .tdq__scroll {
      overflow-x: auto;
    }
    .tdq__nome {
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .tdq__num {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .tdq__total {
      th,
      td {
        border-top: 1px solid var(--glass-border);
        border-bottom: none;
        font-weight: 700;
        color: var(--text-primary);
      }

      th {
        font-size: 0.9375rem;
        text-transform: none;
        letter-spacing: normal;
        text-align: left;
      }
    }
  `,
})
export class TabelaDesempenhoQuestoes {
  private readonly estatisticasService = inject(EstatisticasService);

  readonly agruparPor = signal<AgruparPor>('disciplina');

  readonly result = signal<DesempenhoQuestoesAgregado | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly grupos = computed(() => this.result()?.data ?? []);

  /** Guarda de staleness: respostas de um load antigo não sobrescrevem o atual. */
  private loadSeq = 0;

  constructor() {
    this.load();
  }

  setAgruparPor(valor: AgruparPor): void {
    this.agruparPor.set(valor);
    this.load();
  }

  load(): void {
    const seq = ++this.loadSeq;
    this.loading.set(true);
    this.error.set(null);
    this.estatisticasService.desempenhoQuestoes(this.agruparPor()).subscribe({
      next: (res) => {
        if (seq !== this.loadSeq) return;
        this.result.set(res);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        if (seq !== this.loadSeq) return;
        this.loading.set(false);
        this.error.set(extractApiError(err).message);
      },
    });
  }
}
