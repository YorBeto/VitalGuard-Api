import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
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
import { AlexaModule } from './modules/alexa/alexa.module';
import { AiModule } from './modules/ai/ai.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { MailModule } from './modules/mail/mail.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { EmailCacheModule } from './modules/email-cache/email-cache.module';
import { EmailCacheInterceptor } from './modules/email-cache/email-cache.interceptor';
import { AdminModule } from './modules/admin/admin.module';
import { ProfilesModule } from './modules/profiles/profiles.module';

@Module({
  imports: [
    ScheduleModule.forRoot(), // cron usa TZ America/Mexico_City por defecto vía @Cron({timeZone}) en cada job

    PrismaModule,
    EmailCacheModule,
    RealtimeModule,
    AuthModule,
    MailModule,
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
    AlexaModule,
    AiModule,
    InvitationsModule,
    AdminModule,
    ProfilesModule,
  ],
  controllers: [],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: EmailCacheInterceptor,
    },
  ],
})
export class AppModule {}
