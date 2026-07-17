// scorecard.mjs
// Runs the synthetic prompt set against a Copilot endpoint and produces the
// grounding scorecard: grounded count, honest-empty count, FLAG count, and the
// delta vs the previous run. Zero external dependencies (Node 18+ fetch).
//
// Usage:
//   node harness/scorecard.mjs                 # uses harness/config.json
//   node harness/scorecard.mjs --build R3      # label this run's build
//
// The endpoint contract is documented in API-CONTRACT.md. To score the REAL
// Copilot instead of the mock, change "endpoint" in config.json.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(fs.readFileSync(path.join(HERE, "config.json"), "utf8"));
const buildLabel = (() => {
  const i = process.argv.indexOf("--build");
  return i > -1 ? process.argv[i + 1] : "unlabelled";
})();

const promptsPath = path.join(HERE, "..", cfg.prompt_set);
const prompts = fs
  .readFileSync(promptsPath, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));

function containsFabricatedForbidden(text, forbidden = []) {
  const t = text.toLowerCase();
  return forbidden.some((f) => t.includes(String(f).toLowerCase()));
}
const NO_DATA_MARKERS = [
  "no data", "not reporting", "not a known", "don't have", "do not have",
  "unavailable", "not available",
  // Real-Copilot honest-decline vocabulary (adapter fix #2): the Copilot declines
  // WITHOUT emitting a number — an honest no-answer, never a false zero. Recognising
  // its decline phrasing as "no data" keeps the honest-empty judgement fair to the
  // real API's vocabulary. The no-fabrication guarantee is judged separately (below)
  // and is unaffected. See API-CONTRACT.md § "Real Copilot".
  "could not find grounding", "couldn't identify", "could not identify",
  "not in the evidence", "cannot see", "will not guess",
];

// Adapter fix #1 — digit-separator normalization. The real Copilot narrates numbers
// with thousands separators ("1,850 ms"); the prompt facts are written bare ("1850").
// Normalise BOTH sides (strip a comma between two digits) before the substring check
// so a correctly-grounded value is not scored as missing on cosmetics. Non-numeric
// facts (service names, etc.) are unaffected.
const normNum = (s) => String(s).toLowerCase().replace(/(\d),(?=\d)/g, "$1");

function judge(prompt, resp) {
  const text = (resp.answer || "").toString();
  const grounded = resp.grounded === true;
  const exp = prompt.expect || {};

  if (prompt.grounding === "honest_empty") {
    const saysNoData = NO_DATA_MARKERS.some((m) => text.toLowerCase().includes(m));
    const fabricated = containsFabricatedForbidden(text, exp.forbidden_values);
    if (fabricated) return { pass: false, reason: "FABRICATED_VALUE (false zero / invented)" };
    if (!saysNoData) return { pass: false, reason: "DID_NOT_STATE_NO_DATA" };
    return { pass: true, reason: "honest-empty ok" };
  }

  // grounded expected
  if (!grounded) return { pass: false, reason: "FLAG (ungrounded response where grounded expected)" };
  const hay = normNum(text);
  const missing = (exp.must_include || []).filter(
    (m) => !hay.includes(normNum(m))
  );
  if (missing.length) return { pass: false, reason: "MISSING_FACT: " + missing.join(", ") };
  return { pass: true, reason: "grounded ok" };
}

// ── Adapter (per API-CONTRACT.md) ────────────────────────────────────────────
// The REAL NEXA Copilot's ask endpoint is POST /api/v1/ai/chat and differs from
// the mock's flat contract; this is the ONLY place that difference is absorbed:
//   request : { message } (+ a fresh sessionId per prompt so multi-turn Redis
//             memory never bleeds between independent scorecard prompts)
//   response: { answer, grounded, declined, citations:[{ref,...}], ... }
//             → mapped to the flat { answer, grounded, refs } the judge expects.
// The judge logic below is unchanged. See API-CONTRACT.md § "Real Copilot".
async function ask(prompt) {
  const question = typeof prompt === "string" ? prompt : prompt.question;
  const session = typeof prompt === "string" ? "sc" : `sc-${prompt.id}`;
  const r = await fetch(cfg.endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cfg.headers || {}) },
    // Send BOTH keys so one harness serves both endpoints: the mock reads
    // `question`, the real Copilot reads `message` (+ sessionId). Each ignores
    // the other's field.
    body: JSON.stringify({ question, message: question, sessionId: session }),
  });
  if (!r.ok) throw new Error(`endpoint ${r.status}`);
  const d = await r.json();
  return {
    answer: d.answer ?? "",
    grounded: d.grounded === true,
    refs: Array.isArray(d.citations) ? d.citations.map((c) => c.ref) : (d.refs || []),
  };
}

const run = async () => {
  const results = [];
  let flagCount = 0;
  for (const p of prompts) {
    let resp;
    try {
      resp = await ask(p);
    } catch (e) {
      resp = { answer: `ERROR: ${e.message}`, grounded: false };
    }
    if (resp.grounded === false && p.grounding === "grounded") flagCount++;
    const j = judge(p, resp);
    results.push({ id: p.id, persona: p.persona, grounding: p.grounding, pass: j.pass, reason: j.reason, answer: resp.answer });
  }

  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  const groundedPass = results.filter((r) => r.pass && r.grounding === "grounded").length;
  const emptyPass = results.filter((r) => r.pass && r.grounding === "honest_empty").length;
  const fails = results.filter((r) => !r.pass);
  const fabricated = fails.filter((r) => r.reason.startsWith("FABRICATED")).length;

  const scorecard = {
    build: buildLabel,
    ts: new Date().toISOString(),
    endpoint: cfg.endpoint,
    total, passed,
    grounded_pass: groundedPass,
    honest_empty_pass: emptyPass,
    flag_count: flagCount,
    fabricated_value_count: fabricated,
    fails: fails.map((f) => ({ id: f.id, reason: f.reason })),
  };

  // delta vs previous
  const histPath = path.join(HERE, "..", cfg.history || "harness/last-scorecard.json");
  let delta = "n/a (first run)";
  if (fs.existsSync(histPath)) {
    const prev = JSON.parse(fs.readFileSync(histPath, "utf8"));
    const d = passed - prev.passed;
    delta = `${d >= 0 ? "+" : ""}${d} vs ${prev.build} (${prev.passed}/${prev.total})`;
    scorecard.prev_build = prev.build;
  }
  scorecard.delta = delta;
  fs.writeFileSync(histPath, JSON.stringify(scorecard, null, 2));

  // console report
  const bar = "─".repeat(58);
  console.log(bar);
  console.log(`NEXA GROUNDING SCORECARD   build=${buildLabel}`);
  console.log(bar);
  console.log(`Total prompts        : ${total}`);
  console.log(`Passed               : ${passed}/${total}`);
  console.log(`  grounded pass      : ${groundedPass}`);
  console.log(`  honest-empty pass  : ${emptyPass}`);
  console.log(`FLAG count           : ${flagCount}   (target: 0)`);
  console.log(`Fabricated-value fail: ${fabricated}   (target: 0 — this is the worst failure)`);
  console.log(`Delta                : ${delta}`);
  if (fails.length) {
    console.log(bar);
    console.log("FAILURES:");
    for (const f of fails) console.log(`  ${f.id.padEnd(6)} ${f.reason}`);
  }
  console.log(bar);

  process.exit(fabricated > 0 ? 2 : 0); // fabricated value fails the run hard
};

run();
