import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { Roles } from '../../common/auth/roles.decorator';
import { BlocoResponse, CronogramaResponse } from './cronograma-response';
import { CronogramaService } from './cronograma.service';
import { GerarCronogramaDto } from './dto/gerar-cronograma.dto';
import { ListBlocosQueryDto } from './dto/list-blocos-query.dto';
import { UpdateBlocoDto } from './dto/update-bloco.dto';

/** Recursos escopados ao próprio aluno (acesso cruzado → 403 no service). */
@Controller()
@Roles(Role.ALUNO)
export class CronogramaController {
  constructor(private readonly cronogramaService: CronogramaService) {}

  @Post('cronogramas')
  async gerar(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GerarCronogramaDto,
  ): Promise<{ cronograma: CronogramaResponse }> {
    return { cronograma: await this.cronogramaService.gerar(user, dto) };
  }

  @Get('cronogramas/ativo')
  async getAtivo(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ cronograma: CronogramaResponse }> {
    return { cronograma: await this.cronogramaService.getAtivo(user) };
  }

  @Get('cronogramas/:id/blocos')
  async listBlocos(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListBlocosQueryDto,
  ): Promise<{ blocos: BlocoResponse[] }> {
    return { blocos: await this.cronogramaService.listBlocos(user, id, query) };
  }

  @Patch('blocos/:id')
  async updateBloco(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBlocoDto,
  ): Promise<{ bloco: BlocoResponse }> {
    return { bloco: await this.cronogramaService.updateBlocoStatus(user, id, dto) };
  }
}
