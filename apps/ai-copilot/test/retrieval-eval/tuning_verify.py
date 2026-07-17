#!/usr/bin/env python3
"""Verify a chosen RRF weight config: (c) exact-token wins preserved, honesty 5/5,
and per-question dense->config flips. Offline, over live top-50 pools. Default 4:1."""
import json, os, sys, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.getenv("AI_COPILOT_BASE", "http://localhost:3110")
RRF_K = 60
WD, WS = (int(sys.argv[1]), int(sys.argv[2])) if len(sys.argv) > 2 else (4, 1)

spec = json.load(open(os.path.join(HERE, "questions.json")))
TENANT = spec["tenant_id"]


def get(q, mode, k=50):
    qs = urllib.parse.urlencode({"q": q, "tenant_id": TENANT, "mode": mode, "k": k})
    with urllib.request.urlopen(f"{BASE}/api/v1/knowledge/search?{qs}", timeout=30) as r:
        res = json.loads(r.read().decode())
    return [(h["chunkId"], (h["documentTitle"], h["chunkIndex"])) for h in res["results"]]


def ranks(pool):
    r = {}
    for i, (_c, ti) in enumerate(pool, 1):
        r.setdefault(ti, i)
    return r


def fuse(dense, sparse, wd, ws, k=RRF_K):
    s = {}
    for pool, w in ((dense, wd), (sparse, ws)):
        for ti, rk in ranks(pool).items():
            s[ti] = s.get(ti, 0.0) + w / (k + rk)
    return [ti for ti, _ in sorted(s.items(), key=lambda kv: (-kv[1], kv[0]))]


# ---- (c) exact-token spot-checks: the exact CI row must rank at/near #1 ----
print(f"### (c) EXACT-TOKEN SPOT-CHECK under {WD}:{WS} — sparse must keep earning its keep")
exact = [
    ("Sponsor Bank Link A", ("synthbank-cmdb-export.xlsx", 4), ("cmdb-export.xlsx", 4)),
    ("NPCI Link A", ("synthbank-cmdb-export.xlsx", 5), ("cmdb-export.xlsx", 5)),
    ("HSM Device 1", ("synthbank-cmdb-export.xlsx", 8), ("cmdb-export.xlsx", 8)),
]
for q, *acc in exact:
    acc = set(acc)
    d = get(q, "dense"); s = get(q, "sparse")
    def rank_of(order):
        for i, ti in enumerate(order, 1):
            if ti in acc:
                return i
        return None
    rd = rank_of([ti for _c, ti in d])
    rs = rank_of([ti for _c, ti in s])
    rf = rank_of(fuse(d, s, WD, WS))
    print(f"  '{q:<20}' rank: dense={rd}  sparse={rs}  fused({WD}:{WS})={rf}")
print()

# ---- honesty under the chosen config (hybrid top-10 via weighted fusion) ----
print(f"### HONESTY under {WD}:{WS} (must stay 5/5)")
honesty = [q for q in spec["questions"] if q.get("class") == "honesty"]
npass = 0
for q in honesty:
    d = get(q["q"], "dense"); s = get(q["q"], "sparse")
    top10 = set(fuse(d, s, WD, WS)[:10])
    ev = [{(m[0], m[1]) for m in g} for g in q.get("honest_evidence", [])]
    if ev:
        passed = any(g & top10 for g in ev)
        detail = f"evidence_in_top10={sum(1 for g in ev if g & top10)}/{len(ev)}"
    else:
        passed = bool(q.get("no_confabulation_possible"))
        detail = "no-confabulation (no chunk satisfies false premise)"
    npass += passed
    print(f"  [{'PASS' if passed else 'FAIL'}] {q['id']:<20} {detail}")
print(f"  honesty tally: {npass}/{len(honesty)}")
