import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { extractApiError } from '../../core/http/api-error';
import type { Plano } from '../planos/planos.models';
import { PlanosService } from '../planos/planos.service';
import type { Cronograma, Janela } from './cronograma.models';
import { GRANULARIDADES } from './cronograma.models';
import { CronogramaService } from './cronograma.service';

const DIAS = [
  { valor: 0, abrev: 'Dom', nome: 'Domingo' },
  { valor: 1, abrev: 'Seg', nome: 'Segunda-feira' },
  { valor: 2, abrev: 'Ter', nome: 'Terça-feira' },
  { valor: 3, abrev: 'Qua', nome: 'Quarta-feira' },
  { valor: 4, abrev: 'Qui', nome: 'Quinta-feira' },
  { valor: 5, abrev: 'Sex', nome: 'Sexta-feira' },
  { valor: 6, abrev: 'Sáb', nome: 'Sábado' },
] as const;

/** Janela editável com chave estável para o @for não recriar inputs a cada edição. */
interface JanelaForm extends Janela {
  key: number;
}

let nextKey = 0;

function hhmmToMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

@Component({
  selector: 'app-cronograma-config',
  imports: [FormsModule, RouterLink],
  template: `
    <section class="config">
      <header class="config__header">
        <h1>Configurar cronograma</h1>
        <a class="btn btn--outline btn--sm" routerLink="/cronograma">Voltar ao calendário</a>
      </header>

      @if (loading()) {
        <p class="config__state">Carregando…</p>
      } @else {
        @if (ativo()) {
          <p class="alert alert--warning" role="alert">
            Você já tem um cronograma ativo (gerado em
            {{ geradoEmLabel() }}). Os campos abaixo estão preenchidos com a configuração atual —
            <strong>gerar novamente substitui o cronograma anterior</strong>.
          </p>
        }

        @if (serverError()) {
          <p class="alert alert--error" role="alert">{{ serverError() }}</p>
        }

        <div class="card config__card">
          <div class="field">
            <label for="plano">Plano de estudo</label>
            <select id="plano" [ngModel]="planoId()" (ngModelChange)="planoId.set($event)">
              <option value="" disabled>
                {{ loadingPlanos() ? 'Carregando planos…' : 'Selecione um plano' }}
              </option>
              @for (plano of planos(); track plano.id) {
                <option [value]="plano.id">{{ plano.titulo }} ({{ plano.tipo }})</option>
              }
            </select>
            <span class="field__hint">
              O plano precisa ter disciplinas com pesos definidos somando 100%.
            </span>
          </div>

          <fieldset class="config__dias">
            <legend>Dias da semana</legend>
            <div class="config__dias-grid">
              @for (dia of diasSemana; track dia.valor) {
                <button
                  type="button"
                  class="config__dia-toggle"
                  [class.config__dia-toggle--on]="isDiaSelecionado(dia.valor)"
                  [attr.aria-pressed]="isDiaSelecionado(dia.valor)"
                  [attr.aria-label]="dia.nome"
                  (click)="toggleDia(dia.valor)"
                >
                  {{ dia.abrev }}
                </button>
              }
            </div>
          </fieldset>

          @for (dia of diasSelecionados(); track dia) {
            <div class="config__janelas">
              <div class="config__janelas-header">
                <h2>{{ nomeDia(dia) }}</h2>
                <button class="btn btn--outline btn--sm" type="button" (click)="addJanela(dia)">
                  + Janela
                </button>
              </div>
              @if (janelasDoDia(dia).length === 0) {
                <p class="config__janelas-empty">
                  Nenhuma janela — adicione um horário ou desmarque o dia.
                </p>
              }
              @for (janela of janelasDoDia(dia); track janela.key) {
                <div
                  class="config__janela"
                  [class.config__janela--invalid]="janelaInvalida(janela)"
                >
                  <label class="config__janela-field">
                    <span>Início</span>
                    <input
                      type="time"
                      [ngModel]="janela.inicio"
                      (ngModelChange)="updateJanela(janela.key, 'inicio', $event)"
                    />
                  </label>
                  <span class="config__janela-sep" aria-hidden="true">–</span>
                  <label class="config__janela-field">
                    <span>Fim</span>
                    <input
                      type="time"
                      [ngModel]="janela.fim"
                      (ngModelChange)="updateJanela(janela.key, 'fim', $event)"
                    />
                  </label>
                  <button
                    class="btn btn--outline btn--sm config__janela-remove"
                    type="button"
                    (click)="removeJanela(janela.key)"
                    aria-label="Remover janela"
                  >
                    Remover
                  </button>
                </div>
              }
            </div>
          }

          <div class="config__opcoes">
            <div class="field">
              <label for="granularidade">Granularidade do bloco</label>
              <select
                id="granularidade"
                [ngModel]="granularidade()"
                (ngModelChange)="granularidade.set($event)"
              >
                @for (g of granularidades; track g) {
                  <option [ngValue]="g">{{ g }} minutos</option>
                }
              </select>
            </div>
            <div class="field">
              <label for="timezone">Fuso horário (IANA)</label>
              <input
                id="timezone"
                type="text"
                [ngModel]="timezone()"
                (ngModelChange)="timezone.set($event)"
                placeholder="America/Sao_Paulo"
              />
              <span class="field__hint">Detectado do seu navegador; ajuste se necessário.</span>
            </div>
          </div>

          <p class="config__total" aria-live="polite">
            Total planejado: <strong>{{ horasSemanaLabel() }}</strong> por semana
          </p>

          @if (submitted() && validationErrors().length > 0) {
            <div class="alert alert--error" role="alert">
              <ul class="config__errors">
                @for (erro of validationErrors(); track erro) {
                  <li>{{ erro }}</li>
                }
              </ul>
            </div>
          }

          <button class="btn btn--primary" type="button" [disabled]="saving()" (click)="gerar()">
            {{ saving() ? 'Gerando…' : ativo() ? 'Gerar novo cronograma' : 'Gerar cronograma' }}
          </button>
        </div>
      }
    </section>
  `,
  styles: `
    .config {
      display: grid;
      gap: 1rem;
      max-width: 44rem;
      margin: 0 auto;
    }
    .config__header {
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
    .config__state {
      color: var(--color-text-muted);
      text-align: center;
      padding: 2rem 0;
    }
    .alert--warning {
      background: color-mix(in srgb, var(--color-primary) 12%, var(--color-surface));
      color: var(--color-text);
      border: 1px solid var(--color-primary);
    }
    .config__card {
      display: grid;
      gap: 1rem;
    }
    .config__dias {
      margin: 0;
      padding: 0;
      border: none;

      legend {
        font-size: 0.875rem;
        font-weight: 500;
        margin-bottom: 0.5rem;
        padding: 0;
      }
    }
    .config__dias-grid {
      display: flex;
      gap: 0.375rem;
      flex-wrap: wrap;
    }
    .config__dia-toggle {
      min-width: 44px;
      min-height: 44px;
      padding: 0 0.625rem;
      font: inherit;
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--color-text-muted);
      background: var(--color-background);
      border: 1px solid var(--color-border);
      border-radius: 0.5rem;
      cursor: pointer;

      &:focus-visible {
        outline: 2px solid var(--color-primary);
        outline-offset: 2px;
      }
    }
    .config__dia-toggle--on {
      background: var(--color-primary);
      border-color: var(--color-primary);
      color: var(--color-primary-contrast);
    }
    .config__janelas {
      display: grid;
      gap: 0.5rem;
      padding: 0.75rem;
      border: 1px solid var(--color-border);
      border-radius: 0.5rem;
    }
    .config__janelas-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;

      h2 {
        margin: 0;
        font-size: 0.9375rem;
      }
    }
    .config__janelas-empty {
      margin: 0;
      color: var(--color-text-muted);
      font-size: 0.875rem;
    }
    .config__janela {
      display: flex;
      align-items: end;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .config__janela--invalid input {
      border-color: var(--color-danger);
    }
    .config__janela-field {
      display: grid;
      gap: 0.25rem;
      font-size: 0.8125rem;
      color: var(--color-text-muted);

      input {
        min-height: 44px;
        padding: 0 0.5rem;
        font: inherit;
        color: var(--color-text);
        background: var(--color-background);
        border: 1px solid var(--color-border);
        border-radius: 0.5rem;

        &:focus-visible {
          outline: 2px solid var(--color-primary);
          outline-offset: 1px;
        }
      }
    }
    .config__janela-sep {
      align-self: center;
      margin-top: 1rem;
      color: var(--color-text-muted);
    }
    .config__janela-remove {
      margin-left: auto;
    }
    .config__opcoes {
      display: grid;
      gap: 0.75rem;
      grid-template-columns: 1fr;

      .field {
        margin-bottom: 0;
      }

      @media (min-width: 640px) {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    .config__total {
      margin: 0;
      font-size: 0.9375rem;
      color: var(--color-text-muted);

      strong {
        color: var(--color-text);
      }
    }
    .config__errors {
      margin: 0;
      padding-left: 1.25rem;
      display: grid;
      gap: 0.25rem;
    }
  `,
})
export default class CronogramaConfig {
  private readonly cronogramaService = inject(CronogramaService);
  private readonly planosService = inject(PlanosService);
  private readonly router = inject(Router);

