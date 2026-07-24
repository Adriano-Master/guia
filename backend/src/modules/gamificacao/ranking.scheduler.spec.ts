import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { RankingScheduler } from './ranking.scheduler';
import { RankingService } from './ranking.service';

type RegistryMock = { addCronJob: jest.Mock; addTimeout: jest.Mock };

function registryMock(): RegistryMock {
  return { addCronJob: jest.fn(), addTimeout: jest.fn() };
}

function configMock(overrides: Record<string, unknown> = {}): ConfigService {
  return {
    get: (key: string, def?: unknown) => overrides[key] ?? def,
  } as unknown as ConfigService;
}

function buildScheduler(
  overrides: Record<string, unknown>,
  registry: RegistryMock,
  recomputarTodos: jest.Mock = jest.fn().mockResolvedValue(0),
): { scheduler: RankingScheduler; recomputarTodos: jest.Mock } {
  const scheduler = new RankingScheduler(
    configMock(overrides),
    registry as unknown as SchedulerRegistry,
    { recomputarTodos } as unknown as RankingService,
  );
  return { scheduler, recomputarTodos };
}

describe('RankingScheduler (unit)', () => {
  beforeEach(() => {
    // Meio da hora: o cron default (0 * * * *) está longe de disparar
    jest.useFakeTimers({ now: new Date('2026-07-23T10:20:00Z') });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  /** Para os jobs/timeouts registrados no mock (higiene entre testes). */
  function pararRegistrados(registry: RegistryMock): void {
    for (const call of registry.addCronJob.mock.calls) {
      (call[1] as CronJob).stop();
    }
    for (const call of registry.addTimeout.mock.calls) {
      clearTimeout(call[1] as NodeJS.Timeout);
    }
  }

  it('RANKING_CRON_DISABLED=true → NÃO registra cron nem timeout de boot', () => {
    const registry = registryMock();
    const { scheduler, recomputarTodos } = buildScheduler(
      { RANKING_CRON_DISABLED: true },
      registry,
    );

    scheduler.onApplicationBootstrap();

    expect(registry.addCronJob).not.toHaveBeenCalled();
    expect(registry.addTimeout).not.toHaveBeenCalled();
    expect(recomputarTodos).not.toHaveBeenCalled();
  });

  it('habilitado: registra CronJob com o cron do env (RANKING_CRON) já iniciado + timeout de boot', () => {
    const registry = registryMock();
    const { scheduler } = buildScheduler({ RANKING_CRON: '*/30 * * * *' }, registry);

    scheduler.onApplicationBootstrap();

    expect(registry.addCronJob).toHaveBeenCalledTimes(1);
    const [nome, job] = registry.addCronJob.mock.calls[0] as [string, CronJob];
    expect(nome).toBe('ranking-recomputacao');
    expect(job).toBeInstanceOf(CronJob);
    expect(job.isActive).toBe(true); // job.start() foi chamado
    expect(flatCronSource(job)).toBe('*/30 * * * *');

    expect(registry.addTimeout).toHaveBeenCalledTimes(1);
    expect(registry.addTimeout.mock.calls[0][0]).toBe('ranking-recomputacao-boot');

    pararRegistrados(registry);
  });

  it('sem RANKING_CRON no env → default de hora em hora (0 * * * *)', () => {
    const registry = registryMock();
    const { scheduler } = buildScheduler({}, registry);

    scheduler.onApplicationBootstrap();

    const job = registry.addCronJob.mock.calls[0][1] as CronJob;
    expect(flatCronSource(job)).toBe('0 * * * *');
    pararRegistrados(registry);
  });

  it('execução de boot: após o delay, chama recomputarTodos UMA vez (sem esperar o cron)', async () => {
    const registry = registryMock();
    const { scheduler, recomputarTodos } = buildScheduler({}, registry);

    scheduler.onApplicationBootstrap();
    expect(recomputarTodos).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(5_000);

    expect(recomputarTodos).toHaveBeenCalledTimes(1);
    pararRegistrados(registry);
  });

  it('falha na recomputação de boot é engolida (logada) — não derruba o processo', async () => {
    const registry = registryMock();
    const { scheduler, recomputarTodos } = buildScheduler(
      {},
      registry,
      jest.fn().mockRejectedValue(new Error('banco fora do ar')),
    );

    scheduler.onApplicationBootstrap();

    await expect(jest.advanceTimersByTimeAsync(5_000)).resolves.not.toThrow();
    expect(recomputarTodos).toHaveBeenCalledTimes(1);
    pararRegistrados(registry);
  });

  // -------------------------------------------------------------------------
  // Reentrância (flag `executando`): boot × cron não podem sobrepor
  // -------------------------------------------------------------------------

  describe('guarda de reentrância', () => {
    /** Acessa o método privado `executar` — alvo direto do unit "leve". */
    function executar(scheduler: RankingScheduler, origem: 'boot' | 'cron'): Promise<void> {
      return (
        scheduler as unknown as { executar(origem: 'boot' | 'cron'): Promise<void> }
      ).executar(origem);
    }

    function deferred(): { promise: Promise<number>; resolve: (n: number) => void; reject: (e: Error) => void } {
      let resolve!: (n: number) => void;
      let reject!: (e: Error) => void;
      const promise = new Promise<number>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }

    it('segunda chamada com a primeira PENDENTE → warn + skip (recomputarTodos 1x)', async () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const pendente = deferred();
      const { scheduler, recomputarTodos } = buildScheduler(
        {},
        registryMock(),
        jest.fn().mockReturnValue(pendente.promise),
      );

      const primeira = executar(scheduler, 'boot');
      const segunda = executar(scheduler, 'cron');
      await segunda; // resolve imediatamente: pulou sem esperar a primeira

      expect(recomputarTodos).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('pulada'));

      pendente.resolve(0);
      await primeira;
      warnSpy.mockRestore();
    });

    it('flag liberada após CONCLUSÃO: execução seguinte roda normalmente', async () => {
      const { scheduler, recomputarTodos } = buildScheduler({}, registryMock());

      await executar(scheduler, 'boot');
      await executar(scheduler, 'cron');

      expect(recomputarTodos).toHaveBeenCalledTimes(2);
    });

    it('flag liberada após ERRO: falha não trava as execuções seguintes', async () => {
      const { scheduler, recomputarTodos } = buildScheduler(
        {},
        registryMock(),
        jest
          .fn()
          .mockRejectedValueOnce(new Error('banco fora do ar'))
          .mockResolvedValue(0),
      );

      await executar(scheduler, 'boot'); // falha engolida
      await executar(scheduler, 'cron'); // deve RODAR (flag liberada no finally)

      expect(recomputarTodos).toHaveBeenCalledTimes(2);
    });
  });
});

/** Extrai a expressão cron do CronJob (cron v4 expõe cronTime.source). */
function flatCronSource(job: CronJob): string {
  return String((job as unknown as { cronTime: { source: unknown } }).cronTime.source);
}
