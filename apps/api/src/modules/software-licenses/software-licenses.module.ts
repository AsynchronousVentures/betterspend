import { Module } from '@nestjs/common';
import { SoftwareLicensesController } from './software-licenses.controller';
import { SoftwareLicensesService } from './software-licenses.service';

@Module({
  controllers: [SoftwareLicensesController],
  providers: [SoftwareLicensesService],
  exports: [SoftwareLicensesService],
})
export class SoftwareLicensesModule {}
