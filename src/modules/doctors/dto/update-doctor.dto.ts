import { PartialType } from '@nestjs/mapped-types';
import { CreateDoctorDto } from './create-doctor.dto';

// Reutilizamos los campos, pero los hacemos opcionales
export class UpdateDoctorDto extends PartialType(CreateDoctorDto) {}