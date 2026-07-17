import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RetrievalService, SearchResult } from './retrieval.service';
import { SearchQueryDto } from './dto/search-query.dto';

/**
 * Knowledge retrieval surface (W4). This is the retrieval core the W6 context
 * engine will call. Path is fully-qualified (no global prefix is set).
 */
@ApiTags('knowledge')
@Controller('api/v1/knowledge')
export class RetrievalController {
  constructor(private readonly retrievalService: RetrievalService) {}

  @Get('search')
  @ApiOperation({
    summary: 'Hybrid retrieval (dense + sparse + RRF) over tenant knowledge chunks.',
  })
  async search(@Query() dto: SearchQueryDto): Promise<SearchResult> {
    return this.retrievalService.search(dto);
  }
}
