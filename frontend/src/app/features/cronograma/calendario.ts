import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { extractApiError } from '../../core/http/api-error';
import { Dialog } from '../../shared/dialog/dialog';
import type { PlanoTree } from '../planos/planos.models';
import { PlanosService } from '../planos/planos.service';
import { Cronometro } from '../sessoes/cronometro';
import type { CronometroPrefill } from '../sessoes/sessoes.models';
import type { Bloco, BlocoStatus, Cronograma } from './cronograma.models';
import { CronogramaService } from './cronograma.service';

const DIA_MS = 86_400_000;
const SEMANAS_MATERIALIZADAS = 4;

/** Paleta de acentos por disciplina: tokens --chart-1..8 definidos por tema
 * em styles.scss (variantes claras nos temas escuros e vice-versa). */
const CORES = Array.from({ length: 8 }, (_, i) => `var(--chart-${i + 1})`);

interface BlocoView extends Bloco {
  disciplinaNome: string;
  subtemaNome: string | null;
  cor: string;
}

interface DiaView {
  date: Date;
  isToday: boolean;
  blocos: BlocoView[];
}

interface LegendaItem {
  nome: string;
  cor: string;
}

/** Meia-noite local do domingo da semana que contém `data`. */
function inicioDaSemana(data: Date): Date {
  const inicio = new Date(data.getFullYear(), data.getMonth(), data.getDate());
  inicio.setDate(inicio.getDate() - inicio.getDay());
  return inicio;
}

