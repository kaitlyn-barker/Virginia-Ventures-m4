// ============================================================================
// MARKET MODEL — one source of truth for crop prices & yields (Phase 1.2)
// ----------------------------------------------------------------------------
// Before this module, prices lived in three disconnected places: Season 1's
// random walk (`currentPrices`), Season 2's reset-to-base `activePrices`, and
// Season 3's ±1 stack on top. Because Season 2 reset to base, it THREW AWAY the
// Season 1 prices — so a student who chose "Hold for Later" in Season 1 saw
// their crops re-priced from scratch, with no continuity to what they held at.
//
// This module fixes that: there is ONE `prices` object and ONE `yields` object,
// carried forward across all three seasons.
//   • Season 1 seeds each crop's price = base ± a small random swing.
//   • Season 2 CONTINUES from those prices and applies the event delta on top
//     (it no longer resets to base).
//   • Season 3 stacks its ±1 event on top of that.
// Every price sign in the game reads from the same `market.prices`, and every
// change is recorded in `history` (and logged) so the series is inspectable.
//
// Keys are lowercase crop ids ("tobacco", "wheat", "corn", "cotton") — the same
// ids used everywhere else, so nothing has to translate between name and id.
// ============================================================================

export type CropTable = Record<string, number>;

// One recorded snapshot of the market at the end of a season.
export interface PriceSnapshot {
  season: string;
  prices: CropTable;
  yields: CropTable;
}

class Market {
  // The live, continuous crop prices and yields the rest of the game reads.
  prices: CropTable = {};
  yields: CropTable = {};

  // The untouched base values (from CONSTANTS), handed in at Season 1 start so
  // event math and ▲/▼ arrows can always compare against "normal".
  private basePrices: CropTable = {};
  private baseYields: CropTable = {};

  // One entry per season, so the full price series per crop is inspectable.
  history: PriceSnapshot[] = [];

  // A one-line, student-facing explanation of the biggest supply-and-demand
  // effect the student's own planting mix caused this year (Phase 2.2). Empty
  // when the mix was balanced enough that nothing moved. Shown on the price sign.
  supplyHeadline = "";

  // initSeason1(): remember the base tables, then roll each crop's starting
  // price as base ± a small (-2..+2) random swing. Yields start at base. This
  // runs for EVERY crop in the base tables (not just the ones the student
  // planted) so later seasons' price signs are continuous for all four crops.
  initSeason1(basePrices: CropTable, baseYields: CropTable): void {
    this.basePrices = { ...basePrices };
    this.baseYields = { ...baseYields };
    this.prices = {};
    this.yields = { ...baseYields };
    for (const id in basePrices) {
      const swing = Math.floor(Math.random() * 5) - 2; // -2, -1, 0, +1, or +2
      this.prices[id] = Math.max(1, basePrices[id] + swing);
    }
    this.record("Season 1");
  }