  protected readonly diasSemana = DIAS;
  protected readonly granularidades = GRANULARIDADES;

  readonly loading = signal(true);
  readonly loadingPlanos = signal(true);
  readonly saving = signal(false);
  readonly submitted = signal(false);
  readonly serverError = signal<string | null>(null);

  readonly planos = signal<Plano[]>([]);
  readonly ativo = signal<Cronograma | null>(null);

  readonly planoId = signal('');
  readonly dias = signal<number[]>([]);
  readonly janelas = signal<JanelaForm[]>([]);
  readonly granularidade = signal<number>(30);
  readonly timezone = signal(Intl.DateTimeFormat().resolvedOptions().timeZone);

  readonly diasSelecionados = computed(() => [...this.dias()].sort((a, b) => a - b));

  readonly minutosSemana = computed(() =>
    this.janelas().reduce((total, j) => {
      if (!j.inicio || !j.fim) return total;
      const duracao = hhmmToMin(j.fim) - hhmmToMin(j.inicio);
      return duracao > 0 ? total + duracao : total;
    }, 0),
  );

  readonly horasSemanaLabel = computed(() => {
    const minutos = this.minutosSemana();
    const horas = Math.floor(minutos / 60);
    const resto = minutos % 60;
    return resto === 0 ? `${horas}h` : `${horas}h${String(resto).padStart(2, '0')}`;
  });

