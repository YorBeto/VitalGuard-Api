import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { AppProfilesModule } from './modules/app-profiles/app-profiles.module';
import { PatientsModule } from './modules/patients/patients.module';
import { DoctorsModule } from './modules/doctors/doctors.module';
import { CaregiversModule } from './modules/caregivers/caregivers.module';
import { DevicesModule } from './modules/devices/devices.module';
import { TreatmentsModule } from './modules/treatments/treatments.module';
import { MedicationLogsModule } from './modules/medication-logs/medication-logs.module';
import { SosEventsModule } from './modules/sos-events/sos-events.module';
import { VoiceMessagesModule } from './modules/voice-messages/voice-messages.module';
import { MedicationsModule } from './modules/medications/medications.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { TreatmentDetailsModule } from './modules/treatment-details/treatment-details.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    AppProfilesModule,
    PatientsModule,
    DoctorsModule,
    CaregiversModule,
    DevicesModule,
    TreatmentsModule,
    TreatmentDetailsModule,
    MedicationLogsModule,
    SosEventsModule,
    VoiceMessagesModule,
    MedicationsModule,
    NotificationsModule,
    SchedulerModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
