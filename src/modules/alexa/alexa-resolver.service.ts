import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface AlexaPatientResolution {
  patientId: number;
  patientName?: string;
  status: 'ok';
}

export interface AlexaResolverOutcome {
  ok: boolean;
  /** B5/B6/B7: código del caso borde resuelto */
  code?: 'B5' | 'B6' | 'B7';
  /** Mensaje empático para la skill cuando no se resuelve */
  message?: string;
  patient?: { id: number; name: string };
}

/**
 * Resolución de paciente a partir del vital_id.
 *
 * Patrón: vital_id → app_profiles → caregivers → caregiver_patient → patients.
 *  - 0 pacientes      → B5 (sin perfil/completar registro)
 *  - 1 paciente       → ese paciente (autocuidado B6 o cuidador único)
 *  - varios pacientes → default_alexa_patient_id (B7); si falta → pedir elegir
 */
@Injectable()
export class AlexaResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(vitalId: string): Promise<AlexaResolverOutcome> {
    const appProfile = await this.prisma.app_profiles.findFirst({
      where: { vital_id: vitalId, deleted_at: null, is_active: true },
    });

    if (!appProfile) {
      return {
        ok: false,
        code: 'B5',
        message:
          'Tu cuenta de VitalGuard aún no está configurada. Completa el registro en la aplicación móvil.',
      };
    }

    const caregiver = await this.prisma.caregivers.findFirst({
      where: { app_profile_id: appProfile.id, deleted_at: null },
    });

    if (!caregiver) {
      return {
        ok: false,
        code: 'B5',
        message:
          'Tu cuenta de VitalGuard aún no está configurada. Completa el registro en la aplicación móvil.',
      };
    }

    const relations = await this.prisma.caregiver_patient.findMany({
      where: { caregiver_id: caregiver.id, deleted_at: null },
      include: {
        patients: true,
      },
    });

    // Sin pacientes asignados → B5
    if (relations.length === 0) {
      return {
        ok: false,
        code: 'B5',
        message:
          'Aún no tienes pacientes vinculados. Completa la configuración en la aplicación móvil.',
      };
    }

    // Un solo paciente → autocuidado (B6) o cuidador único
    if (relations.length === 1) {
      const p = relations[0].patients;
      return {
        ok: true,
        code: 'B6',
        patient: { id: p.id, name: this.patientName(p) },
      };
    }

    // Varios pacientes → B7 con default_alexa_patient_id
    const defaultId = appProfile.default_alexa_patient_id;
    if (defaultId != null) {
      const chosen = relations.find((r) => r.patient_id === defaultId);
      if (chosen) {
        return {
          ok: true,
          code: 'B7',
          patient: { id: chosen.patients.id, name: this.patientName(chosen.patients) },
        };
      }
    }

    return {
      ok: false,
      code: 'B7',
      message:
        'Tienes varios pacientes. Por favor elige el paciente por defecto en la aplicación móvil.',
    };
  }

  private patientName(p: {
    first_name: string;
    paternal_last_name: string;
    maternal_last_name?: string | null;
  }): string {
    return [p.first_name, p.paternal_last_name, p.maternal_last_name]
      .filter(Boolean)
      .join(' ');
  }
}
