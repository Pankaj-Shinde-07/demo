import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as yaml from 'js-yaml';
import type { LlmSystemBlock, LogicalModel } from './llm-provider.interface';

// CP5.2 — versioned prompt-template registry with pack-fragment injection (D9).
// Templates live in ONE place and carry a version. Named slots (`{{slot}}`) are
// filled by industry-pack fragments so the engine carries no vertical literal
// (ADR-003). The rendered system prompt is returned as cacheable blocks (the
// stable prefix), so CP5.5 prompt-caching keys on the template+pack, not the
// per-request question.

export interface PromptTemplate {
  id: string;
  version: number;
  /** Drives Haiku-vs-Sonnet routing (CP5.5). */
  callType: 'reasoning' | 'classification';
  model: LogicalModel;
  /** System text with `{{slot}}` placeholders filled from pack fragments. */
  system: string;
}

export interface RenderedTemplate {
  templateId: string;
  templateVersion: number;
  callType: 'reasoning' | 'classification';
  model: LogicalModel;
  systemBlocks: LlmSystemBlock[];
}

// The template set. Add templates here; bump `version` on any wording change so
// the audit trail (ai_audit_log.feature + version) stays meaningful.
const TEMPLATES: PromptTemplate[] = [
  {
    id: 'alert_explain',
    version: 1,
    callType: 'reasoning',
    model: 'sonnet',
    system: [
      '{{domain_framing}}',
      '',
      'Task: explain the given alert / configuration item to an operator — what it is,',
      'what it depends on, and which business services and customers are affected —',
      'using ONLY the evidence provided. {{persona_lens}}',
      '',
      '{{honesty_note}}',
    ].join('\n'),
  },
  {
    // W8 — grounded incident summary over the DETERMINISTIC structure. The model
    // narrates (explains + drafts); it never decides the grouping or invents the
    // root cause. Propose-not-execute is baked into the contract.
    id: 'incident_summary',
    version: 1,
    callType: 'reasoning',
    model: 'sonnet',
    system: [
      '{{domain_framing}}',
      '',
      'Task: produce a grounded incident summary for an operator from the structured',
      'evidence — the correlated incident (how many raw alerts collapsed to one),',
      'the top-ranked recent change (if any) as the likely root cause, the business',
      'impact (use the figures and their class EXACTLY as given — never recompute or',
      'invent a count), the proposed next action, the reportability note, and any',
      'honest gaps (e.g. unknown DR posture). {{persona_lens}}',
      '',
      'You PROPOSE and DRAFT only — never state that an action was taken or will be',
      'taken automatically; a human attests and executes. Do not introduce any',
      'number, dependency, or root cause not present in the evidence. Surface any',
      'regulatory obligation as an Assist with its [verify] caveat, never as a',
      'definitive determination.',
      '',
      '{{honesty_note}}',
    ].join('\n'),
  },
  {
    // W7 — generic grounded chat answer over assembled evidence (knowledge
    // passages / CMDB context). The model answers ONLY from the evidence and
    // cites it; propose-not-execute. Incident answers use incident_summary.
    id: 'chat_answer',
    version: 1,
    callType: 'reasoning',
    model: 'sonnet',
    system: [
      '{{domain_framing}}',
      '',
      'Task: answer the operator\'s question using ONLY the evidence provided —',
      'knowledge passages, CMDB context, or incident facts. Use any figures and their',
      'class EXACTLY as given; never invent a number, dependency, or fact not in the',
      'evidence. Prefer a concise, operator-useful answer. {{persona_lens}}',
      '',
      'You propose and draft only — never state that an action was or will be taken',
      'automatically; a human attests and executes.',
      '',
      '{{honesty_note}}',
    ].join('\n'),
  },
  {
    // W9 — executive board digest, BOUNDED to the structured tiles. The model
    // ties the tiles together; it introduces NO number not present in a tile
    // (T-BOARD-FABRICATION). Every figure keeps its class; propose/inform only.
    id: 'board_digest',
    version: 1,
    callType: 'reasoning',
    model: 'sonnet',
    system: [
      '{{domain_framing}}',
      '',
      'Task: write a concise monthly board digest for a CEO/board from the structured',
      'tile evidence ONLY. Cover the sections present: risk-now, value-realized,',
      'compliance standing, cost/optimization, BCP/DR posture, and trend. Use EVERY',
      'figure with its class label EXACTLY as given; NEVER introduce a number, rupee',
      'figure, or count not present in a tile. {{persona_lens}}',
      '',
      'You inform and propose only — never claim an action was taken automatically.',
      'Surface any regulatory item as an Assist with its [verify] caveat, never a',
      'determination. Surface any DR/BCP gap as a board-visible risk; never imply',
      'coverage the tiles do not show.',
      '',
      '{{honesty_note}}',
    ].join('\n'),
  },
  {
    id: 'classify_intent',
    version: 1,
    callType: 'classification',
    model: 'haiku',
    system: [
      '{{domain_framing}}',
      '',
      'Task: classify the user message into exactly one intent label from:',
      '[alert_explain, rca, service_impact, knowledge_lookup, other].',
      'Reply with only the label.',
    ].join('\n'),
  },
];

