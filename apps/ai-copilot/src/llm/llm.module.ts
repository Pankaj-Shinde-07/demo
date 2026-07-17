import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LlmGateway } from './llm-gateway.service';
import { AnthropicProvider } from './anthropic.provider';
import { OllamaProvider } from './ollama.provider';
import { PromptTemplateRegistry } from './prompt-template.registry';
import { TokenBudgetService } from './token-budget.service';
import { LlmAuditService } from './llm-audit.service';

/**
 * W5 LLM Gateway module (D7). Exports ONLY the gateway — downstream workstreams
 * (W7 chat, W8 RCA) depend on `LlmGateway`, never on a provider. The TypeORM
 * DataSource is global (root TypeOrmModule), so budget/audit services use it
 * directly. The providers are internal; the Anthropic SDK lives behind them.
 */
@Module({
  imports: [ConfigModule],
  providers: [
    LlmGateway,
    AnthropicProvider,
    OllamaProvider,
    PromptTemplateRegistry,
    TokenBudgetService,
    LlmAuditService,
  ],
  exports: [LlmGateway],
})
export class LlmModule {}
