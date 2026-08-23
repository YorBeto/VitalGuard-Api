import { IsInt, IsNotEmpty } from 'class-validator';

export class AssignPatientDto {
  @IsInt()
  @IsNotEmpty()
  patient_id!: number;
}