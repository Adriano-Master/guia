import { IsOptional, IsUUID } from 'class-validator';

export class StartCronometroDto {
  @IsUUID(undefined, { message: 'disciplinaId deve ser um UUID válido' })
  disciplinaId!: string;

  /** @IsOptional deixa null passar: o service o normaliza como ausente. */
  @IsOptional()
  @IsUUID(undefined, { message: 'subtemaId deve ser um UUID válido' })
  subtemaId?: string | null;

  @IsOptional()
  @IsUUID(undefined, { message: 'blocoId deve ser um UUID válido' })
  blocoId?: string | null;
}
