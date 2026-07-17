import * as path from 'node:path';
import { PackLoaderService } from '../src/packs/pack-loader.service';

/**
 * CP6.5 PASS proof — the value-model coefficients resolve from the REAL packs:
 *   - banking carries the [ucb-verify]-tagged value-at-risk + retention figures;
 *   - swapping the active pack to `default` yields generic equivalents, no error.
 * Customer/branch COUNTS are deliberately absent from the value-model (they are
 * Class-1 spine data per §FROZEN) — asserted here so the seam can't regress.
 */
describe('CP6.5 — pack value-model resolution', () => {
  const REAL_PACKS_ROOT = path.resolve(__dirname, '..', '..', '..', 'packs');
  let loader: PackLoaderService;

  beforeAll(async () => {
    process.env.PACKS_ROOT = REAL_PACKS_ROOT;
    loader = new PackLoaderService();
    await loader.onModuleInit();
  });

  it('banking pack resolves value-model with [ucb-verify] tags and no count coefficients', async () => {
    const pack = await loader.getPack('banking');
    expect(pack.valueModel).not.toBeNull();
    const vm = pack.valueModel!;
    expect(typeof vm.valueAtRisk.estimatedOutageHours.value).toBe('number');
    expect(vm.valueAtRisk.estimatedOutageHours.verify).toContain('[ucb-verify]');
    expect(typeof vm.retention.monthlyChurnRatePct.value).toBe('number');
    expect(vm.retention.monthlyChurnRatePct.verify).toContain('[ucb-verify]');
    // No customer/branch count anywhere in the value-model (Class-1 lives in spine).
    expect(JSON.stringify(vm)).not.toMatch(/customer_count|branch_count|450000/);
  });

  it('swapping to the default pack yields generic value-model with no error', async () => {
    const pack = await loader.getPack('default');
    expect(pack.valueModel).not.toBeNull();
    expect(typeof pack.valueModel!.valueAtRisk.estimatedOutageHours.value).toBe('number');
    expect(pack.valueModel!.retention.monthlyChurnRatePct.verify).toContain('[verify]');
  });
});
