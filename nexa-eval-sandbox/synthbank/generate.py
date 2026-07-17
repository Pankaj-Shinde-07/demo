#!/usr/bin/env python3
"""
SynthBank generator — single source of truth for the sandbox.

Produces a synthetic bank IT estate (CIs + services + aliases), a set of
"pinned" scenarios (known health states, known missing metrics, a genuinely
offline CI), and an eval prompt set whose expected answers are derived from
that same estate. Because estate and prompts come from one generator, the
mock Copilot and the scorecard baseline stay consistent by construction.

Everything here is SYNTHETIC. No client data, names, or credentials.

Run:  python3 generate.py
Emits (into ../synthbank and ../prompts):
  cis.json, services.json, service_aliases.csv, derived_facts.json,
  seed.sql, ../prompts/prompt_set.jsonl
"""
import json, csv, os, random, hashlib

random.seed(4242)  # deterministic
HERE = os.path.dirname(os.path.abspath(__file__))
PROMPTS = os.path.abspath(os.path.join(HERE, "..", "prompts"))

# ---- Services (9, bank estate) --------------------------------------------
SERVICES = [
    ("SVC-CBS",  "Core Banking",       ["cbs", "core banking", "core"]),
    ("SVC-IB",   "Internet Banking",   ["internet banking", "net banking", "online banking", "ib"]),
    ("SVC-MOB",  "Mobile & UPI",       ["mobile banking", "mobile app", "upi", "mobile"]),
    ("SVC-ATM",  "ATM Switch",         ["atm", "atm switch", "atm network"]),
    ("SVC-PAY",  "Payments (NEFT/RTGS/IMPS)", ["payments", "neft", "rtgs", "imps", "payment gateway"]),
    ("SVC-CARD", "Card Management",     ["cards", "card management", "card system"]),
    ("SVC-MAIL", "Email & Collaboration", ["email", "mail", "collaboration"]),
    ("SVC-CRM",  "CRM",                ["crm", "customer relationship"]),
    ("SVC-TRE",  "Treasury",           ["treasury", "tr"]),
]

CI_KINDS = [
    # kind, metrics it reports
    ("app",     ["cpu_pct", "mem_pct", "disk_pct", "uptime_s", "response_ms", "availability_pct", "status"]),
    ("db",      ["cpu_pct", "mem_pct", "disk_pct", "uptime_s", "availability_pct", "status"]),
    ("web",     ["cpu_pct", "mem_pct", "disk_pct", "uptime_s", "response_ms", "availability_pct", "status"]),
    ("host",    ["cpu_pct", "mem_pct", "disk_pct", "uptime_s", "status"]),
    # network devices deliberately DO NOT report disk/response — honest-empty targets
    ("network", ["cpu_pct", "mem_pct", "uptime_s", "if_in_bps", "if_out_bps", "status"]),
]

def h(*parts):
    return hashlib.md5("|".join(map(str, parts)).encode()).hexdigest()[:6]

cis = []
services = []
membership = []  # (service_id, ci_id)

def mk_metric(kind, forced=None):
    m = {}
    if forced is None:
        forced = {}
    def val(name, lo, hi, r=1):
        return forced.get(name, round(random.uniform(lo, hi), r))
    if "cpu_pct" in dict(CI_KINDS)[kind]:
        m["cpu_pct"] = val("cpu_pct", 4, 55)
    if "mem_pct" in dict(CI_KINDS)[kind]:
        m["mem_pct"] = val("mem_pct", 20, 70)
    if "disk_pct" in dict(CI_KINDS)[kind]:
        m["disk_pct"] = val("disk_pct", 15, 65)
    if "uptime_s" in dict(CI_KINDS)[kind]:
        m["uptime_s"] = forced.get("uptime_s", random.randint(3*86400, 220*86400))
    if "response_ms" in dict(CI_KINDS)[kind]:
        m["response_ms"] = val("response_ms", 40, 240)
    if "availability_pct" in dict(CI_KINDS)[kind]:
        m["availability_pct"] = val("availability_pct", 99.2, 99.99, 2)
    if "if_in_bps" in dict(CI_KINDS)[kind]:
        m["if_in_bps"] = forced.get("if_in_bps", random.randint(2_000_000, 900_000_000))
    if "if_out_bps" in dict(CI_KINDS)[kind]:
        m["if_out_bps"] = forced.get("if_out_bps", random.randint(2_000_000, 900_000_000))
    m["status"] = forced.get("status", "up")
    return m

# Per-service CI plan (sums ~200)
PLAN = {
    "SVC-CBS":  [("app",4),("db",3),("web",2),("host",4),("network",3)],
    "SVC-IB":   [("app",4),("db",2),("web",3),("host",3),("network",2)],
    "SVC-MOB":  [("app",4),("db",2),("web",2),("host",3),("network",2)],
    "SVC-ATM":  [("app",3),("db",2),("host",3),("network",4)],
    "SVC-PAY":  [("app",4),("db",3),("web",2),("host",3),("network",2)],
    "SVC-CARD": [("app",3),("db",2),("web",2),("host",3),("network",2)],
    "SVC-MAIL": [("app",3),("db",1),("web",2),("host",3),("network",2)],
    "SVC-CRM":  [("app",3),("db",2),("web",2),("host",2),("network",1)],
    "SVC-TRE":  [("app",3),("db",2),("web",1),("host",2),("network",1)],
}

