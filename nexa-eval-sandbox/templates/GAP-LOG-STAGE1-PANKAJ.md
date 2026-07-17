# Grounding Gap Log - Stage 1 - Pankaj

Build/run referenced: `REAL-CLEAN` / real Copilot on SynthBank.

One row per FLAG issue found. No fabricated values were observed.

| # | date | prompt id / question | what happened | expected | class | how to reproduce | status |
|---|------|----------------------|---------------|----------|-------|------------------|--------|
| 1 | 2026-07-15 | P005 - Which services are currently degraded or down? | Route: `incident`; grounded: `false`; declined: `true`; response: `I could not find grounding for that — try rephrasing or naming the service/CI.` | Should return grounded current service health and include `Internet Banking`. | FLAG | `POST http://127.0.0.1:3110/api/v1/ai/chat` with message `Which services are currently degraded or down?` | open |
| 2 | 2026-07-15 | P006 - What is the CPU on IB-APP-01? | Route: `retrieval`; grounded: `false`; declined: `true`; response: `I could not find grounding for that — try rephrasing or naming the service/CI.` | Should return grounded CPU for `IB-APP-01`, expected value includes `94`. | FLAG | `POST http://127.0.0.1:3110/api/v1/ai/chat` with message `What is the CPU on IB-APP-01?` | open |
| 3 | 2026-07-15 | P016 - Which CI has the highest CPU in Internet Banking? | Route: `retrieval`; grounded: `false`; declined: `true`; response: `I could not find grounding for that — try rephrasing or naming the service/CI.` | Should drill into Internet Banking member CIs and identify `IB-APP-01`. | FLAG | `POST http://127.0.0.1:3110/api/v1/ai/chat` with message `Which CI has the highest CPU in Internet Banking?` | open |
| 4 | 2026-07-15 | P017 - How many configuration items make up Payments? | Route: `incident`; grounded: `false`; declined: `true`; response: `I could not find grounding for that — try rephrasing or naming the service/CI.` | Should use service-to-CI graph and answer for `Payments`. | FLAG | `POST http://127.0.0.1:3110/api/v1/ai/chat` with message `How many configuration items make up Payments?` | open |
| 5 | 2026-07-15 | P018 - Give me a one-line health summary across all banking services. | Route: `retrieval`; grounded: `false`; declined: `true`; response: `I could not find grounding for that — try rephrasing or naming the service/CI.` | Should provide a grounded one-line multi-service health summary including `Internet Banking`. | FLAG | `POST http://127.0.0.1:3110/api/v1/ai/chat` with message `Give me a one-line health summary across all banking services.` | open |
| 6 | 2026-07-15 | P019 - Anything I need to escalate on the ATM network? | Route: `incident`; grounded: `false`; declined: `true`; response: `I could not find grounding for that — try rephrasing or naming the service/CI.` | Should identify ATM Switch / ATM network escalation status and include `ATM Switch`. | FLAG | `POST http://127.0.0.1:3110/api/v1/ai/chat` with message `Anything I need to escalate on the ATM network?` | open |
| 7 | 2026-07-15 | P020 - Is the Card Management service reporting normally? | Route: `incident`; grounded: `false`; declined: `true`; response: `I could not find grounding for that — try rephrasing or naming the service/CI.` | Should answer grounded service health and include `Card Management`. | FLAG | `POST http://127.0.0.1:3110/api/v1/ai/chat` with message `Is the Card Management service reporting normally?` | open |

## Notes

- `FABRICATED_VALUE` count was `0`.
- P009 was not logged above because it was not a FLAG. It is a harness/vocabulary issue: the Copilot gives grounded UPI context, but the scorecard expects the exact phrase `Mobile & UPI`.
- P019 is an extra FLAG in my run compared with the HANDOFF table; I would confirm whether this should be added to the known findings list.
