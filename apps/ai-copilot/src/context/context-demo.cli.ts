/**
 * CP6.2/CP6.3 paste-back helper (Deliverable C). Builds and prints the full
 * OperationalContext for one real CI through the live provider stack, or — with
 * `--mode=graph` — the raw CP6.3 impact graph twice (to show the Redis cache
 * miss → hit), proving the traversal against live data.
 *
 *   npm run context:demo -- --ref="UPI Switch 1" --tenant=<tenant-uuid>
 *   npm run context:demo -- --mode=graph --ref="Sponsor Bank Link A"
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { ContextEngine } from './context-engine.service';
import { CmdbGraphService } from './cmdb-graph.service';

const DEFAULTS = {
  ref: 'UPI Switch 1', // a tier-1 upi_imps member (ci_type=upi_switch)
  tenant: 'cfc5801f-db4e-454c-a14a-4732d9eac48a',
};

function arg(name: string, fallback: string): string {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

async function main(): Promise<void> {
  const logger = new Logger('ContextDemoCli');
  const ref = arg('ref', DEFAULTS.ref);
  const tenant = arg('tenant', DEFAULTS.tenant);
  const type = arg('type', 'ci') as 'ci' | 'alert' | 'asset';

  const mode = arg('mode', 'context');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    if (mode === 'graph') {
      const graph = app.get(CmdbGraphService);
      const run1 = await graph.assembleImpactGraph(tenant, { type: 'ci', ref });
      const run2 = await graph.assembleImpactGraph(tenant, { type: 'ci', ref });
      logger.log(
        `assembleImpactGraph('${ref}') → run1.cacheHit=${run1.cacheHit}, run2.cacheHit=${run2.cacheHit}`,
      );
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify(
          {
            seed: run1.seed,
            affectedServices: run1.affectedServices.map((s) => s.name),
            dependencyChain: run1.dependencyChain.map((c) => c.name),
            depthReached: run1.depthReached,
            cyclesCut: run1.cyclesCut,
            affectedNodeCount: run1.affectedNodeCount,
            totalCustomers: run1.totalCustomers,
            customerNodeSample: run1.customerBearingNodes.slice(0, 3),
            gaps: run1.gaps,
            cache: { run1CacheHit: run1.cacheHit, run2CacheHit: run2.cacheHit },
          },
          null,
          2,
        ),
      );
      return;
    }

    const engine = app.get(ContextEngine);
    const packId = arg('pack', 'default');
    const ctx = await engine.buildContext({ tenantId: tenant, entity: { type, ref }, packId });
    logger.log(`buildContext('${ref}') → completeness=${ctx.cmdbContext.completeness} in ${ctx.meta.buildMs}ms`);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(ctx, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
