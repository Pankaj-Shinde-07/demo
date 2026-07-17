import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * W6.5 (T-SECRET) — encrypts/decrypts per-tenant data-source config (e.g. a
 * Zabbix API token + endpoint) for `tenant_data_sources.config_encrypted`.
 * AES-256-GCM (authenticated). The key lives ONLY in the gitignored host `.env`
 * (`CONFIG_ENCRYPTION_KEY`, base64- or hex-encoded 32 bytes) — never committed,
 * never the plaintext token. Same discipline as the W5 `ANTHROPIC_API_KEY`.
 *
 * Blob format: `v1:` + base64(iv[12] | authTag[16] | ciphertext).
 */
const ALGO = 'aes-256-gcm';
const PREFIX = 'v1:';

@Injectable()
export class ConfigCryptoService {
  private readonly logger = new Logger(ConfigCryptoService.name);
  private readonly key: Buffer | null;

  constructor(config: ConfigService) {
    const raw = config.get<string>('CONFIG_ENCRYPTION_KEY', '') ?? '';
    this.key = raw.length > 0 ? this.parseKey(raw) : null;
    if (!this.key) {
      this.logger.warn(
        'CONFIG_ENCRYPTION_KEY not set — encrypted data-source config (e.g. Zabbix tokens) cannot be read; such tenants degrade to honest empty-state.',
      );
    }
  }

  /** True when a key is configured (encrypted configs are readable). */
  get available(): boolean {
    return this.key !== null;
  }

  encrypt(plaintext: string): string {
    const key = this.requireKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGO, key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64');
  }

  decrypt(blob: string): string {
    const key = this.requireKey();
    if (!blob.startsWith(PREFIX)) {
      throw new Error('config blob has an unrecognized format/version');
    }
    const buf = Buffer.from(blob.slice(PREFIX.length), 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const d = createDecipheriv(ALGO, key, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
  }

  encryptJson(obj: unknown): string {
    return this.encrypt(JSON.stringify(obj));
  }

  decryptJson<T>(blob: string): T {
    return JSON.parse(this.decrypt(blob)) as T;
  }

  private parseKey(raw: string): Buffer {
    const buf = /^[0-9a-fA-F]{64}$/.test(raw)
      ? Buffer.from(raw, 'hex')
      : Buffer.from(raw, 'base64');
    if (buf.length !== 32) {
      throw new Error(
        'CONFIG_ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256) — provide base64 or 64-hex.',
      );
    }
    return buf;
  }

  private requireKey(): Buffer {
    if (!this.key) {
      throw new Error('CONFIG_ENCRYPTION_KEY is not configured');
    }
    return this.key;
  }
}
