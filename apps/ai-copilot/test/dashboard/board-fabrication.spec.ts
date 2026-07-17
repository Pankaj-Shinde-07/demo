import { BoardDigestService } from '../../src/dashboard/board-digest.service';
import { CLASS_LABEL, type Figure, type FigureClass } from '../../src/context/business-impact.types';
import type { BoardDigest, Tile } from '../../src/dashboard/dashboard.types';

/**
 * T-BOARD-FABRICATION (the highest-stakes W9 property): no number without its
 * class + grounding, and the narrative contains no number not in a tile. Pure
 * tests of the two check helpers (the live digest is exercised by `board:digest`).
 */

function fig(metric: string, value: number, cls: FigureClass, grounding = 1, assumptions = 0): Figure {
  return {
    metric, value, unit: 'inr', class: cls, classLabel: CLASS_LABEL[cls],
    groundingInputs: Array.from({ length: grounding }, (_, i) => ({ ref: `g${i}`, description: 'x' })),
    assumptions: Array.from({ length: assumptions }, () => ({ description: 'a', verify: '[verify]' })),
  };
}
function digest(tiles: Tile[]): BoardDigest {
  return { tenantId: 't', period: 'p', sections: [{ key: 'value_realized', title: 'V', tiles }], narrative: null, label: 'SynthBank synthetic data' };
}
function tile(figures: Figure[]): Tile {
  return { id: 'value_realized', title: 'Value', status: 'ok', figures, notes: [], gaps: [], label: null };
}

describe('W9 board-fabrication checks', () => {
  it('passes when every figure is classed + grounded and Class-1 has no assumption', () => {
    const d = digest([tile([fig('a', 450000, 'measured', 2, 0), fig('b', 6000000, 'derived', 1, 1)])]);
    expect(BoardDigestService.checkFiguresClassed(d).ok).toBe(true);
  });

  it('fails a Class-1 figure carrying an assumption', () => {
    const d = digest([tile([fig('a', 450000, 'measured', 1, 1)])]);
    const r = BoardDigestService.checkFiguresClassed(d);
    expect(r.ok).toBe(false);
    expect(r.violations[0]).toMatch(/Class-1 carries an assumption/);
  });

  it('fails a figure with empty grounding', () => {
    const d = digest([tile([fig('a', 1, 'measured', 0, 0)])]);
    expect(BoardDigestService.checkFiguresClassed(d).ok).toBe(false);
  });

  it('narrative⊆tiles: passes when big numbers trace to tile values (incl lakh/crore)', () => {
    const d = digest([tile([fig('customers', 450000, 'measured'), fig('value', 4300000, 'derived', 1, 1)])]);
    const ok = 'Impact is 4,50,000 customers; value at risk ₹43,00,000. (≈4.3 lakh? no — 43 lakh).';
    const r = BoardDigestService.checkNarrativeInTiles(ok, d);
    expect(r.ok).toBe(true);
  });

  it('narrative⊆tiles: flags a fabricated big number not in any tile', () => {
    const d = digest([tile([fig('customers', 450000, 'measured')])]);
    const bad = 'The board should note ₹99,99,999 of value — and 450000 customers.';
    const r = BoardDigestService.checkNarrativeInTiles(bad, d);
    expect(r.ok).toBe(false);
    expect(r.orphans).toContain(9999999);
  });
});
