// SynthBank P2 — the 5 scripted scenarios (source: POC_FIDELITY_PLAN.md Part 2,
// reconciled to the frozen t=0 pins per the P2 brief §CP-P2.1). Pure data: arcs,
// alerts, and the planted change. No wall-clock, no RNG — the generator derives
// every timestamp from a scenario base + offset, so re-seeding is byte-identical.
//
// Composition invariant (T-T0-CONTRADICTION): each arc's FIRST value equals the
// §3 t=0 pin for that CI/metric (the telemetry seed's frozen state).

export type ArcMetric =
  | 'cpu_saturation_pct'
  | 'memory_saturation_pct'
  | 'primary_saturation_pct'
  | 'latency_ms';

export interface Arc {
  ciExternalId: string;
  metric: ArcMetric;
  from: number; // MUST equal the t=0 pin value (composition)
  to: number;
}

export interface ScenarioAlert {
  ciExternalId: string;
  severity: 'info' | 'warning' | 'critical';
  hourOffset: number; // hours after the scenario start
  metric: string;
  message: string;
}

export interface ScenarioChange {
  ciExternalId: string;
  hourOffset: number; // BEFORE the first alert (the smoking gun)
  changeRef: string;
  changeType: string;
  summary: string;
  risk: 'low' | 'medium' | 'high' | 'critical';
  role: string | null;
}

export interface ScenarioDef {
  id: string; // 'scenario-1' …
  name: string;
  rootCiExternalId: string | null; // null for the security incident
  windowDayOffset: number; // which day after t0 this scenario sits on
  windowHours: number;
  arcs: Arc[];
  alerts: ScenarioAlert[];
  change: ScenarioChange | null;
  securityFeedGated: boolean;
}

/** Scenario windows are 6h, hourly points (7 points incl. both ends). */
export const SCENARIO_WINDOW_HOURS = 6;

