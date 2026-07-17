# Prompt set schema

`prompt_set.jsonl` is one JSON object per line. Extending this set with good
coverage is **deliverable #2** — add prompts across personas, service types, and
especially more honest-empty cases.

## Fields

```json
{
  "id": "P021",
  "persona": "noc_operator",
  "question": "How is the Payments service performing?",
  "grounding": "grounded",
  "flag_expected": 0,
  "expect": { "must_include": ["Payments"] }
}
```

| field           | values                                              | notes                                              |
|-----------------|-----------------------------------------------------|----------------------------------------------------|
| `id`            | `P###`                                              | unique, stable                                     |
| `persona`       | `noc_operator` · `duty_manager` · `service_owner` · `executive` | who is asking; drives phrasing/expectation |
| `question`      | natural language                                    | how a real operator would ask                      |
| `grounding`     | `grounded` · `honest_empty`                         | what correct behaviour is                          |
| `flag_expected` | `0`                                                 | we always expect a grounded/honest answer, never a FLAG |
| `expect`        | object                                              | machine-checkable assertion (below)                |

## `expect` for `grounded` prompts

```json
"expect": { "must_include": ["Internet Banking", "degraded"] }
```
The answer must contain **all** listed substrings (case-insensitive). Use the
fewest, most load-bearing facts — the service name plus the key value or status.

## `expect` for `honest_empty` prompts

```json
"expect": {
  "must_indicate_no_data": true,
  "forbidden_values": ["0%", "0 s", "0.0"]
}
```
The answer must clearly say there is no data **and** must contain **none** of
`forbidden_values`. This is how a false zero gets caught.

## Where to find facts to assert

`../synthbank/derived_facts.json` has, per service: health rollup, CI count, and
the worst-CPU CI. The `pins` block lists the deliberately-known scenarios
(degraded CI, offline CI, a host with no disk metric) that the current prompts
assert against. Regenerating with `generate.py` keeps facts and prompts in sync.

## Good coverage to aim for

- Every service asked about by **name** and by **alias** (net banking, upi, cbs…).
- At least one honest-empty per absent-metric type: offline CI, unreported metric,
  non-existent CI.
- Top-N / comparison / count questions.
- The same underlying question framed for **different personas**.
- Ambiguous questions that *should* resolve via the alias/synonym layer.
