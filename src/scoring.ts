// ============================================================================
// SCORING MODEL — the pure, tunable heart of how a playthrough is scored.
// ----------------------------------------------------------------------------
// This module has NO rendering and NO game state; it is plain functions of
// numbers. That lets the game (src/index.ts) and the headless rank-balancing
// harness (scripts/simulate.ts, Phase 5.3) share ONE source of truth, so the
// simulator can never drift from the real scoring. Phase 3.3 tunes the rank
// thresholds here against the harness's distribution.
// ============================================================================

export interface Scores {
  revenue: number;
  crophealth: number;
  adaptability: number;
}
export interface Rank {
  name: string;
  desc: string;
}

// ----------------------------------------------------------------------------
// SCORE DELTAS — the exact amounts each decision moves a score. Named here so
// the game handlers and the harness apply identical values.
// ----------------------------------------------------------------------------
export const QUIZ_CORRECT_ADAPT = 8; // a correct market prediction
export const DIVERSIFY_HEALTH = 10; // spreading plots keeps the field healthy
export const DIVERSIFY_ADAPT = 2; // ...and is a mild, sensible hedge
export const PROTECT_HEALTH = 15; // investing in the soil in Season 3

// s2AdaptabilityDelta(): how a Season 2 response scores, given the student's
// position — the share (0..1) of their plots in the crop whose price FELL
// (downShare) and the crop whose price ROSE (upShare). Outcome, not label.
export function s2AdaptabilityDelta(
  decision: "shift" | "doubledown" | "diversify",
  downShare: number,
  upShare: number,
  hasUpCrop: boolean,
): number {
  if (decision === "shift") {
    // Smart when there was a real reason to move: heavy in the crashing crop,
    // or barely in the rising one. Otherwise it's a needless shuffle.
    const needed = downShare >= 0.34 || (hasUpCrop && upShare < 0.2);
    return needed ? 16 : 3;
  }
  if (decision === "doubledown") {
    if (downShare >= 0.34) return -15; // clinging to the falling crop
    if (upShare >= 0.34) return 8; // riding a genuine winner
    return 0; // a fine, steady plan — no read either way
  }
  return DIVERSIFY_ADAPT; // diversify
}

// s3ExpandAdaptabilityDelta(): expanding into a rising market reads it right;
// into a falling one, a misread. (The coins themselves flow to Revenue.)
export function s3ExpandAdaptabilityDelta(priceRose: boolean): number {
  return priceRose ? 9 : -12;
}

// holdAdaptabilityDelta(): the payoff of holding Season 1 crops, judged only at
// resolution by the coin difference vs selling in Season 1. Never punish hard.
export function holdAdaptabilityDelta(coinDiff: number): number {
  if (coinDiff > 0) return 12;
  if (coinDiff < 0) return -6;
  return 0;
}

// ----------------------------------------------------------------------------
// REVENUE SCORE (Phase 3.2) — the 0..100 Revenue meter, derived from actual
// coins and normalized per plot so every farm size can reach the top.
// ----------------------------------------------------------------------------
export function revenueScore(
  coins: number,
  plotCap: number,
  coinsPerPlotForMax: number,
): number {
  const capacity = plotCap * coinsPerPlotForMax;
  const pct = capacity > 0 ? (coins / capacity) * 100 : 0;
  return clamp(Math.round(pct), 0, 100);
}

// ----------------------------------------------------------------------------
// RANKS (Phase 3.3) — the five play-style ranks, in priority order. Tuned so a
// broad random population spreads across all five (every rank ≥5%, none >45%).
// Thresholds are the tuning knobs; see scripts/simulate.ts for the distribution.
// ----------------------------------------------------------------------------
export const RANK_THRESHOLDS = {
  savvyAdapt: 72, // Savvy Merchant: adaptable AND profitable
  savvyRevenue: 58,
  steadyHealth: 66, // Steady Farmer: healthy crops AND decent earnings
  steadyRevenue: 45,
  boldRevenue: 78, // Bold Speculator: an all-in revenue win
  learningBelow: 34, // Learning the Land: any score dipped low
};

export function determineRank(s: Scores): Rank {
  const t = RANK_THRESHOLDS;
  if (s.adaptability >= t.savvyAdapt && s.revenue >= t.savvyRevenue) {
    return {
      name: "Savvy Merchant",
      desc: "You watched the market and changed your plan at just the right time. 🧠",
    };
  }
  if (s.crophealth >= t.steadyHealth && s.revenue >= t.steadyRevenue) {
    return {
      name: "Steady Farmer",
      desc: "You kept your crops healthy and earned steady coins all year. 🌾",
    };
  }
  if (s.revenue >= t.boldRevenue) {
    return {
      name: "Bold Speculator",
      desc: "You went for the big win and bet boldly when prices swung. Daring! 🎲",
    };
  }
  if (
    s.revenue < t.learningBelow ||
    s.crophealth < t.learningBelow ||
    s.adaptability < t.learningBelow
  ) {
    return {
      name: "Learning the Land",
      desc: "Tough year? Every great farmer grows from one. You'll be back! 🌱",
    };
  }
  // Everything in the sensible middle is a balanced, cautious run.
  return {
    name: "Cautious Grower",
    desc: "You made balanced choices and stayed clear of big risks. 🛡️",
  };
}

export const ALL_RANK_NAMES = [
  "Savvy Merchant",
  "Steady Farmer",
  "Bold Speculator",
  "Cautious Grower",
  "Learning the Land",
];

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
