#!/usr/bin/env python3
"""Generate synthbank-business-parameters.xlsx (ADR-005 / D15 economic-model fixture).

SYNTHETIC: every figure is a fabricated placeholder pending [verify]. Flat tidy
table — one row per parameter so the W2 tabular path yields one retrievable chunk
each. Confidence class (1 measured / 2 derived / 3 assumption-only) per ADR-005.

Run:  python3 _generate_business_parameters.py
"""
import os
from openpyxl import Workbook

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "synthbank-business-parameters.xlsx")

COLUMNS = ["category", "scope", "parameter", "value", "unit", "grounding_class", "verify", "notes"]

ROWS = [
    ["_disclaimer", "all", "synthetic_placeholder_notice", "ALL VALUES BELOW ARE SYNTHETIC PLACEHOLDERS", "n/a", "n/a", "verify",
     "SynthBank business-parameters fixture (ADR-005/D15). Every figure is fabricated and pending [verify] at pack-detail time. Reference data read by getEconomicModel; NOT telemetry. source=pack_default (label as default, never the bank's own number)."],

    # --- Class 1: per-service transaction-volume baseline (value-blocked input) ---
    ["txn_volume_baseline", "upi_imps", "peak_txns_per_hour", "48000", "txns/hour", "class_1", "verify", "Morning/evening UPI peak [verify]"],
    ["txn_volume_baseline", "upi_imps", "offpeak_txns_per_hour", "9000", "txns/hour", "class_1", "verify", "Off-peak UPI/IMPS [verify]"],
    ["txn_volume_baseline", "upi_imps", "avg_txn_value", "1850", "INR", "class_1", "verify", "Average UPI/IMPS ticket size [verify]"],
    ["txn_volume_baseline", "core_banking", "peak_txns_per_hour", "22000", "txns/hour", "class_1", "verify", "CBS postings incl. channels [verify]"],
    ["txn_volume_baseline", "atm_card_services", "peak_txns_per_hour", "6500", "txns/hour", "class_1", "verify", "ATM/card peak [verify]"],
    ["txn_volume_baseline", "atm_card_services", "avg_txn_value", "3200", "INR", "class_1", "verify", "ATM withdrawal avg [verify]"],
    ["txn_volume_baseline", "neft_rtgs", "peak_txns_per_hour", "3800", "txns/hour", "class_1", "verify", "NEFT batch + RTGS combined [verify]"],
    ["txn_volume_baseline", "neft_rtgs", "avg_txn_value", "145000", "INR", "class_1", "verify", "RTGS skews high [verify]"],

    # --- Class 1: customer / branch counts ---
    ["customer_counts", "bank_total", "total_customers", "420000", "customers", "class_1", "verify", "SynthBank total customer base [verify]"],
    ["customer_counts", "upi_imps", "active_customers", "265000", "customers", "class_1", "verify", "UPI-active subset [verify]"],
    ["customer_counts", "atm_card_services", "card_customers", "310000", "customers", "class_1", "verify", "Card-holding customers [verify]"],
    ["customer_counts", "branch_network", "branch_count", "50", "branches", "class_1", "verify", "Number of SynthBank branches [verify] — aligned to the 50-branch CMDB estate / POC_FIDELITY spec (was 43)"],
    ["customer_counts", "branch_network", "customers_per_branch_avg", "8400", "customers", "class_1", "verify", "Average across 50 branches (420000/50) [verify]"],
    ["customer_counts", "Branch-014", "branch_customers", "11500", "customers", "class_1", "verify", "Customers homed to Branch-014 (CMDB location) [verify]"],

    # --- Class 2: fee / interchange model (fee-income-at-risk input) ---
    ["fee_model", "upi_imps", "per_txn_fee_p2p", "0.00", "INR", "class_2", "verify", "UPI P2P MDR nil per regulation [verify]"],
    ["fee_model", "upi_imps", "per_txn_fee_merchant", "0.40", "INR", "class_2", "verify", "Synthetic merchant-leg fee assumption [verify]"],
    ["fee_model", "atm_card_services", "interchange_per_txn", "17.00", "INR", "class_2", "verify", "Off-us interchange assumption [verify]"],
    ["fee_model", "neft_rtgs", "per_txn_fee", "8.50", "INR", "class_2", "verify", "Synthetic per-txn fee [verify]"],

    # --- Class 2: SLA-penalty schedule (threshold -> penalty) ---
    ["sla_penalty_schedule", "tier_1_services", "threshold_band_1", "downtime > 30 min", "rule", "class_2", "verify", "Penalty band 1 trigger [verify]"],
    ["sla_penalty_schedule", "tier_1_services", "penalty_band_1", "50000", "INR", "class_2", "verify", "Synthetic penalty, tier-1 > 30 min [verify]"],
    ["sla_penalty_schedule", "tier_1_services", "threshold_band_2", "downtime > 60 min", "rule", "class_2", "verify", "Penalty band 2 trigger [verify]"],
    ["sla_penalty_schedule", "tier_1_services", "penalty_band_2", "150000", "INR", "class_2", "verify", "Synthetic penalty, tier-1 > 60 min [verify]"],
    ["sla_penalty_schedule", "upi_imps", "reportable_condition", "success_rate < threshold sustained", "rule", "class_2", "verify", "RBI success-rate reportable condition [verify] — ties to RCA-4"],

    # --- Class 2: cost-of-downtime model ---
    ["cost_of_downtime", "noc", "handling_cost_per_hour", "12000", "INR/hour", "class_2", "verify", "NOC effort during an incident [verify]"],
    ["cost_of_downtime", "escalation", "escalation_cost_per_incident", "25000", "INR", "class_2", "verify", "Bridge/escalation overhead [verify]"],
    ["cost_of_downtime", "vendor", "vendor_callout_cost", "40000", "INR", "class_2", "verify", "Sponsor/vendor SLA call-out [verify]"],

    # --- Class 3: retention assumption (NEVER a measured figure) ---
    ["retention_assumption", "tier_1_services", "attrition_risk_per_hour", "0.5", "percent_per_hour", "class_3", "verify",
     "ASSUMPTION ONLY — 0.5% attrition risk per hour of tier-1 downtime. Class-3 behavioural estimate per ADR-005; presented only with this assumption visible, never as a measured retention rate. Data-driven version deferred."],

    # --- economicModelCapabilities metadata (ADR-005 shape) ---
    ["model_metadata", "model", "source", "pack_default", "flag", "n/a", "verify", "ADR-005 economicModelCapabilities.source — pack_default (synthetic), label as default not bank-supplied"],
    ["model_metadata", "model", "currency", "INR", "flag", "n/a", "verify", "All monetary values INR"],
    ["model_metadata", "model", "hasRetentionModel", "assumption_based", "flag", "n/a", "verify", "Class-3 assumption_based; data_driven deferred per ADR-005"],
]


def main():
    wb = Workbook()
    ws = wb.active
    ws.title = "business_parameters"
    ws.append(COLUMNS)
    for r in ROWS:
        ws.append(r)
    wb.save(OUT)
    print(f"wrote {OUT}  ({len(ROWS)} data rows -> ~{len(ROWS)} chunks expected via tabular path)")


if __name__ == "__main__":
    main()
