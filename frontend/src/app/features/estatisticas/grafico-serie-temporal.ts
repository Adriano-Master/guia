import { formatDate, formatNumber } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  LOCALE_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { extractApiError } from '../../core/http/api-error';
import type { Granularidade, SerieTemporal } from './estatisticas.models';
import { EstatisticasService } from './estatisticas.service';

/**
 * O viewBox acompanha a largura medida do container (1 unidade SVG ≈ 1px
 * CSS), então o texto dos eixos mantém os 11px REAIS em qualquer viewport —
 * um viewBox fixo encolheria os rótulos junto no mobile. Sem ResizeObserver
 * (SSR/jsdom) fica a largura padrão.
 */
const LARGURA_PADRAO = 640;
const LARGURA_MINIMA = 240;
/** Abaixo disto o eixo X mostra só a primeira e a última data. */
const LARGURA_ESTREITA = 420;
const VB_H = 220;
const PAD = { top: 12, right: 16, bottom: 26, left: 44 };

interface Ponto {
  x: number;
  y: number;
  bucket: string;
  horas: number;
  titulo: string;
}

/**
 * Série temporal de horas (US-04) — GET /estatisticas/serie-temporal. Série
 * ÚNICA (sem legenda, o título do painel a nomeia), eixo único, traço 2px em
 * --chart-1; buckets zerados fazem parte da linha (série contínua, CA-04).
 * Cada ponto tem alvo de hover maior que a marca com tooltip via <title>.
 */
@Component({
  selector: 'app-grafico-serie-temporal',
  imports: [FormsModule],
  template: `
    <div class="gserie__filtros">
      <div class="gserie__toggle" role="group" aria-label="Granularidade da série">
        <button
          type="button"
          class="btn btn--sm"
          [class.btn--primary]="granularidade() === 'dia'"
          [class.btn--outline]="granularidade() !== 'dia'"
          [attr.aria-pressed]="granularidade() === 'dia'"
          (click)="setGranularidade('dia')"
        >
          Dia
        </button>
        <button
          type="button"
          class="btn btn--sm"
          [class.btn--primary]="granularidade() === 'semana'"
          [class.btn--outline]="granularidade() !== 'semana'"
          [attr.aria-pressed]="granularidade() === 'semana'"
          (click)="setGranularidade('semana')"
        >
          Semana
        </button>
      </div>
      <div class="field">
        <label for="gserie-from">De</label>
        <input id="gserie-from" type="date" [ngModel]="from()" (ngModelChange)="setFrom($event)" />
      </div>
      <div class="field">
        <label for="gserie-to">Até</label>
        <input id="gserie-to" type="date" [ngModel]="to()" (ngModelChange)="setTo($event)" />
      </div>
    </div>

    @if (error()) {
      <p class="alert alert--error" role="alert">{{ error() }}</p>
    }

    @if (loading()) {
      <p class="gserie__state">Carregando série temporal…</p>
    } @else if (result(); as res) {
      @if (res.data.length === 0) {
        <p class="gserie__state">Nenhum dado no período.</p>
      } @else {
        <svg
          class="gserie__svg"
          [attr.viewBox]="'0 0 ' + largura() + ' ' + VB_H"
          role="img"
          [attr.aria-label]="ariaLabel()"
        >
          @for (tick of yTicks(); track tick.y) {
            <line
              class="gserie__grade"
              [attr.x1]="PAD.left"
              [attr.x2]="largura() - PAD.right"
              [attr.y1]="tick.y"
              [attr.y2]="tick.y"
            />
            <text
              class="gserie__eixo"
              [attr.x]="PAD.left - 8"
              [attr.y]="tick.y + 4"
              text-anchor="end"
            >
              {{ tick.label }}
            </text>
          }
          @for (tick of xTicks(); track tick.x) {
            <text class="gserie__eixo" [attr.x]="tick.x" [attr.y]="VB_H - 8" text-anchor="middle">
              {{ tick.label }}
            </text>
          }
          <path class="gserie__linha" [attr.d]="path()" />
          @for (p of pontos(); track p.bucket) {
            <g class="gserie__ponto">
              <circle class="gserie__dot" [attr.cx]="p.x" [attr.cy]="p.y" r="2.5" />
              <circle class="gserie__hit" [attr.cx]="p.x" [attr.cy]="p.y" r="10">
                <title>{{ p.titulo }}</title>
              </circle>
            </g>
          }
        </svg>
      }
    }
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .gserie__filtros {
      display: flex;
      flex-wrap: wrap;
      align-items: end;
      gap: 0.75rem;
      margin-bottom: 0.75rem;

      .field {
        margin-bottom: 0;
      }
    }
    .gserie__toggle {
      display: inline-flex;
      gap: 0.375rem;
      /* alinha com a base dos inputs de data ao lado */
      padding-bottom: 0.25rem;
    }
    .gserie__state {
      margin: 0;
      padding: 1.5rem 0;
      text-align: center;
      color: var(--text-secondary);
    }
    /* Altura fixa do viewBox: com o viewBox casando com a largura medida,
       1 unidade ≈ 1px e o texto dos eixos não escala com o viewport. */
    .gserie__svg {
      display: block;
      width: 100%;
      height: auto;
    }
    .gserie__grade {
      stroke: var(--glass-border);
      stroke-width: 1;
      vector-effect: non-scaling-stroke;
    }
    .gserie__eixo {
      fill: var(--text-secondary);
      font-size: 11px;
    }
    .gserie__linha {
      fill: none;
      stroke: var(--chart-1);
      stroke-width: 2;
      stroke-linejoin: round;
      stroke-linecap: round;
      vector-effect: non-scaling-stroke;
    }
    .gserie__dot {
      fill: var(--chart-1);
    }
    .gserie__ponto:hover .gserie__dot {
      r: 4.5;
    }
    .gserie__hit {
      fill: transparent;
    }
  `,
})
export class GraficoSerieTemporal {
  private readonly estatisticasService = inject(EstatisticasService);
  private readonly locale = inject(LOCALE_ID);
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly VB_H = VB_H;
  protected readonly PAD = PAD;

