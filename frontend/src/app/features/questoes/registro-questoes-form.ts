import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { extractApiError } from '../../core/http/api-error';
import type { DisciplinaTree } from '../planos/planos.models';
import type { RegistroQuestoes } from './questoes.models';
import { hojeLocal } from './questoes.models';
import { QuestoesService } from './questoes.service';

const CAMPOS = ['temaId', 'subtemaId', 'data', 'total', 'erros'];

/** Registro de questões resolvidas por tema/subtema (US-1, CA-1..CA-5). */
@Component({
  selector: 'app-registro-questoes-form',
  imports: [DecimalPipe, FormsModule],
  template: `
    <div class="card qform">
      <h2 class="qform__title">Registrar questões</h2>
      <p class="qform__hint">Lance o total resolvido e os erros de um tema do plano.</p>

      @if (serverError()) {
        <p class="alert alert--error" role="alert">{{ serverError() }}</p>
      }
      @if (sucesso(); as reg) {
        <p class="alert alert--success" role="status">
          Registrado: {{ reg.total }} questões, {{ reg.erros }} erros ({{
            reg.taxaErro * 100 | number: '1.0-1'
          }}% de erro).
        </p>
      }

      <div class="field" [class.field--invalid]="temaVisibleError() !== null">
        <label for="qform-tema">Tema</label>
        <select id="qform-tema" [ngModel]="temaId()" (ngModelChange)="setTema($event)">
          <option value="" disabled>
            {{ disciplinas().length === 0 ? 'Selecione um plano acima' : 'Selecione o tema' }}
          </option>
          @for (disciplina of disciplinasComTemas(); track disciplina.id) {
            <optgroup [label]="disciplina.nome">
              @for (tema of disciplina.temas; track tema.id) {
                <option [value]="tema.id">{{ tema.nome }}</option>
              }
            </optgroup>
          }
        </select>
        @if (temaVisibleError(); as erro) {
          <span class="field__error">{{ erro }}</span>
        }
      </div>

      <div class="field" [class.field--invalid]="fieldErrors()['subtemaId'] !== undefined">
        <label for="qform-subtema">Subtema (opcional)</label>
        <select
          id="qform-subtema"
          [ngModel]="subtemaId()"
          (ngModelChange)="subtemaId.set($event)"
          [disabled]="!temaId()"
        >
          <option value="">Sem subtema</option>
          @for (subtema of subtemasDoTema(); track subtema.id) {
            <option [value]="subtema.id">{{ subtema.nome }}</option>
          }
        </select>
        @if (fieldErrors()['subtemaId']; as erro) {
          <span class="field__error">{{ erro }}</span>
        }
      </div>

      <div class="qform__row">
        <div class="field" [class.field--invalid]="dataVisibleError() !== null">
          <label for="qform-data">Data</label>
          <input
            id="qform-data"
            type="date"
            [max]="hoje"
            [ngModel]="data()"
            (ngModelChange)="data.set($event)"
          />
          @if (dataVisibleError(); as erro) {
            <span class="field__error">{{ erro }}</span>
          }
        </div>
        <div class="field" [class.field--invalid]="totalVisibleError() !== null">
          <label for="qform-total">Total de questões</label>
          <input
            id="qform-total"
            type="number"
            min="1"
            step="1"
            inputmode="numeric"
            [ngModel]="total()"
            (ngModelChange)="total.set($event)"
          />
          @if (totalVisibleError(); as erro) {
            <span class="field__error">{{ erro }}</span>
          }
        </div>
        <div class="field" [class.field--invalid]="errosVisibleError() !== null">
          <label for="qform-erros">Erros</label>
          <input
            id="qform-erros"
            type="number"
            min="0"
            step="1"
            inputmode="numeric"
            [ngModel]="erros()"
            (ngModelChange)="erros.set($event)"
          />
          @if (errosVisibleError(); as erro) {
            <span class="field__error">{{ erro }}</span>
          }
        </div>
      </div>

      <p class="qform__taxa" aria-live="polite">
        @if (taxaPreview(); as taxa) {
          Taxa de erro: <strong>{{ taxa.pct | number: '1.0-1' }}%</strong>
        } @else {
          Taxa de erro: <span class="qform__taxa-vazia">informe total e erros</span>
        }
      </p>

      <button
        class="btn btn--primary btn--block"
        type="button"
        [disabled]="saving()"
        (click)="registrar()"
      >
        {{ saving() ? 'Registrando…' : 'Registrar questões' }}
      </button>
    </div>
  `,
  styles: `
    .qform {
      display: grid;
      gap: 0.75rem;
      align-content: start;
    }
    .qform__title {
      margin: 0;
      font-size: 1.125rem;
    }
    .qform__hint {
      margin: 0;
      color: var(--text-secondary);
      font-size: 0.875rem;
    }
    .qform__row {
      display: grid;
      gap: 0.75rem;
      grid-template-columns: 1fr;

      @media (min-width: 480px) {
        /* minmax(0,…): sem o piso 0, o min-content do input de data alarga a
           linha além do card em colunas estreitas */
        grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr);
      }
    }
    .field {
      margin-bottom: 0;
    }
    .qform__taxa {
      margin: 0;
      font-size: 0.9375rem;
      color: var(--text-secondary);

      strong {
        color: var(--text-primary);
        font-variant-numeric: tabular-nums;
      }
    }
    .qform__taxa-vazia {
      font-size: 0.875rem;
    }
  `,
})
export class RegistroQuestoesForm {
  private readonly questoesService = inject(QuestoesService);

