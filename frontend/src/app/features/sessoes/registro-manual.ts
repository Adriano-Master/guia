import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { extractApiError } from '../../core/http/api-error';
import type { DisciplinaTree } from '../planos/planos.models';
import type { Sessao } from './sessoes.models';
import { SessaoService } from './sessoes.service';

/** YYYY-MM-DD da data local do aluno. */
function hojeLocal(): string {
  const hoje = new Date();
  const mes = String(hoje.getMonth() + 1).padStart(2, '0');
  const dia = String(hoje.getDate()).padStart(2, '0');
  return `${hoje.getFullYear()}-${mes}-${dia}`;
}

/** Registro manual de minutos estudados (US-5, CA-6/CA-7/CB-4). */
@Component({
  selector: 'app-registro-manual',
  imports: [FormsModule],
  template: `
    <div class="card manual">
      <h2 class="manual__title">Registro manual</h2>
      <p class="manual__hint">Estudou fora da plataforma? Lance os minutos aqui.</p>

      @if (serverError()) {
        <p class="alert alert--error" role="alert">{{ serverError() }}</p>
      }
      @if (criadaMin(); as min) {
        <p class="alert alert--success" role="status">Registrado: {{ min }} min de estudo.</p>
      }

      <div class="field" [class.field--invalid]="submitted() && !disciplinaId()">
        <label for="manual-disciplina">Disciplina</label>
        <select
          id="manual-disciplina"
          [ngModel]="disciplinaId()"
          (ngModelChange)="setDisciplina($event)"
        >
          <option value="" disabled>
            {{ disciplinas().length === 0 ? 'Selecione um plano acima' : 'Selecione a disciplina' }}
          </option>
          @for (disciplina of disciplinas(); track disciplina.id) {
            <option [value]="disciplina.id">{{ disciplina.nome }}</option>
          }
        </select>
        @if (submitted() && !disciplinaId()) {
          <span class="field__error">Selecione a disciplina.</span>
        }
      </div>

      <div class="field">
        <label for="manual-subtema">Subtema (opcional)</label>
        <select
          id="manual-subtema"
          [ngModel]="subtemaId()"
          (ngModelChange)="subtemaId.set($event)"
          [disabled]="!disciplinaId()"
        >
          <option value="">Sem subtema</option>
          @for (tema of temasDaDisciplina(); track tema.id) {
            <optgroup [label]="tema.nome">
              @for (subtema of tema.subtemas; track subtema.id) {
                <option [value]="subtema.id">{{ subtema.nome }}</option>
              }
            </optgroup>
          }
        </select>
      </div>

      <div class="manual__row">
        <div class="field" [class.field--invalid]="submitted() && dataError() !== null">
          <label for="manual-data">Data</label>
          <input
            id="manual-data"
            type="date"
            [max]="hoje"
            [ngModel]="data()"
            (ngModelChange)="data.set($event)"
          />
          @if (submitted() && dataError(); as erro) {
            <span class="field__error">{{ erro }}</span>
          }
        </div>
        <div class="field" [class.field--invalid]="submitted() && duracaoError() !== null">
          <label for="manual-duracao">Minutos</label>
          <input
            id="manual-duracao"
            type="number"
            min="1"
            step="1"
            inputmode="numeric"
            [ngModel]="duracaoMin()"
            (ngModelChange)="duracaoMin.set($event)"
          />
          @if (submitted() && duracaoError(); as erro) {
            <span class="field__error">{{ erro }}</span>
          }
        </div>
      </div>

      <button
        class="btn btn--primary btn--block"
        type="button"
        [disabled]="saving()"
        (click)="registrar()"
      >
        {{ saving() ? 'Registrando…' : 'Registrar tempo' }}
      </button>
    </div>
  `,
  styles: `
    .manual {
      display: grid;
      gap: 0.75rem;
      align-content: start;
    }
    .manual__title {
      margin: 0;
      font-size: 1.125rem;
    }
    .manual__hint {
      margin: 0;
      color: var(--color-text-muted);
      font-size: 0.875rem;
    }
    .manual__row {
      display: grid;
      gap: 0.75rem;
      grid-template-columns: 1fr;

      @media (min-width: 480px) {
        grid-template-columns: 1fr 1fr;
      }
    }
    .field {
      margin-bottom: 0;
    }
  `,
})
export class RegistroManual {
  private readonly sessaoService = inject(SessaoService);

  readonly disciplinas = input<DisciplinaTree[]>([]);
  readonly criada = output<Sessao>();

  /** Getter para o `max` do date-picker e a validação não ficarem obsoletos à meia-noite. */
  protected get hoje(): string {
    return hojeLocal();
  }

  readonly disciplinaId = signal('');
  readonly subtemaId = signal('');
  readonly data = signal(hojeLocal());
  readonly duracaoMin = signal<number | null>(null);

  readonly submitted = signal(false);
  readonly saving = signal(false);
  readonly serverError = signal<string | null>(null);
  readonly criadaMin = signal<number | null>(null);

  readonly temasDaDisciplina = computed(() => {
    const disciplina = this.disciplinas().find((d) => d.id === this.disciplinaId());
    return (disciplina?.temas ?? []).filter((t) => t.subtemas.length > 0);
  });

  /** Espelha CB-4: data obrigatória e não futura. */
  readonly dataError = computed(() => {
    const data = this.data();
    if (!data) return 'Informe a data do estudo.';
    if (data > this.hoje) return 'A data não pode ser futura.';
    return null;
  });

  /** Espelha CA-7: inteiro maior que zero. */
  readonly duracaoError = computed(() => {
    const duracao = this.duracaoMin();
    if (duracao === null || (duracao as unknown) === '') return 'Informe os minutos estudados.';
    if (!Number.isInteger(Number(duracao))) return 'Use um número inteiro de minutos.';
    if (Number(duracao) <= 0) return 'Os minutos devem ser maiores que zero.';
    return null;
  });

  setDisciplina(id: string): void {
    this.disciplinaId.set(id);
    this.subtemaId.set('');
  }

  registrar(): void {
    this.submitted.set(true);
    this.serverError.set(null);
    this.criadaMin.set(null);
    if (!this.disciplinaId() || this.dataError() !== null || this.duracaoError() !== null) return;

    this.saving.set(true);
    this.sessaoService
      .manual({
        disciplinaId: this.disciplinaId(),
        subtemaId: this.subtemaId() || undefined,
        data: this.data(),
        duracaoMin: Number(this.duracaoMin()),
      })
      .subscribe({
        next: (sessao) => {
          this.saving.set(false);
          this.submitted.set(false);
          this.criadaMin.set(sessao.duracaoMin);
          this.duracaoMin.set(null);
          this.criada.emit(sessao);
        },
        error: (err: unknown) => {
          this.saving.set(false);
          const apiError = extractApiError(err);
          const issues = (apiError.details ?? []).map((d) => d.issue).join(' · ');
          this.serverError.set(issues ? `${apiError.message} ${issues}` : apiError.message);
        },
      });
  }
}
