import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { io, Socket } from 'socket.io-client';

import {
  SensorEventDocument,
  LatestReadingDocument,
} from '@agro-project/schemas';

@Injectable()
export class WsClientService implements OnModuleInit {
  private socket: Socket;

  constructor(
    @InjectModel('SensorEvent')
    private readonly sensorEventModel: Model<SensorEventDocument>,

    @InjectModel('LatestReading')
    private readonly latestReadingModel: Model<LatestReadingDocument>,
  ) {}

  async onModuleInit() {
    this.socket = io(process.env.GATEWAY_URL || 'http://gateway:3000');

    this.socket.on('connect', () => {
      console.log('🔌 Ingestion conectado al Gateway');
    });

    this.socket.on('reading', async (data: any) => {
      try {
        if (Array.isArray(data)) {
          for (const reading of data) {
            await this.handleReading(reading);
          }
        } else if (typeof data === 'object' && data !== null) {
          for (const [id, reading] of Object.entries(data)) {
            if (id === 'sensorType') continue;

            const payload =
              reading && typeof reading === 'object'
                ? { sensorType: data.sensorType, sensorId: id, ...reading }
                : { sensorType: data.sensorType, sensorId: id, value: reading };

            await this.handleReading(payload);
          }
        } else {
          console.warn('⚠️ Payload inesperado:', data);
        }
      } catch (err: any) {
        console.error('❌ Error procesando lectura:', err.message);
      }
    });
  }

  private async handleReading(reading: any) {
    console.log('📥 Lectura recibida:', reading);

    // Extraer timestamp y mapearlo a ts
    const { timestamp, ...rest } = reading;

    const eventDoc = {
      ...rest,
      ts: timestamp ? new Date(timestamp) : new Date(),
      receivedAt: new Date(),
    };

    // Inserta en histórico (SensorEvent)
    await this.sensorEventModel.create(eventDoc);

    // Upsert en LatestReading
    await this.latestReadingModel.updateOne(
      { sensorType: eventDoc.sensorType, sensorId: eventDoc.sensorId },
      { $set: { ...eventDoc, updatedAt: new Date() } },
      { upsert: true },
    );
  }
}
