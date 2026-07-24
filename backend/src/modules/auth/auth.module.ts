import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthGuard } from '../../common/auth/auth.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EMAIL_SERVICE, LoggingEmailService } from './email.service';
import { InMemoryTokenDenylistService, TOKEN_DENYLIST } from './token-denylist.service';
import { TokenService } from './token.service';

@Module({
  imports: [
    // Secrets/expirações são passados por chamada no TokenService.
    JwtModule.register({}),
    // Rate limiting aplicado só onde o design exige (login/forgot/reset),
    // via @UseGuards(ThrottlerGuard) nos handlers do AuthController.
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 5 }],
      errorMessage: 'Muitas tentativas. Aguarde um minuto e tente novamente.',
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    { provide: TOKEN_DENYLIST, useClass: InMemoryTokenDenylistService },
    { provide: EMAIL_SERVICE, useClass: LoggingEmailService },
    // Guards globais: toda rota exige Bearer token, exceto @Public();
    // @Roles(...) é verificado na sequência pelo RolesGuard.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [TokenService],
})
export class AuthModule {}
