# Grounding gap / issue log

One row per issue found. A **fabricated value** (false zero / invented number) is
the most serious class — flag it at the top and tell Pramod the same day.

Flag, don't fix: if the Copilot itself is wrong, log it here and raise it — do not
patch product code.

| # | date | prompt id / question | what happened | expected | class | how to reproduce | status |
|---|------|----------------------|---------------|----------|-------|------------------|--------|
| 1 |      |                      |               |          | FABRICATED_VALUE / FLAG / MISSING_FACT / WRONG_PERSONA / RENDER | endpoint + question | open |

### Classes

- **FABRICATED_VALUE** — returned a number/zero where the estate has no data. Worst class.
- **FLAG** — refused / ungrounded where a grounded answer was expected.
- **MISSING_FACT** — grounded, but the key fact was wrong or absent.
- **WRONG_PERSONA** — answer/dashboard not appropriate for who asked.
- **RENDER** — Studio rendered wrong (wrong widget, broken chart, mislabelled).

### Notes

- Include the exact question and the exact answer text — Pramod needs to reproduce it.
- If it only happens on one build, note the build label.
