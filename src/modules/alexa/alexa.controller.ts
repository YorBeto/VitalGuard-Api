import { Body, Controller, ForbiddenException, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import {
  RateLimitGuard,
  rateLimitFromEnv,
} from '../../common/guards/rate-limit.guard';
import { AlexaService } from './alexa.service';

@Controller('alexa')
export class AlexaController {
  constructor(private readonly alexaService: AlexaService) {}

  /**
   * POST /alexa — endpoint de la Skill de Alexa.
   * Valida el ApplicationId contra ALEXA_SKILL_ID (si está configurado) y
   * aplica rate limiting por vital_id.
   * Siempre responde 200 con una respuesta ASK válida; nunca 500.
   */
  @Post()
  @HttpCode(200)
  @UseGuards(
    new RateLimitGuard(
      rateLimitFromEnv('alexa', { limit: 30, windowMs: 60_000 }),
    ),
  )
  async handle(@Body() body: any) {
    const skillId = body?.context?.System?.application?.applicationId;
    const allowed = process.env.ALEXA_SKILL_ID;

    if (allowed) {
      const norm = (s: string) => s.trim().toLowerCase();
      if (!skillId || norm(skillId) !== norm(allowed)) {
        throw new ForbiddenException({
          code: 'B2',
          message: 'ApplicationId de la Skill no autorizado',
          error: 'Forbidden',
        });
      }
    }

    return this.alexaService.handle(body);
  }

  @Get('status')
  status() {
    const vitalIdConfigured = Boolean(
      process.env.VITAL_ID_BASE_URL && process.env.VITAL_ID_BASE_URL.trim(),
    );
    return {
      service: 'alexa',
      status: 'ok',
      vitalIdBaseUrl: vitalIdConfigured,
      skillIdConfigured: Boolean(
        process.env.ALEXA_SKILL_ID && process.env.ALEXA_SKILL_ID.trim(),
      ),
    };
  }
}