import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';

import { extractApiError } from '../../core/http/api-error';
import { AnelProgresso } from './anel-progresso';
import type { HorasPorDisciplina, ResumoEstatisticas } from './estatisticas.models';
import { EstatisticasService } from './estatisticas.service';
import { GraficoBarrasHoras } from './grafico-barras-horas';
import { GraficoSerieTemporal } from './grafico-serie-temporal';
import { TabelaDesempenhoQuestoes } from './tabela-desempenho-questoes';

/**
 * Dashboard de estatísticas do aluno: cartões de resumo (números-herói em
 * texto), anel de progresso, barras de horas por disciplina, série temporal
 * e tabela de desempenho em questões. Somente leitura — tudo é agregação
 * sobre o que o aluno já registrou.
 */
@Component({
  selector: 'app-estatisticas-page',
  imports: [
    DecimalPipe,
    RouterLink,
    AnelProgresso,
    GraficoBarrasHoras,
    GraficoSerieTemporal,
    TabelaDesempenhoQuestoes,
  ],
  template: `
    <section class="stats">
      <h1>Estatísticas</h1>

      @if (loading()) {
        <p class="stats__state">Carregando estatísticas…</p>
      } @else if (error()) {
        <p class="alert alert--error" role="alert">{{ error() }}</p>
      } @else if (resumo(); as res) {
        <div class="stats__cards">
          <div class="card stats__card">
            <h2>Horas totais</h2>
            <p class="stats__hero">{{ res.horasTotais | number: '1.0-1' }} h</p>
            <p class="stats__sub">somando as sessões de estudo finalizadas</p>
          </div>
          <div class="card stats__card">
            <h2>Progresso</h2>
            <app-anel-progresso
              [percentual]="res.progresso.percentual"
              [label]="
                'Progresso do plano ativo: ' +
                res.progresso.concluidos +
                ' de ' +
                res.progresso.totalSubtemas +
                ' subtemas concluídos'
              "
            />
            <p class="stats__sub">
              {{ res.progresso.concluidos }} de {{ res.progresso.totalSubtemas }} subtemas
              concluídos
            </p>
          </div>
          <div class="card stats__card">
            <h2>Questões</h2>
            <p class="stats__hero">{{ res.questoes.total }}</p>
            <p class="stats__sub">
              {{ res.questoes.erros }} erros — taxa de
              {{ res.questoes.taxaErro * 100 | number: '1.0-1' }}%
            </p>
          </div>
        </div>

        @if (semDados()) {
          <div class="card stats__empty">
            <p>
              Você ainda não tem dados por aqui. Registre sessões de estudo e questões para
              acompanhar sua evolução.
            </p>
            <a class="btn btn--primary btn--sm" routerLink="/sessoes">Começar a estudar</a>
          </div>
        } @else {
          <div class="card stats__panel">
            <h2>Horas por disciplina</h2>
            <app-grafico-barras-horas [data]="horas()?.data ?? []" />
          </div>

          <div class="card stats__panel">
            <h2>Evolução das horas de estudo</h2>
            <app-grafico-serie-temporal />
          </div>

          <div class="card stats__panel">
            <h2>Desempenho em questões</h2>
            <app-tabela-desempenho-questoes />
          </div>
        }
      }
    </section>
  `,
  styles: `
    .stats {
      display: grid;
      gap: 1rem;
      max-width: 64rem;
      margin: 0 auto;

      h1 {
        margin: 0;
        font-size: 1.5rem;
      }
    }
    .stats__state {
      margin: 0;
      padding: 2rem 0;
      text-align: center;
      color: var(--text-secondary);
    }
    .stats__cards {
      display: grid;
      gap: 1rem;
      grid-template-columns: 1fr;

      @media (min-width: 640px) {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }
    .stats__card {
      display: grid;
      gap: 0.5rem;
      align-content: start;
      justify-items: start;

      h2 {
        margin: 0;
        font-size: 0.9375rem;
        font-weight: 600;
        color: var(--text-secondary);
      }
    }
    /* Número-herói sempre em texto (tokens) — sem gráfico dentro do cartão. */
    .stats__hero {
      margin: 0;
      font-size: 2rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      color: var(--text-primary);
    }
    .stats__sub {
      margin: 0;
      font-size: 0.875rem;
      color: var(--text-secondary);
    }
    .stats__empty {
      display: grid;
      gap: 0.75rem;
      justify-items: start;

      p {
        margin: 0;
        color: var(--text-secondary);
      }
    }
    .stats__panel {
      display: grid;
      gap: 0.75rem;

      h2 {
        margin: 0;
        font-size: 1.125rem;
      }
    }
  `,
})
export default class EstatisticasPage {
  private readonly estatisticasService = inject(EstatisticasService);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly resumo = signal<ResumoEstatisticas | null>(null);
  readonly horas = signal<HorasPorDisciplina | null>(null);

  /** Sem sessões, sem questões e sem subtemas concluídos → CTA no lugar dos gráficos. */
  readonly semDados = computed(() => {
    const res = this.resumo();
    if (!res) return false;
    return res.horasTotais === 0 && res.questoes.total === 0 && res.progresso.concluidos === 0;
  });

  constructor() {
    forkJoin([
      this.estatisticasService.resumo(),
      this.estatisticasService.horasPorDisciplina(),
    ]).subscribe({
      next: ([resumo, horas]) => {
        this.resumo.set(resumo);
        this.horas.set(horas);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.error.set(extractApiError(err).message);
      },
    });
  }
}
