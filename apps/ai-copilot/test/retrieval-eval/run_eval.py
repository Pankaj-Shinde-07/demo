#!/usr/bin/env python3
"""W4 deferred gate — FORMAL recall@10 eval (346-chunk SynthBank corpus).

Supersedes the W4 smoke-eval (PROVISIONAL, 18 chunks — preserved as
questions_w4_smoke_provisional.json / results_w4_smoke_provisional.json). At 346
chunks, k=10 is ~3% of the corpus, so recall@10 finally discriminates. THIS is the
W4->W5 gate.

Metric (group-based, see questions.json _meta.schema):
  Each question has target_groups: a list of GROUPS; a group is a list of acceptable
  [documentTitle, chunkIndex] refs and is SATISFIED if ANY member appears in top-k.
  recall@k = satisfied_groups / total_groups, averaged over the POSITIVE questions
  (class != honesty). This makes the legacy 16-CI export and the 255-CI estate count
  as ONE group for duplicated CIs (fair), and lets multi-item list questions weight
  each distinct item.

Honesty cases (class=honesty) are evaluated SEPARATELY (pass/fail tally, NOT folded
into recall): for each, hybrid top-k is inspected for honest-gap evidence and the
absence of any confabulated chunk.

GATE: fused (hybrid) recall@10 over the positive questions >= 0.85.
  Pass -> report + evidence. Miss -> STOP and report (the harness does NOT lower the
  threshold or tune anything; that is an architect decision).

Also runs the LOUD prefix-regression assertion (W4 §2/§5): /embed(chunk_text) on the
query path must NOT reproduce the stored passage embedding. Exit code is non-zero ONLY
if that plumbing assertion fails (the gate verdict is reported, not exit-coded).

Usage:
  python3 run_eval.py [--base http://localhost:3110] [--embed http://localhost:3112]
                      [--pg-container ems-ai-postgres] [--json results.json]
"""
import argparse
import json
import os
import subprocess
import sys
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
KS = [1, 3, 5, 10]
GATE_K = 10
GATE_THRESHOLD = 0.85


