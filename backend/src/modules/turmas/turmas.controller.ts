import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { Roles } from '../../common/auth/roles.decorator';
import { PaginatedResponse } from '../../common/pagination/pagination';
import { CreateTurmaDto } from './dto/create-turma.dto';
import { ListTurmasQueryDto } from './dto/list-turmas-query.dto';
import { UpdateTurmaDto } from './dto/update-turma.dto';
import { TurmaResponse } from './turma-response';
import { TurmasService } from './turmas.service';

@Controller('turmas')
export class TurmasController {
  constructor(private readonly turmasService: TurmasService) {}

  @Post()
  @Roles(Role.ADMIN, Role.MODERADOR, Role.PROFESSOR)
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTurmaDto,
  ): Promise<{ turma: TurmaResponse }> {
    return { turma: await this.turmasService.create(user, dto) };
  }

  @Get()
  @Roles(Role.ADMIN, Role.MODERADOR, Role.PROFESSOR)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListTurmasQueryDto,
  ): Promise<PaginatedResponse<TurmaResponse>> {
    return this.turmasService.list(user, query);
  }

  /** Dono/moderação OU aluno com matrícula ativa (escopo no service). */
  @Get(':id')
  async getById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ turma: TurmaResponse }> {
    return { turma: await this.turmasService.getById(user, id) };
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.MODERADOR, Role.PROFESSOR)
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTurmaDto,
  ): Promise<{ turma: TurmaResponse }> {
    return { turma: await this.turmasService.update(user, id, dto) };
  }

  @Post(':id/regenerar-codigo')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN, Role.MODERADOR, Role.PROFESSOR)
  async regenerarCodigo(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ codigoConvite: string }> {
    return { codigoConvite: await this.turmasService.regenerarCodigo(user, id) };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.ADMIN, Role.MODERADOR, Role.PROFESSOR)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.turmasService.remove(user, id);
  }
}
