import { DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { extractApiError } from '../../core/http/api-error';
import type { Bloco, Cronograma } from '../cronograma/cronograma.models';
import { CronogramaService } from '../cronograma/cronograma.service';
import { AnelProgresso } from '../estatisticas/anel-progresso';
import type { ResumoEstatisticas } from '../estatisticas/estatisticas.models';
import { EstatisticasService } from '../estatisticas/estatisticas.service';
import type { MinhaPontuacao } from '../gamificacao/gamificacao.models';
import { RankingService } from '../gamificacao/ranking.service';
import type { PlanoTree } from '../planos/planos.models';
import { PlanosService } from '../planos/planos.service';
import type { Sessao } from '../sessoes/sessoes.models';
import { SessaoService } from '../sessoes/sessoes.service';

interface BlocoHojeView extends Bloco {
  disciplinaNome: string;
}

@Component({
  selector: 'app-dashboard-page',
  imports: [DatePipe, RouterLink, AnelProgresso],
  template: `
    <section class="dash">
      <header class="dash__header">
        <h1>Dashboard</h1>
        <p class="dash__greeting">Olá, {{ primeiroNome() }}! Aqui está o resumo dos seus estudos.</p>
      </header>

      @if (loading()) {
        <p class="dash__state">Carregando seu resumo…</p>
      } @else if (error()) {
        <p class="alert alert--error" role="alert">{{ error() }}</p>
      } @else {
        @if (sessaoAtiva(); as sessao) {
          <div class="card card--flat dash__sessao" role="status">
            <span class="dash__sessao-dot" aria-hidden="true"></span>
            <p class="dash__sessao-text">
              Você tem uma sessão de estudo
              {{ sessao.estado === 'PAUSED' ? 'pausada' : 'em andamento' }}.
            </p>
            <a class="btn btn--primary btn--sm" routerLink="/sessoes">Continuar</a>
          </div>
        }

        <ul class="dash__tiles">
          <li class="card card--flat dash__tile">
            <span class="dash__tile-label">Horas estudadas</span>
            <span class="dash__tile-value">{{ horasLabel() }}</span>
            <a class="dash__tile-link" routerLink="/estatisticas">Ver estatísticas</a>
          </li>
          <li class="card card--flat dash__tile">
            <span class="dash__tile-label">Questões resolvidas</span>
            <span class="dash__tile-value">{{ resumo()?.questoes?.total ?? 0 }}</span>
            <span class="dash__tile-hint">{{ acertoLabel() }}</span>
          </li>
          <li class="card card--flat dash__tile">
            <span class="dash__tile-label">Pontos no ranking</span>
            <span class="dash__tile-value">{{ pontuacao()?.pontos ?? 0 }}</span>
            <span class="dash__tile-hint">{{ posicaoLabel() }}</span>
          </li>
        </ul>

        <div class="dash__grid">
          <section class="card dash__panel" aria-labelledby="dash-progresso-titulo">
            <h2 id="dash-progresso-titulo" class="dash__panel-title">Progresso do plano</h2>
            @if (resumo(); as res) {
              <div class="dash__progresso">
                <app-anel-progresso
                  [percentual]="res.progresso.percentual"
                  [label]="
                    'Progresso do plano: ' +
                    res.progresso.concluidos +
                    ' de ' +
                    res.progresso.totalSubtemas +
                    ' subtemas concluídos'
                  "
                />
                <p class="dash__progresso-text">
                  {{ res.progresso.concluidos }} de {{ res.progresso.totalSubtemas }} subtemas
                  concluídos
                </p>
                <a class="btn btn--outline btn--sm" routerLink="/progresso">Ver progresso</a>
              </div>
            }
          </section>

          <section class="card dash__panel" aria-labelledby="dash-hoje-titulo">
            <h2 id="dash-hoje-titulo" class="dash__panel-title">Hoje no cronograma</h2>
            @if (!cronograma()) {
              <div class="dash__empty">
                <p>Você ainda não tem um cronograma ativo.</p>
                <a class="btn btn--primary btn--sm" routerLink="/cronograma">Criar cronograma</a>
              </div>
            } @else if (blocosHoje().length === 0) {
              <div class="dash__empty">
                <p>Nenhum bloco de estudo planejado para hoje. Aproveite para revisar!</p>
                <a class="btn btn--outline btn--sm" routerLink="/cronograma">Abrir calendário</a>
              </div>
            } @else {
              <ul class="dash__blocos">
                @for (bloco of blocosHoje(); track bloco.id) {
                  <li class="dash__bloco">
                    <span class="dash__bloco-horario">
                      {{ bloco.inicio | date: 'HH:mm' }}–{{ bloco.fim | date: 'HH:mm' }}
                    </span>
                    <span class="dash__bloco-disciplina">{{ bloco.disciplinaNome }}</span>
                    <span
                      class="dash__bloco-status"
                      [class.dash__bloco-status--concluido]="bloco.status === 'CONCLUIDO'"
                      [class.dash__bloco-status--pulado]="bloco.status === 'PULADO'"
                    >
                      {{ statusLabel(bloco.status) }}
                    </span>
                  </li>
                }
              </ul>
              <a class="btn btn--outline btn--sm dash__panel-cta" routerLink="/cronograma">
                Abrir calendário
              </a>
            }
          </section>
        </div>
      }
    </section>
  `,
  styles: `
    .dash {
      display: grid;
      gap: 1.5rem;
      max-width: 64rem;
      margin: 0 auto;
    }

    .dash__header {
      display: grid;
      gap: 0.25rem;
    }

    .dash__header h1 {
      margin: 0;
      font-size: 1.5rem;
    }

    .dash__greeting {
      margin: 0;
      color: var(--text-secondary);
    }

    .dash__state {
      margin: 0;
      padding: 2rem 0;
      text-align: center;
      color: var(--text-secondary);
    }

    .dash__sessao {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex-wrap: wrap;
    }

    .dash__sessao-dot {
      width: 0.6rem;
      height: 0.6rem;
      border-radius: 50%;
      background: var(--success);
      flex-shrink: 0;
    }

    .dash__sessao-text {
      margin: 0;
      flex: 1;
      min-width: 12rem;
    }

    .dash__tiles {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
      gap: 1rem;
    }

    .dash__tile {
      display: grid;
      gap: 0.25rem;
      align-content: start;
    }

    .dash__tile-label {
      font-size: 0.8rem;
      font-weight: 600;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      color: var(--text-secondary);
    }

    .dash__tile-value {
      font-size: 1.75rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }

    .dash__tile-hint {
      font-size: 0.85rem;
      color: var(--text-secondary);
    }

    .dash__tile-link {
      font-size: 0.85rem;
      color: var(--accent);
    }

    .dash__grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
      gap: 1rem;
      align-items: start;
    }

    .dash__panel {
      display: grid;
      gap: 1rem;
    }

    .dash__panel-title {
      margin: 0;
      font-size: 1.1rem;
    }

    .dash__progresso {
      display: grid;
      gap: 0.75rem;
      justify-items: center;
      text-align: center;
    }

    .dash__progresso-text {
      margin: 0;
      color: var(--text-secondary);
      font-size: 0.9rem;
    }

    .dash__empty {
      display: grid;
      gap: 0.75rem;
      justify-items: start;
    }

    .dash__empty p {
      margin: 0;
      color: var(--text-secondary);
    }

    .dash__blocos {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 0.5rem;
    }

    .dash__bloco {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.5rem 0.75rem;
      border: 1px solid var(--glass-border);
      border-radius: 0.6rem;
      background: var(--surface-flat);
    }

    .dash__bloco-horario {
      font-variant-numeric: tabular-nums;
      font-size: 0.85rem;
      color: var(--text-secondary);
      flex-shrink: 0;
    }

    .dash__bloco-disciplina {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 600;
    }

    .dash__bloco-status {
      font-size: 0.75rem;
      font-weight: 600;
      padding: 0.15rem 0.5rem;
      border-radius: 999px;
      background: var(--surface-inset);
      color: var(--text-secondary);
      flex-shrink: 0;
    }

    .dash__bloco-status--concluido {
      background: var(--success-bg);
      color: var(--success);
    }

    .dash__bloco-status--pulado {
      background: var(--danger-bg);
      color: var(--danger);
    }

    .dash__panel-cta {
      justify-self: start;
    }
  `,
})
export default class DashboardPage {
  private readonly auth = inject(AuthService);
  private readonly estatisticasService = inject(EstatisticasService);
  private readonly rankingService = inject(RankingService);
  private readonly cronogramaService = inject(CronogramaService);
  private readonly planosService = inject(PlanosService);
  private readonly sessaoService = inject(SessaoService);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly resumo = signal<ResumoEstatisticas | null>(null);
  readonly pontuacao = signal<MinhaPontuacao | null>(null);
  readonly cronograma = signal<Cronograma | null>(null);
  readonly sessaoAtiva = signal<Sessao | null>(null);
  private readonly plano = signal<PlanoTree | null>(null);
  private readonly blocos = signal<Bloco[]>([]);

  readonly primeiroNome = computed(() => {
    const nome = this.auth.currentUser()?.nome ?? '';
    return nome.split(' ')[0] || 'aluno';
  });

  readonly horasLabel = computed(() => {
    const totalMin = Math.round((this.resumo()?.horasTotais ?? 0) * 60);
    const inteiras = Math.floor(totalMin / 60);
    const minutos = totalMin % 60;
    return minutos === 0 ? `${inteiras}h` : `${inteiras}h${String(minutos).padStart(2, '0')}`;
  });

  readonly acertoLabel = computed(() => {
    const questoes = this.resumo()?.questoes;
    if (!questoes || questoes.total === 0) return 'Nenhuma registrada ainda';
    const acerto = Math.round((1 - questoes.taxaErro) * 100);
    return `${acerto}% de acerto`;
  });

  readonly posicaoLabel = computed(() => {
    const posicao = this.pontuacao()?.posicaoGlobal;
    return posicao ? `${posicao}º no ranking global` : 'Ainda fora do ranking';
  });

  readonly blocosHoje = computed<BlocoHojeView[]>(() => {
    const nomes = new Map<string, string>();
    for (const d of this.plano()?.disciplinas ?? []) nomes.set(d.id, d.nome);
    return this.blocos()
      .map((b) => ({ ...b, disciplinaNome: nomes.get(b.disciplinaId) ?? 'Disciplina' }))
      .sort((a, b) => a.inicio.localeCompare(b.inicio));
  });

  constructor() {
    forkJoin({
      resumo: this.estatisticasService.resumo(),
      pontuacao: this.rankingService.me().pipe(catchError(() => of(null))),
      cronograma: this.cronogramaService.getAtivo().pipe(catchError(() => of(null))),
      sessao: this.sessaoService.getAtiva().pipe(catchError(() => of(null))),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ resumo, pontuacao, cronograma, sessao }) => {
          this.resumo.set(resumo);
          this.pontuacao.set(pontuacao);
          this.cronograma.set(cronograma);
          this.sessaoAtiva.set(sessao);
          this.loading.set(false);
          if (cronograma) this.loadHoje(cronograma);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(extractApiError(err).message);
        },
      });
  }

  statusLabel(status: Bloco['status']): string {
    if (status === 'CONCLUIDO') return 'Concluído';
    if (status === 'PULADO') return 'Pulado';
    return 'Planejado';
  }

  private loadHoje(cronograma: Cronograma): void {
    const agora = new Date();
    const inicio = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
    const fim = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + 1);
    forkJoin({
      plano: this.planosService.get(cronograma.planoId).pipe(catchError(() => of(null))),
      blocos: this.cronogramaService
        .listBlocos(cronograma.id, inicio.toISOString(), fim.toISOString())
        .pipe(catchError(() => of([] as Bloco[]))),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ plano, blocos }) => {
        this.plano.set(plano);
        this.blocos.set(blocos);
      });
  }
}
