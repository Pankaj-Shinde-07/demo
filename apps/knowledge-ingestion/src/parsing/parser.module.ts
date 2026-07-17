import { Module } from '@nestjs/common';
import { ParserService } from './parser.service';

/**
 * Parsing module (W2 / CP2.1). Exports the format dispatcher so the upload
 * pipeline (CP2.3) can resolve uploads to normalized ParsedDocuments.
 */
@Module({
  providers: [ParserService],
  exports: [ParserService],
})
export class ParserModule {}
