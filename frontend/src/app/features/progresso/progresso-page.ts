import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { forkJoin } from 'rxjs';

import { extractApiError } from '../../core/http/api-error';
import { CronogramaService, planoPadraoEntre } from '../cronograma/cronograma.service';
import type { Plano } from '../planos/planos.models';
import { PlanosService } from '../planos/planos.service';
import { ProgressoBarra } from './progresso-barra';
import type { ProgressoPlano, ProgressoSubtemaNode } from './progresso.models';
import { comSubtema } from './progresso.models';
import { ProgressoService } from './progresso.service';

/**
 * Página de progresso do aluno: indicador geral do plano + árvore
 * disciplina → tema → subtema com marcação de conclusão otimista (a UI
 * atualiza na hora recalculando os agregados a partir das folhas — mesma
 * regra do backend — e o PUT confirma/reverte em seguida).
 */
@Component({
  selector: 'app-progresso-page',
  imports: [FormsModule, RouterLink, DatePipe, DecimalPipe, ProgressoBarra],
  template: `
    <section class="prog">
      <h1>Progresso</h1>

      @if (planoError()) {
        <p class="alert alert--error" role="alert">{{ planoError() }}</p>
      }

      <div class="field prog__plano">
        <label for="prog-plano">Plano de estudo</label>
        <select id="prog-plano" [ngModel]="planoId()" (ngModelChange)="setPlano($event)">
          <option value="" disabled>
            {{ loadingPlanos() ? 'Carregando planos…' : 'Selecione um plano' }}
          </option>
          @for (plano of planos(); track plano.id) {
            <option [value]="plano.id">{{ plano.titulo }} ({{ plano.tipo }})</option>
          }
        </select>
        <span class="field__hint"
          >O progresso é calculado sobre os subtemas do plano escolhido.</span
        >
      </div>

      @if (!planoId()) {
        <p class="prog__state">Selecione um plano para acompanhar seu progresso.</p>
      } @else if (loadingTree()) {
        <p class="prog__state">Carregando progresso…</p>
      } @else if (treeError()) {
        <p class="alert alert--error prog__tree-error" role="alert">{{ treeError() }}</p>
      } @else if (tree(); as plano) {
        @if (plano.subtemasTotais === 0) {
          <div class="card prog__empty">
            <p>Este plano ainda não tem subtemas para acompanhar.</p>
            <a class="btn btn--outline btn--sm" [routerLink]="['/planos', plano.planoId]">
              Ver conteúdo do plano
            </a>
          </div>
        } @else {
          <div class="card prog__resumo">
            <div class="prog__resumo-header">
              <h2>Progresso geral</h2>
              <span class="prog__pct prog__pct--geral">
                {{ plano.progressoPercentual | number: '1.0-1' }}%
              </span>
            </div>
            <app-progresso-barra
              [valor]="plano.progressoPercentual"
              [label]="
                'Progresso do plano: ' +
                plano.subtemasConcluidos +
                ' de ' +
                plano.subtemasTotais +
                ' subtemas concluídos'
              "
            />
            <p class="prog__resumo-contagem" aria-live="polite">
              <strong>{{ plano.subtemasConcluidos }}</strong> de
              <strong>{{ plano.subtemasTotais }}</strong> subtemas concluídos
            </p>
          </div>

          <label class="prog__filtro">
            <input
              type="checkbox"
              [checked]="apenasPendentes()"
              (change)="toggleApenasPendentes()"
            />
            <span>Mostrar apenas pendentes</span>
          </label>

          @if (toggleError()) {
            <p class="alert alert--error prog__toggle-error" role="alert">{{ toggleError() }}</p>
          }

          @if (apenasPendentes() && viewDisciplinas().length === 0) {
            <p class="prog__state">
              Nenhum subtema pendente — você concluiu todo o conteúdo deste plano.
            </p>
          }

          <ul class="prog__disciplinas">
            @for (disciplina of viewDisciplinas(); track disciplina.disciplinaId) {
              <li class="card card--flat prog__disciplina">
                <button
                  class="prog__node"
                  type="button"
                  [attr.aria-expanded]="isDisciplinaExpanded(disciplina.disciplinaId)"
                  [attr.aria-controls]="
                    isDisciplinaExpanded(disciplina.disciplinaId)
                      ? 'prog-disc-' + disciplina.disciplinaId
                      : null
                  "
                  (click)="toggleDisciplina(disciplina.disciplinaId)"
                >
                  <span class="prog__chevron" aria-hidden="true">
                    {{ isDisciplinaExpanded(disciplina.disciplinaId) ? '▾' : '▸' }}
                  </span>
                  <span class="prog__nome">{{ disciplina.nome }}</span>
                  <span class="prog__contagem">
                    {{ disciplina.concluidos }}/{{ disciplina.totais }}
                  </span>
                  <span class="prog__pct">
                    {{ disciplina.progressoPercentual | number: '1.0-1' }}%
                  </span>
                </button>
                <app-progresso-barra
                  [valor]="disciplina.progressoPercentual"
                  [label]="
                    'Progresso da disciplina ' +
                    disciplina.nome +
                    ': ' +
                    disciplina.concluidos +
                    ' de ' +
                    disciplina.totais +
                    ' subtemas'
                  "
                />

                @if (isDisciplinaExpanded(disciplina.disciplinaId)) {
                  <ul class="prog__temas" [id]="'prog-disc-' + disciplina.disciplinaId">
                    @for (tema of disciplina.temas; track tema.temaId) {
                      <li class="prog__tema">
                        <button
                          class="prog__node prog__node--tema"
                          type="button"
                          [attr.aria-expanded]="isTemaExpanded(tema.temaId)"
                          [attr.aria-controls]="
                            isTemaExpanded(tema.temaId) ? 'prog-tema-' + tema.temaId : null
                          "
                          (click)="toggleTema(tema.temaId)"
                        >
                          <span class="prog__chevron" aria-hidden="true">
                            {{ isTemaExpanded(tema.temaId) ? '▾' : '▸' }}
                          </span>
                          <span class="prog__nome">{{ tema.nome }}</span>
                          <span class="prog__contagem">
                            {{ tema.concluidos }}/{{ tema.totais }}
                          </span>
                          <span class="prog__pct">
                            {{ tema.progressoPercentual | number: '1.0-1' }}%
                          </span>
                        </button>
                        <app-progresso-barra
                          [valor]="tema.progressoPercentual"
                          [label]="
                            'Progresso do tema ' +
                            tema.nome +
                            ': ' +
                            tema.concluidos +
                            ' de ' +
                            tema.totais +
                            ' subtemas'
                          "
                        />

                        @if (isTemaExpanded(tema.temaId)) {
                          <ul class="prog__subtemas" [id]="'prog-tema-' + tema.temaId">
                            @if (tema.subtemas.length === 0) {
                              <li class="prog__subtemas-empty">Este tema não tem subtemas.</li>
                            }
                            @for (subtema of tema.subtemas; track subtema.subtemaId) {
                              <li>
                                <label
                                  class="prog__subtema"
                                  [attr.title]="
                                    subtema.concluidoEm
                                      ? 'Concluído em ' +
                                        (subtema.concluidoEm | date: 'dd/MM/yyyy HH:mm')
                                      : null
                                  "
                                >
                                  <input
                                    type="checkbox"
                                    [checked]="subtema.concluido"
                                    [disabled]="isPendente(subtema.subtemaId)"
                                    (change)="toggleConclusao(subtema)"
                                    [attr.aria-label]="
                                      (subtema.concluido
                                        ? 'Desmarcar conclusão de '
                                        : 'Marcar como concluído: ') + subtema.nome
                                    "
                                  />
                                  <span
                                    class="prog__subtema-nome"
                                    [class.prog__subtema-nome--done]="subtema.concluido"
                                  >
                                    {{ subtema.nome }}
                                  </span>
                                </label>
                              </li>
                            }
                          </ul>
                        }
                      </li>
                    }
                  </ul>
                }
              </li>
            }
          </ul>
        }
      }
    </section>
  `,
  styles: `
    .prog {
      display: grid;
      gap: 1rem;
      max-width: 48rem;
      margin: 0 auto;

      h1 {
        margin: 0;
        font-size: 1.5rem;
      }
    }
    .prog__plano {
      max-width: 28rem;
      margin-bottom: 0;
    }
    .prog__state {
      margin: 0;
      color: var(--color-text-muted);
      text-align: center;
      padding: 2rem 0;
    }
    .prog__tree-error,
    .prog__toggle-error {
      margin-bottom: 0;
    }
    .prog__empty {
      display: grid;
      gap: 0.75rem;
      justify-items: start;

      p {
        margin: 0;
        color: var(--color-text-muted);
      }
    }
    .prog__resumo {
      display: grid;
      gap: 0.625rem;
    }
    .prog__resumo-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.5rem;

      h2 {
        margin: 0;
        font-size: 1.125rem;
      }
    }
    .prog__resumo-contagem {
      margin: 0;
      font-size: 0.9375rem;
      color: var(--color-text-muted);

      strong {
        color: var(--color-text);
      }
    }
    .prog__filtro {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      min-height: 44px;
      font-size: 0.9375rem;
      cursor: pointer;
      user-select: none;

      input {
        width: 1.25rem;
        height: 1.25rem;
        accent-color: var(--color-primary);
        cursor: pointer;
      }
    }
    .prog__disciplinas,
    .prog__temas,
    .prog__subtemas {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 0.5rem;
    }
    .prog__disciplinas {
      gap: 0.75rem;
    }
    .prog__disciplina {
      display: grid;
      gap: 0.5rem;
      padding: 1rem;
    }
    .prog__temas {
      margin-top: 0.5rem;
      padding-left: 0.75rem;
      border-left: 2px solid var(--color-border);
    }
    .prog__node {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      width: 100%;
      min-height: 44px;
      padding: 0 0.25rem;
      font: inherit;
      font-weight: 600;
      text-align: left;
      color: var(--color-text);
      background: transparent;
      border: none;
      border-radius: 0.5rem;
      cursor: pointer;

      &:hover {
        background: var(--color-background);
      }
      &:focus-visible {
        outline: 2px solid var(--color-primary);
        outline-offset: 2px;
      }
    }
    .prog__node--tema {
      font-weight: 500;
      font-size: 0.9375rem;
    }
    .prog__chevron {
      flex-shrink: 0;
      width: 1rem;
      color: var(--color-text-muted);
    }
    .prog__nome {
      flex: 1;
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .prog__contagem {
      flex-shrink: 0;
      font-size: 0.8125rem;
      font-weight: 400;
      color: var(--color-text-muted);
    }
    .prog__pct {
      flex-shrink: 0;
      min-width: 3.25rem;
      text-align: right;
      font-variant-numeric: tabular-nums;
      font-size: 0.875rem;
      color: var(--color-text-muted);
    }
    .prog__pct--geral {
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--color-primary);
    }
    .prog__tema {
      display: grid;
      gap: 0.375rem;
    }
    .prog__subtemas {
      margin-top: 0.25rem;
      padding-left: 1.5rem;
      gap: 0;
    }
    .prog__subtemas-empty {
      padding: 0.5rem 0;
      font-size: 0.875rem;
      color: var(--color-text-muted);
    }
    .prog__subtema {
      display: flex;
      align-items: center;
      gap: 0.625rem;
      min-height: 44px;
      padding: 0 0.25rem;
      border-radius: 0.5rem;
      font-size: 0.9375rem;
      cursor: pointer;

      &:hover {
        background: var(--color-background);
      }

      input {
        width: 1.25rem;
        height: 1.25rem;
        flex-shrink: 0;
        accent-color: var(--color-primary);
        cursor: pointer;

        &:disabled {
          cursor: wait;
        }
      }
    }
    .prog__subtema-nome {
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .prog__subtema-nome--done {
      color: var(--color-text-muted);
      text-decoration: line-through;
    }
  `,
})
export default class ProgressoPage {
  private readonly planosService = inject(PlanosService);
  private readonly cronogramaService = inject(CronogramaService);
  private readonly progressoService = inject(ProgressoService);
  private readonly destroyRef = inject(DestroyRef);

