import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe, Logger } from '@nestjs/common';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';
import { HttpLoggerInterceptor } from './common/interceptors/http-logger.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug', 'verbose'],
  });
  // Logs robustos para docker logs -f vitalguard-backend
  app.useGlobalInterceptors(new HttpLoggerInterceptor());
  const logger = new Logger('Bootstrap');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type, Accept, Authorization',
  });

  // Configuración de microservicio MQTT con tiempo de espera bajo
  const mqttUrl = process.env.MQTT_BROKER_URL || 'mqtt://178.128.0.112:1883';
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.MQTT,
    options: {
      url: mqttUrl,
      connectTimeout: 3000,
      reconnectPeriod: 0, // Desactiva reintentos infinitos en local
    },
  });

  const config = new DocumentBuilder()
    .setTitle('VitalGuard API')
    .setDescription('API Backend para la gestión de adherencia a medicamentos e IoT')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));

  // PRIMERO levantamos el servidor HTTP para garantizar que los endpoints funcionen
  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');
  logger.log(`🚀 HTTP API corriendo en: http://localhost:${port}/api/docs`);
  logger.log(`[FCM] Service account path: ${process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? 'no configurado'}`);

  // LUEGO intentamos iniciar los microservicios MQTT sin bloquear el hilo HTTP
  app.startAllMicroservices()
    .then(() => logger.log(`📡 Cliente MQTT conectado a: ${mqttUrl}`))
    .catch(() => logger.warn(`⚠️ No se pudo conectar a MQTT (${mqttUrl}). Modo HTTP activo.`));
}
bootstrap();