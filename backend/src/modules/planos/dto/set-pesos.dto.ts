import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsNumber,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class PesoItemDto {
  @IsUUID(undefined, { message: 'disciplinaId deve ser um UUID válido' })
  disciplinaId!: string;

  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'pesoPercentual deve ser um número com no máximo 2 casas decimais' },
  )
  @Min(0, { message: 'pesoPercentual deve ser no mínimo 0' })
  @Max(100, { message: 'pesoPercentual deve ser no máximo 100' })
  pesoPercentual!: number;
}

export class SetPesosDto {
  @IsArray({ message: 'pesos deve ser uma lista' })
  @ArrayNotEmpty({ message: 'pesos não pode ser vazio' })
  @ValidateNested({ each: true })
  @Type(() => PesoItemDto)
  pesos!: PesoItemDto[];
}
