import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { Roles } from '../../common/auth/roles.decorator';
import { PaginatedResponse } from '../../common/pagination/pagination';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';
import { VincularPlanoDto } from './dto/vincular-plano.dto';
import { TurmaPlanoResponse } from './turma-response';
import { TurmaPlanosService } from './turma-planos.service';

@Controller('turmas/:turmaId/planos')
export class TurmaPlanosController {
  constructor(private readonly turmaPlanosService: TurmaPlanosService) {}

  @Post()
  @Roles(Role.ADMIN, Role.MODERADOR, Role.PROFESSOR)
  async vincular(
    @CurrentUser() user: AuthenticatedUser,
    @Param('turmaId', ParseUUIDPipe) turmaId: string,
    @Body() dto: VincularPlanoDto,
  ): Promise<{ turmaPlano: TurmaPlanoResponse }> {
    return { turmaPlano: await this.turmaPlanosService.vincular(user, turmaId, dto) };
  }

  /** Dono/moderação OU aluno com matrícula ativa (escopo no service). */
  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('turmaId', ParseUUIDPipe) turmaId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedResponse<TurmaPlanoResponse>> {
    return this.turmaPlanosService.listByTurma(user, turmaId, query);
  }

  @Delete(':planoId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.ADMIN, Role.MODERADOR, Role.PROFESSOR)
  desvincular(
    @CurrentUser() user: AuthenticatedUser,
    @Param('turmaId', ParseUUIDPipe) turmaId: string,
    @Param('planoId', ParseUUIDPipe) planoId: string,
  ): Promise<void> {
    return this.turmaPlanosService.desvincular(user, turmaId, planoId);
  }
}