PINS = {"facts": {}}

for sid, sname, aliases in SERVICES:
    services.append({"id": sid, "name": sname, "aliases": aliases})
    idx = 0
    for kind, count in PLAN[sid]:
        for _ in range(count):
            idx += 1
            cid = f"{sid.split('-')[1]}-{kind[:3].upper()}-{idx:02d}"
            forced = None

            # ---- PINNED SCENARIOS (known, assertable) ----
            # Internet Banking: one degraded app -> service degraded
            if sid == "SVC-IB" and kind == "app" and idx == 1:
                forced = {"cpu_pct": 94.0, "response_ms": 1850.0, "status": "degraded"}
                PINS["facts"]["ib_degraded_ci"] = cid
            # ATM Switch: one genuinely OFFLINE network device (down, metrics null)
            if sid == "SVC-ATM" and kind == "network" and idx == 12:
                forced = {"status": "down"}
                PINS["facts"]["atm_offline_ci"] = cid
            # Treasury stays fully healthy (no pins needed) -> assert healthy
            if sid == "SVC-TRE":
                PINS["facts"].setdefault("treasury_service", sid)

            m = mk_metric(kind, forced)

            # Offline device: metrics genuinely ABSENT (null), NOT zero.
            if forced and forced.get("status") == "down":
                for k in list(m.keys()):
                    if k != "status":
                        m[k] = None

            # A specific CORE network switch reports no disk (already true for
            # network kind) AND no availability — honest-empty target for a
            # metric the user might reasonably ask for.
            ci = {
                "id": cid,
                "service_id": sid,
                "kind": kind,
                "hostname": f"{cid.lower()}.synthbank.local",
                "metrics": m,
            }
            cis.append(ci)
            membership.append((sid, cid))

# Pin a "missing metric" honest-empty target: pick a host and remove disk_pct
for ci in cis:
    if ci["service_id"] == "SVC-CRM" and ci["kind"] == "host":
        ci["metrics"].pop("disk_pct", None)
        PINS["facts"]["crm_host_no_disk"] = ci["id"]
        break

# ---- Derived facts (health rollups, worst CPU, offline list) ---------------
def service_health(sid):
    members = [c for c in cis if c["service_id"] == sid]
    statuses = [c["metrics"].get("status") for c in members]
    if any(s == "down" for s in statuses) and sum(1 for s in statuses if s == "down") >= 2:
        return "down"
    if any(s in ("down", "degraded") for s in statuses):
        return "degraded"
    return "healthy"

derived = {"services": {}, "pins": PINS["facts"]}
for sid, sname, _ in SERVICES:
    members = [c for c in cis if c["service_id"] == sid]
    cpus = [(c["metrics"].get("cpu_pct"), c["id"]) for c in members if c["metrics"].get("cpu_pct") is not None]
    worst = max(cpus)[1] if cpus else None
    derived["services"][sid] = {
        "name": sname,
        "health": service_health(sid),
        "ci_count": len(members),
        "worst_cpu_ci": worst,
        "worst_cpu_val": round(max(cpus)[0], 1) if cpus else None,
    }

# ---- Write estate files ----------------------------------------------------
with open(os.path.join(HERE, "cis.json"), "w") as f:
    json.dump(cis, f, indent=2)
with open(os.path.join(HERE, "services.json"), "w") as f:
    json.dump(services, f, indent=2)
with open(os.path.join(HERE, "derived_facts.json"), "w") as f:
    json.dump(derived, f, indent=2)
