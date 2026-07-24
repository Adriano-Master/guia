import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { Observable } from 'rxjs';

import { extractApiError } from '../../core/http/api-error';
import { SessaoAtivaService } from '../../core/sessao-ativa/sessao-ativa.service';
import type { DisciplinaTree } from '../planos/planos.models';
import type { CronometroPrefill, Sessao } from './sessoes.models';

/**
 * Cronômetro de estudo (US-1..US-4). O tempo exibido é apenas visual: a fonte
 * da verdade é o servidor (D-1) — a duração oficial deriva de inicio/fim no
 * stop. O ESTADO da sessão ativa (incluindo o acúmulo local de pausa, D-3, e a
 * aproximação de reidratação, CB-3) vive no SessaoAtivaService, para o
 * cronômetro sobreviver à navegação; este componente é o formulário/painel que
 * consome esse serviço.
 *
 * Modo `embutido` (modal do calendário): sem card/título próprios, seletores
 * ocultos quando há prefill (os nomes viram texto) e aviso quando já existe um
 * cronômetro em andamento que não é o deste bloco.
 */
@Component({
  selector: 'app-cronometro',
  imports: [FormsModule],
  template: `
    <div class="crono" [class.card]="!embutido()">
      @if (!embutido()) {
        <h2 class="crono__title">Cronômetro</h2>
      }

      @if (error()) {
        <div class="alert alert--error" role="alert">
          {{ error() }}
          @if (conflito()) {
            <button
              class="btn btn--outline btn--sm crono__ir"
              type="button"
              (click)="carregarAtiva()"
            >
              Ir para o cronômetro em andamento
            </button>
          }
        </div>
      }
      @if (registrada(); as s) {
        <p class="alert alert--success" role="status">
          Sessão registrada: {{ s.duracaoMin }} min de estudo.
        </p>
      }

      @if (carregando()) {
        <p class="crono__state">Verificando cronômetro em andamento…</p>
      } @else if (sessao(); as s) {
        @if (avisoOutraSessao()) {
          <p class="crono__aviso" role="status">
            Já existe um cronômetro em andamento — ele é exibido abaixo. Fechar esta janela não
            interrompe a contagem.
          </p>
        }
        <p class="crono__alvo">
          <strong>{{ disciplinaNomeAtiva() }}</strong>
          @if (subtemaNomeAtivo(); as subtema) {
            <span> · {{ subtema }}</span>
          }
          @if (s.blocoId) {
            <span class="badge crono__badge">bloco do calendário</span>
          }
        </p>

        <p class="crono__display" [class.crono__display--pausado]="pausado()" aria-live="off">
          {{ decorridoLabel() }}
        </p>
        <p class="crono__estado">
          {{ pausado() ? 'Pausado' : 'Em andamento' }}
          @if (pausaMinAtual() > 0) {
            <span> · {{ pausaMinAtual() }} min em pausa</span>
          }
        </p>

        <div class="crono__actions">
          @if (pausado()) {
            <button
              class="btn btn--primary"
              type="button"
              [disabled]="pendente()"
              (click)="resume()"
            >
              Retomar
            </button>
          } @else {
            <button
              class="btn btn--outline"
              type="button"
              [disabled]="pendente()"
              (click)="pause()"
            >
              Pausar
            </button>
          }
          <button class="btn btn--primary" type="button" [disabled]="pendente()" (click)="stop()">
            Parar e registrar
          </button>
          <button
            class="btn btn--outline crono__discard"
            type="button"
            [disabled]="pendente()"
            (click)="descartar()"
          >
            Descartar
          </button>
        </div>
      } @else {
        @if (embutido() && prefill()?.disciplinaId) {
          <p class="crono__alvo">
            <strong>{{ prefillDisciplinaNome() }}</strong>
            @if (prefillSubtemaNome(); as subtema) {
              <span> · {{ subtema }}</span>
            }
          </p>
          @if (blocoId()) {
            <p class="crono__bloco-hint">Esta sessão será vinculada ao bloco do calendário.</p>
          }
        } @else {
          <div class="field" [class.field--invalid]="submitted() && !disciplinaId()">
            <label for="crono-disciplina">Disciplina</label>
            <select
              id="crono-disciplina"
              [ngModel]="disciplinaId()"
              (ngModelChange)="setDisciplina($event)"
            >
              <option value="" disabled>
                {{
                  disciplinas().length === 0 ? 'Selecione um plano acima' : 'Selecione a disciplina'
                }}
              </option>
              @for (disciplina of disciplinas(); track disciplina.id) {
                <option [value]="disciplina.id">{{ disciplina.nome }}</option>
              }
            </select>
            @if (submitted() && !disciplinaId()) {
              <span class="field__error">Selecione a disciplina para iniciar.</span>
            }
          </div>

          <div class="field">
            <label for="crono-subtema">Subtema (opcional)</label>
            <select
              id="crono-subtema"
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

          @if (blocoId()) {
            <p class="crono__bloco-hint">
              Esta sessão será vinculada ao bloco do calendário.
              <button class="btn btn--outline btn--sm" type="button" (click)="removerVinculo()">
                Remover vínculo
              </button>
            </p>
          }
        }

        <button
          class="btn btn--primary btn--block"
          type="button"
          [disabled]="pendente()"
          (click)="start()"
        >
          {{ pendente() ? 'Iniciando…' : 'Iniciar cronômetro' }}
        </button>
      }
    </div>
  `,
  styles: `
    .crono {
      display: grid;
      gap: 0.75rem;
      align-content: start;
    }
    .crono__title {
      margin: 0;
      font-size: 1.125rem;
    }
    .crono__state {
      margin: 0;
      color: var(--color-text-muted);
      text-align: center;
      padding: 1.5rem 0;
    }
    .crono__ir {
      display: block;
      margin-top: 0.5rem;
    }
    .crono__aviso {
      margin: 0;
      padding: 0.75rem 1rem;
      border: 1px solid var(--glass-border);
      border-radius: 0.5rem;
      background: var(--surface-inset);
      color: var(--color-text-muted);
      font-size: 0.875rem;
    }
    .crono__alvo {
      margin: 0;
      font-size: 0.9375rem;

      span {
        color: var(--color-text-muted);
      }
    }
    .crono__badge {
      margin-left: 0.5rem;
    }
    .crono__display {
      margin: 0;
      font-size: 3rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      text-align: center;
      letter-spacing: 0.05em;
    }
    .crono__display--pausado {
      color: var(--color-text-muted);
    }
    .crono__estado {
      margin: 0;
      text-align: center;
      color: var(--color-text-muted);
      font-size: 0.875rem;
    }
    .crono__actions {
      display: flex;
      justify-content: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .crono__discard {
      color: var(--color-danger);
    }
    .crono__bloco-hint {
      margin: 0;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
      font-size: 0.8125rem;
      color: var(--color-text-muted);
    }
    .field {
      margin-bottom: 0;
    }
  `,
})
export class Cronometro {
  private readonly sessaoAtiva = inject(SessaoAtivaService);