  // applySupplyDemand(playerPlots, nameOf): the student's OWN planting mix moves
  // the market (Phase 2.2). Other Virginia farmers follow the same trends, so a
  // crop the student over-planted is oversupplied colony-wide and its price
  // falls; a crop nobody grew is scarce and its price rises. Magnitudes are kept
  // small (±1..2) so the scripted Season 2/3 events remain the dominant story.
  // Runs once, right after initSeason1, and folds into the Season 1 price the
  // student actually sees and sells at (so history[0] stays truthful).
  //   playerPlots: crop id -> plots the student planted
  //   nameOf:      crop id -> friendly display name (for the explanation line)
  applySupplyDemand(
    playerPlots: CropTable,
    nameOf: (id: string) => string,
  ): void {
    let total = 0;
    for (const id in playerPlots) total += playerPlots[id] || 0;
    if (total < 1) total = 1; // avoid divide-by-zero if nothing was planted

    this.supplyHeadline = "";
    let biggestDelta = 0; // remember the largest swing for the headline
    for (const id in this.prices) {
      const share = (playerPlots[id] || 0) / total;
      let delta = 0;
      let why = "";
      if (share >= 0.5) {
        delta = -2; // more than half the farm -> heavy oversupply
        why = `Many farmers grew ${nameOf(id)} this year — supply is high, so its price fell.`;
      } else if (share >= 0.34) {
        delta = -1; // a big share -> mild oversupply
        why = `A lot of ${nameOf(id)} was grown this year — supply is up, so its price dipped.`;
      } else if (share === 0) {
        delta = 1; // nobody grew it -> scarce
        why = `Hardly anyone grew ${nameOf(id)} — it's scarce, so its price rose.`;
      }
      if (delta !== 0) {
        this.prices[id] = Math.max(1, this.prices[id] + delta);
        // Keep the biggest single effect as the sign's one-line explanation,
        // preferring price DROPS (the core "if everyone grows it, price falls").
        if (Math.abs(delta) > Math.abs(biggestDelta) || (delta < 0 && biggestDelta > 0)) {
          biggestDelta = delta;
          this.supplyHeadline = why;
        }
      }
    }
    this.clampFloor();
    // Fold the supply effect into the Season 1 snapshot so history[0] reflects
    // the price the student truly sold/held at (used later for hold-vs-sell).
    if (this.history.length) {
      this.history[this.history.length - 1].prices = { ...this.prices };
    }
    console.log(
      `[market] supply/demand from planting mix: ${JSON.stringify(this.prices)} | ${this.supplyHeadline || "(balanced mix, no swing)"}`,
    );
  }

  // applySeason2Event(): CONTINUE from the Season 1 prices (do NOT reset to
  // base) and apply just the one event that was rolled. Yields reset to base
  // first because only the drought changes a yield, and it should not compound.
  //   0 = Summer Drought:      corn scarce -> price +3, corn yield halved
  //   1 = Cotton Demand Surge: cotton price +4
  //   2 = Tobacco Oversupply:  tobacco price -3
  applySeason2Event(eventIndex: number): void {
    this.yields = { ...this.baseYields };
    if (eventIndex === 0) {
      this.prices.corn = (this.prices.corn ?? 0) + 3;
      this.yields.corn = Math.round(this.baseYields.corn / 2);
    } else if (eventIndex === 1) {
      this.prices.cotton = (this.prices.cotton ?? 0) + 4;
    } else if (eventIndex === 2) {
      this.prices.tobacco = Math.max(1, (this.prices.tobacco ?? 0) - 3);
    }
    this.clampFloor();
    this.record("Season 2");
  }

  // applySeason3Event(): nudge EVERY crop price by the event's delta, stacking
  // on top of whatever Season 2 left in place (never below 1 coin).
  applySeason3Event(priceDelta: number): void {
    for (const id in this.prices) {
      this.prices[id] = Math.max(1, this.prices[id] + priceDelta);
    }
    this.record("Season 3");
  }

  // The crop's normal (pre-swing, pre-event) base price — used for ▲/▼ arrows.
  basePrice(id: string): number {
    return this.basePrices[id] ?? 0;
  }

  // reset(): wipe everything for a fresh playthrough (Play Again). initSeason1()
  // rebuilds prices/yields, but we clear history here so it never accumulates
  // across replays.
  reset(): void {
    this.prices = {};
    this.yields = {};
    this.history = [];
    this.supplyHeadline = "";
  }

  // No crop is ever worth less than 1 coin.
  private clampFloor(): void {
    for (const id in this.prices) {
      if (this.prices[id] < 1) this.prices[id] = 1;
    }
  }

  // Snapshot the current prices/yields and log the full per-crop series so the
  // continuous price history is visible in the console.
  private record(season: string): void {
    this.history.push({
      season,
      prices: { ...this.prices },
      yields: { ...this.yields },
    });
    const series: Record<string, number[]> = {};
    for (const snap of this.history) {
      for (const id in snap.prices) {
        (series[id] ||= []).push(snap.prices[id]);
      }
    }
    console.log(
      `[market] ${season} prices: ${JSON.stringify(this.prices)} | ` +
        `series so far: ${JSON.stringify(series)}`,
    );
  }
}

// A single shared instance the whole game reads and writes.
export const market = new Market();
