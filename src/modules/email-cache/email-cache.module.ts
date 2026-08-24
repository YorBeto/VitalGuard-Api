import { Global, Module } from '@nestjs/common';
import { EmailCacheService } from './email-cache.service';

@Global()
@Module({
  providers: [EmailCacheService],
  exports: [EmailCacheService],
})
export class EmailCacheModule {}
