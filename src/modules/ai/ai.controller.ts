import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  RateLimitGuard,
  rateLimitFromEnv,
} from '../../common/guards/rate-limit.guard';
import { GetVitalId } from '../../common/decorators/get-user.decorator';
import { GeminiService } from './gemini.service';
import { AiOrchestratorService } from './ai-orchestrator.service';
import { VoiceCommandDto } from './dto/voice-command.dto';

@ApiTags('AI')
@Controller('ai')
export class AiController {
  constructor(
    private readonly geminiService: GeminiService,
    private readonly orchestrator: AiOrchestratorService,
  ) {}

  /** Endpoint de prueba (contexto simulado) — preserva el comportamiento original. */
  @Post('test')
  @ApiOperation({ summary: 'Prueba del clasificador Gemini con contexto simulado' })
  async probarGemini(@Body('texto') texto: string) {
    const contextoSimulado = {
      nombre: 'Jesús',
      medicamentos_programados: ['Metformina', 'Paracetamol'],
    };

    const resultado = await this.geminiService.analyzeVoiceCommand(
      texto,
      contextoSimulado,
    );

    return {
      exito: true,
      datos_procesados: resultado,
    };
  }

  /** Endpoint real de la Fase A: comando de voz con contexto real del paciente. */
  @Post('voice-command')
  @UseGuards(
    JwtAuthGuard,
    new RateLimitGuard(
      rateLimitFromEnv('voice_command', { limit: 20, windowMs: 60_000 }),
    ),
  )
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Procesa un comando de voz con contexto real y ejecuta la acción' })
  async voiceCommand(
    @Body() dto: VoiceCommandDto,
    @GetVitalId() vitalId: string,
  ) {
    return this.orchestrator.processVoiceCommand({
      patientId: dto.patientId,
      text: dto.texto,
      vitalId,
    });
  }
}
