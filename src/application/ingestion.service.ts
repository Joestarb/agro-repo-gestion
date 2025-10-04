// src/application/ingestion.service.ts
import axios from 'axios';
import pLimit from 'p-limit';
import crypto from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LatestReadingDocument } from '@agro-project/schemas';

type Reading = {
  sensorType: string;
  sensorId: string;
  ts: string;        // ISO string
  value: number;
};

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);
  private readonly limit = pLimit(12); // controla concurrencia

  private readonly apiBaseUrl = process.env.API_BASE_URL || '';
  private readonly pollIntervalMs = Number(process.env.POLL_INTERVAL_MS || '60000');

  constructor(
    @InjectModel('SensorEvent') private readonly eventModel: Model<any>,
    @InjectModel('LatestReading') private readonly latestModel: Model<LatestReadingDocument>,
  ) {}

  // Método manual (útil para pruebas)
  async pollOnce() {
    await this.pollAll();
  }

  // Loop manual si no quieres cron
  async startLoop() {
    while (true) {
      await this.pollAll();
      await new Promise(r => setTimeout(r, this.pollIntervalMs));
    }
  }

  async pollAll() {
    const endpoints = ['temperatura', 'humedad', 'lluvia', 'radiacion_solar'];

    const tasks = endpoints.map(ep => this.limit(() => this.fetchAndProcess(ep)));
    const results = await Promise.allSettled(tasks);

    const ok = results.filter(r => r.status === 'fulfilled').length;
    const fail = results.length - ok;
    this.logger.log(`Ciclo de ingesta: ${ok} ok, ${fail} fallos`);
  }

  private async fetchAndProcess(endpoint: string) {
    try {
      const url = `${this.apiBaseUrl}/${endpoint}`;
      const { data } = await axios.get(url, { timeout: 10000 });
      const readings = this.normalize(data, endpoint);

      const writes = readings.map(r => this.limit(() => this.processReading(r)));
      await Promise.all(writes);
      this.logger.log(`Procesados ${readings.length} readings de ${endpoint}`);
    } catch (e: any) {
      this.logger.warn(`Fetch failed for ${endpoint}: ${e.message}`);
    }
  }

  private normalize(payload: any, endpoint: string): Reading[] {
    const nowIso = new Date().toISOString();

    if (Array.isArray(payload)) {
      return payload.map((p: any, i: number) => ({
        sensorType: endpoint,
        sensorId: p.id ?? `${endpoint}-${i}`,
        ts: p.ts ?? nowIso,
        value: Number(p.value),
      }));
    }

    if (payload && typeof payload === 'object' && payload[endpoint]) {
      const arr = Array.isArray(payload[endpoint]) ? payload[endpoint] : [payload[endpoint]];
      return arr.map((p: any, i: number) => ({
        sensorType: endpoint,
        sensorId: p.id ?? `${endpoint}-${i}`,
        ts: p.ts ?? nowIso,
        value: Number(p.value),
      }));
    }

    return [{
      sensorType: endpoint,
      sensorId: `${endpoint}-0`,
      ts: payload?.ts ?? nowIso,
      value: Number(payload?.value ?? 0),
    }];
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

  private async processReading(r: Reading) {
    const hash = this.hashReading(r);
    const ts = new Date(r.ts);

    try {
      // 1) Lee último estado
      const latest = await this.latestModel.findOne({
        sensorType: r.sensorType,
        sensorId: r.sensorId,
      }).lean();

      const changed = !latest || latest.payloadHash !== hash;
      if (!changed) {
        this.logger.debug(`Sin cambios para ${r.sensorType}:${r.sensorId} @ ${r.ts}`);
        return;
      }

      // 2) Inserta en histórico
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

      // 3) Actualiza latest_readings
      const latestResult = await this.latestModel.updateOne(
        { sensorType: r.sensorType, sensorId: r.sensorId },
        { $set: { ts, value: r.value, payloadHash: hash, updatedAt: new Date() } },
        { upsert: true },
      );

      this.logger.debug(
        `LatestReading ${r.sensorType}:${r.sensorId} → matched: ${latestResult.matchedCount}, modified: ${latestResult.modifiedCount}, upserted: ${latestResult.upsertedCount}`,
      );
    } catch (err: any) {
      if (err?.code === 11000) {
        this.logger.debug(`Duplicate event skipped: ${r.sensorType}:${r.sensorId} @ ${r.ts}`);
      } else {
        this.logger.error(`❌ Error procesando lectura ${r.sensorType}:${r.sensorId}: ${err.message}`, err.stack);
      }
    }
  }
}
