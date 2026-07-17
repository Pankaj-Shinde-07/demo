import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

@Injectable()
export class AppService {
  constructor(
    private dataSource: DataSource,
    private configService: ConfigService,
  ) {}

  async getHealth(): Promise<{
    status: string;
    module: string;
    uptime: number;
    environment: string;
    version: string;
    database: { connected: boolean; latencyMs?: number };
    timestamp: string;
  }> {
    let dbConnected = false;
    let dbLatency: number | undefined;

    try {
      const start = Date.now();
      await this.dataSource.query('SELECT 1');
      dbLatency = Date.now() - start;
      dbConnected = true;
    } catch {
      dbConnected = false;
    }

    return {
      status: dbConnected ? 'healthy' : 'degraded',
      module: 'ai-copilot',
      uptime: process.uptime(),
      environment: this.configService.get<string>('NODE_ENV', 'development'),
      version: '0.1.0',
      database: {
        connected: dbConnected,
        latencyMs: dbLatency,
      },
      timestamp: new Date().toISOString(),
    };
  }
}
