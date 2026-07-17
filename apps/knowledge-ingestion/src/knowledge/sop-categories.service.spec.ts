import * as path from 'node:path';
import { ConfigService } from '@nestjs/config';
import { SopCategoriesService } from './sop-categories.service';

// Point PACKS_ROOT at the repo's real packs/ so we exercise the committed
// banking pack's sop-categories.yaml.
const PACKS_ROOT = path.join(__dirname, '..', '..', '..', '..', 'packs');
const config = { get: (_k: string, d?: unknown) => PACKS_ROOT ?? d } as ConfigService;

describe('SopCategoriesService (W2 / CP2.3 — soft hint)', () => {
  const svc = new SopCategoriesService(config);

  it('matches a CBS EOD document to cbs_eod', async () => {
    expect(await svc.hint('banking', 'CBS End-of-Day batch and day rollover')).toBe('cbs_eod');
  });

  it('matches a UPI reconciliation document to upi_reconciliation', async () => {
    expect(await svc.hint('banking', 'UPI/IMPS settlement reconciliation with NPCI')).toBe(
      'upi_reconciliation',
    );
  });

  it('returns null when nothing matches', async () => {
    expect(await svc.hint('banking', 'completely unrelated content about gardening')).toBeNull();
  });

  it('returns null (never throws) for an unknown industry', async () => {
    expect(await svc.hint('does-not-exist', 'anything')).toBeNull();
  });
});
