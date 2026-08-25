import { Global, Module } from '@nestjs/common';
import { PatientAccessService } from './services/patient-access.service';

@Global()
@Module({
  providers: [PatientAccessService],
  exports: [PatientAccessService],
})
export class CommonModule {}
