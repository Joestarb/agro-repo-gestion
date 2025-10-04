// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['log', 'warn', 'error', 'debug'] });
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3000);
}
bootstrap();