@Component({
  selector: 'app-calendario',
  imports: [DatePipe, RouterLink, Dialog, Cronometro],
  template: `
    <section class="cal">
      <header class="cal__header">
        <h1>Calendário</h1>
        @if (cronograma()) {
          <a class="btn btn--outline btn--sm" routerLink="/cronograma/configurar">
            Ajustar cronograma
          </a>
        }
      </header>

      @if (error()) {
        <p class="alert alert--error" role="alert">{{ error() }}</p>
      }

      @if (loading()) {
        <p class="cal__state">Carregando cronograma…</p>
      } @else if (semCronograma()) {
        <div class="card cal__empty-state">
          <h2>Você ainda não tem um cronograma</h2>
          <p>
            Informe seus dias, horários e o plano de estudo para a plataforma montar sua agenda
            semanal automaticamente, respeitando o peso de cada disciplina.
          </p>
          <a class="btn btn--primary" routerLink="/cronograma/configurar">Configurar cronograma</a>
        </div>
      } @else if (cronograma(); as c) {
        <p class="cal__meta">
          @if (plano(); as p) {
            <span
              ><strong>{{ p.titulo }}</strong></span
            >
          }
          <span>{{ horasSemanaLabel() }}/semana</span>
          <span>blocos de {{ c.granularidadeMin }} min</span>
          <span>{{ c.timezone }}</span>
        </p>

        <nav class="cal__nav" aria-label="Navegação de semanas">
          <button
            class="btn btn--outline btn--sm"
            type="button"
            (click)="mudarSemana(-1)"
            aria-label="Semana anterior"
          >
            ←
          </button>
          <span class="cal__nav-label">
            {{ weekStart() | date: 'dd/MM' }} – {{ weekEndLabel() | date: 'dd/MM/yyyy' }}
          </span>
          <button
            class="btn btn--outline btn--sm"
            type="button"
            (click)="mudarSemana(1)"
            aria-label="Próxima semana"
          >
            →
          </button>
          <button class="btn btn--outline btn--sm" type="button" (click)="irParaHoje()">
            Hoje
          </button>
        </nav>

        @if (legenda().length > 0) {
          <ul class="cal__legenda" aria-label="Disciplinas">
            @for (item of legenda(); track item.nome) {
              <li>
                <span class="cal__dot" [style.background]="item.cor" aria-hidden="true"></span>
                {{ item.nome }}
              </li>
            }
          </ul>
        }

        @if (blocosLoading()) {
          <p class="cal__state">Carregando blocos…</p>
        } @else {
          @if (semanaVazia()) {
            <p class="cal__state">
              Sem blocos nesta semana.
              @if (foraDoHorizonte()) {
                Os blocos são gerados para {{ horizonteSemanas }} semanas a partir da geração — gere
                o cronograma novamente para planejar semanas futuras.
              }
            </p>
          }
          <div class="cal__grid">
            @for (dia of dias(); track dia.date.getTime()) {
              <section class="cal__day" [class.cal__day--today]="dia.isToday">
                <h2 class="cal__day-title">
                  {{ dia.date | date: 'EEE' }}
                  <span class="cal__day-date">{{ dia.date | date: 'dd/MM' }}</span>
                </h2>
                @if (dia.blocos.length === 0) {
                  <p class="cal__day-empty">Sem blocos</p>
                }
                @for (bloco of dia.blocos; track bloco.id) {
                  <article
                    class="cal__bloco"
                    [class.cal__bloco--concluido]="bloco.status === 'CONCLUIDO'"
                    [class.cal__bloco--pulado]="bloco.status === 'PULADO'"
                    [style.border-left-color]="bloco.cor"
                  >
                    <p class="cal__bloco-hora">
                      {{ bloco.inicio | date: 'HH:mm' }}–{{ bloco.fim | date: 'HH:mm' }}
                      <span>· {{ bloco.duracaoMin }} min</span>
                    </p>
                    <p class="cal__bloco-disciplina">{{ bloco.disciplinaNome }}</p>
                    <p class="cal__bloco-subtema">
                      {{ bloco.subtemaNome ?? 'Revisão' }}
                    </p>
                    <div class="cal__bloco-actions">
                      @if (bloco.status === 'PLANEJADO') {
                        <button
                          class="btn btn--outline btn--sm"
                          type="button"
                          (click)="marcar(bloco, 'CONCLUIDO')"
                        >
                          Concluir
                        </button>
                        <button
                          class="btn btn--outline btn--sm"
                          type="button"
                          (click)="marcar(bloco, 'PULADO')"
                        >
                          Pular
                        </button>
                        <button
                          class="btn btn--outline btn--sm"
                          type="button"
                          (click)="abrirEstudo(bloco)"
                        >
                          Iniciar estudo
                        </button>
                      } @else {
                        <span
                          class="badge"
                          [class.badge--ativo]="bloco.status === 'CONCLUIDO'"
                          [class.badge--inativo]="bloco.status === 'PULADO'"
                        >
                          {{ bloco.status === 'CONCLUIDO' ? 'Concluído' : 'Pulado' }}
                        </span>
                        <button
                          class="btn btn--outline btn--sm"
                          type="button"
                          (click)="marcar(bloco, 'PLANEJADO')"
                        >
                          Desfazer
                        </button>
                      }
                    </div>
                  </article>
                }
              </section>
            }
          </div>
        }
      }

      @if (estudoPrefill(); as prefill) {
        <app-dialog titulo="Iniciar estudo" (fechado)="fecharEstudo()">
          <app-cronometro
            [disciplinas]="plano()?.disciplinas ?? []"
            [prefill]="prefill"
            [embutido]="true"
          />
          <p class="cal__dialog-hint">
            Fechar esta janela não interrompe o cronômetro — acompanhe o tempo pelo menu lateral.
          </p>
        </app-dialog>
      }
    </section>
  `,
  styles: `
    .cal {
      display: grid;
      gap: 1rem;
      max-width: 80rem;
      margin: 0 auto;
    }
    .cal__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      flex-wrap: wrap;

      h1 {
        margin: 0;
        font-size: 1.5rem;
      }
    }
    .cal__state {
      color: var(--color-text-muted);
      text-align: center;
      padding: 1.5rem 0;
      margin: 0;
    }
    .cal__empty-state {
      display: grid;
      gap: 0.75rem;
      justify-items: center;
      text-align: center;
      padding: 2.5rem 1.5rem;

      h2 {
        margin: 0;
        font-size: 1.25rem;
      }

      p {
        margin: 0;
        color: var(--color-text-muted);
        max-width: 32rem;
      }
    }
    .cal__meta {
      margin: 0;
      display: flex;
      gap: 0.375rem 1rem;
      flex-wrap: wrap;
      color: var(--color-text-muted);
      font-size: 0.875rem;
    }
    .cal__nav {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .cal__nav-label {
      font-weight: 600;
      font-size: 0.9375rem;
      min-width: 10rem;
      text-align: center;
    }
    .cal__legenda {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      gap: 0.375rem 1rem;
      flex-wrap: wrap;
      font-size: 0.8125rem;
      color: var(--color-text-muted);

      li {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
      }
    }
    .cal__dot {
      width: 0.625rem;
      height: 0.625rem;
      border-radius: 999px;
      display: inline-block;
    }
    .cal__grid {
      display: grid;
      gap: 0.75rem;
      grid-template-columns: 1fr;

      @media (min-width: 768px) {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      @media (min-width: 1100px) {
        grid-template-columns: repeat(7, minmax(0, 1fr));
      }
    }
    .cal__day {
      display: grid;
      gap: 0.5rem;
      align-content: start;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 0.75rem;
      padding: 0.75rem;
    }
    .cal__day--today {
      border-color: var(--color-primary);
    }
    .cal__day-title {
      margin: 0;
      font-size: 0.875rem;
      text-transform: capitalize;
      display: flex;
      align-items: baseline;
      gap: 0.375rem;
    }
    .cal__day-date {
      font-weight: 400;
      color: var(--color-text-muted);
      font-size: 0.8125rem;
    }
    .cal__day-empty {
      margin: 0;
      color: var(--color-text-muted);
      font-size: 0.8125rem;
    }
    .cal__bloco {
      display: grid;
      gap: 0.25rem;
      padding: 0.5rem 0.625rem;
      background: var(--color-background);
      border: 1px solid var(--color-border);
      border-left: 4px solid var(--color-border);
      border-radius: 0.5rem;
    }
    .cal__bloco--concluido {
      opacity: 0.75;

      .cal__bloco-disciplina {
        text-decoration: line-through;
      }
    }
    .cal__bloco--pulado {
      opacity: 0.6;
    }
    .cal__bloco-hora {
      margin: 0;
      font-size: 0.75rem;
      color: var(--color-text-muted);
    }
    .cal__bloco-disciplina {
      margin: 0;
      font-weight: 600;
      font-size: 0.875rem;
    }
    .cal__bloco-subtema {
      margin: 0;
      font-size: 0.8125rem;
      color: var(--color-text-muted);
    }
    .cal__bloco-actions {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      flex-wrap: wrap;
      margin-top: 0.25rem;

      .btn--sm {
        min-height: 32px;
        padding: 0 0.5rem;
        font-size: 0.75rem;
      }
    }
    .cal__dialog-hint {
      margin: 0;
      font-size: 0.8125rem;
      color: var(--color-text-muted);
    }
  `,
})
export default class Calendario {
  private readonly cronogramaService = inject(CronogramaService);
  private readonly planosService = inject(PlanosService);

