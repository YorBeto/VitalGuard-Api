import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Pipes globales de validación
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Configuración de CORS
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type, Accept, Authorization',
  });

  // Conexión del Microservicio MQTT
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.MQTT,
    options: {
      url: process.env.MQTT_BROKER_URL || 'mqtt://178.128.0.112:1883',
    },
  });

  // Configuración de Swagger
  const config = new DocumentBuilder()
    .setTitle('VitalGuard API')
    .setDescription('API Backend para la gestión de adherencia a medicamentos e IoT')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));

  // 1. Levantar PRIMERO el servidor HTTP (prioriza process.env.PORT)
  const port = process.env.PORT || 3001;
  await app.listen(port, '0.0.0.0');
  console.log(`🚀 HTTP API corriendo en: http://localhost:${port}/api/docs`);

  // 2. Iniciar MQTT de forma asíncrona sin bloquear el hilo principal HTTP
  app.startAllMicroservices()
    .then(() => console.log(`📡 Cliente MQTT conectado escuchando eventos del ESP32...`))
    .catch((err) => console.warn(`⚠️ No se pudo conectar a MQTT, pero el servidor HTTP/Alexa sigue activo.`));
}
bootstrap();