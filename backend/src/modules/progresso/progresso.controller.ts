import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { Roles } from '../../common/auth/roles.decorator';
import { ListProgressoSubtemasQueryDto } from './dto/list-progresso-subtemas-query.dto';
import { SetProgressoDto } from './dto/set-progresso.dto';
import {
  ProgressoMarcacaoResponse,
  ProgressoPlanoResponse,
  ProgressoSubtemaFlatItem,
} from './progresso-response';
import { ProgressoService } from './progresso.service';

/** Recursos escopados ao próprio aluno (acesso cruzado → 403 no service). */
@Controller('progresso')
@Roles(Role.ALUNO)
export class ProgressoController {
  constructor(private readonly progressoService: ProgressoService) {}

  @Put('subtemas/:subtemaId')
  setConcluido(
    @CurrentUser() user: AuthenticatedUser,
    @Param('subtemaId', ParseUUIDPipe) subtemaId: string,
    @Body() dto: SetProgressoDto,
  ): Promise<ProgressoMarcacaoResponse> {
    return this.progressoService.setConcluido(user, subtemaId, dto);
  }

  @Get('planos/:planoId')
  getPlano(
    @CurrentUser() user: AuthenticatedUser,
    @Param('planoId', ParseUUIDPipe) planoId: string,
  ): Promise<ProgressoPlanoResponse> {
    return this.progressoService.calcularPlano(user, planoId);
  }

  @Get('subtemas')
  async listSubtemas(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListProgressoSubtemasQueryDto,
  ): Promise<{ subtemas: ProgressoSubtemaFlatItem[] }> {
    return { subtemas: await this.progressoService.listarSubtemas(user, query) };
  }
}
