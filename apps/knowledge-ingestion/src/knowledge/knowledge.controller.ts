import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Query,
  Body,
  UploadedFile,
  UseInterceptors,
  ParseUUIDPipe,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiConsumes, ApiOperation } from '@nestjs/swagger';
import { KnowledgeService } from './knowledge.service';
import { UploadDocumentDto } from './dto/upload-document.dto';

const MAX_UPLOAD_BYTES = 52_428_800; // 50MB (W2_BRIEF §3)

@ApiTags('knowledge')
@Controller('api/v1/knowledge')
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Post('upload')
  @ApiOperation({ summary: 'Upload a document for async ingestion (parse → chunk → store)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  async upload(
    @UploadedFile() file: { originalname: string; buffer: Buffer; size: number } | undefined,
    @Body() dto: UploadDocumentDto,
  ) {
    if (!file) throw new BadRequestException('file is required (multipart field "file")');
    return this.knowledge.uploadAndQueue(file, dto);
  }

  @Get('documents/:id')
  @ApiOperation({ summary: 'Get document ingestion status' })
  getStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('tenant_id', ParseUUIDPipe) tenantId: string,
  ) {
    return this.knowledge.getStatus(id, tenantId);
  }

  @Delete('documents/:id')
  @ApiOperation({ summary: 'Delete a document (chunks cascade)' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('tenant_id', ParseUUIDPipe) tenantId: string,
  ) {
    return this.knowledge.remove(id, tenantId);
  }

  @Post('documents/:id/reindex')
  @ApiOperation({ summary: 'Re-run ingestion for a document' })
  reindex(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('tenant_id', ParseUUIDPipe) tenantId: string,
  ) {
    return this.knowledge.reindex(id, tenantId);
  }
}