  readonly disciplinas = input<DisciplinaTree[]>([]);
  readonly prefill = input<CronometroPrefill | null>(null);
  /** Modo modal/embutido: sem card próprio, prefill vira texto (não seletores). */
  readonly embutido = input(false);

  /** Emitida quando uma sessão é finalizada com sucesso (stop). */
  readonly finalizada = output<Sessao>();

  readonly pendente = signal(false);
  readonly submitted = signal(false);
  readonly error = signal<string | null>(null);
  readonly conflito = signal(false);
  readonly registrada = signal<Sessao | null>(null);

  // Estado da sessão ativa: delegado ao serviço (sobrevive à navegação).
  readonly carregando = this.sessaoAtiva.carregando;
  readonly sessao = this.sessaoAtiva.sessao;
  readonly pausado = this.sessaoAtiva.pausado;
  readonly pausaMinAtual = this.sessaoAtiva.pausaMinAtual;
  readonly decorridoLabel = this.sessaoAtiva.decorridoLabel;

  readonly disciplinaId = signal('');
  readonly subtemaId = signal('');
  readonly blocoId = signal<string | null>(null);

  readonly temasDaDisciplina = computed(() => {
    const disciplina = this.disciplinas().find((d) => d.id === this.disciplinaId());
    return (disciplina?.temas ?? []).filter((t) => t.subtemas.length > 0);
  });

  readonly disciplinaNomeAtiva = computed(() => {
    const sessao = this.sessao();
    if (!sessao) return '';
    return (
      this.disciplinas().find((d) => d.id === sessao.disciplinaId)?.nome ?? 'Sessão em andamento'
    );
  });

  readonly subtemaNomeAtivo = computed(() => {
    const sessao = this.sessao();
    if (!sessao?.subtemaId) return null;
    return this.nomeDoSubtema(sessao.subtemaId);
  });

  readonly prefillDisciplinaNome = computed(() => {
    const id = this.prefill()?.disciplinaId;
    return this.disciplinas().find((d) => d.id === id)?.nome ?? 'Disciplina';
  });

  readonly prefillSubtemaNome = computed(() => {
    const id = this.prefill()?.subtemaId;
    return id ? this.nomeDoSubtema(id) : null;
  });

