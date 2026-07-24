import { Controller, Get, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { Roles } from '../../common/auth/roles.decorator';
import { DesempenhoQuestoesQueryDto } from './dto/desempenho-questoes-query.dto';
import { HorasPorDisciplinaQueryDto } from './dto/horas-por-disciplina-query.dto';
import { ProgressoEstatisticasQueryDto } from './dto/progresso-estatisticas-query.dto';
import { SerieTemporalQueryDto } from './dto/serie-temporal-query.dto';
import {
  DesempenhoQuestoesResponse,
  HorasPorDisciplinaResponse,
  ProgressoEstatisticasResponse,
  ResumoResponse,
  SerieTemporalResponse,
} from './estatisticas-response';
import { EstatisticasService } from './estatisticas.service';

/** Somente leitura, escopado ao próprio aluno (CA-06: papel interno → 403). */
@Controller('estatisticas')
@Roles(Role.ALUNO)
export class EstatisticasController {
  constructor(private readonly estatisticasService: EstatisticasService) {}

  @Get('resumo')
  resumo(@CurrentUser() user: AuthenticatedUser): Promise<ResumoResponse> {
    return this.estatisticasService.resumo(user);
  }

  @Get('horas-por-disciplina')
  horasPorDisciplina(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: HorasPorDisciplinaQueryDto,
  ): Promise<HorasPorDisciplinaResponse> {
    return this.estatisticasService.horasPorDisciplina(user, query);
  }

  @Get('serie-temporal')
  serieTemporal(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SerieTemporalQueryDto,
  ): Promise<SerieTemporalResponse> {
    return this.estatisticasService.serieTemporal(user, query);
  }

  @Get('progresso')
  progresso(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ProgressoEstatisticasQueryDto,
  ): Promise<ProgressoEstatisticasResponse> {
    return this.estatisticasService.progresso(user, query);
  }

  @Get('desempenho-questoes')
  desempenhoQuestoes(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DesempenhoQuestoesQueryDto,
  ): Promise<DesempenhoQuestoesResponse> {
    return this.estatisticasService.desempenhoQuestoes(user, query);
  }
}
