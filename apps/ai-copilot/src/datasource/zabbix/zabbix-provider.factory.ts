import { Injectable } from '@nestjs/common';
import { ZabbixJsonRpcClient } from './zabbix-jsonrpc.client';
import { ZabbixProvider } from './zabbix.provider';
import { HttpZabbixTransport, type ZabbixTransport } from './zabbix.transport';
import type { ZabbixConfig } from './zabbix.types';

/**
 * W6.5 — builds a ZabbixProvider from a decrypted per-tenant config. Production
 * uses the real HTTP transport; tests inject a fixture transport via
 * `createWith`, so the registry path is exercised without a live Zabbix.
 */
@Injectable()
export class ZabbixProviderFactory {
  create(config: ZabbixConfig): ZabbixProvider {
    return this.createWith(config, new HttpZabbixTransport(config.endpoint));
  }

  createWith(config: ZabbixConfig, transport: ZabbixTransport): ZabbixProvider {
    return new ZabbixProvider(new ZabbixJsonRpcClient(transport, config.token), config);
  }
}
