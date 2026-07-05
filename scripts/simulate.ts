// ============================================================================
// HEADLESS PLAYTHROUGH SIMULATOR (Phase 5.3)
// ----------------------------------------------------------------------------
// Drives the SHARED game logic (src/market.ts + src/scoring.ts) through many
// scripted playthroughs with no rendering, so we can:
//   • tune the rank thresholds (Phase 3.3) against a real distribution, and
//   • regression-check the market model and the smart-vs-random gap (Phase 3.1).
// Run:  npx tsx scripts/simulate.ts        (used by CI, see .github/workflows)
//
// The farm-size table and base prices are mirrored from src/index.ts (which
// can't be imported — it boots the whole 3D world on load). Keep them in sync.
// ============================================================================
import { market } from "../src/market";
import {
  determineRank,
  revenueScore,
  s2AdaptabilityDelta,
  s3ExpandAdaptabilityDelta,
  holdAdaptabilityDelta,
  QUIZ_CORRECT_ADAPT,
  DIVERSIFY_HEALTH,
  DIVERSIFY_ADAPT,
  PROTECT_HEALTH,
  ALL_RANK_NAMES,
} from "../src/scoring";

const BASE_PRICE: Record<string, number> = { tobacco: 8, wheat: 4, corn: 3, cotton: 6 };
const BASE_YIELD: Record<string, number> = { tobacco: 3, wheat: 6, corn: 7, cotton: 4 };
const CROP_IDS = ["tobacco", "wheat", "corn", "cotton"];
const HEALTH_START = 50;
const ADAPT_START = 50;
const REVENUE_COINS_PER_PLOT = 65;
const FARM_SIZES = {
  small: { plotCap: 8, upkeep: 0, healthBonus: 10, expandCap: 12 },
  medium: { plotCap: 12, upkeep: 0, healthBonus: 0, expandCap: 16 },
  large: { plotCap: 16, upkeep: 3, healthBonus: 0, expandCap: 20 },
};
type SizeKey = keyof typeof FARM_SIZES;

const clamp = (v: number) => (v < 0 ? 0 : v > 100 ? 100 : v);
const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

// Season 2 up/down crop (matches index.ts eventUpCrop / eventDownCrop).
const upCropOf = (e: number) => (e === 0 ? "corn" : e === 1 ? "cotton" : null);
const downCropOf = (e: number) => (e === 2 ? "tobacco" : null);

interface Policy {
  // How the simulated student decides. "random" = uniform; "smart" = reads the
  // market (shift out of losers / hold in winners / predict correctly).
  kind: "random" | "smart" | "poor";
}

function randomMix(plotCap: number): Record<string, number> {
  // Spread plotCap plots across a random subset of crops.
  const count = 1 + Math.floor(Math.random() * 4); // 1..4 crops
  const crops = [...CROP_IDS].sort(() => Math.random() - 0.5).slice(0, count);
  const mix: Record<string, number> = {};
  for (const c of crops) mix[c] = 0;
  for (let i = 0; i < plotCap; i++) mix[pick(crops)]++;
  return mix;
}

