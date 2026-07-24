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
  Put,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { Roles } from '../../common/auth/roles.decorator';
import { PaginatedResponse } from '../../common/pagination/pagination';
import { CreatePlanoDto } from './dto/create-plano.dto';
import { DerivarPlanoDto } from './dto/derivar-plano.dto';
import { ListPlanosQueryDto } from './dto/list-planos-query.dto';
import { SetPesosDto } from './dto/set-pesos.dto';
import { UpdatePlanoDto } from './dto/update-plano.dto';
import { PesoDisciplinaResponse, PlanoResponse } from './plano-response';
import { PlanosService } from './planos.service';

@Controller('planos')
export class PlanosController {
  constructor(private readonly planosService: PlanosService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListPlanosQueryDto,
  ): Promise<PaginatedResponse<PlanoResponse>> {
    return this.planosService.list(user, query);
  }

  @Get(':id')
  async getById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ plano: PlanoResponse }> {
    return { plano: await this.planosService.getById(user, id) };
  }

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePlanoDto,
  ): Promise<{ plano: PlanoResponse }> {
    return { plano: await this.planosService.create(user, dto) };
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlanoDto,
  ): Promise<{ plano: PlanoResponse }> {
    return { plano: await this.planosService.update(user, id, dto) };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.planosService.remove(user, id);
  }

  @Post(':id/publicar')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.ADMIN, Role.MODERADOR, Role.PROFESSOR)
  async publicar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ plano: PlanoResponse }> {
    return { plano: await this.planosService.publicar(user, id) };
  }

  @Post(':id/derivar')
  @Roles(Role.ALUNO)
  async derivar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DerivarPlanoDto,
  ): Promise<{ plano: PlanoResponse }> {
    return { plano: await this.planosService.derivar(user, id, dto) };
  }

  @Get(':planoId/pesos')
  async listPesos(
    @CurrentUser() user: AuthenticatedUser,
    @Param('planoId', ParseUUIDPipe) planoId: string,
  ): Promise<{ pesos: PesoDisciplinaResponse[] }> {
    return { pesos: await this.planosService.listPesos(user, planoId) };
  }

  @Put(':planoId/pesos')
  async setPesos(
    @CurrentUser() user: AuthenticatedUser,
    @Param('planoId', ParseUUIDPipe) planoId: string,
    @Body() dto: SetPesosDto,
  ): Promise<{ pesos: PesoDisciplinaResponse[] }> {
    return { pesos: await this.planosService.setPesos(user, planoId, dto) };
  }
}