@Injectable()
export class PromptTemplateRegistry {
  private readonly logger = new Logger(PromptTemplateRegistry.name);
  private readonly fragmentCache = new Map<string, Record<string, string>>();

  /** Render a template version, filling pack-fragment slots + caller vars. */
  render(
    templateId: string,
    packId: string,
    vars: Record<string, string> = {},
    version?: number,
  ): RenderedTemplate {
    const tmpl = this.get(templateId, version);
    const fragments = this.loadFragments(packId);
    const filled = this.fill(tmpl.system, { ...fragments, ...vars });
    return {
      templateId: tmpl.id,
      templateVersion: tmpl.version,
      callType: tmpl.callType,
      model: tmpl.model,
      // The rendered template is the stable prefix (per template+pack). The
      // gateway appends the grounding-contract block (structured vs plain) based
      // on requireGrounding, then the volatile evidence/question go in the user
      // turn after this cached prefix.
      systemBlocks: [{ text: filled, cache: true }],
    };
  }

  get(templateId: string, version?: number): PromptTemplate {
    const matches = TEMPLATES.filter((t) => t.id === templateId);
    if (matches.length === 0) throw new Error(`Unknown prompt template '${templateId}'`);
    if (version === undefined) {
      return matches.reduce((a, b) => (b.version > a.version ? b : a));
    }
    const exact = matches.find((t) => t.version === version);
    if (!exact) throw new Error(`Template '${templateId}' has no version ${version}`);
    return exact;
  }

  private fill(template: string, values: Record<string, string>): string {
    return template.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_m, key: string) => {
      const v = values[key];
      if (v === undefined) {
        this.logger.warn(`template slot '{{${key}}}' had no fragment/var; left blank`);
        return '';
      }
      return v.trim();
    });
  }

  /** Load a pack's prompt fragments (framing.yaml); fall back to the default pack. */
  private loadFragments(packId: string): Record<string, string> {
    if (this.fragmentCache.has(packId)) return this.fragmentCache.get(packId)!;
    const root = process.env.PACKS_ROOT
      ? resolve(process.env.PACKS_ROOT)
      : resolve(process.cwd(), 'packs');
    const fragments =
      this.readFragmentFile(resolve(root, packId, 'prompt-fragments', 'framing.yaml')) ??
      this.readFragmentFile(resolve(root, 'default', 'prompt-fragments', 'framing.yaml')) ??
      {};
    this.fragmentCache.set(packId, fragments);
    return fragments;
  }

  private readFragmentFile(path: string): Record<string, string> | null {
    try {
      const parsed = yaml.load(readFileSync(path, 'utf8'));
      if (parsed && typeof parsed === 'object') return parsed as Record<string, string>;
      return null;
    } catch {
      return null;
    }
  }
}
