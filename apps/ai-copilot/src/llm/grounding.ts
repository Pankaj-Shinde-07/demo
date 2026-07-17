// Grounding enforcement (CP5.3, D8). The gateway gives the model a set of
// EVIDENCE items, each with an id, and requires the answer to (a) draw only from
// them and (b) declare which ids it used. A should-be-grounded answer with no
// valid evidence_refs is HARD-REJECTED (one retry, then an honest non-answer) —
// never emitted as a confident fabrication. This is the core end-game guarantee.

export interface EvidenceItem {
  id: string; // e.g. 'kc:<chunkId>' (knowledge) or 'cmdb:<ciId>' (CMDB fact)
  label: string; // short human label for the citation
  content: string; // the grounded text the model may use
}

export interface GroundingResult {
  declined: boolean; // model honestly said it can't answer from the evidence
  declineReason: string | null;
  evidenceRefs: string[]; // validated ids the answer is grounded in (⊆ provided)
  cleanContent: string; // answer with the machine markers stripped
}

const EVIDENCE_LINE = /^\s*EVIDENCE:\s*\[([^\]]*)\]\s*$/im;
const CANNOT_ANSWER = /^\s*CANNOT_ANSWER:\s*(.*)$/im;

/**
 * The grounding instruction injected as a system block. Deterministic and
 * explainable — no second LLM. The honesty contract (ADR-004/005) is enforced
 * here: "unknown"/"absent" is a valid answer, fabrication is not.
 */
export function groundingInstruction(requireGrounding: boolean): string {
  if (!requireGrounding) {
    return [
      'Answer the user helpfully and concisely.',
      'If you state any operational fact, end with a line `EVIDENCE: [ids]` listing the',
      'evidence ids you used (use `EVIDENCE: []` if none were needed).',
    ].join('\n');
  }
  return [
    'You answer STRICTLY from the EVIDENCE block provided below. Do not use prior',
    'knowledge and do not speculate. Every operational/business fact in your answer',
    'must be supported by an evidence item.',
    '',
    'Honesty contract (hard rules):',
    '- If the EVIDENCE does not support a confident answer, reply with a single line:',
    '  `CANNOT_ANSWER: <one-sentence honest reason>` and then `EVIDENCE: []`.',
    '- Never present a number, impact, or dependency that is not in the EVIDENCE.',
    '- "unknown" / "not documented" is a valid, expected answer — say it plainly.',
    '',
    'Citation contract:',
    '- End your response with exactly one line: `EVIDENCE: [id1, id2, ...]` listing the',
    '  evidence ids you actually used. Use only ids that appear in the EVIDENCE block.',
  ].join('\n');
}

/** Render the EVIDENCE block (goes in the user turn, after the cached prefix). */
export function renderEvidenceBlock(items: EvidenceItem[]): string {
  if (items.length === 0) return 'EVIDENCE:\n(none provided)';
  const body = items
    .map((it) => `--- [${it.id}] ${it.label} ---\n${it.content}`)
    .join('\n\n');
  return `EVIDENCE (the only facts you may use):\n${body}`;
}

/**
 * Parse + validate the model's response against the evidence contract. Cited ids
 * must be a subset of the provided ids (a fabricated ref is dropped, not trusted).
 */
export function parseGrounding(
  raw: string,
  provided: EvidenceItem[],
): GroundingResult {
  const providedIds = new Set(provided.map((p) => p.id));

  const cannot = raw.match(CANNOT_ANSWER);
  const evMatch = raw.match(EVIDENCE_LINE);

  const cited = evMatch
    ? evMatch[1]
        .split(',')
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean)
    : [];
  const validRefs = cited.filter((id) => providedIds.has(id));

  // Strip the machine markers from the user-visible content.
  const cleanContent = raw
    .replace(EVIDENCE_LINE, '')
    .replace(CANNOT_ANSWER, '')
    .trim();

  if (cannot) {
    return {
      declined: true,
      declineReason: cannot[1].trim() || 'evidence insufficient',
      evidenceRefs: [],
      cleanContent,
    };
  }

  return {
    declined: false,
    declineReason: null,
    evidenceRefs: validRefs,
    cleanContent,
  };
}

// ── Structured grounding (CP5.3 robustness) ───────────────────────────────────
// Free-text citation lines are fragile (the model can drop them in long markdown),
// which wrongly tips a valid grounded answer into rejection. The schema below
// FORCES the model to return its answer + the evidence ids it used + an honest
// can_answer flag, so the evidence_refs are always present and parseable.

export const GROUNDED_ANSWER_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    can_answer: {
      type: 'boolean',
      description: 'true only if the EVIDENCE supports a confident answer',
    },
    answer: {
      type: 'string',
      description: 'the operator-facing answer, grounded strictly in the EVIDENCE',
    },
    evidence_refs: {
      type: 'array',
      items: { type: 'string' },
      description: 'the evidence ids actually used; only ids from the EVIDENCE block',
    },
    decline_reason: {
      type: 'string',
      description: 'when can_answer is false, one honest sentence on what is missing',
    },
  },
  required: ['can_answer', 'answer', 'evidence_refs', 'decline_reason'],
};

/** Grounding instruction for the structured-output path (paired with the schema). */
export function groundingInstructionStructured(): string {
  return [
    'You answer STRICTLY from the EVIDENCE block provided in the user turn. Do not use',
    'prior knowledge and do not speculate. Every operational/business fact must be',
    'supported by an evidence item.',
    '',
    'Return a JSON object matching the required schema:',
    '- can_answer: true ONLY if the EVIDENCE supports a confident answer; otherwise false.',
    '- answer: the grounded, operator-facing answer (or, if can_answer is false, a short honest non-answer).',
    '- evidence_refs: the ids you actually used — ONLY ids that appear in the EVIDENCE block. Never invent ids.',
    '- decline_reason: when can_answer is false, one honest sentence on what is missing (else "").',
    '',
    'Honesty contract: "unknown"/"not documented" is a valid, expected answer. Never present a',
    'number, impact, or dependency that is not in the EVIDENCE.',
  ].join('\n');
}

/** Parse + validate a structured grounding response. Refs are filtered to provided ids. */
export function parseStructuredGrounding(
  rawJson: string,
  provided: EvidenceItem[],
): GroundingResult {
  const providedIds = new Set(provided.map((p) => p.id));
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(rawJson) as Record<string, unknown>;
  } catch {
    // Schema violation / non-JSON — treat as ungrounded so the caller hard-rejects.
    return { declined: true, declineReason: 'model did not return structured grounding', evidenceRefs: [], cleanContent: rawJson.trim() };
  }
  const canAnswer = obj.can_answer === true;
  const answer = typeof obj.answer === 'string' ? obj.answer.trim() : '';
  const refs = Array.isArray(obj.evidence_refs) ? (obj.evidence_refs as unknown[]) : [];
  const validRefs = refs.filter((r): r is string => typeof r === 'string' && providedIds.has(r));
  const declineReason = typeof obj.decline_reason === 'string' ? obj.decline_reason.trim() : null;

  if (!canAnswer) {
    return { declined: true, declineReason: declineReason || 'evidence insufficient', evidenceRefs: [], cleanContent: answer };
  }
  return { declined: false, declineReason: null, evidenceRefs: validRefs, cleanContent: answer };
}

export const HONEST_NON_ANSWER =
  "I can't answer that with confidence — the available grounding doesn't support a " +
  'reliable answer, and I will not guess. Load or connect the relevant data and ask again.';
