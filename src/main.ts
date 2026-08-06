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
    origin: '*', // Permitir solicitudes desde cualquier origen
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

  // Iniciar tanto los listeners MQTT como el servidor HTTP REST
  await app.startAllMicroservices();
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');

  console.log(`🚀 HTTP API corriendo en: http://localhost:${process.env.PORT ?? 3000}/api/docs`);
  console.log(`📡 Cliente MQTT conectado escuchando eventos del ESP32...`);
}
bootstrap();