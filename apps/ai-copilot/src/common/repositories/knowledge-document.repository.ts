import { Injectable, Scope } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KnowledgeDocument } from '../../entities/knowledge-document.entity';
import { TenantScopedRepository } from '../tenant-scoped.repository';

// Per-request instantiation: the tenantId comes from the request context
// (resolved by W5/W6's request-scoped factory, not yet wired in CP1.3).
// In CP1.3, the e2e test instantiates this class directly with a fixed
// tenantId, bypassing Nest DI for the runtime arg — see the CP1.3 brief
// "Things to flag" section for why the DI factory shape is deferred.
@Injectable({ scope: Scope.TRANSIENT })
export class KnowledgeDocumentRepository extends TenantScopedRepository<KnowledgeDocument> {
  constructor(
    @InjectRepository(KnowledgeDocument) repo: Repository<KnowledgeDocument>,
    tenantId: string,
  ) {
    super(repo, tenantId);
  }
}
