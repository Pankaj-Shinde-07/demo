import type { ZabbixTransport } from './zabbix.transport';
import type { ZabbixHost, ZabbixItem, ZabbixTrend } from './zabbix.types';

/**
 * W6.5 — read-only Zabbix JSON-RPC client (D16 / T-BOUNDARY). Zabbix is a
 * read-only PULL source: we CONSUME the golden signals it already collected and
 * NEVER write or configure it. This client exposes ONLY read methods, and the
 * `read()` guard refuses any method not on the allow-list — so no mutating
 * Zabbix call (`*.create` / `*.update` / `*.delete` / `*.import` / `configuration.*`)
 * is reachable even by mistake. A lint test asserts the source carries none.
 */
export const ZABBIX_READ_ONLY_METHODS = [
  'apiinfo.version',
  'host.get',
  'item.get',
  'trends.get',
  'history.get',
  'problem.get',
] as const;

export class ZabbixJsonRpcClient {
  constructor(
    private readonly transport: ZabbixTransport,
    private readonly token: string | null,
  ) {}

  private read(method: (typeof ZABBIX_READ_ONLY_METHODS)[number], params: unknown, withAuth = true): Promise<unknown> {
    if (!ZABBIX_READ_ONLY_METHODS.includes(method)) {
      // Defence in depth — the type already constrains this.
      throw new Error(`refused non-read-only Zabbix method: ${method}`);
    }
    return this.transport.call(method, params, withAuth ? this.token : null);
  }

  /** Handshake — no auth required. */
  async apiVersion(): Promise<string> {
    return (await this.read('apiinfo.version', {}, false)) as string;
  }

  async hostGet(params: Record<string, unknown>): Promise<ZabbixHost[]> {
    return ((await this.read('host.get', params)) as ZabbixHost[]) ?? [];
  }

  async itemGet(params: Record<string, unknown>): Promise<ZabbixItem[]> {
    return ((await this.read('item.get', params)) as ZabbixItem[]) ?? [];
  }

  async trendsGet(params: Record<string, unknown>): Promise<ZabbixTrend[]> {
    return ((await this.read('trends.get', params)) as ZabbixTrend[]) ?? [];
  }
}
