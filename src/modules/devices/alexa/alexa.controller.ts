import { Controller, Post, Body, UsePipes, ValidationPipe, HttpCode } from '@nestjs/common';

@Controller('alexa')
export class AlexaController {
  @Post()
  @HttpCode(200) // <--- OBLIGATORIO PARA ALEXA
  @UsePipes(new ValidationPipe({ whitelist: false, forbidNonWhitelisted: false }))
  handleAlexaRequest(@Body() body: any) {
    const requestType = body.request?.type;

    if (requestType === 'LaunchRequest') {
      return this.buildAlexaResponse(
        '¡Hola! Bienvenido a Vital Guard. ¿En qué puedo ayudarte hoy?'
      );
    }

    if (requestType === 'IntentRequest') {
      const intentName = body.request.intent?.name;

      if (intentName === 'ConsultarTomasIntent') {
        const mensajeRespuesta =
          'Tu próxima toma es Paracetamol de 500 miligramos a las 8:00 PM en el compartimento 1.';

        return this.buildAlexaResponse(mensajeRespuesta);
      }
    }

    return this.buildAlexaResponse(
      'Lo siento, no entendí esa indicación de mi pastillero.'
    );
  }

  private buildAlexaResponse(speechText: string) {
    return {
      version: '1.0',
      response: {
        outputSpeech: {
          type: 'PlainText',
          text: speechText,
        },
        shouldEndSession: false,
      },
    };
  }
}