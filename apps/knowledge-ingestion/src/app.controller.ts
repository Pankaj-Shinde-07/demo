import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';

// Health endpoint registered on both `/` (EMS pattern — compose healthcheck hits this)
// and `/health` (cloud-native alias — same handler, same body) per CP1.2 resolution.
@ApiTags('health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHealthRoot() {
    return this.appService.getHealth();
  }

  @Get('health')
  getHealthAlias() {
    return this.appService.getHealth();
  }
}
