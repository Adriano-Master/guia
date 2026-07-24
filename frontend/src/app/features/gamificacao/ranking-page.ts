import { Component, computed, inject, signal } from '@angular/core';

import { AuthService } from '../../core/auth/auth.service';
import type { Paginated } from '../../core/auth/auth.models';
import { extractApiError } from '../../core/http/api-error';
import { TurmasService } from '../turmas/turmas.service';
import type { MinhaPontuacao, RankingEntry } from './gamificacao.models';
import { MinhaPontuacaoCard } from './minha-pontuacao-card';
import { RankingLista } from './ranking-lista';
import { RankingService } from './ranking.service';

const PAGE_SIZE = 20;
const ABA_GLOBAL = 'global';

interface Aba {
  id: string;
  label: string;
}

/**
 * Tela de ranking (US-01/02/03/05), adaptada por papel:
 * - ALUNO: card "Minha pontuação" + abas com as turmas de /ranking/me e Global;
 *   a própria posição fica sempre visível (posicaoGlobal/turmas[].posicao),
 *   sem precisar navegar até a página em que o aluno aparece.
 * - PROFESSOR: sem card pessoal e sem chamar /ranking/me; abas = suas turmas
 *   (TurmasService) + Global.
 */
@Component({
  selector: 'app-ranking-page',
  imports: [MinhaPontuacaoCard, RankingLista],
  template: `
    <section class="ranking">
      <h1>Ranking</h1>

      @if (abasLoading()) {
        <p class="ranking__state">Carregando ranking…</p>
      } @else {
        @if (isAluno()) {
          @if (meError()) {
            <p class="alert alert--error" role="alert">{{ meError() }}</p>
          } @else if (me(); as minha) {
            <app-minha-pontuacao-card [me]="minha" />
          }
        } @else if (turmasError()) {
          <p class="alert alert--error" role="alert">{{ turmasError() }}</p>
        }

        <div class="ranking__abas" role="group" aria-label="Escopo do ranking">
          @for (aba of abas(); track aba.id) {
            <button
              type="button"
              class="btn btn--sm"
              [class.btn--primary]="abaAtiva() === aba.id"
              [class.btn--outline]="abaAtiva() !== aba.id"
              [attr.aria-pressed]="abaAtiva() === aba.id"
              (click)="setAba(aba.id)"
            >
              {{ aba.label }}
            </button>
          }
        </div>

        @if (minhaPosicaoNaAba(); as pos) {
          <p class="ranking__minha-posicao">
            Sua posição neste ranking: <strong>{{ pos }}º</strong>
          </p>
        }

        @if (error()) {
          <p class="alert alert--error" role="alert">{{ error() }}</p>
        } @else if (loading()) {
          <p class="ranking__state">Carregando ranking…</p>
        } @else if (result(); as res) {
          @if (res.data.length === 0) {
            <p class="ranking__state">
              {{
                abaAtiva() === 'global'
                  ? 'Ainda não há alunos no ranking.'
                  : 'Esta turma ainda não tem alunos no ranking.'
              }}
            </p>
          } @else {
            <app-ranking-lista
              [result]="res"
              [meuAlunoId]="meuAlunoId()"
              (pageChange)="goToPage($event)"
            />
          }
        }
      }
    </section>
  `,
  styles: `
    .ranking {
      display: grid;
      gap: 1rem;
      max-width: 48rem;
      margin: 0 auto;

      h1 {
        margin: 0;
        font-size: 1.5rem;
      }
    }
    .ranking__state {
      margin: 0;
      padding: 2rem 0;
      text-align: center;
      color: var(--text-secondary);
    }
    .ranking__abas {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .ranking__minha-posicao {
      margin: 0;
      font-size: 0.9375rem;
      color: var(--text-secondary);

      strong {
        color: var(--text-primary);
        font-variant-numeric: tabular-nums;
      }
    }
  `,
})
export default class RankingPage {
  private readonly rankingService = inject(RankingService);
  private readonly turmasService = inject(TurmasService);
  private readonly auth = inject(AuthService);

