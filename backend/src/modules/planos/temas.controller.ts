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
import { CreateTemaDto } from './dto/create-tema.dto';
import { UpdateTemaDto } from './dto/update-tema.dto';
import { TemaResponse } from './plano-response';
import { TemasService } from './temas.service';

@Controller()
export class TemasController {
  constructor(private readonly temasService: TemasService) {}

  @Get('disciplinas/:disciplinaId/temas')
  async listByDisciplina(
    @CurrentUser() user: AuthenticatedUser,
    @Param('disciplinaId', ParseUUIDPipe) disciplinaId: string,
  ): Promise<{ temas: TemaResponse[] }> {
    return { temas: await this.temasService.listByDisciplina(user, disciplinaId) };
  }

  @Post('disciplinas/:disciplinaId/temas')
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('disciplinaId', ParseUUIDPipe) disciplinaId: string,
    @Body() dto: CreateTemaDto,
  ): Promise<{ tema: TemaResponse }> {
    return { tema: await this.temasService.create(user, disciplinaId, dto) };
  }

  @Patch('temas/:id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTemaDto,
  ): Promise<{ tema: TemaResponse }> {
    return { tema: await this.temasService.update(user, id, dto) };
  }

  @Delete('temas/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.temasService.remove(user, id);
  }
}
