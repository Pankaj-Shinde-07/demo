#!/usr/bin/env python3
"""W4 RRF tuning pass — bounded weighted-RRF + OR-semantics sweep (offline fusion).

The eval set is FROZEN (same questions.json: 30 positive + 5 honesty, group metric,
targets-by-inspection). Only the retrieval *config* varies. To avoid five container
rebuilds, the sweep is computed OFFLINE: for each question we fetch the dense top-50
and sparse top-50 candidate pools from the LIVE endpoint (the exact pools the service
fuses), and an OR-semantics sparse pool via psql, then apply weighted RRF in Python.

A sanity check confirms the offline 1:1 fusion reproduces the live hybrid headline
(0.865) — that validates the method before any weighting conclusion is drawn.

Configs (Lever 1 = weight sweep on the websearch sparse pool; Lever 2 = OR-semantics
sparse at 1:1):
    1:1 (baseline)  2:1  3:1  4:1   |   OR@1:1

Usage: python3 rrf_tuning.py
"""
import json
import os
import subprocess
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.getenv("AI_COPILOT_BASE", "http://localhost:3110")
PG = os.getenv("PG_CONTAINER", "ems-ai-postgres")
POOL = 50
RRF_K = 60
KS = [1, 3, 5, 10]
WEIGHT_CONFIGS = [(1, 1), (2, 1), (3, 1), (4, 1)]


