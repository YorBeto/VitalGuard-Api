import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class EmailCacheService {
  private readonly logger = new Logger(EmailCacheService.name);
  // email(lower) -> vitalId
  private readonly map = new Map<string, string>();
  // vitalId -> email (último visto)
  private readonly reverse = new Map<string, string>();

  put(email: string | undefined, vitalId: string | undefined) {
    if (!email || !vitalId) return;
    const key = email.trim().toLowerCase();
    if (!key) return;
    this.map.set(key, vitalId);
    this.reverse.set(vitalId, key);
    this.logger.debug(`[EmailCache] ${key} -> ${vitalId}`);
  }

  getVitalId(email: string): string | undefined {
    return this.map.get(email.trim().toLowerCase());
  }

  getEmail(vitalId: string): string | undefined {
    return this.reverse.get(vitalId);
  }
}
