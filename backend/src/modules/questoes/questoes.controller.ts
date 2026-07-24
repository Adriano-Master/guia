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
import { CreateRegistroDto } from './dto/create-registro.dto';
import { DesempenhoQueryDto } from './dto/desempenho-query.dto';
import { ListRegistrosQueryDto } from './dto/list-registros-query.dto';
import { UpdateRegistroDto } from './dto/update-registro.dto';
import { QuestoesService } from './questoes.service';
import { DesempenhoResponse, RegistroQuestoesResponse } from './registro-questoes-response';

/** Recursos escopados ao próprio aluno (acesso cruzado → 403 no service). */
@Controller('questoes')
@Roles(Role.ALUNO)
export class QuestoesController {
  constructor(private readonly questoesService: QuestoesService) {}

  @Post()
  async criar(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateRegistroDto,
  ): Promise<{ registro: RegistroQuestoesResponse }> {
    return { registro: await this.questoesService.criar(user, dto) };
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListRegistrosQueryDto,
  ): Promise<PaginatedResponse<RegistroQuestoesResponse>> {
    return this.questoesService.list(user, query);
  }

  // Declarado ANTES de GET /:id para "desempenho" não casar como UUID de rota.
  @Get('desempenho')
  desempenho(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DesempenhoQueryDto,
  ): Promise<DesempenhoResponse> {
    return this.questoesService.desempenho(user, query);
  }

  @Get(':id')
  async getById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ registro: RegistroQuestoesResponse }> {
    return { registro: await this.questoesService.getById(user, id) };
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRegistroDto,
  ): Promise<{ registro: RegistroQuestoesResponse }> {
    return { registro: await this.questoesService.update(user, id, dto) };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.questoesService.remove(user, id);
  }
}
