import 'reflect-metadata';
import { validateEnv } from './env.validation';

/** Mínimo obrigatório para o validateEnv passar (campos @IsNotEmpty). */
function baseEnv(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    JWT_ACCESS_SECRET: 'access-secret',
    JWT_REFRESH_SECRET: 'refresh-secret',
    APP_BASE_URL: 'http://localhost:8080',
    ...overrides,
  };
}

describe('validateEnv', () => {
  it('env mínima válida passa com os defaults de gamificação (fórmula + cron horário)', () => {
    const env = validateEnv(baseEnv());

    expect(env.PTS_SUBTEMA).toBe(10);
    expect(env.PTS_HORA).toBe(5);
    expect(env.PTS_BONUS_SEM).toBe(50);
    expect(env.RANKING_CRON).toBe('0 * * * *');
    expect(env.RANKING_CRON_DISABLED).toBe(false);
  });

  it('RANKING_CRON=banana → reprova com "expressão cron inválida" (falha na SUBIDA, não no scheduler)', () => {
    expect(() => validateEnv(baseEnv({ RANKING_CRON: 'banana' }))).toThrow(
      /RANKING_CRON.*expressão cron inválida/,
    );
  });

  it('RANKING_CRON com expressão válida passa e é ecoada', () => {
    const env = validateEnv(baseEnv({ RANKING_CRON: '*/30 * * * *' }));
    expect(env.RANKING_CRON).toBe('*/30 * * * *');
  });

  it('RANKING_CRON vazio ou com campo fora do domínio → reprova', () => {
    expect(() => validateEnv(baseEnv({ RANKING_CRON: '' }))).toThrow(/RANKING_CRON/);
    // 5 campos com minuto inválido (60 não existe)
    expect(() => validateEnv(baseEnv({ RANKING_CRON: '60 * * * *' }))).toThrow(
      /expressão cron inválida/,
    );
  });

  it('RANKING_CRON_DISABLED lê o valor bruto: "false" → false, "true" → true, lixo → reprova', () => {
    expect(validateEnv(baseEnv({ RANKING_CRON_DISABLED: 'false' })).RANKING_CRON_DISABLED).toBe(
      false, // Boolean('false') implícito seria true — regressão coberta
    );
    expect(validateEnv(baseEnv({ RANKING_CRON_DISABLED: 'true' })).RANKING_CRON_DISABLED).toBe(
      true,
    );
    expect(() => validateEnv(baseEnv({ RANKING_CRON_DISABLED: 'xyz' }))).toThrow(
      /RANKING_CRON_DISABLED/,
    );
  });

  it('constantes da fórmula: aceitam 0, reprovam negativas e não-inteiras', () => {
    expect(validateEnv(baseEnv({ PTS_BONUS_SEM: '0' })).PTS_BONUS_SEM).toBe(0);
    expect(() => validateEnv(baseEnv({ PTS_SUBTEMA: '-1' }))).toThrow(/PTS_SUBTEMA/);
    expect(() => validateEnv(baseEnv({ PTS_HORA: '2.5' }))).toThrow(/PTS_HORA/);
  });

  it('obrigatórias ausentes → erro nomeando o campo', () => {
    const env = baseEnv();
    delete env.DATABASE_URL;
    expect(() => validateEnv(env)).toThrow(/DATABASE_URL/);
  });
});
