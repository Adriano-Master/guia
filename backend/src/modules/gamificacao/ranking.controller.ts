import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { Roles } from '../../common/auth/roles.decorator';
import { PaginatedResponse } from '../../common/pagination/pagination';
import { RankingQueryDto } from './dto/ranking-query.dto';
import { RankingItemResponse, RankingMeResponse } from './ranking-response';
import { RankingService } from './ranking.service';

@Controller('ranking')
export class RankingController {
  constructor(private readonly rankingService: RankingService) {}

  /** Qualquer autenticado (design): ranking de todos os alunos ATIVOS. */
  @Get('global')
  global(@Query() query: RankingQueryDto): Promise<PaginatedResponse<RankingItemResponse>> {
    return this.rankingService.global(query);
  }

  /** CA-06: posição global e por turma do próprio aluno, com composição. */
  @Get('me')
  @Roles(Role.ALUNO)
  me(@CurrentUser() user: AuthenticatedUser): Promise<RankingMeResponse> {
    return this.rankingService.me(user);
  }

  /** Matrícula ATIVA ou professor da turma (autorização no service — CA-05). */
  @Get('turmas/:turmaId')
  porTurma(
    @CurrentUser() user: AuthenticatedUser,
    @Param('turmaId', ParseUUIDPipe) turmaId: string,
    @Query() query: RankingQueryDto,
  ): Promise<PaginatedResponse<RankingItemResponse>> {
    return this.rankingService.porTurma(user, turmaId, query);
  }
}
