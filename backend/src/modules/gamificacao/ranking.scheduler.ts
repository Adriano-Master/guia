import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { RankingService } from './ranking.service';

const CRON_JOB_NAME = 'ranking-recomputacao';
const BOOT_TIMEOUT_NAME = 'ranking-recomputacao-boot';

/** Pequeno delay pós-boot: deixa o app terminar de subir antes da 1ª recomputação. */
const BOOT_DELAY_MS = 5_000;

/**
 * Decisão do design: batch agendado (não trigger). Cron configurável por env
 * (RANKING_CRON, default de hora em hora) + uma execução logo após o boot;
 * RANKING_CRON_DISABLED=true desliga tudo (necessário nos e2e).
 */
@Injectable()
export class RankingScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(RankingScheduler.name);

  /** Guarda de reentrância: boot × tick do cron (ou recomputação mais longa
   * que o intervalo) não podem sobrepor — dois recomputarTodos() concorrentes
   * arriscam deadlock no UPSERT multi-linha. */
  private executando = false;

  constructor(
    private readonly config: ConfigService,
    private readonly registry: SchedulerRegistry,
    private readonly rankingService: RankingService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get<boolean>('RANKING_CRON_DISABLED', false)) {
      this.logger.log('Scheduler do ranking desabilitado (RANKING_CRON_DISABLED=true).');
      return;
    }

    const cron = this.config.get<string>('RANKING_CRON', '0 * * * *');
    const job = new CronJob(cron, () => void this.executar('cron'));
    this.registry.addCronJob(CRON_JOB_NAME, job);
    job.start();

    const timeout = setTimeout(() => void this.executar('boot'), BOOT_DELAY_MS);
    this.registry.addTimeout(BOOT_TIMEOUT_NAME, timeout);
    this.logger.log(`Scheduler do ranking registrado (cron: ${cron}).`);
  }

  /** Log de início/fim com contagem; falha é logada sem derrubar o processo. */
  private async executar(origem: 'boot' | 'cron'): Promise<void> {
    if (this.executando) {
      this.logger.warn(`Recomputação do ranking pulada (${origem}): execução anterior em andamento.`);
      return;
    }
    this.executando = true;
    this.logger.log(`Recomputação do ranking iniciada (${origem}).`);
    try {
      const total = await this.rankingService.recomputarTodos();
      this.logger.log(`Recomputação do ranking concluída (${origem}): ${total} aluno(s).`);
    } catch (error) {
      this.logger.error(
        `Recomputação do ranking falhou (${origem}).`,
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.executando = false;
    }
  }
}
