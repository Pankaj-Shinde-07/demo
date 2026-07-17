// W6.5 — Zabbix backing types. Raw Zabbix API shapes (the subset we read) + the
// per-tenant config that lives encrypted in tenant_data_sources.config_encrypted.

export type ZabbixMatchKey = 'hostname' | 'ip' | 'custom';

/** item-key pattern → golden signal (overridable per tenant; defaults below). */
export interface ZabbixItemMap {
  cpu_saturation_pct: string;
  memory_saturation_pct: string;
  latency_ms: string;
  packet_loss_pct: string;
  availability: string;
  primary_disk: string;
  primary_if: string;
}

export interface ZabbixConfig {
  /** Full JSON-RPC endpoint, e.g. https://zbx.example/api_jsonrpc.php */
  endpoint: string;
  /** API token (Bearer). Secret — only ever read from config_encrypted. */
  token: string;
  /** How a CI external id is matched to a Zabbix host. Default 'hostname'. */
  matchKey?: ZabbixMatchKey;
  /** For matchKey='custom': the host inventory field or tag name that holds the CI external id. */
  customMatchField?: string;
  /** Optional item-key overrides (templates vary). */
  itemMap?: Partial<ZabbixItemMap>;
}

/** Default item-key patterns for standard Zabbix templates (CP6.5.2). */
export const DEFAULT_ITEM_MAP: ZabbixItemMap = {
  cpu_saturation_pct: 'system.cpu.util',
  memory_saturation_pct: 'vm.memory.utilization',
  latency_ms: 'icmppingsec', // seconds → ×1000 ms
  packet_loss_pct: 'icmppingloss',
  availability: 'icmpping',
  primary_disk: 'vfs.fs.size', // [*,pused]
  primary_if: 'net.if',
};

// ── raw Zabbix shapes (read subset) ──────────────────────────────────────────
export interface ZabbixHostInterface {
  ip: string;
  type: string;
}
export interface ZabbixHost {
  hostid: string;
  host: string; // technical name
  name: string; // visible name
  interfaces?: ZabbixHostInterface[];
  inventory?: Record<string, string>;
  tags?: Array<{ tag: string; value: string }>;
}
export interface ZabbixItem {
  itemid: string;
  hostid: string;
  key_: string;
  name: string;
  lastvalue: string;
  units?: string;
}
export interface ZabbixTrend {
  itemid: string;
  clock: string; // unix seconds
  value_avg?: string;
  value_max?: string;
  num?: string;
}
