import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  registerDecorator,
  ValidateNested,
  ValidationOptions,
} from 'class-validator';
import { isValidIanaTimezone } from '../timezone.util';

const HORA_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export const GRANULARIDADES_MIN = [15, 30, 60] as const;

/** Valida timezone IANA via Intl API (formato; não é regra de negócio). */
function IsIanaTimezone(options?: ValidationOptions): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isIanaTimezone',
      target: object.constructor,
      propertyName: propertyName as string,
      options,
      validator: {
        validate: (value: unknown) => typeof value === 'string' && isValidIanaTimezone(value),
      },
    });
  };
}

export class JanelaDto {
  @IsInt({ message: 'dia deve ser um inteiro' })
  @Min(0, { message: 'dia deve ser entre 0 (domingo) e 6 (sábado)' })
  @Max(6, { message: 'dia deve ser entre 0 (domingo) e 6 (sábado)' })
  dia!: number;

  @Matches(HORA_REGEX, { message: 'inicio deve estar no formato HH:mm' })
  inicio!: string;

  @Matches(HORA_REGEX, { message: 'fim deve estar no formato HH:mm' })
  fim!: string;
}

export class GerarCronogramaDto {
  @IsUUID(undefined, { message: 'planoId deve ser um UUID válido' })
  planoId!: string;

  @IsArray({ message: 'diasSemana deve ser uma lista' })
  @ArrayNotEmpty({ message: 'diasSemana não pode ser vazio' })
  @ArrayMaxSize(7, { message: 'diasSemana deve ter no máximo 7 dias' })
  @ArrayUnique({ message: 'diasSemana não pode ter dias duplicados' })
  @IsInt({ each: true, message: 'diasSemana deve conter inteiros' })
  @Min(0, { each: true, message: 'diasSemana deve conter valores entre 0 e 6' })
  @Max(6, { each: true, message: 'diasSemana deve conter valores entre 0 e 6' })
  diasSemana!: number[];

  @IsArray({ message: 'janelas deve ser uma lista' })
  @ArrayNotEmpty({ message: 'janelas não pode ser vazio' })
  @ArrayMaxSize(50, { message: 'janelas deve ter no máximo 50 itens' })
  @ValidateNested({ each: true })
  @Type(() => JanelaDto)
  janelas!: JanelaDto[];

  @IsOptional()
  @IsIn(GRANULARIDADES_MIN, { message: 'granularidadeMin deve ser um de: 15, 30, 60' })
  granularidadeMin?: number;

  @IsString({ message: 'timezone deve ser um texto' })
  @IsNotEmpty({ message: 'timezone é obrigatório' })
  @IsIanaTimezone({ message: 'timezone deve ser um identificador IANA válido' })
  timezone!: string;
}
