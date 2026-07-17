import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ZABBIX_READ_ONLY_METHODS } from '../../src/datasource/zabbix/zabbix-jsonrpc.client';

/**
 * T-BOUNDARY (D16 / ADR-004): the Zabbix client is read-only. Zabbix is the tool
 * that instruments devices; the Copilot only CONSUMES the signals it collected
 * and NEVER writes or configures Zabbix. This lint fails if any Zabbix mutating
 * method string appears in the zabbix source, or if the allow-list grows a
 * mutating method.
 */
describe('T-BOUNDARY — Zabbix client is read-only', () => {
  const zabbixDir = join(__dirname, '..', '..', 'src', 'datasource', 'zabbix');
  const sources = [
    'zabbix-jsonrpc.client.ts',
    'zabbix.provider.ts',
    'zabbix.transport.ts',
  ].map((f) => readFileSync(join(zabbixDir, f), 'utf8'));

  const MUTATING = [
    '.create',
    '.update',
    '.delete',
    '.massadd',
    '.massupdate',
    '.massremove',
    '.import',
    'configuration.',
    'host.create',
    'item.create',
  ];

  it('the allow-list contains only read methods', () => {
    for (const m of ZABBIX_READ_ONLY_METHODS) {
      expect(/(get|version)$/.test(m)).toBe(true);
    }
  });

  it('no zabbix source references a mutating Zabbix method', () => {
    const stripComments = (s: string) =>
      s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    for (const src of sources) {
      const code = stripComments(src);
      for (const m of MUTATING) {
        expect(code.includes(m)).toBe(false);
      }
    }
  });
});