  readonly isAluno = computed(() => this.auth.role() === 'ALUNO');
  /** Id do aluno autenticado para destacar a própria linha na lista. */
  readonly meuAlunoId = computed(() =>
    this.isAluno() ? (this.auth.currentUser()?.id ?? null) : null,
  );

  readonly me = signal<MinhaPontuacao | null>(null);
  readonly meError = signal<string | null>(null);
  readonly turmasError = signal<string | null>(null);

  readonly abas = signal<Aba[]>([]);
  readonly abasLoading = signal(true);
  readonly abaAtiva = signal<string>(ABA_GLOBAL);

  readonly page = signal(1);
  readonly result = signal<Paginated<RankingEntry> | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  /** Posição fixa do aluno no escopo ativo, vinda de /ranking/me (sem varrer páginas). */
  readonly minhaPosicaoNaAba = computed<number | null>(() => {
    const minha = this.me();
    if (!minha) return null;
    if (this.abaAtiva() === ABA_GLOBAL) return minha.posicaoGlobal;
    return minha.turmas.find((t) => t.turmaId === this.abaAtiva())?.posicao ?? null;
  });

  /** Guarda de staleness: respostas de um load antigo não sobrescrevem o atual. */
  private loadSeq = 0;

  constructor() {
    if (this.isAluno()) {
      this.initAluno();
    } else {
      this.initProfessor();
    }
  }

  setAba(id: string): void {
    if (this.abaAtiva() === id) return;
    this.abaAtiva.set(id);
    this.page.set(1);
    this.loadRanking();
  }

  goToPage(page: number): void {
    this.page.set(page);
    this.loadRanking();
  }

  /** As abas do aluno vêm do próprio /ranking/me (turmas em que ele tem posição). */
  private initAluno(): void {
    this.rankingService.me().subscribe({
      next: (minha) => {
        this.me.set(minha);
        this.iniciarAbas(minha.turmas.map((t) => ({ id: t.turmaId, label: t.nome })));
      },
      error: (err: unknown) => {
        // sem a pontuação pessoal ainda dá para consultar o ranking global
        this.meError.set(extractApiError(err).message);
        this.iniciarAbas([]);
      },
    });
  }

  private initProfessor(): void {
    this.turmasService.list({ page: 1, pageSize: 100, sort: 'nome' }).subscribe({
      next: (res) => {
        this.iniciarAbas(res.data.map((t) => ({ id: t.id, label: t.nome })));
      },
      error: (err: unknown) => {
        this.turmasError.set(extractApiError(err).message);
        this.iniciarAbas([]);
      },
    });
  }

  private iniciarAbas(turmas: Aba[]): void {
    this.abas.set([...turmas, { id: ABA_GLOBAL, label: 'Global' }]);
    this.abaAtiva.set(turmas[0]?.id ?? ABA_GLOBAL);
    this.abasLoading.set(false);
    this.loadRanking();
  }

  private loadRanking(): void {
    const seq = ++this.loadSeq;
    const aba = this.abaAtiva();
    const params = { page: this.page(), pageSize: PAGE_SIZE };
    this.loading.set(true);
    this.error.set(null);
    this.result.set(null);

    const request$ =
      aba === ABA_GLOBAL
        ? this.rankingService.global(params)
        : this.rankingService.porTurma(aba, params);

    request$.subscribe({
      next: (res) => {
        if (seq !== this.loadSeq) return;
        this.result.set(res);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        if (seq !== this.loadSeq) return;
        this.loading.set(false);
        const apiError = extractApiError(err);
        // 403 (sem matrícula ATIVA / não é o professor) e 404 (turma removida)
        // chegam pelo envelope padrão; mensagens específicas do contexto
        if (aba !== ABA_GLOBAL && apiError.code === 'FORBIDDEN') {
          this.error.set('Você não tem acesso ao ranking desta turma.');
        } else if (aba !== ABA_GLOBAL && apiError.code === 'NOT_FOUND') {
          this.error.set('Turma não encontrada.');
        } else {
          this.error.set(apiError.message);
        }
      },
    });
  }
}