def http_get_json(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.loads(r.read().decode())


def shquote(s):
    return "'" + s.replace("'", "'\\''") + "'"


def psql_rows(sql):
    cmd = ["docker", "exec", PG, "sh", "-c",
           'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -F"|" -c ' + shquote(sql)]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if out.returncode != 0:
        raise RuntimeError(f"psql failed: {out.stderr.strip()}")
    return [ln for ln in out.stdout.splitlines() if ln.strip()]


def fetch_pool(q, mode):
    """Live dense/sparse top-50 -> ordered list of (title, idx) and (chunkId)."""
    qs = urllib.parse.urlencode({"q": q, "tenant_id": TENANT, "mode": mode, "k": POOL})
    res = http_get_json(f"{BASE}/api/v1/knowledge/search?{qs}")
    return [(r["chunkId"], (r["documentTitle"], r["chunkIndex"])) for r in res["results"]]


def fetch_sparse_or(q):
    """OR-semantics sparse top-50 via psql: plainto_tsquery AND -> OR, same ts_rank_cd.
    Returns ordered list of (chunkId, (title, idx))."""
    sql = (
        "WITH qq AS (SELECT NULLIF(replace(plainto_tsquery('english', " + shquote(q)
        + ")::text, ' & ', ' | '), '')::tsquery AS tsq) "
        "SELECT c.id, d.title, c.chunk_index, ts_rank_cd(c.ts_vector, qq.tsq) AS rs "
        "FROM knowledge_chunks c JOIN knowledge_documents d ON d.id=c.document_id, qq "
        "WHERE c.tenant_id='" + TENANT + "'::uuid AND d.deleted_at IS NULL "
        "AND qq.tsq IS NOT NULL AND c.ts_vector @@ qq.tsq "
        "ORDER BY rs DESC, c.id LIMIT " + str(POOL)
    )
    out = []
    for ln in psql_rows(sql):
        cid, title, idx, _rs = ln.split("|")
        out.append((cid, (title, int(idx))))
    return out


def ranks(pool):
    """(title,idx)->1-based rank from an ordered pool (first occurrence wins)."""
    r = {}
    for i, (_cid, ti) in enumerate(pool, start=1):
        if ti not in r:
            r[ti] = i
    return r


def weighted_rrf(dense_pool, sparse_pool, wd, ws, k=RRF_K):
    """Return fused ordered list of (title,idx). Score by (title,idx) so duplicates
    across docs fuse naturally; tie-break by (title,idx) for determinism."""
    score = {}
    for pool, w in ((dense_pool, wd), (sparse_pool, ws)):
        rk = ranks(pool)
        for ti, rank in rk.items():
            score[ti] = score.get(ti, 0.0) + w / (k + rank)
    return [ti for ti, _ in sorted(score.items(), key=lambda kv: (-kv[1], kv[0]))]


def groups_to_sets(target_groups):
    return [{(m[0], m[1]) for m in g} for g in target_groups]


def metrics(ordered, target_groups):
    groups = groups_to_sets(target_groups)
    n = len(groups)
    rec = {}
    for k in KS:
        topk = set(ordered[:k])
        rec[k] = (sum(1 for g in groups if g & topk) / n) if n else 0.0
    members = set().union(*groups) if groups else set()
    rr = 0.0
    for i, h in enumerate(ordered, start=1):
        if h in members:
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


spec = json.load(open(os.path.join(HERE, "questions.json")))
TENANT = spec["tenant_id"]
positives = [q for q in spec["questions"] if q.get("class") != "honesty"]
honesty = [q for q in spec["questions"] if q.get("class") == "honesty"]
classes = sorted({q["class"] for q in positives})

# ---- fetch all pools once ----
pools = {}
for q in positives + honesty:
    qid = q["id"]
    pools[qid] = {
        "dense": fetch_pool(q["q"], "dense"),
        "sparse": fetch_pool(q["q"], "sparse"),
        "sparse_or": fetch_sparse_or(q["q"]),
    }

# dense-only / sparse-only (frozen baselines)
def eval_single(pool_key):
    rows = [metrics([ti for _c, ti in pools[q["id"]][pool_key]], q["target_groups"]) for q in positives]
    return aggregate(rows)

# weighted/OR hybrid eval over positives
def eval_config(wd, ws, sparse_key="sparse"):
    by_class = {c: [] for c in classes}
    allrows = []
    for q in positives:
        fused = weighted_rrf(pools[q["id"]]["dense"], pools[q["id"]][sparse_key], wd, ws)
        m = metrics(fused, q["target_groups"])
        allrows.append(m)
        by_class[q["class"]].append(m)
    return aggregate(allrows), {c: aggregate(by_class[c]) for c in classes}


def fmt(label, agg):
    return (f"| {label:<14} | {agg['recall@1']:.3f} | {agg['recall@3']:.3f} "
            f"| {agg['recall@5']:.3f} | {agg['recall@10']:.3f} | {agg['mrr']:.3f} |")


dense_only = eval_single("dense")
sparse_only = eval_single("sparse")
print("\nW4 RRF TUNING — frozen eval (30 positive), offline weighted fusion over live top-50 pools\n")
print("### SINGLE-MODE BASELINES")
print("| mode           | rec@1 | rec@3 | rec@5 | rec@10| MRR   |")
print("|----------------|-------|-------|-------|-------|-------|")
print(fmt("dense-only", dense_only))
print(fmt("sparse-only", sparse_only))
print()

print("### HYBRID CONFIG GRID (overall, n=30)")
print("| config         | rec@1 | rec@3 | rec@5 | rec@10| MRR   |")
print("|----------------|-------|-------|-------|-------|-------|")
grid = {}
for wd, ws in WEIGHT_CONFIGS:
    ov, bc = eval_config(wd, ws)
    grid[f"{wd}:{ws}"] = (ov, bc)
    print(fmt(f"{wd}:{ws} (websrch)", ov))
ov_or, bc_or = eval_config(1, 1, "sparse_or")
grid["OR@1:1"] = (ov_or, bc_or)
print(fmt("OR @1:1", ov_or))
print()

print(f"(method check: offline 1:1 recall@10 = {grid['1:1'][0]['recall@10']:.3f} ; "
      f"live hybrid headline was 0.865)\n")

print("### CMDB-CLASS recall@10 (must stay >= 0.829) + per-class @10 by config")
hdr = "| config         | overall@10 | cmdb@10 | payments@10 | rca@10 | topology@10 |"
print(hdr); print("|" + "-" * (len(hdr) - 2) + "|")
def cls10(bc, c): return f"{bc[c]['recall@10']:.3f}"
for label, (ov, bc) in grid.items():
    print(f"| {label:<14} | {ov['recall@10']:.3f}      | {cls10(bc,'cmdb')}   | "
          f"{cls10(bc,'payments')}       | {cls10(bc,'rca')}  | {cls10(bc,'topology')}       |")
print()

# ---- selection (a)-(d) vs dense-only ----
d10 = dense_only["recall@10"]; dmrr = dense_only["mrr"]
print(f"### SELECTION CRITERIA (vs dense-only @10={d10:.3f}, MRR={dmrr:.3f}; cmdb floor 0.829)")
winner = None
for label in ["1:1", "2:1", "3:1", "4:1", "OR@1:1"]:
    ov, bc = grid[label]
    a = ov["recall@10"] >= d10 - 1e-9
    b = bc["cmdb"]["recall@10"] >= 0.829 - 1e-9
    dd = ov["mrr"] >= dmrr - 1e-9
    print(f"  {label:<8} (a)hybrid>=dense@10:{ov['recall@10']:.3f}{'✓' if a else '✗'}  "
          f"(b)cmdb>=0.829:{bc['cmdb']['recall@10']:.3f}{'✓' if b else '✗'}  "
          f"(d)MRR>=dense:{ov['mrr']:.3f}{'✓' if dd else '✗'}")
    if winner is None and a and b and dd and label != "1:1":
        winner = label
print(f"\n  -> simplest config satisfying (a),(b),(d): {winner or 'NONE (tripwire candidate)'}")
print("     (exact-token spot-check (c) + honesty 5/5 verified separately for the chosen config)\n")

json.dump({"dense_only": dense_only, "sparse_only": sparse_only,
           "grid": {kk: {"overall": v[0], "by_class": v[1]} for kk, v in grid.items()},
           "winner_by_abd": winner},
          open(os.path.join(HERE, "rrf_tuning_results.json"), "w"), indent=2)
print(f"wrote {os.path.join(HERE, 'rrf_tuning_results.json')}")
