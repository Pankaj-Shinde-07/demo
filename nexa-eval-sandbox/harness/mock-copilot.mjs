// mock-copilot.mjs
// A tiny stand-in for the NEXA Copilot, used ONLY to bring the harness up on
// day one. It answers questions from the synthetic estate, following the same
// request/response contract the real Copilot exposes (see API-CONTRACT.md).
//
// It is deliberately a *correct-but-simple* grounding implementation: it
// resolves a service via aliases, reads real metrics, and — critically —
// returns an honest "no data" instead of a false zero when a metric is
// genuinely absent. That is exactly the behaviour the scorecard checks for.
//
// Swap this out by pointing harness/config.json at the real Copilot endpoint.
//
// Run:  node harness/mock-copilot.mjs   (listens on :8899)

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SB = path.join(HERE, "..", "synthbank");

const cis = JSON.parse(fs.readFileSync(path.join(SB, "cis.json"), "utf8"));
const services = JSON.parse(fs.readFileSync(path.join(SB, "services.json"), "utf8"));

const aliasMap = new Map(); // alias(lower) -> service
for (const s of services) {
  aliasMap.set(s.name.toLowerCase(), s);
  for (const a of s.aliases) aliasMap.set(a.toLowerCase(), s);
}
const ciMap = new Map(cis.map((c) => [c.id.toUpperCase(), c]));

const METRIC_WORDS = {
  cpu_pct: ["cpu"],
  mem_pct: ["memory", "mem", "ram"],
  disk_pct: ["disk", "storage"],
  uptime_s: ["uptime"],
  response_ms: ["response", "latency", "response time"],
  availability_pct: ["availability", "uptime %"],
};

function serviceHealth(sid) {
  const members = cis.filter((c) => c.service_id === sid);
  const downs = members.filter((c) => c.metrics.status === "down").length;
  if (downs >= 2) return "down";
  if (members.some((c) => ["down", "degraded"].includes(c.metrics.status))) return "degraded";
  return "healthy";
}

// Ground an answer, or honestly refuse. Returns { answer, grounded, refs }.
function answer(question) {
  const q = question.toLowerCase();

  // 1) Direct CI reference (e.g. "IB-APP-01")
  const ciRef = (question.match(/\b[A-Z]{2,4}-[A-Z]{3}-\d{2}\b/) || [])[0];
  if (ciRef) {
    const ci = ciMap.get(ciRef.toUpperCase());
    if (!ci) {
      return {
        answer: `I have no data for ${ciRef} — it is not a known CI in the estate.`,
        grounded: true, refs: [],
      };
    }
    // which metric?
    let metric = null;
    for (const [m, words] of Object.entries(METRIC_WORDS)) {
      if (words.some((w) => q.includes(w))) { metric = m; break; }
    }
    if (metric) {
      const v = ci.metrics[metric];
      if (v === undefined || v === null) {
        // genuinely absent -> honest no-data, never a zero
        return {
          answer: `No data: ${ci.id} is not reporting ${metric.replace("_", " ")} right now.`,
          grounded: true, refs: [ci.id],
        };
      }
      const unit = metric.endsWith("_pct") ? "%" : metric === "response_ms" ? " ms" : metric === "uptime_s" ? " s" : "";
      return { answer: `${ci.id} ${metric.replace("_", " ")} is ${v}${unit}.`, grounded: true, refs: [ci.id] };
    }
    return {
      answer: `${ci.id} (${ci.kind}) is currently ${ci.metrics.status}.`,
      grounded: true, refs: [ci.id],
    };
  }

  // 2) Cross-estate: degraded / down listing
  if (q.includes("degraded") || (q.includes("down") && q.includes("service")) || q.includes("escalate")) {
    const bad = services
      .map((s) => ({ s, h: serviceHealth(s.id) }))
      .filter((x) => x.h !== "healthy");
    if (bad.length === 0) return { answer: "All services are healthy.", grounded: true, refs: [] };
    return {
      answer: "Currently not healthy: " + bad.map((x) => `${x.s.name} (${x.h})`).join(", ") + ".",
      grounded: true, refs: bad.map((x) => x.s.id),
    };
  }

  // 2b) All-services summary / overview
  if ((q.includes("all") || q.includes("across") || q.includes("every")) &&
      (q.includes("service") || q.includes("banking")) &&
      (q.includes("summary") || q.includes("overview") || q.includes("health") || q.includes("status"))) {
    const roll = services.map((s) => `${s.name}: ${serviceHealth(s.id)}`).join("; ");
    return { answer: `Estate health — ${roll}.`, grounded: true, refs: services.map((s) => s.id) };
  }

  // 3) Service resolution via alias, then worst-cpu / count / health.
  //    Order matters: check specific intents before the generic health reply.
  let svc = null;
  for (const [alias, s] of aliasMap) {
    if (q.includes(alias)) { svc = s; break; }
  }
  if (svc) {
    const members = cis.filter((c) => c.service_id === svc.id);
    if (q.includes("highest cpu") || q.includes("worst")) {
      const withCpu = members.filter((c) => typeof c.metrics.cpu_pct === "number");
      const worst = withCpu.sort((a, b) => b.metrics.cpu_pct - a.metrics.cpu_pct)[0];
      return { answer: `Highest CPU in ${svc.name} is ${worst.id} at ${worst.metrics.cpu_pct}%.`, grounded: true, refs: [worst.id] };
    }
    if (q.includes("how many") || q.includes("configuration items") || q.includes("how many ci")) {
      return { answer: `${svc.name} is made up of ${members.length} configuration items.`, grounded: true, refs: [svc.id] };
    }
    return { answer: `${svc.name} is ${serviceHealth(svc.id)}.`, grounded: true, refs: [svc.id] };
  }

  // 4) Nothing matched -> honest refusal (ungrounded FLAG), never a guess
  return { answer: "I don't have grounded data to answer that.", grounded: false, refs: [] };
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || !req.url.startsWith("/copilot/ask")) {
    res.writeHead(404); return res.end("not found");
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let q = "";
    try { q = JSON.parse(body).question || ""; } catch {}
    const a = answer(q);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(a));
  });
});
server.listen(8899, () => console.log("mock-copilot listening on http://127.0.0.1:8899/copilot/ask"));
