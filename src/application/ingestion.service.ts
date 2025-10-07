import crypto from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LatestReadingDocument } from '@agro-project/schemas';

type Reading = {
  sensorType: string;
  sensorId: string;
  ts: string;
  value: number;
};

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    @InjectModel('SensorEvent') private readonly eventModel: Model<any>,
    @InjectModel('LatestReading') private readonly latestModel: Model<LatestReadingDocument>,
  ) {}

  async processReading(r: Reading) {
    const hash = this.hashReading(r);
    const ts = new Date(r.ts);

    try {
      const latest = await this.latestModel.findOne({
        sensorType: r.sensorType,
        sensorId: r.sensorId,
      }).lean();

      const changed = !latest || latest.payloadHash !== hash;
      if (!changed) {
        this.logger.debug(`Sin cambios para ${r.sensorType}:${r.sensorId} @ ${r.ts}`);
        return;
      }

      // Inserta en histórico
      const eventResult = await this.eventModel.updateOne(
        { sensorType: r.sensorType, sensorId: r.sensorId, ts },
        {
          $setOnInsert: {
            value: r.value,
            payloadHash: hash,
            source: 'sensores-async-api',
            receivedAt: new Date(),
          },
        },
        { upsert: true },
      );

      this.logger.debug(
        `SensorEvent ${r.sensorType}:${r.sensorId} → matched: ${eventResult.matchedCount}, modified: ${eventResult.modifiedCount}, upserted: ${eventResult.upsertedCount}`,
      );

      // Actualiza latest_readings
      const latestResult = await this.latestModel.updateOne(
        { sensorType: r.sensorType, sensorId: r.sensorId },
        { $set: { ts, value: r.value, payloadHash: hash, updatedAt: new Date() } },
        { upsert: true },
      );

      this.logger.debug(
        `LatestReading ${r.sensorType}:${r.sensorId} → matched: ${latestResult.matchedCount}, modified: ${latestResult.modifiedCount}, upserted: ${latestResult.upsertedCount}`,
      );

      // 👇 Lógica de limpieza: mantener máximo 10,000 históricos
      const count = await this.eventModel.estimatedDocumentCount();
      if (count > 10000) {
        const oldest = await this.eventModel
          .find()
          .sort({ receivedAt: 1 })
          .limit(count - 10000);

        const ids = oldest.map(doc => doc._id);
        await this.eventModel.deleteMany({ _id: { $in: ids } });

        this.logger.warn(`⚠️ Se eliminaron ${ids.length} históricos para mantener el límite de 10,000`);
      }

    } catch (err: any) {
      if (err?.code === 11000) {
        this.logger.debug(`Duplicate event skipped: ${r.sensorType}:${r.sensorId} @ ${r.ts}`);
      } else {
        this.logger.error(`❌ Error procesando lectura ${r.sensorType}:${r.sensorId}: ${err.message}`, err.stack);
      }
    }
  }

  private hashReading(r: Reading) {
    const canonical = JSON.stringify({
      sensorType: r.sensorType,
      sensorId: r.sensorId,
      ts: r.ts,
      value: r.value,
    });
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }
}