function runOne(policy: Policy): { scores: any; rank: string; coins: number } {
  const sizeKey = pick(Object.keys(FARM_SIZES)) as SizeKey;
  const size = FARM_SIZES[sizeKey];
  const mix = randomMix(size.plotCap);
  const totalPlots = () => Object.values(mix).reduce((a, b) => a + b, 0);
  const shareOf = (id: string | null) => (id ? (mix[id] || 0) / totalPlots() : 0);

  // --- Season 1 prices (base swing + supply/demand from the mix) -------------
  market.reset();
  market.initSeason1(BASE_PRICE, BASE_YIELD);
  market.applySupplyDemand(mix, (id) => id);
  const s1Prices = { ...market.history[0].prices };

  let coins = 0;
  let adapt = ADAPT_START;
  let health = HEALTH_START + size.healthBonus;

  // --- Season 1 decision: sell now or hold for later -------------------------
  let sell: boolean;
  if (policy.kind === "smart") sell = false; // holding can pay off; smart holds to read the market
  else if (policy.kind === "poor") sell = Math.random() < 0.7;
  else sell = Math.random() < 0.5;
  if (sell) {
    for (const c of CROP_IDS) coins += (mix[c] || 0) * BASE_YIELD[c] * (s1Prices[c] || 0);
  }

  // --- Season 2 event + quiz + response --------------------------------------
  const e2 = Math.floor(Math.random() * 3);
  market.applySeason2Event(e2);
  coins -= size.upkeep;
  const up2 = upCropOf(e2), down2 = downCropOf(e2);
  // Quiz: smart predicts right; random 50/50; poor 35%.
  const q2 = policy.kind === "smart" ? true : Math.random() < (policy.kind === "poor" ? 0.35 : 0.5);
  if (q2) adapt += QUIZ_CORRECT_ADAPT;
  // Decision.
  let d2: "shift" | "doubledown" | "diversify";
  if (policy.kind === "smart") {
    // Shift out of a crop you're stuck in; ride a winner you already hold; else diversify.
    if (shareOf(down2) >= 0.34) d2 = "shift";
    else if (shareOf(up2) >= 0.34) d2 = "doubledown";
    else d2 = up2 ? "shift" : "diversify";
  } else if (policy.kind === "poor") {
    d2 = shareOf(down2) >= 0.34 ? "doubledown" : pick(["doubledown", "diversify"] as const);
  } else {
    d2 = pick(["shift", "doubledown", "diversify"] as const);
  }
  adapt += s2AdaptabilityDelta(d2, shareOf(down2), shareOf(up2), up2 !== null);
  if (d2 === "diversify") health += DIVERSIFY_HEALTH; // adapt part already in the delta

  // --- Season 3 event + quiz + response --------------------------------------
  const e3 = Math.floor(Math.random() * 2);
  const priceDelta = e3 === 1 ? 1 : -1;
  market.applySeason3Event(priceDelta);
  coins -= size.upkeep;
  const q3 = policy.kind === "smart" ? true : Math.random() < (policy.kind === "poor" ? 0.35 : 0.5);
  if (q3) adapt += QUIZ_CORRECT_ADAPT;
  // Decision: smart expands into a rising market, protects into a falling one.
  let d3: "expand" | "protect";
  if (policy.kind === "smart") d3 = priceDelta > 0 ? "expand" : "protect";
  else if (policy.kind === "poor") d3 = priceDelta > 0 ? "protect" : "expand";
  else d3 = pick(["expand", "protect"] as const);
  if (d3 === "expand") {
    adapt += s3ExpandAdaptabilityDelta(priceDelta > 0);
    // Hand out up to 3 extra plots (up to the expand cap), spread across crops.
    let add = 3;
    const grown = Object.keys(mix).filter((c) => mix[c] > 0);
    while (add > 0 && totalPlots() < size.expandCap && grown.length) {
      for (const c of grown) {
        if (add <= 0 || totalPlots() >= size.expandCap) break;
        mix[c]++;
        add--;
      }
    }
  } else {
    health += PROTECT_HEALTH;
  }

  // --- Final harvest + held-inventory resolution -----------------------------
  for (const c of CROP_IDS) coins += (mix[c] || 0) * (market.yields[c] || 0) * (market.prices[c] || 0);
  if (!sell) {
    // Held Season 1 plots sell now; compare to what Season 1 would have earned.
    let heldNow = 0, heldS1 = 0;
    for (const c of CROP_IDS) {
      // heldInventory reflects the ORIGINAL Season 1 mix (before any S3 expand).
      const s1Plots = Math.min(mix[c] || 0, s1Prices[c] !== undefined ? mix[c] || 0 : 0);
      heldNow += s1Plots * (market.yields[c] || 0) * (market.prices[c] || 0);
      heldS1 += s1Plots * (market.yields[c] || 0) * (s1Prices[c] || 0);
    }
    coins += heldNow;
    adapt += holdAdaptabilityDelta(heldNow - heldS1);
  }

  const scores = {
    revenue: revenueScore(Math.max(0, coins), size.plotCap, REVENUE_COINS_PER_PLOT),
    crophealth: clamp(health),
    adaptability: clamp(adapt),
  };
  return { scores, rank: determineRank(scores).name, coins };
}

function distribution(policy: Policy, n: number) {
  const counts: Record<string, number> = {};
  for (const r of ALL_RANK_NAMES) counts[r] = 0;
  let adaptSum = 0;
  for (let i = 0; i < n; i++) {
    const r = runOne(policy);
    counts[r.rank]++;
    adaptSum += r.scores.adaptability;
  }
  return { counts, avgAdapt: adaptSum / n };
}

// --- Run it -----------------------------------------------------------------
// Large N so the stochastic averages are stable enough for a CI gate.
const N = 8000;
const random = distribution({ kind: "random" }, N);
const smart = distribution({ kind: "smart" }, N);
const poor = distribution({ kind: "poor" }, N);

console.log(`\n=== Rank distribution over ${N} RANDOM playthroughs (Phase 3.3) ===`);
let ok = true;
for (const r of ALL_RANK_NAMES) {
  const pct = (random.counts[r] / N) * 100;
  const bar = "█".repeat(Math.round(pct / 2));
  const flag = pct < 5 ? "  ⚠ <5%" : pct > 45 ? "  ⚠ >45%" : "";
  if (pct < 5 || pct > 45) ok = false;
  console.log(`  ${r.padEnd(18)} ${pct.toFixed(1).padStart(5)}%  ${bar}${flag}`);
}
console.log(
  `\nAvg Adaptability — smart: ${smart.avgAdapt.toFixed(1)}  random: ${random.avgAdapt.toFixed(1)}  poor: ${poor.avgAdapt.toFixed(1)}`,
);
const gap = smart.avgAdapt - random.avgAdapt;
console.log(`Smart beats random on Adaptability by ${gap.toFixed(1)} (Phase 3.1 target: ≥20)`);
const smartSavvy = (smart.counts["Savvy Merchant"] / N) * 100;
console.log(`Smart players reaching "Savvy Merchant": ${smartSavvy.toFixed(1)}%`);

const gapOk = gap >= 20;
console.log(
  `\n${ok ? "✓" : "✗"} distribution balanced (every rank 5–45%)   ${gapOk ? "✓" : "✗"} smart–random gap ≥20`,
);
process.exit(ok && gapOk ? 0 : 1);
