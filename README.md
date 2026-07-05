# Market Harvest — Virginia's Agricultural Economy (Module 4)

An immersive WebXR learning game for 5th graders (VA SOL USI.8a + economics),
built with [IWSDK](https://github.com/meta-quest/immersive-web-sdk). The student
runs a 1750s Virginia farm across three seasons — choosing a farm size, planting
crops, tending them, and reacting to market events — to learn how supply, demand,
and prices work. Target runtime: 30–35 minutes.

Plays in the browser and in a headset (WebXR). Deployed to GitHub Pages.

## Running it

```bash
npm install
npm run dev        # start the IWSDK dev server (browser + WebXR emulator)
npm run build      # production build (also compiles ui/*.uikitml -> public/ui/*.json)
```

## Testing

```bash
npm run typecheck  # tsc --noEmit
npm run simulate   # headless playthrough simulator (rank distribution + smart-vs-random gap)
npm test           # typecheck + simulate (this is what CI runs)
```

CI (`.github/workflows/ci.yml`) type-checks and runs the simulator on every push
and PR; the simulator exits non-zero if the rank distribution or the smart-vs-
random gap regresses. Deploys run from `.github/workflows/deploy.yml`.

## Architecture

- **`src/index.ts`** — the game: World.create, the ECS/3D world, the phase
  manager (`showPhase`/`nextPhase`), all interactions, HUD, and the report.
- **`src/market.ts`** — the single source of truth for crop prices & yields. One
  continuous price series across all three seasons (Season 2 continues from
  Season 1; Season 3 stacks on top), plus supply-and-demand from the student's
  planting mix and a per-season history used for the hold-vs-sell counterfactual.
- **`src/scoring.ts`** — pure, tunable score/rank logic (rank thresholds, the
  coins→revenue mapping, and the per-decision adaptability deltas). Shared by the
  game **and** the simulator so they can never drift.
- **`src/environment.ts`** — scenery (sky, terrain, farmhouse, fence, stall,
  Samuel, crop plants). The fence is rebuildable to match the chosen farm size.
- **`src/sfx.ts`** — synthesized sound effects.
- **`scripts/simulate.ts`** — the headless rank-balancing / regression harness.
- **`ui/*.uikitml`** — panel markup, compiled to `public/ui/*.json` at build.

## Course integration

On completion the game dispatches an `onSimulationComplete` `CustomEvent` **and**
`postMessage`s the same payload to `window.parent` (for the Rise iframe shell).
The payload (`schemaVersion` 1) includes the three scores, the play-style rank,
coins, farm size, market-prediction results, a season-by-season `yearInReview`,
and per-phase durations. Progress is autosaved to `localStorage`, and the title
screen offers **Resume** after an accidental refresh.
