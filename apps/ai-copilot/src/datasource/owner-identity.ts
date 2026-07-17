import { createHash } from 'node:crypto';
import type { OwnerIdentity } from './data-source.types';

// Deterministic owner identities for the native (Bundled) profile.
//
// The CMDB export carries owners as e-mail strings (e.g. 'core.ops@synthbank.example').
// The cmdb_* tables store owner *ids* as opaque UUIDs (technical_owner_id /
// business_owner_id) — no FK, per ADR-002/Q2. We derive a STABLE uuid from the
// e-mail (uuid v5) so the import is idempotent and the provider can resolve the
// same id back to an identity. The full identity record is denormalized into the
// CI's `attributes` jsonb at import time, so resolveOwner() needs no extra table
// (T-OWNER honoured: existing columns + jsonb, no new schema object).

// A fixed namespace UUID for SynthBank owner derivation. Arbitrary but constant.
const OWNER_NAMESPACE = '6f4d2c1a-9b3e-5f70-8a21-1c2d3e4f5a6b';

/** RFC-4122 §4.3 name-based UUID v5 (SHA-1). Self-contained, no dependency. */
export function uuidV5(name: string, namespace = OWNER_NAMESPACE): string {
  const nsBytes = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1')
    .update(nsBytes)
    .update(Buffer.from(name, 'utf8'))
    .digest();
  const bytes = hash.subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC-4122 variant
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Tokens that read better upper-cased in a derived display name.
const ACRONYMS = new Set(['cbs', 'cio', 'dba', 'bcp', 'ad', 'dns', 'dhcp', 'it', 'hsm', 'upi']);

function titleCase(token: string): string {
  if (ACRONYMS.has(token.toLowerCase())) return token.toUpperCase();
  return token.charAt(0).toUpperCase() + token.slice(1);
}

/** Owners whose local-part names a role-holder rather than a functional team. */
function isRole(localPart: string): boolean {
  return /^(head|regional\.head|cio|chief)\b/.test(localPart) || localPart.startsWith('head.');
}

/**
 * Derive a stable OwnerIdentity from an owner e-mail. Returns null for a blank/
 * missing owner — the import leaves the id column NULL, preserving the deliberate
 * ~15% unowned CIs (the auditor gap-detection demo).
 */
export function ownerFromEmail(email: string | null | undefined): OwnerIdentity | null {
  if (!email || !email.trim()) return null;
  const clean = email.trim().toLowerCase();
  const localPart = clean.split('@')[0] ?? clean;
  const name = localPart
    .split(/[.\-_]/)
    .filter(Boolean)
    .map(titleCase)
    .join(' ');
  return {
    id: uuidV5(clean),
    name,
    email: clean,
    kind: isRole(localPart) ? 'role' : 'team',
  };
}
