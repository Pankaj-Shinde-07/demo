/**
 * CP9.3.2/9.3.3/9.3.4 paste-back — LIVE. Boots Nest and exercises the template
 * read path through the real PackLoader + resolver.
 *
 *   PACKS_ROOT=<repo>/packs npx ts-node -r tsconfig-paths/register \
 *     src/dashboard/template-render.cli.ts [--list | --render]
 *
 *  --list   : load + validate the pack templates; print count, keys, CEO JSON.
 *             (If a template is invalid, the pack load throws — used for the
 *              broken-template rejection proof.)
 *  --render : render CEO/NOC/Branch for the rich tenant and CEO/SOC for the poor
 *             tenant; print resolved widget states.
 *  default  : both.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { DashboardTemplateService } from './dashboard-template.service';

/* eslint-disable no-console */
const RICH = 'cfc5801f-db4e-454c-a14a-4732d9eac48a';
const POOR = '11111111-1111-1111-1111-111111111111';
const args = process.argv.slice(2);
const want = (m: string) => args.includes(m) || (!args.includes('--list') && !args.includes('--render'));

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const svc = app.get(DashboardTemplateService);
  try {
    if (want('--list')) {
      const templates = await svc.listTemplates('banking'); // throws if any template is invalid
      console.log(`\n=== GET /templates?pack=banking → ${templates.length} validated templates ===`);
      for (const t of templates) console.log(`  ${t.persona?.padEnd(11)} ${t.key}  (${t.widgets.length} widgets)`);
      const ceo = templates.find((t) => t.persona === 'ceo');
      console.log('\n=== CEO template JSON ===');
      console.log(JSON.stringify(ceo, null, 2));
    }

    if (want('--render')) {
      const proofs: [string, string, string][] = [
        ['ceo-bank-digital-operations-scorecard', RICH, 'RICH'],
        ['noc-real-time-infrastructure', RICH, 'RICH'],
        ['branch-operations', RICH, 'RICH'],
        ['ceo-bank-digital-operations-scorecard', POOR, 'POOR'],
        ['soc-cyber-security-operations', POOR, 'POOR'],
      ];
      for (const [key, tenant, label] of proofs) {
        const d = await svc.render('banking', key, tenant);
        console.log(`\n=== RENDER ${key}  [${label} tenant]  → ${d.liveCount} live / ${d.emptyCount} empty ===`);
        for (const w of d.widgets) {
          const tag = w.status === 'live' ? 'LIVE ' : 'empty';
          console.log(`  [${tag}] ${w.type.padEnd(22)} ${w.title.padEnd(26)} — ${w.detail}`);
        }
      }
    }
  } finally {
    await app.close();
  }
}
main().catch((e) => {
  console.error('LOAD/RENDER ERROR:', e?.name, '-', e?.message);
  if (e?.issues) console.error('issues:', JSON.stringify(e.issues).slice(0, 400));
  process.exit(1);
});