  readonly granularidade = signal<Granularidade>('dia');
  readonly from = signal('');
  readonly to = signal('');

  readonly result = signal<SerieTemporal | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  /** Largura do container em px CSS ≈ largura do viewBox (M1 do review). */
  readonly largura = signal(LARGURA_PADRAO);

  /** Guarda de staleness: respostas de um load antigo não sobrescrevem o atual. */
  private loadSeq = 0;

  /** Teto do eixo Y (mín. 1h para a série toda-zerada não colar no topo). */
  private readonly maxHoras = computed(() => {
    const res = this.result();
    if (!res) return 1;
    return Math.max(...res.data.map((p) => p.horas), 1);
  });

  readonly pontos = computed<Ponto[]>(() => {
    const res = this.result();
    if (!res || res.data.length === 0) return [];
    const innerW = this.largura() - PAD.left - PAD.right;
    const innerH = VB_H - PAD.top - PAD.bottom;
    const max = this.maxHoras();
    const passo = res.data.length > 1 ? innerW / (res.data.length - 1) : 0;
    const prefixo = res.granularidade === 'semana' ? 'semana de ' : '';
    return res.data.map((p, i) => ({
      x: round2(PAD.left + (res.data.length === 1 ? innerW / 2 : i * passo)),
      y: round2(PAD.top + innerH - (p.horas / max) * innerH),
      bucket: p.bucket,
      horas: p.horas,
      titulo: `${formatNumber(p.horas, this.locale, '1.0-1')} h — ${prefixo}${formatDate(p.bucket, 'dd/MM/yyyy', this.locale)}`,
    }));
  });

  readonly path = computed(() =>
    this.pontos()
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`)
      .join(' '),
  );

  /** Grades/rótulos esparsos e recessivos: 0, metade e teto. */
  readonly yTicks = computed(() => {
    const max = this.maxHoras();
    const innerH = VB_H - PAD.top - PAD.bottom;
    return [0, 0.5, 1].map((fracao) => ({
      y: round2(PAD.top + innerH - fracao * innerH),
      label: `${formatNumber(max * fracao, this.locale, '1.0-1')} h`,
    }));
  });

  /** Em containers estreitos os rótulos do X caem para 2 (primeiro/último). */
  readonly xTicks = computed(() => {
    const pontos = this.pontos();
    if (pontos.length === 0) return [];
    const indices =
      this.largura() < LARGURA_ESTREITA
        ? [...new Set([0, pontos.length - 1])]
        : [...new Set([0, Math.floor((pontos.length - 1) / 2), pontos.length - 1])];
    return indices.map((i) => ({
      x: pontos[i].x,
      label: formatDate(pontos[i].bucket, 'dd/MM', this.locale),
    }));
  });

  /** Alternativa textual da linha: período, granularidade e total (a11y). */
  readonly ariaLabel = computed(() => {
    const res = this.result();
    if (!res) return '';
    const total = res.data.reduce((soma, p) => soma + p.horas, 0);
    const unidade = res.granularidade === 'semana' ? 'semana' : 'dia';
    return (
      `Horas de estudo por ${unidade} de ` +
      `${formatDate(res.from, 'dd/MM/yyyy', this.locale)} a ` +
      `${formatDate(res.to, 'dd/MM/yyyy', this.locale)}: ` +
      `total de ${formatNumber(total, this.locale, '1.0-1')} h`
    );
  });

  constructor() {
    this.load();
    this.observarLargura();
  }

  setGranularidade(valor: Granularidade): void {
    if (this.granularidade() === valor) return;
    this.granularidade.set(valor);
    this.load();
  }

  setFrom(valor: string): void {
    this.from.set(valor);
    this.load();
  }

  setTo(valor: string): void {
    this.to.set(valor);
    this.load();
  }

  load(): void {
    const seq = ++this.loadSeq;
    this.loading.set(true);
    this.error.set(null);
    this.estatisticasService
      .serieTemporal({
        granularidade: this.granularidade(),
        // Dias de calendário, ambos inclusivos; omitidos → backend aplica 30 dias.
        from: this.from() || undefined,
        to: this.to() || undefined,
      })
      .subscribe({
        next: (res) => {
          if (seq !== this.loadSeq) return;
          this.result.set(res);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          if (seq !== this.loadSeq) return;
          this.loading.set(false);
          this.error.set(extractApiError(err).message);
        },
      });
  }

  private observarLargura(): void {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const largura = entries[0]?.contentRect.width ?? 0;
      if (largura > 0) this.largura.set(Math.max(Math.round(largura), LARGURA_MINIMA));
    });
    observer.observe(this.elementRef.nativeElement);
    this.destroyRef.onDestroy(() => observer.disconnect());
  }
}

function round2(valor: number): number {
  return Math.round(valor * 100) / 100;
}
