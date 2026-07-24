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
import { CreateSubtemaDto } from './dto/create-subtema.dto';
import { UpdateSubtemaDto } from './dto/update-subtema.dto';
import { SubtemaResponse } from './plano-response';
import { SubtemasService } from './subtemas.service';

@Controller()
export class SubtemasController {
  constructor(private readonly subtemasService: SubtemasService) {}

  @Get('temas/:temaId/subtemas')
  async listByTema(
    @CurrentUser() user: AuthenticatedUser,
    @Param('temaId', ParseUUIDPipe) temaId: string,
  ): Promise<{ subtemas: SubtemaResponse[] }> {
    return { subtemas: await this.subtemasService.listByTema(user, temaId) };
  }

  @Post('temas/:temaId/subtemas')
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('temaId', ParseUUIDPipe) temaId: string,
    @Body() dto: CreateSubtemaDto,
  ): Promise<{ subtema: SubtemaResponse }> {
    return { subtema: await this.subtemasService.create(user, temaId, dto) };
  }

  @Patch('subtemas/:id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSubtemaDto,
  ): Promise<{ subtema: SubtemaResponse }> {
    return { subtema: await this.subtemasService.update(user, id, dto) };
  }

  @Delete('subtemas/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.subtemasService.remove(user, id);
  }
}
