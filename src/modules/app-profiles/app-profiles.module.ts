import { Module } from '@nestjs/common';
import { AppProfilesService } from './app-profiles.service';
import { AppProfilesController } from './app-profiles.controller';

@Module({
  providers: [AppProfilesService],
  controllers: [AppProfilesController]
})
export class AppProfilesModule {}
