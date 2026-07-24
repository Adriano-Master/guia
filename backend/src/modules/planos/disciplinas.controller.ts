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
} from '@nestjs/common';
import { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { CreateDisciplinaDto } from './dto/create-disciplina.dto';
import { UpdateDisciplinaDto } from './dto/update-disciplina.dto';
import { DisciplinaResponse } from './plano-response';
import { DisciplinasService } from './disciplinas.service';

/** Rotas aninhadas ao plano + rotas top-level /disciplinas/{id} (design plano-de-estudo). */
@Controller()
export class DisciplinasController {
  constructor(private readonly disciplinasService: DisciplinasService) {}

  @Get('planos/:planoId/disciplinas')
  async listByPlano(
    @CurrentUser() user: AuthenticatedUser,
    @Param('planoId', ParseUUIDPipe) planoId: string,
  ): Promise<{ disciplinas: DisciplinaResponse[] }> {
    return { disciplinas: await this.disciplinasService.listByPlano(user, planoId) };
  }

  @Post('planos/:planoId/disciplinas')
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('planoId', ParseUUIDPipe) planoId: string,
    @Body() dto: CreateDisciplinaDto,
  ): Promise<{ disciplina: DisciplinaResponse }> {
    return { disciplina: await this.disciplinasService.create(user, planoId, dto) };
  }

  @Patch('disciplinas/:id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDisciplinaDto,
  ): Promise<{ disciplina: DisciplinaResponse }> {
    return { disciplina: await this.disciplinasService.update(user, id, dto) };
  }

  @Delete('disciplinas/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.disciplinasService.remove(user, id);
  }
}
