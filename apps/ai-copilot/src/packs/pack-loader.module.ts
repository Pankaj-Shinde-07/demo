import { Module } from '@nestjs/common';
import { PackLoaderService } from './pack-loader.service';

@Module({
  providers: [PackLoaderService],
  exports: [PackLoaderService],
})
export class PackLoaderModule {}
