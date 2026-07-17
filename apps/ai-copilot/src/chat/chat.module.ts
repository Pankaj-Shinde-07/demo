import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { ContextModule } from '../context/context.module';
import { DataSourceModule } from '../datasource/datasource.module';
import { IncidentModule } from '../incident/incident.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { ChatController } from './chat.controller';
import { ChatOrchestratorService } from './chat-orchestrator.service';
import { IntentRouterService } from './intent-router.service';
import { ChatSessionStore } from './chat-session.store';

/**
 * W7 — Copilot Chat (SSE delivery surface). Ties together W4 retrieval, W6
 * context + D15, and W8 incident reasoning behind a grounded, cited, streaming,
 * multi-turn chat. No new core reasoning — the delivery layer. RedisModule is
 * global (session state); audit lives in ai_audit_log; no new Postgres table.
 */
@Module({
  imports: [LlmModule, RetrievalModule, ContextModule, DataSourceModule, IncidentModule, DashboardModule],
  controllers: [ChatController],
  providers: [ChatOrchestratorService, IntentRouterService, ChatSessionStore],
  exports: [ChatOrchestratorService],
})
export class ChatModule {}