  readonly loadingPlanos = signal(true);
  readonly planoError = signal<string | null>(null);
  readonly planos = signal<Plano[]>([]);
  readonly planoId = signal('');

  readonly loadingTree = signal(false);
  readonly treeError = signal<string | null>(null);
  readonly tree = signal<ProgressoPlano | null>(null);

  readonly apenasPendentes = signal(false);
  readonly toggleError = signal<string | null>(null);

  private readonly expandedDisciplinas = signal<Set<string>>(new Set());
  private readonly expandedTemas = signal<Set<string>>(new Set());
  /** Subtemas com PUT em voo (evita toggles concorrentes no mesmo item). */
  private readonly pendentes = signal<Set<string>>(new Set());

  /**
   * Filtro "apenas pendentes" é local (a árvore já está carregada): remove os
   * subtemas concluídos e oculta temas/disciplinas sem pendências (100% ou
   * vazios) — nada acionável neles. Os contadores/percentuais exibidos seguem
   * sendo os agregados reais (não os filtrados), para não distorcer a leitura.
   */
  readonly viewDisciplinas = computed(() => {
    const tree = this.tree();
    if (!tree) return [];
    if (!this.apenasPendentes()) return tree.disciplinas;
    return tree.disciplinas
      .map((disciplina) => ({
        ...disciplina,
        temas: disciplina.temas
          .map((tema) => ({
            ...tema,
            subtemas: tema.subtemas.filter((subtema) => !subtema.concluido),
          }))
          .filter((tema) => tema.subtemas.length > 0),
      }))
      .filter((disciplina) => disciplina.temas.length > 0);
  });

