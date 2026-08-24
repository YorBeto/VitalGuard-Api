import { Module, forwardRef } from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import { InvitationsController } from './invitations.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [NotificationsModule, forwardRef(() => RealtimeModule)],
  providers: [InvitationsService],
  controllers: [InvitationsController],
})
export class InvitationsModule {}
