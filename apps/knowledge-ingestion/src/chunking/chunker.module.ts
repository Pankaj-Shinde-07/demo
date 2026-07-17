import { Module } from '@nestjs/common';
import { ChunkerService } from './chunker.service';

/**
 * Chunking module (W2 / CP2.2). Exports the chunker for the upload pipeline
 * (CP2.3), which parses → chunks → stores.
 */
@Module({
  providers: [ChunkerService],
  exports: [ChunkerService],
})
export class ChunkerModule {}
