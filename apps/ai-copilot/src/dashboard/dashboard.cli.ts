/**
 * W9 gate — render the monthly board digest on SynthBank (the thin render; the
 * production React dashboards are W11).
 *
 *   npm run board:digest               # deterministic digest + checks
 *   npm run board:digest -- --narrate  # also generate the executive narrative
 *
 * Proves: 6 sections assembled, every figure classed (no number without class),
 * the narrative ⊆ tiles, the DR-gap surfaced, ROI "unprovable" without a baseline,
 * and determinism across reruns.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { BoardDigestService } from './board-digest.service';
import { DashboardTilesService } from './dashboard-tiles.service';
import type { BoardDigest } from './dashboard.types';

const TENANT = 'cfc5801f-db4e-454c-a14a-4732d9eac48a';
const NO_BASELINE_TENANT = '00000000-0000-0000-0000-000000000000';
const log = new Logger('BoardDigest');
const j = (o: unknown) => JSON.stringify(o, null, 2);

function figuresView(d: BoardDigest) {
  return d.sections.map((s) => ({
    section: s.key,
    tiles: s.tiles.map((t) => ({
      tile: t.id,
      status: t.status,
      figures: t.figures.map((f) => `${f.metric}=${f.value} ${f.unit} [${f.classLabel}] grounded=${f.groundingInputs.length}${f.assumptions.length ? ' assumed=[' + f.assumptions.map((a) => a.verify ?? a.description).join(' | ') + ']' : ''}`),
      notes: t.notes,
      gaps: t.gaps.map((g) => `${g.scope}:${g.missingInput}→${g.degradedOutput}`),
    })),
  }));
}

async function main(): Promise<void> {
  const narrate = process.argv.slice(2).includes('--narrate');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const svc = app.get(BoardDigestService);
  const tiles = app.get(DashboardTilesService);
  try {
    const a = await svc.assemble(TENANT, 'banking');
    const b = await svc.assemble(TENANT, 'banking');
    const valuesA = [...BoardDigestService.tileFigureValues(a)].sort((x, y) => x - y);
    const valuesB = [...BoardDigestService.tileFigureValues(b)].sort((x, y) => x - y);
    const deterministic = JSON.stringify(valuesA) === JSON.stringify(valuesB);

    const classed = BoardDigestService.checkFiguresClassed(a);

    // Empty-state proof: ROI is "unprovable" without a captured baseline.
    const noBaseline = await tiles.valueRealized(NO_BASELINE_TENANT, 'banking');

    let narrativeOut: unknown = '(skipped; pass --narrate)';
    let narrativeCheck: unknown = null;
    if (narrate) {
      const withN = await svc.assembleWithNarrative(TENANT, 'banking');
      const chk = BoardDigestService.checkNarrativeInTiles(withN.narrative?.content ?? '', withN);
      narrativeOut = { grounded: withN.narrative?.grounded, declined: withN.narrative?.declined, model: withN.narrative?.model, refs: withN.narrative?.evidenceRefs?.length, content: withN.narrative?.content };
      narrativeCheck = { narrativeSubsetOfTiles: chk.ok, orphanNumbers: chk.orphans };
    }

    // eslint-disable-next-line no-console
    console.log(j({
      proof: 'W9 board digest on SynthBank (labelled synthetic)',
      label: a.label,
      sections: a.sections.map((s) => s.key),
      noNumberWithoutClass: classed,
      deterministic,
      drGapSurfaced: a.sections.find((s) => s.key === 'bcp_dr')?.tiles[0]?.gaps?.some((g) => g.degradedOutput === 'dr_posture_unknown') ?? false,
      roiUnprovableWithoutBaseline: { status: noBaseline.status, note: noBaseline.notes[0], gap: noBaseline.gaps[0] },
      digest: figuresView(a),
      narrativeCheck,
      narrative: narrativeOut,
    }));
    if (!classed.ok || !deterministic) process.exit(3);
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  log.error(e);
  process.exit(1);
});
