// src/application/scheduler.service.ts
import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { IngestionService } from './ingestion.service';

@Injectable()
export class SchedulerService {
  constructor(private readonly ingestionService: IngestionService) {}

  // Ejemplo: correr cada minuto
  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron() {
    console.log('⏰ Ejecutando tarea programada...');
    await this.ingestionService.pollAll();
  }
}
