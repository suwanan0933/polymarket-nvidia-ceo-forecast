// polymarket-nvidia-ceo-forecast-01 — improved forecaster (Node 22, standard library only)
// Strategy: persistence center + per-market realized volatility spread
//   q_tau(h) = clamp(x + z_tau * sigma_m * sqrt(h), 0, 1), rounded to 6 decimals
// where sigma_m is the per-market realized vol (std of 1-min price changes)
// over the last N minutes of the case's price history.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const QUANTILES = [0.05, 0.25, 0.5, 0.75, 0.95];
const Z = [-1.644854, -0.67449, 0, 0.67449, 1.644854];

// How many trailing minutes to use for realized-vol estimation.
const LOOKBACK_MINUTES = 120;
// Min number of price changes needed to compute sigma; otherwise fall back to global default.
const MIN_CHANGES = 10;
// Global fallback sigma (baseline's value).
const FALLBACK_SIGMA = 0.0025;
// Clamp sigma to [MIN_SIGMA, MAX_SIGMA] so it can't go absurd.
const MIN_SIGMA = 0.0005;
const MAX_SIGMA = 0.01;

interface CaseMarket {
  id: string;
  prices: number[];
}

interface Case {
  horizon_minutes: number;
  quantiles: number[];
  markets: CaseMarket[];
}

const price6 = (x: number): number => Math.round(Math.min(1, Math.max(0, x)) * 1e6) / 1e6 + 0;

function mean(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function stdDev(xs: number[]): number {
  const m = mean(xs);
  let s = 0;
  for (const x of xs) {
    const d = x - m;
    s += d * d;
  }
  return Math.sqrt(s / xs.length);
}

/** Per-market realized sigma from trailing absolute 1-minute price changes. */
function marketSigma(m: CaseMarket): number {
  const prices = m.prices;
  if (prices.length < 2) return FALLBACK_SIGMA;
  const start = Math.max(0, prices.length - LOOKBACK_MINUTES - 1);
  const changes: number[] = [];
  for (let i = start + 1; i < prices.length; i++) {
    changes.push(Math.abs(prices[i] - prices[i - 1]));
  }
  if (changes.length < MIN_CHANGES) return FALLBACK_SIGMA;
  const s = stdDev(changes);
  if (!isFinite(s) || s <= 0) return FALLBACK_SIGMA;
  return Math.min(MAX_SIGMA, Math.max(MIN_SIGMA, s));
}

function forecast(m: CaseMarket, horizon: number): number[][] {
  if (m.prices.length === 0) throw new Error(`market ${m.id} has no prices`);
  const x = m.prices[m.prices.length - 1] as number;
  const sigma = marketSigma(m);
  const rows: number[][] = [];
  for (let h = 1; h <= horizon; h++) {
    const spread = sigma * Math.sqrt(h);
    rows.push(Z.map((z) => price6(x + z * spread)));
  }
  return rows;
}

mkdirSync(OUTPUT_DIR, { recursive: true });
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  if (c.quantiles.length !== QUANTILES.length || c.quantiles.some((t, j) => t !== QUANTILES[j])) {
    throw new Error(`${file} asks for quantiles ${JSON.stringify(c.quantiles)}, not ${JSON.stringify(QUANTILES)}`);
  }
  const forecasts = c.markets.map((m) => ({ id: m.id, q: forecast(m, c.horizon_minutes) }));
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ forecasts })}\n`);
}
