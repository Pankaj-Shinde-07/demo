// Barrel — re-export all AI Copilot entities for TypeOrmModule.forFeature(...).
//
// All entities are net-new in W1. They scaffold the Repository pattern used
// by TenantScopedRepository<T> (CP1.3). The migrations in ../migrations/ are
// the source of truth for the schema; these entities mirror it.

export { Tenant } from './tenant.entity';
export { TenantDataSource } from './tenant-data-source.entity';
export { TenantTokenBudget } from './tenant-token-budget.entity';

export { KnowledgeDocument } from './knowledge-document.entity';
export { KnowledgeChunk } from './knowledge-chunk.entity';

export { AiConversation } from './ai-conversation.entity';
export { AiMessage } from './ai-message.entity';
export { AiFeedback } from './ai-feedback.entity';
export { AiAuditLog } from './ai-audit-log.entity';

export { AiDashboardTemplate } from './ai-dashboard-template.entity';
export { AiDashboardGenerationLog } from './ai-dashboard-generation-log.entity';
export { DashboardWidgetMetadata } from './dashboard-widget-metadata.entity';

export { CmdbConfigurationItem } from './cmdb-configuration-item.entity';
export { CmdbRelationship } from './cmdb-relationship.entity';
export { CmdbBusinessService } from './cmdb-business-service.entity';
export { CmdbServiceCiLink } from './cmdb-service-ci-link.entity';
export { CmdbChangeLink } from './cmdb-change-link.entity';
