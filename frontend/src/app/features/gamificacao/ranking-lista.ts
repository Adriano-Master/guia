import { DecimalPipe } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';

import type { Paginated } from '../../core/auth/auth.models';
import type { RankingEntry } from './gamificacao.models';

/**
 * Lista paginada do ranking. Pódio (posições 1–3) destacado com borda em
 * --accent, mas a identidade nunca é só cor: o número da posição aparece
 * sempre, em todas as linhas. A linha do próprio aluno ganha o badge "Você".
 */
@Component({
  selector: 'app-ranking-lista',
  imports: [DecimalPipe],
  template: `
    <ul class="rlista">
      @for (entry of result().data; track entry.alunoId) {
        <li
          class="card card--flat rlista__item"
          [class.rlista__item--podio]="entry.posicao <= 3"
          [class.rlista__item--me]="entry.alunoId === meuAlunoId()"
        >
          <span
            class="rlista__posicao"
            [class.rlista__posicao--podio]="entry.posicao <= 3"
            aria-hidden="true"
          >
            {{ entry.posicao }}º
          </span>
          <div class="rlista__info">
            <p class="rlista__nome">
              <span class="visually-hidden">{{ entry.posicao }}º lugar:</span>
              {{ entry.nome }}
              @if (entry.alunoId === meuAlunoId()) {
                <span class="badge rlista__voce">Você</span>
              }
            </p>
            <p class="rlista__detalhe">
              {{ entry.subtemasConcluidos }} subtemas ·
              {{ entry.horasEstudadas | number: '1.0-1' }} h
            </p>
          </div>
          <span class="rlista__pontos">{{ entry.pontos | number: '1.0-0' }} pts</span>
        </li>
      }
    </ul>

    @if (totalPages() > 1) {
      <div class="rlista__pagination">
        <button
          class="btn btn--outline btn--sm"
          type="button"
          [disabled]="result().page <= 1"
          (click)="pageChange.emit(result().page - 1)"
        >
          Anterior
        </button>
        <span>Página {{ result().page }} de {{ totalPages() }} · {{ result().total }} alunos</span>
        <button
          class="btn btn--outline btn--sm"
          type="button"
          [disabled]="result().page >= totalPages()"
          (click)="pageChange.emit(result().page + 1)"
        >
          Próxima
        </button>
      </div>
    }
  `,
  styles: `
    .rlista {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 0.5rem;
    }
    .rlista__item {
      display: flex;
      align-items: center;
      gap: 0.875rem;
      padding: 0.875rem 1.25rem;
    }
    .rlista__item--podio {
      border-color: var(--accent);
    }
    .rlista__item--me {
      outline: 2px solid var(--accent);
      outline-offset: -1px;
    }
    .rlista__posicao {
      min-width: 2.5rem;
      text-align: center;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      color: var(--text-secondary);
    }
    .rlista__posicao--podio {
      padding: 0.25rem 0;
      border-radius: 0.5rem;
      background: var(--accent);
      color: var(--accent-contrast);
    }
    .rlista__info {
      display: grid;
      gap: 0.125rem;
      min-width: 0;
      flex: 1;
    }
    .rlista__nome {
      margin: 0;
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .rlista__voce {
      margin-left: 0.375rem;
      background: var(--accent);
      color: var(--accent-contrast);
      border-color: transparent;
    }
    .rlista__detalhe {
      margin: 0;
      font-size: 0.8125rem;
      color: var(--text-secondary);
    }
    .rlista__pontos {
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .rlista__pagination {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 1rem;
      flex-wrap: wrap;
      margin-top: 0.75rem;
      font-size: 0.875rem;
      color: var(--text-secondary);
    }
  `,
})
export class RankingLista {
  readonly result = input.required<Paginated<RankingEntry>>();
  /** Id do aluno autenticado (destaque "Você"); null para professor. */
  readonly meuAlunoId = input<string | null>(null);
  readonly pageChange = output<number>();

  readonly totalPages = computed(() => {
    const res = this.result();
    return Math.max(1, Math.ceil(res.total / res.pageSize));
  });
}
