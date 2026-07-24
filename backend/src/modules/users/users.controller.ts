import {
  Body,
  Controller,
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
import { AdminUpdateUserDto } from './dto/admin-update-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { UserResponse } from './user-response';
import { ImpersonationResult, UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async getMe(@CurrentUser() current: AuthenticatedUser): Promise<{ user: UserResponse }> {
    return { user: await this.usersService.getMe(current.sub) };
  }

  @Patch('me')
  async updateMe(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: UpdateMeDto,
  ): Promise<{ user: UserResponse }> {
    return { user: await this.usersService.updateMe(current.sub, dto) };
  }

  @Post('me/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  changePassword(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    return this.usersService.changePassword(current.sub, dto);
  }

  @Get()
  @Roles(Role.ADMIN)
  list(@Query() query: ListUsersQueryDto): Promise<PaginatedResponse<UserResponse>> {
    return this.usersService.list(query);
  }

  @Get(':id')
  @Roles(Role.ADMIN)
  async getById(@Param('id', ParseUUIDPipe) id: string): Promise<{ user: UserResponse }> {
    return { user: await this.usersService.getById(id) };
  }

  // Impersonação somente-leitura: restrita a ADMIN (MODERADOR/PROFESSOR não).
  @Post(':id/impersonate')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  impersonate(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ImpersonationResult> {
    return this.usersService.impersonate(current.sub, id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  async adminUpdate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminUpdateUserDto,
  ): Promise<{ user: UserResponse }> {
    return { user: await this.usersService.adminUpdate(id, dto) };
  }
}
