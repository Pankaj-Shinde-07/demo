// W6.5 — swappable JSON-RPC transport. Production talks HTTP to Zabbix; tests
// inject a fixture transport that replays recorded responses. The provider/client
// never know which is in use (the seam that makes the build testable without a
// live Zabbix).

export interface ZabbixTransport {
  /**
   * Send a JSON-RPC call and return its `result`. Throws on a JSON-RPC error or
   * a transport failure. `authToken` is sent as a Bearer header when non-null
   * (apiinfo.version is called with null — it needs no auth).
   */
  call(method: string, params: unknown, authToken: string | null): Promise<unknown>;
}

/** Real HTTP transport (Zabbix 6.x API-token / Bearer auth). */
export class HttpZabbixTransport implements ZabbixTransport {
  constructor(private readonly endpoint: string) {}

  async call(method: string, params: unknown, authToken: string | null): Promise<unknown> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json-rpc' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', method, params: params ?? {}, id: 1 }),
    });
    if (!res.ok) throw new Error(`Zabbix HTTP ${res.status} for ${method}`);
    const json = (await res.json()) as { result?: unknown; error?: { message: string; data?: string } };
    if (json.error) {
      throw new Error(`Zabbix JSON-RPC error on ${method}: ${json.error.message} ${json.error.data ?? ''}`.trim());
    }
    return json.result;
  }
}

/** Fixture transport for tests + the fixture-mode smoke demo. */
export class FixtureZabbixTransport implements ZabbixTransport {
  constructor(private readonly resolver: (method: string, params: unknown) => unknown) {}
  async call(method: string, params: unknown): Promise<unknown> {
    return this.resolver(method, params);
  }
}