  readonly geradoEmLabel = computed(() => {
    const geradoEm = this.ativo()?.geradoEm;
    return geradoEm ? new Date(geradoEm).toLocaleDateString('pt-BR') : '';
  });

  /** Espelha as validações do backend (422) para feedback imediato. */
  readonly validationErrors = computed(() => {
    const erros: string[] = [];
    const granularidade = this.granularidade();

    if (!this.planoId()) erros.push('Selecione um plano de estudo.');
    if (this.dias().length === 0) erros.push('Selecione pelo menos um dia da semana.');
    if (this.janelas().length === 0) erros.push('Adicione pelo menos uma janela de horário.');
    if (!this.timezone().trim()) erros.push('Informe o fuso horário.');

    for (const dia of this.diasSelecionados()) {
      const doDia = this.janelasDoDia(dia);
      const nome = this.nomeDia(dia);
      if (doDia.length === 0) {
        erros.push(`${nome}: adicione uma janela ou desmarque o dia.`);
        continue;
      }
      for (const janela of doDia) {
        if (!janela.inicio || !janela.fim) {
          erros.push(`${nome}: preencha início e fim da janela.`);
          continue;
        }
        const duracao = hhmmToMin(janela.fim) - hhmmToMin(janela.inicio);
        if (duracao <= 0) {
          erros.push(`${nome}: o fim da janela deve ser maior que o início.`);
        } else if (duracao < granularidade) {
          erros.push(`${nome}: a janela deve ter ao menos ${granularidade} minutos.`);
        }
      }
      const ordenadas = doDia
        .filter((j) => j.inicio && j.fim)
        .map((j) => ({ inicio: hhmmToMin(j.inicio), fim: hhmmToMin(j.fim) }))
        .sort((a, b) => a.inicio - b.inicio);
      for (let i = 1; i < ordenadas.length; i += 1) {
        if (ordenadas[i].inicio < ordenadas[i - 1].fim) {
          erros.push(`${nome}: as janelas não podem se sobrepor.`);
          break;
        }
      }
    }
    return erros;
  });

