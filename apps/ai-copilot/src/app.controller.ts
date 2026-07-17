import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { AppService } from './app.service';

// Health endpoints:
//   `/` and `/health` — LIVENESS (always 200 with a status body; EMS pattern).
//   `/health/ready`   — READINESS (DEPLOY-1 CP-D3): returns 503 when the DB is
//                       unreachable, so the Docker healthcheck only goes healthy
//                       when the service can actually serve + reach the DB
//                       (T-SILENT-HALF-DEAD — no silently-half-dead container).
@ApiTags('health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @SkipThrottle()
  async getHealthRoot() {
    return this.appService.getHealth();
  }

  @Get('health')
  @SkipThrottle()
  async getHealthAlias() {
    return this.appService.getHealth();
  }

  @Get('health/ready')
  @SkipThrottle()
  async getReadiness() {
    const health = await this.appService.getHealth();
    if (!health.database.connected) {
      // Non-200 → the compose healthcheck marks the container unhealthy.
      throw new ServiceUnavailableException({ ...health, ready: false });
    }
    return { ...health, ready: true };
  }
}
