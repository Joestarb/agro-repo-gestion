// src/app.module.ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { IngestionService } from './application/ingestion.service';
import { SchedulerService } from './application/scheduler.service';
import { SensorEventSchema, LatestReadingSchema } from '@agro-project/schemas';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    MongooseModule.forRoot(process.env.MONGODB_URI!, {
      dbName: process.env.DB_NAME,
    }),
    MongooseModule.forFeature([
      { name: 'SensorEvent', schema: SensorEventSchema },
      { name: 'LatestReading', schema: LatestReadingSchema },
    ]),

  ],
  providers: [IngestionService, SchedulerService],
})
export class AppModule {}