  readonly disciplinas = input<DisciplinaTree[]>([]);
  readonly criado = output<RegistroQuestoes>();

  /** Getter para o `max` do date-picker e a validação não ficarem obsoletos à meia-noite. */
  protected get hoje(): string {
    return hojeLocal();
  }

  readonly temaId = signal('');
  readonly subtemaId = signal('');
  readonly data = signal(hojeLocal());
  readonly total = signal<number | null>(null);
  readonly erros = signal<number | null>(null);

  readonly submitted = signal(false);
  readonly saving = signal(false);
  readonly serverError = signal<string | null>(null);
  /** Details do 422 por campo (CA-2..CA-4), exibidos junto ao campo correspondente. */
  readonly fieldErrors = signal<Record<string, string>>({});
  readonly sucesso = signal<RegistroQuestoes | null>(null);

  readonly disciplinasComTemas = computed(() =>
    this.disciplinas().filter((d) => d.temas.length > 0),
  );

  readonly subtemasDoTema = computed(() => {
    for (const disciplina of this.disciplinas()) {
      const tema = disciplina.temas.find((t) => t.id === this.temaId());
      if (tema) return tema.subtemas;
    }
    return [];
  });

  private readonly temaError = computed(() => (this.temaId() ? null : 'Selecione o tema.'));

  /** Espelha CA-3: data obrigatória e não futura. */
  private readonly dataError = computed(() => {
    const data = this.data();
    if (!data) return 'Informe a data.';
    if (data > this.hoje) return 'A data não pode ser futura.';
    return null;
  });

  /** Espelha RN-2: inteiro ≥ 1 (CB-1: total 0 não é permitido). */
  private readonly totalError = computed(() => {
    const total = this.total();
    if (total === null || (total as unknown) === '') return 'Informe o total de questões.';
    if (!Number.isInteger(Number(total))) return 'Use um número inteiro.';
    if (Number(total) < 1) return 'O total deve ser pelo menos 1.';
    return null;
  });

  /** Espelha RN-2: inteiro em 0..total (CA-2). */
  private readonly errosError = computed(() => {
    const erros = this.erros();
    if (erros === null || (erros as unknown) === '') return 'Informe o número de erros.';
    if (!Number.isInteger(Number(erros))) return 'Use um número inteiro.';
    if (Number(erros) < 0) return 'Os erros não podem ser negativos.';
    if (this.totalError() === null && Number(erros) > Number(this.total())) {
      return 'Os erros não podem exceder o total.';
    }
    return null;
  });

  readonly temaVisibleError = computed(() =>
    this.fieldErrors()['temaId'] ?? (this.submitted() ? this.temaError() : null),
  );

  readonly dataVisibleError = computed(() =>
    this.fieldErrors()['data'] ?? (this.submitted() ? this.dataError() : null),
  );

  readonly totalVisibleError = computed(() =>
    this.fieldErrors()['total'] ?? (this.submitted() ? this.totalError() : null),
  );

  /** erros > total aparece AO VIVO (antes do submit), como pede a spec. */
  readonly errosVisibleError = computed(() => {
    const server = this.fieldErrors()['erros'];
    if (server !== undefined) return server;
    if (this.submitted()) return this.errosError();
    const erros = Number(this.erros());
    if (
      this.erros() !== null &&
      Number.isInteger(erros) &&
      this.totalError() === null &&
      erros > Number(this.total())
    ) {
      return 'Os erros não podem exceder o total.';
    }
    return null;
  });

  /** Taxa calculada AO VIVO enquanto digita (objeto para 0% passar no @if). */
  readonly taxaPreview = computed(() => {
    const total = Number(this.total());
    const erros = Number(this.erros());
    if (this.total() === null || (this.total() as unknown) === '') return null;
    if (this.erros() === null || (this.erros() as unknown) === '') return null;
    if (!Number.isInteger(total) || total < 1) return null;
    if (!Number.isInteger(erros) || erros < 0 || erros > total) return null;
    return { pct: (erros / total) * 100 };
  });

  setTema(id: string): void {
    this.temaId.set(id);
    this.subtemaId.set('');
  }

  registrar(): void {
    this.submitted.set(true);
    this.serverError.set(null);
    this.fieldErrors.set({});
    this.sucesso.set(null);
    if (this.temaError() || this.dataError() || this.totalError() || this.errosError()) return;

    this.saving.set(true);
    this.questoesService
      .create({
        temaId: this.temaId(),
        subtemaId: this.subtemaId() || undefined,
        data: this.data(),
        total: Number(this.total()),
        erros: Number(this.erros()),
      })
      .subscribe({
        next: (registro) => {
          this.saving.set(false);
          this.submitted.set(false);
          this.sucesso.set(registro);
          this.total.set(null);
          this.erros.set(null);
          this.criado.emit(registro);
        },
        error: (err: unknown) => {
          this.saving.set(false);
          const apiError = extractApiError(err);
          const fields: Record<string, string> = {};
          const avulsos: string[] = [];
          for (const detail of apiError.details ?? []) {
            if (CAMPOS.includes(detail.field)) fields[detail.field] = detail.issue;
            else avulsos.push(detail.issue);
          }
          this.fieldErrors.set(fields);
          this.serverError.set(
            avulsos.length > 0 ? `${apiError.message} ${avulsos.join(' · ')}` : apiError.message,
          );
        },
      });
  }
}
