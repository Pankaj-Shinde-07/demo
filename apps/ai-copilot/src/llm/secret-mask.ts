// Outbound secret masking (CP5.4). Credentials/secrets that slip into context
// (a config snippet in a runbook, a connection string in an alert payload) are
// masked BEFORE the prompt leaves the deployment. Deterministic regex set —
// errs toward masking. Applied to the fully-assembled outbound prompt.

export interface MaskResult {
  text: string;
  maskedCount: number;
  kinds: string[];
}

const RULES: Array<{ kind: string; re: RegExp; replace: string }> = [
  // Anthropic / OpenAI-style keys
  { kind: 'anthropic_key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, replace: 'sk-ant-«MASKED»' },
  { kind: 'openai_key', re: /\bsk-[A-Za-z0-9]{20,}\b/g, replace: 'sk-«MASKED»' },
  // AWS
  { kind: 'aws_access_key', re: /\bAKIA[0-9A-Z]{16}\b/g, replace: 'AKIA«MASKED»' },
  // JWTs
  { kind: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, replace: '«MASKED_JWT»' },
  // PEM private keys
  { kind: 'private_key', re: /-----BEGIN[ A-Z]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z]*PRIVATE KEY-----/g, replace: '«MASKED_PRIVATE_KEY»' },
  // password / secret / token = value  (env / config / connection-string style)
  { kind: 'kv_secret', re: /\b(password|passwd|pwd|secret|api[_-]?key|token|access[_-]?key)\b(\s*[:=]\s*)(['"]?)([^\s'";,]{4,})\3/gi, replace: '$1$2$3«MASKED»$3' },
  // postgres/redis/mongo URIs with inline credentials
  { kind: 'uri_credentials', re: /\b([a-z][a-z0-9+.-]*:\/\/)([^:/@\s]+):([^@/\s]+)@/gi, replace: '$1$2:«MASKED»@' },
];

export function maskSecrets(text: string): MaskResult {
  let out = text;
  let count = 0;
  const kinds = new Set<string>();
  for (const { kind, re, replace } of RULES) {
    const matches = out.match(new RegExp(re.source, re.flags));
    if (matches && matches.length > 0) {
      count += matches.length;
      kinds.add(kind);
      out = out.replace(re, replace);
    }
  }
  return { text: out, maskedCount: count, kinds: [...kinds] };
}
