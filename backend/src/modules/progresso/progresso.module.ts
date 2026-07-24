import { Module } from '@nestjs/common';
import { PlanosModule } from '../planos/planos.module';
import { ProgressoController } from './progresso.controller';
import { ProgressoService } from './progresso.service';

@Module({
  imports: [PlanosModule],
  controllers: [ProgressoController],
  providers: [ProgressoService],
})
export class ProgressoModule {}
