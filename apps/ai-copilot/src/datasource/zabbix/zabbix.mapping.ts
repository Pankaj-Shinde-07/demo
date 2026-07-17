// W6.5 (CP6.5.2) — host→CI match decision + item→golden-signal mapping. Pure
// functions (no I/O) so they unit-test without a transport. Deterministic:
// ambiguity is surfaced, never guessed.

import type { GoldenSignal } from '../data-source.types';
import {
  DEFAULT_ITEM_MAP,
  type ZabbixHost,
  type ZabbixItem,
  type ZabbixItemMap,
} from './zabbix.types';

export type HostMatchStatus = 'resolved' | 'zero' | 'ambiguous';

export interface HostMatch {
  status: HostMatchStatus;
  host: ZabbixHost | null;
}

/**
 * Decide the match from the candidate hosts a filtered host.get returned:
 * exactly one → resolved; none → zero (named gap upstream); more than one →
 * ambiguous (named gap upstream), NEVER pick one.
 */
export function decideHostMatch(candidates: ZabbixHost[]): HostMatch {
  if (candidates.length === 1) return { status: 'resolved', host: candidates[0] };
  if (candidates.length === 0) return { status: 'zero', host: null };
  return { status: 'ambiguous', host: null };
}

/** key_ matches a configured pattern (exact, or `pattern[...]`, or `pattern.suffix`). */
export function matchesKey(key: string, pattern: string): boolean {
  return key === pattern || key.startsWith(`${pattern}[`) || key.startsWith(`${pattern}.`);
}

function findValue(items: ZabbixItem[], pattern: string): number | null {
  const it = items.find((i) => matchesKey(i.key_, pattern));
  if (!it) return null;
  const n = Number(it.lastvalue);
  return Number.isFinite(n) ? n : null;
}

/**
 * Map a matched host's items to a GoldenSignal (Class-1). A signal whose item is
 * absent on the host degrades to null — others still populate (CP6.5.2). The
 * output shape is byte-compatible with the substrate backing's GoldenSignal.
 */
export function mapItemsToSignal(
  ciExternalId: string,
  ciName: string,
  items: ZabbixItem[],
  lastReadingAt: string,
  overrides?: Partial<ZabbixItemMap>,
): GoldenSignal {
  const map: ZabbixItemMap = { ...DEFAULT_ITEM_MAP, ...(overrides ?? {}) };

  const latencySec = findValue(items, map.latency_ms);
  const avail = findValue(items, map.availability); // icmpping: 1 up / 0 down

  // primary: prefer disk %used, else interface utilisation.
  const diskPct = findValue(items, map.primary_disk);
  const ifPct = diskPct === null ? findValue(items, map.primary_if) : null;
  const primary = diskPct !== null ? diskPct : ifPct;
  const primaryMetric = diskPct !== null ? 'disk' : ifPct !== null ? 'bandwidth' : null;

  return {
    ciExternalId,
    ciName,
    availabilityState: avail === null ? 'up' : avail >= 1 ? 'up' : 'down',
    cpuSaturationPct: round1(findValue(items, map.cpu_saturation_pct)),
    memorySaturationPct: round1(findValue(items, map.memory_saturation_pct)),
    primarySaturationPct: round1(primary),
    primaryMetric,
    latencyMs: latencySec === null ? null : Math.round(latencySec * 1000),
    packetLossPct: round1(findValue(items, map.packet_loss_pct)),
    lastReadingAt,
  };
}

function round1(n: number | null): number | null {
  return n === null ? null : Math.round(n * 10) / 10;
}