  constructor() {
    this.planosService.list({ page: 1, pageSize: 100, sort: 'titulo' }).subscribe({
      next: (res) => {
        this.planos.set(res.data);
        this.loadingPlanos.set(false);
        // Auto-seleção com plano único quando nada foi escolhido; o prefill do
        // cronograma ativo (abaixo) tem prioridade e sobrescreve se existir.
        if (!this.planoId() && res.data.length === 1) this.planoId.set(res.data[0].id);
      },
      error: () => this.loadingPlanos.set(false),
    });

    this.cronogramaService.getAtivo().subscribe({
      next: (cronograma) => {
        this.ativo.set(cronograma);
        this.prefill(cronograma);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        const apiError = extractApiError(err);
        if (apiError.code !== 'NOT_FOUND') this.serverError.set(apiError.message);
        this.loading.set(false);
      },
    });
  }

  nomeDia(dia: number): string {
    return DIAS[dia]?.nome ?? String(dia);
  }

  isDiaSelecionado(dia: number): boolean {
    return this.dias().includes(dia);
  }

  toggleDia(dia: number): void {
    if (this.isDiaSelecionado(dia)) {
      this.dias.set(this.dias().filter((d) => d !== dia));
      this.janelas.set(this.janelas().filter((j) => j.dia !== dia));
    } else {
      this.dias.set([...this.dias(), dia]);
      if (this.janelasDoDia(dia).length === 0) this.addJanela(dia);
    }
  }

  janelasDoDia(dia: number): JanelaForm[] {
    return this.janelas().filter((j) => j.dia === dia);
  }

  addJanela(dia: number): void {
    this.janelas.set([...this.janelas(), { key: nextKey++, dia, inicio: '08:00', fim: '10:00' }]);
  }

  removeJanela(key: number): void {
    this.janelas.set(this.janelas().filter((j) => j.key !== key));
  }

  updateJanela(key: number, campo: 'inicio' | 'fim', valor: string): void {
    this.janelas.set(this.janelas().map((j) => (j.key === key ? { ...j, [campo]: valor } : j)));
  }

  janelaInvalida(janela: JanelaForm): boolean {
    if (!janela.inicio || !janela.fim) return false;
    const duracao = hhmmToMin(janela.fim) - hhmmToMin(janela.inicio);
    return duracao <= 0 || duracao < this.granularidade();
  }

  gerar(): void {
    this.submitted.set(true);
    this.serverError.set(null);
    if (this.validationErrors().length > 0) return;

    this.saving.set(true);
    this.cronogramaService
      .gerar({
        planoId: this.planoId(),
        diasSemana: this.diasSelecionados(),
        janelas: this.janelas().map(({ dia, inicio, fim }) => ({ dia, inicio, fim })),
        granularidadeMin: this.granularidade(),
        timezone: this.timezone().trim(),
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          void this.router.navigate(['/cronograma']);
        },
        error: (err: unknown) => {
          this.saving.set(false);
          const apiError = extractApiError(err);
          const issues = (apiError.details ?? []).map((d) => d.issue).join(' · ');
          this.serverError.set(issues ? `${apiError.message} ${issues}` : apiError.message);
        },
      });
  }

  private prefill(cronograma: Cronograma): void {
    this.planoId.set(cronograma.planoId);
    this.dias.set([...cronograma.diasSemana]);
    this.janelas.set(cronograma.janelas.map((j) => ({ ...j, key: nextKey++ })));
    this.granularidade.set(cronograma.granularidadeMin);
    this.timezone.set(cronograma.timezone);
  }
}
