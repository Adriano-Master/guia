import { Module } from '@nestjs/common';
import { PlanosModule } from '../planos/planos.module';
import { QuestoesController } from './questoes.controller';
import { QuestoesService } from './questoes.service';

@Module({
  imports: [PlanosModule],
  controllers: [QuestoesController],
  providers: [QuestoesService],
  exports: [QuestoesService],
})
export class QuestoesModule {}
