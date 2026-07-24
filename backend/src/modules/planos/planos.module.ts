import { Module } from '@nestjs/common';
import { DisciplinasController } from './disciplinas.controller';
import { DisciplinasService } from './disciplinas.service';
import { PlanosAccessService } from './planos-access.service';
import { PlanosController } from './planos.controller';
import { PlanosService } from './planos.service';
import { SubtemasController } from './subtemas.controller';
import { SubtemasService } from './subtemas.service';
import { TemasController } from './temas.controller';
import { TemasService } from './temas.service';

@Module({
  controllers: [PlanosController, DisciplinasController, TemasController, SubtemasController],
  providers: [PlanosAccessService, PlanosService, DisciplinasService, TemasService, SubtemasService],
  exports: [PlanosService, PlanosAccessService],
})
export class PlanosModule {}
