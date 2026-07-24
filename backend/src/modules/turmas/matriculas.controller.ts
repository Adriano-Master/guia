import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Response } from 'express';
import { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { Roles } from '../../common/auth/roles.decorator';
import { PaginatedResponse } from '../../common/pagination/pagination';
import { ListMatriculasQueryDto } from './dto/list-matriculas-query.dto';
import { MatricularDto } from './dto/matricular.dto';
import { UpdateMatriculaDto } from './dto/update-matricula.dto';
import { VincularAlunoDto } from './dto/vincular-aluno.dto';
import { MatriculasService } from './matriculas.service';
import { MatriculaResponse } from './turma-response';

/** Rotas de /matriculas e a listagem aninhada /turmas/{id}/matriculas (design). */
@Controller()
export class MatriculasController {
  constructor(private readonly matriculasService: MatriculasService) {}

  /**
   * RN-04: só ALUNO se matricula (interno → 403 pelo guard). Contrato do
   * design: criação nova → 201; reativação de matrícula INATIVA → 200.
   * Rate limit (defesa em profundidade contra enumeração de códigos): o
   * ThrottlerModule global (AuthModule) tem default 5/min; aqui o @Throttle
   * afrouxa para 10/min — matrícula legítima pode errar a digitação algumas
   * vezes sem esbarrar no limite de brute force do login.
   */
  @Post('matriculas')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Roles(Role.ALUNO)
  async matricular(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: MatricularDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ matricula: MatriculaResponse }> {
    const { matricula, reativada } = await this.matriculasService.matricular(user, dto);
    res.status(reativada ? HttpStatus.OK : HttpStatus.CREATED);
    return { matricula };
  }

  @Get('matriculas/me')
  @Roles(Role.ALUNO)
  listMe(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListMatriculasQueryDto,
  ): Promise<PaginatedResponse<MatriculaResponse>> {
    return this.matriculasService.listMe(user, query);
  }

  /**
   * Vínculo direto por email (dono da turma ou moderação — escopo no service).
   * Mesmo contrato de status do POST /matriculas: criação → 201; reativação
   * de matrícula INATIVA/soft-deleted → 200.
   */
  @Post('turmas/:turmaId/matriculas')
  @Roles(Role.ADMIN, Role.MODERADOR, Role.PROFESSOR)
  async vincularAluno(
    @CurrentUser() user: AuthenticatedUser,
    @Param('turmaId', ParseUUIDPipe) turmaId: string,
    @Body() dto: VincularAlunoDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ matricula: MatriculaResponse }> {
    const { matricula, reativada } = await this.matriculasService.vincularAluno(user, turmaId, dto);
    res.status(reativada ? HttpStatus.OK : HttpStatus.CREATED);
    return { matricula };
  }

  @Get('turmas/:turmaId/matriculas')
  @Roles(Role.ADMIN, Role.MODERADOR, Role.PROFESSOR)
  listByTurma(
    @CurrentUser() user: AuthenticatedUser,
    @Param('turmaId', ParseUUIDPipe) turmaId: string,
    @Query() query: ListMatriculasQueryDto,
  ): Promise<PaginatedResponse<MatriculaResponse>> {
    return this.matriculasService.listByTurma(user, turmaId, query);
  }

  /** Dono da turma OU o próprio aluno (escopo no service). */
  @Patch('matriculas/:id')
  async updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMatriculaDto,
  ): Promise<{ matricula: MatriculaResponse }> {
    return { matricula: await this.matriculasService.updateStatus(user, id, dto) };
  }
}
