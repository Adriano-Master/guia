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
import { ListSessoesQueryDto } from './dto/list-sessoes-query.dto';
import { ManualSessaoDto } from './dto/manual-sessao.dto';
import { StartCronometroDto } from './dto/start-cronometro.dto';
import { StopCronometroDto } from './dto/stop-cronometro.dto';
import { UpdateSessaoDto } from './dto/update-sessao.dto';
import { SessaoResponse } from './sessao-response';
import { SessoesService } from './sessoes.service';

/** Recursos escopados ao próprio aluno (acesso cruzado → 403 no service). */
@Controller('sessoes')
@Roles(Role.ALUNO)
export class SessoesController {
  constructor(private readonly sessoesService: SessoesService) {}

  @Post('cronometro/start')
  async start(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: StartCronometroDto,
  ): Promise<{ sessao: SessaoResponse }> {
    return { sessao: await this.sessoesService.startCronometro(user, dto) };
  }

  @Get('ativa')
  async getAtiva(@CurrentUser() user: AuthenticatedUser): Promise<{ sessao: SessaoResponse }> {
    return { sessao: await this.sessoesService.getAtiva(user) };
  }

  @Post('ativa/pause')
  @HttpCode(HttpStatus.OK)
  async pause(@CurrentUser() user: AuthenticatedUser): Promise<{ sessao: SessaoResponse }> {
    return { sessao: await this.sessoesService.pause(user) };
  }

  @Post('ativa/resume')
  @HttpCode(HttpStatus.OK)
  async resume(@CurrentUser() user: AuthenticatedUser): Promise<{ sessao: SessaoResponse }> {
    return { sessao: await this.sessoesService.resume(user) };
  }

  @Post('ativa/stop')
  @HttpCode(HttpStatus.OK)
  async stop(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: StopCronometroDto,
  ): Promise<{ sessao: SessaoResponse }> {
    return { sessao: await this.sessoesService.stop(user, dto) };
  }

  @Delete('ativa')
  @HttpCode(HttpStatus.NO_CONTENT)
  discard(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    return this.sessoesService.discard(user);
  }

  @Post('manual')
  async manual(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ManualSessaoDto,
  ): Promise<{ sessao: SessaoResponse }> {
    return { sessao: await this.sessoesService.registrarManual(user, dto) };
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListSessoesQueryDto,
  ): Promise<PaginatedResponse<SessaoResponse>> {
    return this.sessoesService.list(user, query);
  }

  @Get(':id')
  async getById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ sessao: SessaoResponse }> {
    return { sessao: await this.sessoesService.getById(user, id) };
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSessaoDto,
  ): Promise<{ sessao: SessaoResponse }> {
    return { sessao: await this.sessoesService.update(user, id, dto) };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.sessoesService.remove(user, id);
  }
}
