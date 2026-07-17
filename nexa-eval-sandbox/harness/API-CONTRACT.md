# Copilot API contract (assumed)

The mock Copilot and the scorecard both speak this contract. It is a **starting
assumption** — if the real NEXA Copilot's API differs, adjust this doc **and** the
adapter in `scorecard.mjs`/`config.json` to match, and note the difference as a
finding for Pramod. Getting this contract right is itself part of the work.

## Request

`POST {endpoint}` (default `http://127.0.0.1:8899/copilot/ask`)

```json
{ "question": "What is the health of Internet Banking right now?" }
```

Add auth or tenant headers via `config.json → headers` if the real API needs them.

## Response

```json
{
  "answer":    "Internet Banking is degraded.",
  "grounded":  true,
  "refs":      ["SVC-IB"]
}
```

| field      | type     | meaning                                                              |
|------------|----------|----------------------------------------------------------------------|
| `answer`   | string   | the natural-language answer shown to the operator                    |
| `grounded` | boolean  | `true` = answer is backed by real telemetry; `false` = **FLAG** (ungrounded / refused) |
| `refs`     | string[] | optional CI/service IDs the answer was grounded on                   |

## How the scorecard interprets it

- **grounded prompt** (`grounding: "grounded"`): passes only if `grounded === true`
  **and** every string in `expect.must_include` appears in `answer`. A
  `grounded === false` here is counted as a **FLAG**.
- **honest-empty prompt** (`grounding: "honest_empty"`): passes only if `answer`
  clearly states there is no data **and** contains none of `expect.forbidden_values`
  (false zeros / invented numbers). A fabricated value is a hard fail and makes the
  whole run exit non-zero.

## If the real Copilot's response differs

Common cases and where to adapt (all in `scorecard.mjs`, function `ask` / `judge`):

- Different field names (e.g. `text` instead of `answer`, or a nested
  `grounding.status`): map them in `ask()` before returning.
- Grounding signalled differently (e.g. an empty `refs[]` means ungrounded, or a
  `flagged: true` field): translate it to the boolean `grounded` the judge expects.
- Streaming / envelope wrapper: unwrap to the flat shape above in `ask()`.

Keep the *judge* logic stable; only the *adapter* should change per API.

---

## Real Copilot (as wired in this sandbox) — VERIFIED against ems-platform.AICopilot @1d4ebc1

The assumed flat contract above is the **mock's**. The real NEXA Copilot differs,
and the difference is absorbed entirely in `scorecard.mjs → ask()` (the product was
NOT changed):

**Request** — `POST http://127.0.0.1:3110/api/v1/ai/chat`
```json
{ "message": "What is the health of Internet Banking right now?", "sessionId": "sc-P001" }
```
- field is `message`, not `question` (the adapter sends BOTH so one harness drives
  mock and real).
- `sessionId` is passed fresh per prompt — the Copilot keeps multi-turn memory in
  Redis keyed by session, so a shared session would let one prompt's context bleed
  into the next. One session per prompt keeps the 20 prompts independent.
- optional `tenantId` / `packId` default server-side to the SynthBank tenant + the
  `banking` pack.

**Response** — `ChatResult`
```json
{
  "route": "grounded_context",
  "answer": "Internet Banking (CI: SVC-IB) is currently DEGRADED ...",
  "grounded": true,
  "declined": false,
  "citations": [ { "ref": "cmdb:ci:IB-APP-01", "label": "...", "kind": "cmdb" } ],
  "confidence": { "level": "high", "reasons": [] },
  "evidenceCount": 3,
  "model": "claude-..."
}
```
Adapter mapping in `ask()`:  `answer ← answer`,  `grounded ← grounded`,
`refs ← citations.map(c => c.ref)`.

**Routing note (a real finding, NOT a bug to patch in the harness):** the Copilot's
deterministic intent router only reaches the grounded-context/telemetry path when the
question resolves a CI/service entity AND carries a "live-state" keyword (health,
status, availability, latency, **response time**, saturation, **utilisation**, trend,
posture, …). Bare-metric phrasings — "CPU on X", "disk **usage** on X", "uptime of X",
and alias-only names ("net banking", "UPI", "core") — fall through to the (empty)
knowledge-retrieval route and DECLINE. Same honest engine, different doorway. This is
the finding surface the interns extend against; it is not adapted away here.