  protected readonly horizonteSemanas = SEMANAS_MATERIALIZADAS;

  readonly loading = signal(true);
  readonly blocosLoading = signal(false);
  readonly error = signal<string | null>(null);
  readonly semCronograma = signal(false);

  readonly cronograma = signal<Cronograma | null>(null);
  readonly plano = signal<PlanoTree | null>(null);
  readonly blocos = signal<Bloco[]>([]);
  readonly weekStart = signal(inicioDaSemana(new Date()));

  /** Bloco escolhido em "Iniciar estudo": abre o modal com o cronômetro. */
  readonly estudoBloco = signal<BlocoView | null>(null);

  /**
   * Prefill do cronômetro no modal (US-7): disciplina, subtema (se houver) e
   * o vínculo com o bloco — o start é confirmado no modal pelo aluno. O
   * deep-link /sessoes?disciplinaId=… continua funcionando como fallback.
   */
  readonly estudoPrefill = computed<CronometroPrefill | null>(() => {
    const bloco = this.estudoBloco();
    if (!bloco) return null;
    return {
      disciplinaId: bloco.disciplinaId,
      subtemaId: bloco.subtemaId ?? undefined,
      blocoId: bloco.id,
      planoId: this.cronograma()?.planoId,
    };
  });

  private readonly disciplinaNomes = computed(() => {
    const nomes = new Map<string, string>();
    for (const d of this.plano()?.disciplinas ?? []) nomes.set(d.id, d.nome);
    return nomes;
  });

  private readonly subtemaNomes = computed(() => {
    const nomes = new Map<string, string>();
    for (const d of this.plano()?.disciplinas ?? []) {
      for (const t of d.temas) {
        for (const s of t.subtemas) nomes.set(s.id, s.nome);
      }
    }
    return nomes;
  });

  private readonly disciplinaCores = computed(() => {
    const cores = new Map<string, string>();
    (this.plano()?.disciplinas ?? []).forEach((d, i) => {
      cores.set(d.id, CORES[i % CORES.length]);
    });
    return cores;
  });

  readonly weekEndLabel = computed(() => new Date(this.weekStart().getTime() + 6 * DIA_MS));