  constructor() {
    // Auto-seleção: plano do cronograma ativo se acessível → senão plano
    // único. planoPadraoId() nunca erra (404 → null), seguro no forkJoin.
    forkJoin([
      this.planosService.list({ page: 1, pageSize: 100, sort: 'titulo' }),
      this.cronogramaService.planoPadraoId(),
    ])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ([res, padraoId]) => {
          this.planos.set(res.data);
          this.loadingPlanos.set(false);
          if (!this.planoId()) {
            const padrao = planoPadraoEntre(res.data, padraoId);
            if (padrao) this.setPlano(padrao);
          }
        },
        error: (err: unknown) => {
          this.loadingPlanos.set(false);
          this.planoError.set(extractApiError(err).message);
        },
      });
  }

  setPlano(id: string): void {
    this.planoId.set(id);
    this.tree.set(null);
    this.treeError.set(null);
    this.toggleError.set(null);
    this.loadingTree.set(false);
    if (!id) return;
    this.loadingTree.set(true);
    this.progressoService
      .getPlano(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (plano) => {
          // guarda de staleness: se o aluno já trocou de plano, a resposta
          // atrasada deste id não pode sobrescrever a árvore do plano atual
          if (id !== this.planoId()) return;
          this.loadingTree.set(false);
          this.tree.set(plano);
          // visão inicial: disciplinas abertas (mostram as barras dos temas),
          // temas fechados — o aluno expande onde quer marcar
          this.expandedDisciplinas.set(new Set(plano.disciplinas.map((d) => d.disciplinaId)));
          this.expandedTemas.set(new Set());
        },
        error: (err: unknown) => {
          if (id !== this.planoId()) return;
          this.loadingTree.set(false);
          this.treeError.set(extractApiError(err).message);
        },
      });
  }

  isDisciplinaExpanded(id: string): boolean {
    return this.expandedDisciplinas().has(id);
  }

  isTemaExpanded(id: string): boolean {
    return this.expandedTemas().has(id);
  }

  toggleDisciplina(id: string): void {
    this.expandedDisciplinas.set(toggleInSet(this.expandedDisciplinas(), id));
  }

  toggleTema(id: string): void {
    this.expandedTemas.set(toggleInSet(this.expandedTemas(), id));
  }

  /** Ao ativar o filtro, expande tudo para as pendências ficarem visíveis. */
  toggleApenasPendentes(): void {
    const ligando = !this.apenasPendentes();
    this.apenasPendentes.set(ligando);
    const tree = this.tree();
    if (ligando && tree) {
      this.expandedDisciplinas.set(new Set(tree.disciplinas.map((d) => d.disciplinaId)));
      this.expandedTemas.set(
        new Set(tree.disciplinas.flatMap((d) => d.temas.map((t) => t.temaId))),
      );
    }
  }

  isPendente(subtemaId: string): boolean {
    return this.pendentes().has(subtemaId);
  }

  toggleConclusao(subtema: ProgressoSubtemaNode): void {
    const tree = this.tree();
    if (!tree || this.isPendente(subtema.subtemaId)) return;

    const anterior = { concluido: subtema.concluido, concluidoEm: subtema.concluidoEm };
    const concluido = !subtema.concluido;
    // otimista: data provisória na marcação (o PUT devolve a definitiva);
    // remarcação preserva a original e desmarcação zera, como no backend
    const concluidoEm = concluido ? (subtema.concluidoEm ?? new Date().toISOString()) : null;

    this.toggleError.set(null);
    this.pendentes.set(new Set(this.pendentes()).add(subtema.subtemaId));
    this.tree.set(comSubtema(tree, subtema.subtemaId, { concluido, concluidoEm }));

    this.progressoService
      .setConcluido(subtema.subtemaId, concluido)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.liberarPendente(subtema.subtemaId);
          const atual = this.tree();
          if (atual) {
            this.tree.set(
              comSubtema(atual, res.subtemaId, {
                concluido: res.concluido,
                concluidoEm: res.concluidoEm,
              }),
            );
          }
        },
        error: (err: unknown) => {
          this.liberarPendente(subtema.subtemaId);
          const atual = this.tree();
          if (atual) this.tree.set(comSubtema(atual, subtema.subtemaId, anterior));
          this.toggleError.set(extractApiError(err).message);
        },
      });
  }

  private liberarPendente(subtemaId: string): void {
    const next = new Set(this.pendentes());
    next.delete(subtemaId);
    this.pendentes.set(next);
  }
}

function toggleInSet(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
