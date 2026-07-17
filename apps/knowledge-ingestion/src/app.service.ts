import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AppService {
  constructor(private configService: ConfigService) {}

  // Health response intentionally omits the `database` field — knowledge-ingestion
  // has no DB wiring in CP1.2. The field reappears in W2 when Postgres+BullMQ
  // wiring is added (per CP1.2 architect resolution).
  getHealth(): {
    status: string;
    module: string;
    uptime: number;
    environment: string;
    version: string;
    timestamp: string;
  } {
    return {
      status: 'healthy',
      module: 'knowledge-ingestion',
      uptime: process.uptime(),
      environment: this.configService.get<string>('NODE_ENV', 'development'),
      version: '0.1.0',
      timestamp: new Date().toISOString(),
    };
  }
}
