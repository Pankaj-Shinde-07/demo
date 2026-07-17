# Stage-1 Failure Classification - Pankaj

Build/run referenced: `REAL-CLEAN` / real Copilot on SynthBank.

Scorecard result:

```text
Total prompts        : 20
Passed               : 12/20
  grounded pass      : 7
  honest-empty pass  : 5
FLAG count           : 7
Fabricated-value fail: 0
```

## Classification Before Answer-Key Check

| Prompt | Question | Scorecard failure | My bucket | Why |
|---|---|---|---|---|
| P005 | Which services are currently degraded or down? | FLAG | Product/router gap | The data exists, but the Copilot routed to `incident` and could not assemble grounding for an all-services health query. |
| P006 | What is the CPU on IB-APP-01? | FLAG | Product/router gap | The data exists for `IB-APP-01`, but the bare CPU wording routed to `retrieval` instead of live context/APM. |
| P009 | Any problems with UPI? | MISSING_FACT: Mobile & UPI | Harness/vocabulary | The Copilot answered with grounded UPI context and cited `cmdb:svc:Mobile & UPI`, but the natural-language answer may say `UPI` instead of the exact canonical phrase the scorecard expects. |
| P016 | Which CI has the highest CPU in Internet Banking? | FLAG | Product/router gap | The Copilot cannot drill down from a service to member CIs and rank by CPU, so it declines. |
| P017 | How many configuration items make up Payments? | FLAG | Product/router gap | The data exists in the service-to-CI graph, but the question routed to `incident` instead of a CMDB count path. |
| P018 | Give me a one-line health summary across all banking services. | FLAG | Product/router gap | The product does not currently have a multi-service summary handler, so it declines. |
| P019 | Anything I need to escalate on the ATM network? | FLAG | Product/router gap | The question is an operator escalation/health intent, but routes to `incident` and finds no incident grounding. |
| P020 | Is the Card Management service reporting normally? | FLAG | Product/router gap | The data exists for the service, but the wording routed to `incident` instead of service health/context. |

## Check Against HANDOFF Decomposition

Matches:

- P006 is a router keyword gap for bare metric wording like CPU.
- P016 is missing service-member drill-down/ranking.
- P017 and P020 are LLM fallback misroutes into incident.
- P005 and P018 are aggregate/all-services handler gaps.
- P009 is a narration/vocabulary artifact around `UPI` vs canonical `Mobile & UPI`.

Additional observation from my run:

- P019 also FLAGged. It behaves like a product/router gap: it routed to `incident` and declined with no evidence. This is not listed in the HANDOFF table, so I would flag it as an extra Stage-1 finding to confirm with Pramod.

## Bank-Operator Impact Bridge

- P006, CPU on `IB-APP-01`: A NOC operator could ask a direct CPU question during a slowdown. Today the Copilot declines even though the metric exists, so the operator would have to switch tools or rephrase instead of getting a quick grounded answer.
- P017, CI count for Payments: A manager asking how many CIs make up Payments would not get the service composition from the Copilot. In a bank, that weakens impact sizing during an incident or audit discussion.
- P018, all-services summary: An executive asking for a one-line estate health summary would get a decline. For AMC, that means the Copilot is not yet reliable for broad operational snapshots unless a dashboard or explicit service path handles it.

