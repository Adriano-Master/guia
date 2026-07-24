import { Module } from '@nestjs/common';
import { PlanosModule } from '../planos/planos.module';
import { SessoesController } from './sessoes.controller';
import { SessoesService } from './sessoes.service';

@Module({
  imports: [PlanosModule],
  controllers: [SessoesController],
  providers: [SessoesService],
  exports: [SessoesService],
})
export class SessoesModule {}