with open(os.path.join(HERE, "service_aliases.csv"), "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["alias", "service_id", "service_name"])
    for sid, sname, aliases in SERVICES:
        for a in aliases:
            w.writerow([a, sid, sname])

# ---- Seed SQL (matches assumed CMDB spine; additive, namespaced) -----------
def sql_str(v):
    if v is None:
        return "NULL"
    if isinstance(v, str):
        return "'" + v.replace("'", "''") + "'"
    return str(v)

lines = ["-- SynthBank seed (SYNTHETIC ONLY). Generated by generate.py.",
         "-- Additive, namespaced tables. See schema.sql for DDL.", ""]
for sid, sname, _ in SERVICES:
    lines.append(f"INSERT INTO synth_cmdb_service (id, name) VALUES ('{sid}', {sql_str(sname)});")
lines.append("")
for sid, sname, aliases in SERVICES:
    for a in aliases:
        lines.append(f"INSERT INTO synth_cmdb_service_aliases (alias, service_id) VALUES ({sql_str(a)}, '{sid}');")
lines.append("")
for c in cis:
    lines.append(f"INSERT INTO synth_cmdb_ci (id, service_id, kind, hostname) VALUES "
                 f"('{c['id']}', '{c['service_id']}', '{c['kind']}', {sql_str(c['hostname'])});")
lines.append("")
for c in cis:
    for metric, val in c["metrics"].items():
        if metric == "status":
            continue
        # NULL metric rows are intentionally NOT inserted -> genuinely absent.
        if val is None:
            continue
        lines.append(f"INSERT INTO synth_ci_metric_sample (ci_id, metric, value) VALUES "
                     f"('{c['id']}', '{metric}', {val});")
lines.append("")
for c in cis:
    lines.append(f"UPDATE synth_cmdb_ci SET status = {sql_str(c['metrics'].get('status'))} WHERE id = '{c['id']}';")
with open(os.path.join(HERE, "seed.sql"), "w") as f:
    f.write("\n".join(lines) + "\n")

# ---- Prompt set (expected answers derived from estate) ---------------------
P = derived["pins"]
ib = derived["services"]["SVC-IB"]
tre = derived["services"]["SVC-TRE"]
prompts = []

def add(pid, persona, question, grounding, expect):
    prompts.append({
        "id": pid, "persona": persona, "question": question,
        "grounding": grounding,        # "grounded" | "honest_empty"
        "flag_expected": 0,
        "expect": expect,
    })

# --- Grounded: service health rollups ---
add("P001", "noc_operator", "What is the health of Internet Banking right now?",
    "grounded", {"must_include": ["Internet Banking", "degraded"]})
add("P002", "duty_manager", "Is Core Banking healthy?",
    "grounded", {"must_include": ["Core Banking"]})
add("P003", "service_owner", "Give me the status of the ATM Switch service.",
    "grounded", {"must_include": ["ATM Switch"]})
add("P004", "noc_operator", "How is Treasury doing?",
    "grounded", {"must_include": ["Treasury", "healthy"]})
add("P005", "executive", "Which services are currently degraded or down?",
    "grounded", {"must_include": ["Internet Banking"]})

# --- Grounded: specific CI metric lookups ---
add("P006", "noc_operator", f"What is the CPU on {P['ib_degraded_ci']}?",
    "grounded", {"must_include": [P["ib_degraded_ci"], "94"]})
add("P007", "noc_operator", f"Show me the response time for {P['ib_degraded_ci']}.",
    "grounded", {"must_include": [P["ib_degraded_ci"], "1850"]})

# --- Grounded: alias / synonym resolution (Layer 2) ---
add("P008", "service_owner", "How is net banking looking?",
    "grounded", {"must_include": ["Internet Banking"]})
add("P009", "noc_operator", "Any problems with UPI?",
    "grounded", {"must_include": ["Mobile & UPI"]})
add("P010", "duty_manager", "Status of the core?",
    "grounded", {"must_include": ["Core Banking"]})

# --- Honest-empty: genuinely offline CI (must NOT return a false zero) ---
add("P011", "noc_operator", f"What is the CPU on {P['atm_offline_ci']}?",
    "honest_empty", {"must_indicate_no_data": True,
                     "forbidden_values": ["0%", "0 %", "0.0", " 0 ", "cpu is 0"]})
add("P012", "noc_operator", f"What is the uptime of {P['atm_offline_ci']}?",
    "honest_empty", {"must_indicate_no_data": True,
                     "forbidden_values": ["0 s", "0s", "0 seconds"]})

# --- Honest-empty: metric a device does not report ---
add("P013", "service_owner", f"What is the disk usage on {P['crm_host_no_disk']}?",
    "honest_empty", {"must_indicate_no_data": True,
                     "forbidden_values": ["0%", "0 %"]})
# network devices don't report disk at all
net_ci = next(c["id"] for c in cis if c["kind"] == "network")
add("P014", "noc_operator", f"Show disk utilisation for {net_ci}.",
    "honest_empty", {"must_indicate_no_data": True,
                     "forbidden_values": ["0%", "0 %"]})

# --- Honest-empty: CI that does not exist ---
add("P015", "noc_operator", "What is the CPU on IB-APP-99?",
    "honest_empty", {"must_indicate_no_data": True,
                     "forbidden_values": ["0%", "0 %"]})

# --- Grounded: top-N / comparison ---
add("P016", "service_owner", "Which CI has the highest CPU in Internet Banking?",
    "grounded", {"must_include": [ib["worst_cpu_ci"]]})
add("P017", "executive", "How many configuration items make up Payments?",
    "grounded", {"must_include": ["Payments"]})

# --- Persona spread: same estate, different framing ---
add("P018", "executive", "Give me a one-line health summary across all banking services.",
    "grounded", {"must_include": ["Internet Banking"]})
add("P019", "duty_manager", "Anything I need to escalate on the ATM network?",
    "grounded", {"must_include": ["ATM Switch"]})
add("P020", "service_owner", "Is the Card Management service reporting normally?",
    "grounded", {"must_include": ["Card Management"]})

with open(os.path.join(PROMPTS, "prompt_set.jsonl"), "w") as f:
    for p in prompts:
        f.write(json.dumps(p) + "\n")

print(f"CIs: {len(cis)}  Services: {len(services)}  Prompts: {len(prompts)}")
print("Pins:", json.dumps(P))
print("Wrote: cis.json services.json derived_facts.json service_aliases.csv seed.sql "
      "../prompts/prompt_set.jsonl")
