import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { IngestionService } from './application/ingestion.service';
import { WsClientService } from './application/ws-client.service';
import { SensorEventSchema, LatestReadingSchema } from '@agro-project/schemas';

@Module({
  imports: [
    MongooseModule.forRoot(process.env.MONGODB_URI!, {
      dbName: process.env.DB_NAME,
    }),
    MongooseModule.forFeature([
      { name: 'SensorEvent', schema: SensorEventSchema },
      { name: 'LatestReading', schema: LatestReadingSchema },
    ]),
  ],
  providers: [IngestionService, WsClientService],
})
export class AppModule {}
