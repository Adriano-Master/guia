import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidationOptions,
  registerDecorator,
  validateSync,
} from 'class-validator';
import { validateCronExpression } from 'cron';

/**
 * Valida a expressão cron AQUI (padrão do validateEnv): sem isto, um
 * RANKING_CRON inválido só estouraria no bootstrap do scheduler, com stack
 * da lib cron em vez de mensagem clara de configuração.
 */
function IsCronExpression(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'isCronExpression',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && validateCronExpression(value).valid,
        defaultMessage: () => 'expressão cron inválida',
      },
    });
  };
}

export class EnvironmentVariables {
  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  JWT_ACCESS_SECRET!: string;

  @IsString()
  @IsNotEmpty()
  JWT_REFRESH_SECRET!: string;

  @IsString()
  @IsNotEmpty()
  APP_BASE_URL!: string;

  // Expirações dos JWTs (formato ms/vercel: "15m", "7d").
  @IsOptional()
  @IsString()
  JWT_ACCESS_EXPIRES_IN: string = '15m';

  @IsOptional()
  @IsString()
  JWT_REFRESH_EXPIRES_IN: string = '7d';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  // --- Gamificação/ranking: constantes da fórmula de pontuação (design de
  // gamificacao-ranking). Mudar por env só reflete após a próxima recomputação.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  PTS_SUBTEMA: number = 10;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  PTS_HORA: number = 5;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  PTS_BONUS_SEM: number = 50;

  // Expressão cron da recomputação do ranking (default: de hora em hora),
  // interpretada no timezone do processo (UTC no container).
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @IsCronExpression()
  RANKING_CRON: string = '0 * * * *';

  // Desliga o scheduler E a execução de boot (necessário nos e2e). Lê o valor
  // BRUTO: a conversão implícita faria Boolean('false') === true.
  @IsOptional()
  @Transform(({ obj }) => {
    const raw: unknown = (obj as Record<string, unknown>).RANKING_CRON_DISABLED;
    if (raw === 'true' || raw === true) return true;
    if (raw === 'false' || raw === false) return false;
    return raw;
  })
  @IsBoolean()
  RANKING_CRON_DISABLED: boolean = false;
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    const missing = errors
      .map((error) => `${error.property}: ${Object.values(error.constraints ?? {}).join(', ')}`)
      .join('; ');
    throw new Error(`Invalid environment configuration — ${missing}`);
  }

  return validated;
}
