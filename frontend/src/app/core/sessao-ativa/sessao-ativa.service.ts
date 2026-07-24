import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';

import type { Sessao, StartCronometroInput } from '../../features/sessoes/sessoes.models';
import { SessaoService } from '../../features/sessoes/sessoes.service';
import { AuthService } from '../auth/auth.service';

const MS_POR_MIN = 60_000;

/**
 * Estado compartilhado da sessão CRONOMETRO em andamento (uma por aluno).
 * Vive na raiz para o cronômetro sobreviver à navegação: o acúmulo LOCAL de
 * pausa (D-3), que antes morria com o componente ao trocar de página, agora
 * persiste enquanto o app estiver aberto. A aproximação documentada (CB-3) —
 * pausas anteriores se perdem porque o servidor não persiste os instantes de
 * pausa — fica restrita ao reload da página.
 *
 * Hidratação via GET /sessoes/ativa: automática no boot/login de um ALUNO
 * (effect sobre os signals do AuthService) e sob demanda pelos consumidores;
 * logout limpa o estado. Os métodos start/pause/resume/stop/discard envolvem
 * o SessaoService HTTP com `tap` de estado — o observable retornado deve ser
 * assinado pelo chamador (que trata os erros).
 */
@Injectable({ providedIn: 'root' })
export class SessaoAtivaService {
  private readonly sessaoService = inject(SessaoService);
  private readonly auth = inject(AuthService);

  private readonly sessaoSignal = signal<Sessao | null>(null);
  private readonly pausadoSignal = signal(false);

  /** Acúmulo local de pausa (D-3): total fechado + início da pausa corrente. */
  private readonly pausaAcumuladaMs = signal(0);
  private readonly pausadoDesde = signal<number | null>(null);

  private readonly agora = signal(Date.now());
  private hidratada = false;

  readonly carregando = signal(false);
  readonly sessao = this.sessaoSignal.asReadonly();
  readonly pausado = this.pausadoSignal.asReadonly();

  private readonly pausaTotalMs = computed(() => {
    const desde = this.pausadoDesde();
    return this.pausaAcumuladaMs() + (desde !== null ? this.agora() - desde : 0);
  });

  readonly pausaMinAtual = computed(() => Math.floor(this.pausaTotalMs() / MS_POR_MIN));

  /** hh:mm:ss decorridos, descontando a pausa local. Apenas visual (D-1). */
  readonly decorridoLabel = computed(() => {
    const sessao = this.sessaoSignal();
    if (!sessao) return '00:00:00';
    const decorridoMs = Math.max(
      0,
      this.agora() - new Date(sessao.inicio).getTime() - this.pausaTotalMs(),
    );
    const total = Math.floor(decorridoMs / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
  });

  constructor() {
    // Ticking de 1 s apenas enquanto há sessão em andamento.
    effect((onCleanup) => {
      if (this.sessaoSignal() === null) return;
      const timer = setInterval(() => this.agora.set(Date.now()), 1000);
      onCleanup(() => clearInterval(timer));
    });

    // Boot/login de ALUNO hidrata; logout (ou role interna) limpa o estado.
    effect(() => {
      if (this.auth.isAuthenticated() && this.auth.role() === 'ALUNO') {
        // 404 (sem cronômetro) e falhas de rede no boot são silenciosos: o
        // widget só não aparece; a página Estudar re-hidrata sob demanda.
        this.hidratarSeNecessario()?.subscribe({ error: () => {} });
      } else {
        this.hidratada = false;
        this.limpar();
      }
    });
  }

  /** Reidratação forçada (CB-3; também no pós-409 do start). */
  hidratar(): Observable<Sessao> {
    this.hidratada = true;
    this.carregando.set(true);
    return this.sessaoService.getAtiva().pipe(
      tap({
        next: (sessao) => {
          this.carregando.set(false);
          this.aplicarSessao(sessao);
          // Aproximação documentada: pausas anteriores ao reload se perdem;
          // se PAUSED, a pausa corrente conta a partir de agora.
          if (sessao.estado === 'PAUSED') {
            this.pausadoSignal.set(true);
            this.pausadoDesde.set(Date.now());
          }
        },
        error: () => this.carregando.set(false),
      }),
    );
  }

  /** Hidrata uma única vez; null quando já hidratada (estado é reaproveitado). */
  hidratarSeNecessario(): Observable<Sessao> | null {
    if (this.hidratada || this.carregando()) return null;
    return this.hidratar();
  }

  start(input: StartCronometroInput): Observable<Sessao> {
    return this.sessaoService.start(input).pipe(tap((sessao) => this.aplicarSessao(sessao)));
  }

  pause(): Observable<Sessao> {
    return this.sessaoService.pause().pipe(
      tap(() => {
        this.pausadoSignal.set(true);
        this.pausadoDesde.set(Date.now());
      }),
    );
  }

  resume(): Observable<Sessao> {
    return this.sessaoService.resume().pipe(
      tap(() => {
        const desde = this.pausadoDesde();
        if (desde !== null) {
          this.pausaAcumuladaMs.set(this.pausaAcumuladaMs() + (Date.now() - desde));
        }
        this.pausadoDesde.set(null);
        this.pausadoSignal.set(false);
      }),
    );
  }

  /** Envia o acúmulo local arredondado como pausaMin (D-3) e limpa no sucesso. */
  stop(): Observable<Sessao> {
    const pausaMin = Math.round(this.pausaTotalMs() / MS_POR_MIN);
    return this.sessaoService.stop(pausaMin).pipe(tap(() => this.limpar()));
  }

  discard(): Observable<void> {
    return this.sessaoService.discard().pipe(tap(() => this.limpar()));
  }

  /** Zera o estado local (logout, sessão finalizada em outra aba). */
  limpar(): void {
    this.sessaoSignal.set(null);
    this.pausadoSignal.set(false);
    this.pausaAcumuladaMs.set(0);
    this.pausadoDesde.set(null);
  }

  private aplicarSessao(sessao: Sessao): void {
    this.hidratada = true;
    this.sessaoSignal.set(sessao);
    this.pausadoSignal.set(false);
    this.pausaAcumuladaMs.set(0);
    this.pausadoDesde.set(null);
    this.agora.set(Date.now());
  }
}
