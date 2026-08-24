import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { DevicesService } from './devices.service';
import { DevicesController } from './devices.controller';
import {SosEventsModule} from "../sos-events/sos-events.module";


@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: 'MQTT_CLIENT',
        useFactory: () => ({
          transport: Transport.MQTT,
          options: {
            url: process.env.MQTT_BROKER_URL || 'mqtt://178.128.0.112:1883',
            connectTimeout: 5000,
            reconnectPeriod: 10000,
          },
        }),
      },
    ]),
    SosEventsModule,
  ],
  providers: [DevicesService],
  controllers: [DevicesController],
  exports: [DevicesService],
})
export class DevicesModule {}