export const SCENARIOS: ScenarioDef[] = [
  {
    id: 'scenario-1',
    name: 'Sponsor-link flap cascade',
    rootCiExternalId: 'CI-0005',
    windowDayOffset: 1,
    windowHours: SCENARIO_WINDOW_HOURS,
    // CI-0005 t=0 pin: latency 35ms, primary(bandwidth) 22. Climbs into a flap.
    arcs: [
      { ciExternalId: 'CI-0005', metric: 'latency_ms', from: 35, to: 180 },
      { ciExternalId: 'CI-0005', metric: 'primary_saturation_pct', from: 22, to: 70 },
    ],
    // The storm: the link degrades, then everything that depends on it alerts.
    alerts: [
      { ciExternalId: 'CI-0005', severity: 'critical', hourOffset: 2, metric: 'latency_ms', message: 'Sponsor Bank Link A latency breach (flapping)' },
      { ciExternalId: 'CI-0004', severity: 'critical', hourOffset: 3, metric: 'availability', message: 'UPI Switch 1 transaction failures (upstream link)' },
      { ciExternalId: 'CI-0008', severity: 'critical', hourOffset: 3, metric: 'availability', message: 'ATM Switch 1 interchange failures (upstream link)' },
      { ciExternalId: 'CI-0027', severity: 'warning', hourOffset: 3, metric: 'latency_ms', message: 'CTS System 1 clearing delays (upstream link)' },
      { ciExternalId: 'CI-0007', severity: 'critical', hourOffset: 4, metric: 'availability', message: 'Payment Gateway 1 settlement errors (upstream link)' },
      { ciExternalId: 'CI-0005', severity: 'critical', hourOffset: 4, metric: 'packet_loss_pct', message: 'Sponsor Bank Link A sustained packet loss' },
    ],
    change: null, // a flap, not a change
    securityFeedGated: false,
  },
  {
    id: 'scenario-2',
    name: 'EOD batch overrun',
    rootCiExternalId: 'CI-0002',
    windowDayOffset: 2,
    windowHours: SCENARIO_WINDOW_HOURS,
    // CI-0002 t=0 pin: conn 78, cpu 72, mem 81. EOD batch drives a breach.
    arcs: [
      { ciExternalId: 'CI-0002', metric: 'primary_saturation_pct', from: 78, to: 96 },
      { ciExternalId: 'CI-0002', metric: 'cpu_saturation_pct', from: 72, to: 90 },
      { ciExternalId: 'CI-0002', metric: 'memory_saturation_pct', from: 81, to: 93 },
    ],
    alerts: [
      { ciExternalId: 'CI-0002', severity: 'warning', hourOffset: 2, metric: 'primary_saturation_pct', message: 'CBS DB Node 1 connection saturation high' },
      { ciExternalId: 'CI-0002', severity: 'critical', hourOffset: 4, metric: 'primary_saturation_pct', message: 'CBS DB Node 1 connection pool near exhaustion' },
      { ciExternalId: 'CI-0025', severity: 'warning', hourOffset: 5, metric: 'latency_ms', message: 'Internet Banking Server 1 timeouts (CBS slow)' },
    ],
    // The smoking gun: a config change the prior evening, before the incident.
    change: {
      ciExternalId: 'CI-0002',
      hourOffset: 1, // after the benign baseline (h0), before the first alert (h2)
      changeRef: 'CHG-20260610-001',
      changeType: 'config',
      summary: 'CBS DB connection-pool / EOD batch window tuning (prior evening)',
      risk: 'medium',
      role: 'caused_by',
    },
    securityFeedGated: false,
  },
  {
    id: 'scenario-3',
    name: 'Branch failure (branch-local)',
    rootCiExternalId: 'CI-0093',
    windowDayOffset: 3,
    windowHours: SCENARIO_WINDOW_HOURS,
    // CI-0093 t=0 pin: latency 280, primary(bw) 85, already degraded. Goes down.
    arcs: [
      { ciExternalId: 'CI-0093', metric: 'latency_ms', from: 280, to: 1000 },
      { ciExternalId: 'CI-0093', metric: 'primary_saturation_pct', from: 85, to: 100 },
    ],
    // Branch-local only — NO estate-wide cascade (the §9.1 discrimination).
    alerts: [
      { ciExternalId: 'CI-0093', severity: 'warning', hourOffset: 1, metric: 'latency_ms', message: 'Branch Router BR-011 latency critical' },
      { ciExternalId: 'CI-0093', severity: 'critical', hourOffset: 3, metric: 'availability', message: 'Branch Router BR-011 unreachable (branch down)' },
    ],
    change: null,
    securityFeedGated: false,
  },
  {
    id: 'scenario-4',
    name: 'Cyber posture (failed-login + IPS)',
    rootCiExternalId: null, // a security incident, not a CI failure
    windowDayOffset: 4,
    windowHours: SCENARIO_WINDOW_HOURS,
    arcs: [], // not a Tier-A golden-signal arc; the signal is the alert stream
    alerts: [
      { ciExternalId: 'CI-0025', severity: 'warning', hourOffset: 1, metric: 'failed_login_rate', message: 'Internet Banking Server 1 failed-login spike' },
      { ciExternalId: 'CI-0025', severity: 'critical', hourOffset: 2, metric: 'failed_login_rate', message: 'Internet Banking Server 1 credential-stuffing pattern' },
      { ciExternalId: 'CI-0013', severity: 'critical', hourOffset: 2, metric: 'ips', message: 'Firewall Edge 1 IPS: brute-force signature' },
    ],
    change: null,
    securityFeedGated: true, // W8 reasoning gated on the deferred security feed
  },
  {
    id: 'scenario-5',
    name: 'Interface/integration degradation (CTS↔rail)',
    rootCiExternalId: 'CI-0027',
    windowDayOffset: 5,
    windowHours: SCENARIO_WINDOW_HOURS,
    // CI-0027 t=0 pin: latency 95. Interface degrades — scoped, not tier-1-wide.
    arcs: [{ ciExternalId: 'CI-0027', metric: 'latency_ms', from: 95, to: 400 }],
    alerts: [
      { ciExternalId: 'CI-0027', severity: 'warning', hourOffset: 2, metric: 'latency_ms', message: 'CTS System 1 clearing-interface latency high' },
      { ciExternalId: 'CI-0027', severity: 'critical', hourOffset: 4, metric: 'latency_ms', message: 'CTS System 1 clearing-interface degraded' },
    ],
    change: null,
    securityFeedGated: false,
  },
];