  /** Sessão em andamento que não nasceu do bloco prefilled (modal, mudança B). */
  readonly avisoOutraSessao = computed(() => {
    if (!this.embutido()) return false;
    const sessao = this.sessao();
    if (!sessao) return false;
    return sessao.blocoId !== (this.prefill()?.blocoId ?? null);
  });

  constructor() {
    // Pré-preenche os seletores quando o aluno chega do calendário (US-7).
    effect(() => {
      const prefill = this.prefill();
      if (!prefill) return;
      if (prefill.disciplinaId) this.disciplinaId.set(prefill.disciplinaId);
      this.subtemaId.set(prefill.subtemaId ?? '');
      this.blocoId.set(prefill.blocoId ?? null);
    });

    this.assinarReidratacao(this.sessaoAtiva.hidratarSeNecessario());
  }

  setDisciplina(id: string): void {
    this.disciplinaId.set(id);
    this.subtemaId.set('');
  }

  removerVinculo(): void {
    this.blocoId.set(null);
  }

  start(): void {
    this.submitted.set(true);
    this.registrada.set(null);
    if (!this.disciplinaId()) return;

    this.pendente.set(true);
    this.limparErro();
    this.sessaoAtiva
      .start({
        disciplinaId: this.disciplinaId(),
        subtemaId: this.subtemaId() || undefined,
        blocoId: this.blocoId() ?? undefined,
      })
      .subscribe({
        next: () => {
          this.pendente.set(false);
          this.submitted.set(false);
        },
        error: (err: unknown) => {
          this.pendente.set(false);
          const apiError = extractApiError(err);
          if (apiError.code === 'CONFLICT') {
            this.error.set('Já há um cronômetro em andamento.');
            this.conflito.set(true);
          } else {
            this.error.set(this.mensagemComDetails(apiError));
          }
        },
      });
  }

  pause(): void {
    this.executar(this.sessaoAtiva.pause());
  }

  resume(): void {
    this.executar(this.sessaoAtiva.resume());
  }

  stop(): void {
    this.pendente.set(true);
    this.limparErro();
    this.sessaoAtiva.stop().subscribe({
      next: (sessao) => {
        this.pendente.set(false);
        this.registrada.set(sessao);
        this.finalizada.emit(sessao);
      },
      error: (err: unknown) => this.tratarErroDeAtiva(err),
    });
  }

  descartar(): void {
    if (!confirm('Descartar o cronômetro em andamento? O tempo NÃO será registrado.')) return;
    this.pendente.set(true);
    this.limparErro();
    this.sessaoAtiva.discard().subscribe({
      next: () => this.pendente.set(false),
      error: (err: unknown) => this.tratarErroDeAtiva(err),
    });
  }

  /** Reidratação sob demanda (após 409 no start, "ir para ele"). */
  carregarAtiva(): void {
    this.limparErro();
    this.assinarReidratacao(this.sessaoAtiva.hidratar());
  }

  private assinarReidratacao(fonte: Observable<Sessao> | null): void {
    if (!fonte) return;
    fonte.subscribe({
      error: (err: unknown) => {
        const apiError = extractApiError(err);
        if (apiError.code !== 'NOT_FOUND') this.error.set(apiError.message);
      },
    });
  }

  private executar(acao: Observable<Sessao>): void {
    this.pendente.set(true);
    this.limparErro();
    acao.subscribe({
      next: () => this.pendente.set(false),
      error: (err: unknown) => this.tratarErroDeAtiva(err),
    });
  }

  /** 404 aqui significa que a sessão sumiu (ex.: finalizada em outra aba). */
  private tratarErroDeAtiva(err: unknown): void {
    this.pendente.set(false);
    const apiError = extractApiError(err);
    if (apiError.code === 'NOT_FOUND') {
      this.sessaoAtiva.limpar();
      this.error.set('O cronômetro não está mais em andamento (finalizado em outra aba?).');
    } else {
      this.error.set(this.mensagemComDetails(apiError));
    }
  }

  private nomeDoSubtema(subtemaId: string): string | null {
    for (const d of this.disciplinas()) {
      for (const t of d.temas) {
        const subtema = t.subtemas.find((s) => s.id === subtemaId);
        if (subtema) return subtema.nome;
      }
    }
    return null;
  }

  private mensagemComDetails(apiError: ReturnType<typeof extractApiError>): string {
    const issues = (apiError.details ?? []).map((d) => d.issue).join(' · ');
    return issues ? `${apiError.message} ${issues}` : apiError.message;
  }

  private limparErro(): void {
    this.error.set(null);
    this.conflito.set(false);
  }
}