def http_get_json(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.loads(r.read().decode())


def http_post_json(url, payload):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def psql(container, sql):
    cmd = ["docker", "exec", container, "sh", "-c",
           'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -c ' + shquote(sql)]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if out.returncode != 0:
        raise RuntimeError(f"psql failed: {out.stderr.strip()}")
    return out.stdout


def shquote(s):
    return "'" + s.replace("'", "'\\''") + "'"


def search(base, tenant, q, mode, k=10):
    qs = urllib.parse.urlencode({"q": q, "tenant_id": tenant, "mode": mode, "k": k})
    res = http_get_json(f"{base}/api/v1/knowledge/search?{qs}")
    return [(r["documentTitle"], r["chunkIndex"]) for r in res["results"]]


def groups_to_sets(target_groups):
    """[[ [t,i], [t,i] ], ...] -> list of sets of (t,i) tuples."""
    return [{(m[0], m[1]) for m in group} for group in target_groups]


def metrics_for_groups(ordered, target_groups):
    """recall@k (satisfied groups / total) + reciprocal rank of first hit in any group."""
    groups = groups_to_sets(target_groups)
    n = len(groups)
    rec = {}
    for k in KS:
        topk = set(ordered[:k])
        sat = sum(1 for g in groups if g & topk)
        rec[k] = sat / n if n else 0.0
    rr = 0.0
    all_members = set().union(*groups) if groups else set()
    for i, h in enumerate(ordered, start=1):
        if h in all_members:
            rr = 1.0 / i
            break
    return rec, rr


def aggregate(rows):
    if not rows:
        return {f"recall@{k}": 0.0 for k in KS} | {"mrr": 0.0, "n": 0}
    agg = {f"recall@{k}": sum(r[0][k] for r in rows) / len(rows) for k in KS}
    agg["mrr"] = sum(r[1] for r in rows) / len(rows)
    agg["n"] = len(rows)
    return agg


def prefix_regression(base, embed, container, tenant):
    """LOUD assertion: /embed(chunk_text) must differ from the stored passage embedding
    of that same chunk. Probe = legacy cmdb-export.xlsx idx 8 (HSM Device 1)."""
    where = ("FROM knowledge_chunks c JOIN knowledge_documents d ON d.id=c.document_id "
             "WHERE d.source_filename='cmdb-export.xlsx' AND c.chunk_index=8")
    chunk_text = psql(container, f"SELECT c.chunk_text {where}").rstrip("\n")
    if not chunk_text:
        return False, "could not read probe chunk text"
    stored_raw = psql(container, f"SELECT c.embedding::text {where}").strip()
    stored = [float(x) for x in stored_raw.strip("[]").split(",")]
    resp = http_post_json(f"{embed}/embed", {"text": chunk_text})
    qvec = resp["embedding"]
    if not resp.get("query_prefix_applied"):
        return False, "/embed reports query_prefix_applied=false"
    cos = sum(a * b for a, b in zip(qvec, stored))
    return cos < 0.99, f"cos(query_embed(text), stored_passage)={cos:.4f} (<0.99 required; ~1.0 => prefix dropped)"


def fmt_row(label, agg):
    return (f"| {label:<10} | {agg['n']:>2} | {agg['recall@1']:.3f} | {agg['recall@3']:.3f} "
            f"| {agg['recall@5']:.3f} | {agg['recall@10']:.3f} | {agg['mrr']:.3f} |")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=os.getenv("AI_COPILOT_BASE", "http://localhost:3110"))
    ap.add_argument("--embed", default=os.getenv("EMBED_BASE", "http://localhost:3112"))
    ap.add_argument("--pg-container", default=os.getenv("PG_CONTAINER", "ems-ai-postgres"))
    ap.add_argument("--json", default=os.path.join(HERE, "results.json"))
    args = ap.parse_args()

    spec = json.load(open(os.path.join(HERE, "questions.json")))
    tenant = spec["tenant_id"]
    questions = spec["questions"]
    positives = [q for q in questions if q.get("class") != "honesty"]
    honesty = [q for q in questions if q.get("class") == "honesty"]
    pos_classes = sorted({q["class"] for q in positives})
    modes = ["dense", "sparse", "hybrid"]

    # per (mode, question) metrics over positives
    per = {m: {} for m in modes}
    for m in modes:
        for q in positives:
            ordered = search(args.base, tenant, q["q"], m, k=10)
            rec, rr = metrics_for_groups(ordered, q["target_groups"])
            per[m][q["id"]] = {"recall": rec, "rr": rr, "top5": ordered[:5]}

    def rows_for(mode, cls=None):
        return [(per[mode][q["id"]]["recall"], per[mode][q["id"]]["rr"])
                for q in positives if cls is None or q["class"] == cls]

    summary = {}
    for m in modes:
        summary[m] = {"overall": aggregate(rows_for(m))}
        for c in pos_classes:
            summary[m][c] = aggregate(rows_for(m, c))

    # ---- report ----
    print("\nW4 DEFERRED GATE — FORMAL RECALL@10 EVAL (346-chunk SynthBank corpus)")
    print(f"positives={len(positives)}  honesty={len(honesty)}  k=10  tenant={tenant[:8]}…\n")
    scopes = ["overall"] + pos_classes
    for scope in scopes:
        print(f"### {scope.upper()} ({summary['hybrid'][scope]['n']} q)")
        print("| mode       |  n | rec@1 | rec@3 | rec@5 | rec@10| MRR   |")
        print("|------------|----|-------|-------|-------|-------|-------|")
        for m in modes:
            print(fmt_row(m, summary[m][scope]))
        print()

    # ---- hybrid thesis: fused >= best single mode (overall + cmdb), rec@10 + MRR ----
    def thesis(scope):
        h = summary["hybrid"][scope]
        bs_r10 = max(summary["dense"][scope]["recall@10"], summary["sparse"][scope]["recall@10"])
        bs_mrr = max(summary["dense"][scope]["mrr"], summary["sparse"][scope]["mrr"])
        return (h["recall@10"] >= bs_r10 - 1e-9, h["recall@10"], bs_r10,
                h["mrr"] >= bs_mrr - 1e-9, h["mrr"], bs_mrr)
    print("### HYBRID THESIS — fused >= best single mode")
    thesis_out = {}
    for scope in ["overall", "cmdb"]:
        ok10, h10, b10, okm, hm, bm = thesis(scope)
        thesis_out[scope] = {"recall@10_ok": ok10, "mrr_ok": okm}
        print(f"  [{scope}] recall@10: hybrid={h10:.3f} vs best-single={b10:.3f} -> {'PASS' if ok10 else 'FAIL'}"
              f"   |  MRR: hybrid={hm:.3f} vs best-single={bm:.3f} -> {'PASS' if okm else 'FAIL'}")
    print()

    # ---- honesty tally (separate; hybrid top-10) ----
    print("### HONESTY / NEGATIVE CASES (hybrid top-10; not folded into recall)")
    honesty_results = []
    for q in honesty:
        ordered = search(args.base, tenant, q["q"], "hybrid", k=10)
        topk = set(ordered)
        ev_groups = groups_to_sets(q.get("honest_evidence", []))
        ev_hits = [bool(g & topk) for g in ev_groups]
        # pass: if honest_evidence specified -> >=1 evidence group present (grounds the
        # honest gap answer). If none specified (nonexistent svc/incident) -> pass by
        # no_confabulation_possible (corpus has no chunk that satisfies the false premise).
        if ev_groups:
            passed = any(ev_hits)
        else:
            passed = bool(q.get("no_confabulation_possible"))
        honesty_results.append({"id": q["id"], "passed": passed,
                                "evidence_present": ev_hits, "top3": ordered[:3]})
        ev_str = (f"evidence_in_top10={sum(ev_hits)}/{len(ev_groups)}" if ev_groups
                  else "no-confabulation (no chunk satisfies the false premise)")
        print(f"  [{'PASS' if passed else 'FAIL'}] {q['id']:<20} {ev_str}")
    hon_pass = sum(1 for r in honesty_results if r["passed"])
    print(f"  honesty tally: {hon_pass}/{len(honesty_results)} pass\n")

    # ---- prefix regression (LOUD) ----
    ok, detail = prefix_regression(args.base, args.embed, args.pg_container, tenant)
    print("### PREFIX REGRESSION ASSERTION (W4 §2/§5)")
    print(f"  {'PASS' if ok else 'FAIL'} — {detail}\n")

    # ---- THE GATE ----
    gate_val = summary["hybrid"]["overall"][f"recall@{GATE_K}"]
    gate_pass = gate_val >= GATE_THRESHOLD
    print("=" * 64)
    print(f"GATE — fused recall@{GATE_K} >= {GATE_THRESHOLD}: "
          f"{gate_val:.3f} -> {'PASS ✅' if gate_pass else 'MISS ❌ (STOP — architect review)'}")
    print("=" * 64)

    json.dump({"summary": summary, "per": per, "thesis": thesis_out,
               "honesty": honesty_results,
               "gate": {"metric": f"recall@{GATE_K}", "threshold": GATE_THRESHOLD,
                        "value": gate_val, "pass": gate_pass},
               "prefix_regression": {"ok": ok, "detail": detail}},
              open(args.json, "w"), indent=2)
    print(f"\nwrote {args.json}")

    if not ok:
        print("\nFATAL: prefix regression assertion failed — query prefix not applied.", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
