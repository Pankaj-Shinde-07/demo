// W7 — Copilot Chat (SSE delivery surface). Routing/orchestration types. No
// banking literal (§6.6); the router classifies + dispatches, capabilities ground,
// the gateway narrates.

export type ChatRoute = 'retrieval' | 'grounded_context' | 'incident' | 'value' | 'out_of_scope';

export interface Citation {
  ref: string; // the validated evidence id (⊆ provided)
  label: string;
  kind: 'knowledge' | 'cmdb' | 'service' | 'incident' | 'impact' | 'gap' | 'other';
}

export interface ChatConfidence {
  level: 'high' | 'partial' | 'low';
  reasons: string[];
}

/** A resolved chat answer — grounding/hard-reject DECIDED before any streaming. */
export interface ChatResult {
  route: ChatRoute;
  answer: string;
  grounded: boolean;
  declined: boolean;
  citations: Citation[];
  confidence: ChatConfidence;
  evidenceCount: number;
  model: string | null;
  /** Non-LLM redirect offered on an out-of-scope decline (D16). */
  redirect?: string | null;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
  route?: ChatRoute;
  at: string;
}

export interface ChatRequest {
  tenantId: string;
  sessionId: string;
  message: string;
  packId?: string;
}

// SSE event envelope streamed to the thin client.
export type ChatStreamEvent =
  | { type: 'route'; route: ChatRoute }
  | { type: 'token'; text: string }
  | { type: 'decline'; text: string; redirect?: string | null }
  | { type: 'citations'; citations: Citation[] }
  | { type: 'confidence'; confidence: ChatConfidence }
  | { type: 'done'; grounded: boolean; declined: boolean; model: string | null };