  readonly dias = computed<DiaView[]>(() => {
    const inicio = this.weekStart();
    const hoje = new Date();
    const nomes = this.disciplinaNomes();
    const subtemas = this.subtemaNomes();
    const cores = this.disciplinaCores();

    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + i);
      const blocos = this.blocos()
        .filter((b) => sameLocalDay(new Date(b.inicio), date))
        .map((b) => ({
          ...b,
          disciplinaNome: nomes.get(b.disciplinaId) ?? 'Disciplina',
          subtemaNome: b.subtemaId ? (subtemas.get(b.subtemaId) ?? null) : null,
          cor: cores.get(b.disciplinaId) ?? CORES[0],
        }));
      return { date, isToday: sameLocalDay(hoje, date), blocos };
    });
  });

  readonly legenda = computed<LegendaItem[]>(() => {
    const cores = this.disciplinaCores();
    const usadas = new Set(this.blocos().map((b) => b.disciplinaId));
    return (this.plano()?.disciplinas ?? [])
      .filter((d) => usadas.has(d.id))
      .map((d) => ({ nome: d.nome, cor: cores.get(d.id) ?? CORES[0] }));
  });

  readonly semanaVazia = computed(() => this.blocos().length === 0);

  readonly foraDoHorizonte = computed(() => {
    const cronograma = this.cronograma();
    if (!cronograma) return false;
    const limite = new Date(cronograma.geradoEm).getTime() + SEMANAS_MATERIALIZADAS * 7 * DIA_MS;
    return this.weekStart().getTime() >= limite;
  });

  readonly horasSemanaLabel = computed(() => {
    const horas = this.cronograma()?.horasSemanaTotal ?? 0;
    const inteiras = Math.floor(horas);
    const minutos = Math.round((horas - inteiras) * 60);
    return minutos === 0 ? `${inteiras}h` : `${inteiras}h${String(minutos).padStart(2, '0')}`;
  });

  constructor() {
    this.cronogramaService.getAtivo().subscribe({
      next: (cronograma) => {
        this.cronograma.set(cronograma);
        this.loading.set(false);
        this.loadPlano(cronograma.planoId);
        this.loadBlocos();
      },
      error: (err: unknown) => {
        this.loading.set(false);
        const apiError = extractApiError(err);
        if (apiError.code === 'NOT_FOUND') {
          this.semCronograma.set(true);
        } else {
          this.error.set(apiError.message);
        }
      },
    });
  }

  mudarSemana(delta: number): void {
    const atual = this.weekStart();
    this.weekStart.set(
      new Date(atual.getFullYear(), atual.getMonth(), atual.getDate() + delta * 7),
    );
    this.loadBlocos();
  }

  irParaHoje(): void {
    this.weekStart.set(inicioDaSemana(new Date()));
    this.loadBlocos();
  }

  abrirEstudo(bloco: BlocoView): void {
    this.estudoBloco.set(bloco);
  }

  /** Fechar o modal NÃO para o cronômetro: o estado vive no SessaoAtivaService. */
  fecharEstudo(): void {
    this.estudoBloco.set(null);
  }

  /** Atualização otimista do status; reverte se o PATCH falhar. */
  marcar(bloco: Bloco, status: BlocoStatus): void {
    const anterior = bloco.status;
    this.error.set(null);
    this.aplicarStatus(bloco.id, status);
    this.cronogramaService.updateBlocoStatus(bloco.id, status).subscribe({
      error: (err: unknown) => {
        this.aplicarStatus(bloco.id, anterior);
        this.error.set(extractApiError(err).message);
      },
    });
  }

  private aplicarStatus(blocoId: string, status: BlocoStatus): void {
    this.blocos.set(this.blocos().map((b) => (b.id === blocoId ? { ...b, status } : b)));
  }

  private loadBlocos(): void {
    const cronograma = this.cronograma();
    if (!cronograma) return;
    const from = this.weekStart();
    const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 7);
    this.blocosLoading.set(true);
    this.cronogramaService
      .listBlocos(cronograma.id, from.toISOString(), to.toISOString())
      .subscribe({
        next: (blocos) => {
          this.blocos.set(blocos);
          this.blocosLoading.set(false);
        },
        error: (err: unknown) => {
          this.blocosLoading.set(false);
          this.error.set(extractApiError(err).message);
        },
      });
  }

  private loadPlano(planoId: string): void {
    this.planosService.get(planoId).subscribe({
      next: (plano) => this.plano.set(plano),
      // Sem o plano ainda dá para exibir o calendário (nomes com fallback).
      error: () => this.plano.set(null),
    });
  }
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
