// ============================================================================
// Market Harvest: Virginia's Agricultural Economy
// ----------------------------------------------------------------------------
// Clean starting scaffold built on top of IWSDK (Immersive Web SDK).
// This file:
//   1. Defines game CONSTANTS (tweakable numbers in one place).
//   2. Boots the IWSDK world + WebXR session (the core IWSDK setup).
//   3. Sets up the farm scene: sky color, ground, farmhouse, crop field,
//      fence, dirt path, and Samuel's market stall (all visual scenery).
// No game logic lives here yet — this is just the foundation to build on.
// ============================================================================

import {
  World,
  SessionMode,
  // Three.js building blocks (always import these from @iwsdk/core, never "three")
  Color,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial, // lit version for scenery boxes (responds to the sun)
  AssetType, // declares the GLB models preloaded in World.create({ assets })
  PlaneGeometry,
  BoxGeometry, // a simple 3D box shape; used for buildings, crop plots, fence posts
  CylinderGeometry, // a tube/disc shape; used for sign posts and pointer cones
  Group, // an empty container for assembling multi-part props (the scoreboard)
  SphereGeometry, // a ball shape; used for Samuel's head
  Vector3, // a 3D point in space; used to measure how far the player is from Samuel
  CanvasTexture, // wraps an HTML <canvas> so we can draw text and use it as a texture
  DoubleSide, // makes a flat plane visible from both front and back
  SRGBColorSpace, // keeps canvas-drawn colors looking correct in the 3D scene
  // Spatial UI panel
  PanelUI,
  PanelDocument, // internal component holding a panel's loaded UI document
  Interactable,
  RayInteractable, // marks a plain 3D mesh as clickable by mouse/controller rays
  Pressed, // transient tag the InputSystem adds while a ray is clicking an entity
  // Floor that the player can stand/walk on
  LocomotionEnvironment,
  EnvironmentType,
  VisibilityState, // tells us browser (non-immersive) vs in-headset (XR) mode
} from "@iwsdk/core";

// The visual world (sky, lighting, terrain, farmhouse, stall, trees, Samuel's
// body, and the little crop plant models) lives in its own module so this file
// can stay focused on game logic. See src/environment.ts.
import {
  buildEnvironment,
  buildSamuel,
  makeCropPlant,
  getFurrowTexture,
  setSeasonLook, // retints sky/sun/grass/trees so each season looks different
} from "./environment";

// Synthesized sound effects (no audio files needed). See src/sfx.ts.
import {
  sfxClick,
  sfxPlant,
  sfxCoin,
  sfxDown,
  sfxSeason,
  sfxFanfare,
  sfxNotify,
} from "./sfx";

// ============================================================================
// CONSTANTS
// ----------------------------------------------------------------------------
// All of the game's tunable numbers live here in one plain object so they are
// easy to find and adjust. Nothing below reads these yet — that comes later
// when we add game logic.
// ============================================================================
const CONSTANTS = {
  // Score starting values
  FARM_REVENUE_START: 50,
  CROP_HEALTH_START: 50,
  MARKET_ADAPTABILITY_START: 50,
  SCORE_MAX: 100,
  SCORE_MIN: 0,

  // Crop base prices (coins per unit)
  PRICE_TOBACCO: 8,
  PRICE_WHEAT: 4,
  PRICE_CORN: 3,
  PRICE_COTTON: 6,

  // Crop yield multipliers (units harvested per plot)
  YIELD_TOBACCO: 3,
  YIELD_WHEAT: 6,
  YIELD_CORN: 7,
  YIELD_COTTON: 4,

  // Crop risk scores (higher = more volatile price swings)
  RISK_TOBACCO: 3,
  RISK_WHEAT: 1,
  RISK_CORN: 1,
  RISK_COTTON: 2,

  // NPC name
  NPC_NAME: "Samuel",
};

// Market event is randomized at runtime — 0=Drought, 1=Cotton surge, 2=Tobacco oversupply
const SEASON2_EVENT = Math.floor(Math.random() * 3);

// ============================================================================
// CROP DATA (for the setup / crop-selection screen)
// ----------------------------------------------------------------------------
// One entry per crop the student can plant. We build this list FROM the
// CONSTANTS object above so that prices and risk scores live in exactly one
// place. The `id` matches the element ids used in ui/setup.uikitml
// (e.g. id "tobacco" -> card "card-tobacco", price text "price-tobacco", ...).
// ============================================================================
const CROPS = [
  {
    id: "tobacco",
    name: "Tobacco",
    description:
      "High reward, high risk. England loves it, but so does everyone else.",
    price: CONSTANTS.PRICE_TOBACCO,
    risk: CONSTANTS.RISK_TOBACCO,
  },
  {
    id: "wheat",
    name: "Wheat",
    description: "Steady and safe. Lower price, but reliable.",
    price: CONSTANTS.PRICE_WHEAT,
    risk: CONSTANTS.RISK_WHEAT,
  },
  {
    id: "corn",
    name: "Corn",
    description: "High yield, low price. Good for feeding your workers.",
    price: CONSTANTS.PRICE_CORN,
    risk: CONSTANTS.RISK_CORN,
  },
  {
    id: "cotton",
    name: "Cotton",
    description: "Growing demand from England. Risky but promising.",
    price: CONSTANTS.PRICE_COTTON,
    risk: CONSTANTS.RISK_COTTON,
  },
];

// Turn a numeric risk score from CONSTANTS into a friendly label.
// (RISK constants: 1 = Low, 2 = Medium, 3 = High.)
function riskLabel(risk: number): string {
  if (risk === 1) return "Low";
  if (risk === 2) return "Medium";
  return "High";
}

// The crops the student has tapped/selected on the setup screen. Starts empty.
// Later phases (the growing seasons) will read this list to know what was planted.
let selectedCrops: string[] = [];

// One entry per planted plot, in the order plots were filled. Built when the
// student confirms their planting in the 3D setup phase (see the seed-bag code
// near the bottom of the file). Later phases can read this to know the layout.
let plantingRecord: { cropType: string }[] = [];

// Reusable color strings so the same value isn't retyped in several places.
const COLOR_NAVY = "#1F3A5F"; // default border + active button text
const COLOR_GOLD = "#c8962a"; // SELECTED card border + active button background
const COLOR_DISABLED_BG = "#c9c2b5"; // grayed-out button background
const COLOR_DISABLED_TEXT = "#7a7a7a"; // grayed-out button label

// High-contrast TEXT variants (WCAG AA on cream/white backgrounds). The bright
// brand colors above stay for graphics — bars, buttons, borders — but words on
// light backgrounds use these darker versions (all ≥ 4.5:1 against cream):
const TEXT_GOLD = "#8a6118"; // readable gold (the bright gold is only ~2.6:1)
const TEXT_GREEN = "#2e7d32"; // readable green
const TEXT_BLUE = "#1e5fa8"; // readable blue

// ============================================================================
// SCORING SYSTEM
// ----------------------------------------------------------------------------
// Three running scores track how the student's farm is doing. They run as a
// quiet background calculation for the WHOLE experience: every choice the
// student makes nudges one (or more) of them up or down via updateScore().
//
//   scoreRevenue       - money / profitability of the farm
//   scoreCropHealth    - how healthy the crops/soil are
//   scoreAdaptability  - how well the student reacts to the market
//
// Each one starts at its matching value from the CONSTANTS block above, and is
// always kept inside the SCORE_MIN..SCORE_MAX range (0..100).
// ============================================================================
let scoreRevenue = CONSTANTS.FARM_REVENUE_START; // starts at 50
let scoreCropHealth = CONSTANTS.CROP_HEALTH_START; // starts at 50
let scoreAdaptability = CONSTANTS.MARKET_ADAPTABILITY_START; // starts at 50

// clampScore(value): keep a score from going above SCORE_MAX or below SCORE_MIN.
// Beginner note: "clamp" just means "pin a number inside a min..max range".
function clampScore(value: number): number {
  if (value > CONSTANTS.SCORE_MAX) return CONSTANTS.SCORE_MAX; // cap at the top (100)
  if (value < CONSTANTS.SCORE_MIN) return CONSTANTS.SCORE_MIN; // floor at the bottom (0)
  return value;
}

// updateScore(meter, delta): the single way to change a score.
//   meter - which score to change: 'revenue', 'crophealth', or 'adaptability'
//   delta - how much to change it by (positive rewards, negative penalizes)
// It clamps the new value, stores it back in the right variable, logs the
// change, and refreshes the on-screen HUD so the number updates immediately.
function updateScore(meter: string, delta: number) {
  let before: number; // the score before the change (for the log line)
  let after: number; // the score after clamping (the new value)

  // Figure out WHICH of the three scores this call is about, then update it.
  if (meter === "revenue") {
    before = scoreRevenue;
    after = clampScore(scoreRevenue + delta);
    scoreRevenue = after;
  } else if (meter === "crophealth") {
    before = scoreCropHealth;
    after = clampScore(scoreCropHealth + delta);
    scoreCropHealth = after;
  } else if (meter === "adaptability") {
    before = scoreAdaptability;
    after = clampScore(scoreAdaptability + delta);
    scoreAdaptability = after;
  } else {
    // A typo in the meter name shouldn't silently create a phantom score.
    console.warn("updateScore: unknown meter '" + meter + "'");
    return;
  }

  // Log the change in a consistent format, e.g. "[SCORE] revenue: 50 -> 60".
  console.log("[SCORE] " + meter + ": " + before + " -> " + after);

  // Push the new numbers to the visible HUD panel (defined just below).
  refreshHUD();

  // Pop the number that changed, and let the world react too (the 3D
  // scoreboard, floating "+10" popups, and a coin/down sound). The hook is
  // assigned once the world exists.
  if (meter === "revenue") bumpHudValue(hudRevenueValue);
  else if (meter === "crophealth") bumpHudValue(hudHealthValue);
  else bumpHudValue(hudAdaptabilityValue);
  if (onScoreChange) onScoreChange(meter, delta);
}

// Assigned inside the world setup: spawns the floating score popup, refreshes
// the world-space scoreboard, and plays a sound. Null until the world exists.
let onScoreChange: ((meter: string, delta: number) => void) | null = null;

// ============================================================================
// SCORE HUD (heads-up display)
// ----------------------------------------------------------------------------
// A small panel pinned to the upper-left corner of the screen that ALWAYS shows
// the three current scores. We build it as a plain HTML overlay sitting on top
// of the 3D canvas, so it stays put no matter where the player looks.
//
// Colors (matching the rest of the experience):
//   cream  #f3e9d2  panel background
//   navy   #1F3A5F  the labels ("Farm Revenue:", ...)
//   gold   #c8962a  the score numbers
// ============================================================================

// We hold on to the live elements so refreshHUD() can update them quickly,
// without rebuilding the whole panel each time. Each meter keeps its number
// AND its colored fill bar.
let hudRevenueValue: HTMLElement | null = null;
let hudHealthValue: HTMLElement | null = null;
let hudAdaptabilityValue: HTMLElement | null = null;
let hudRevenueFill: HTMLElement | null = null;
let hudHealthFill: HTMLElement | null = null;
let hudAdaptabilityFill: HTMLElement | null = null;
let hudCoinsValue: HTMLElement | null = null;
let hudSeasonChip: HTMLElement | null = null;
let hudObjectiveValue: HTMLElement | null = null;

// makeHudMeter(icon, label, barColor, textColor): one meter row —
// "🪙 Farm Coins [▓▓▓░░] 50". The bar keeps the bright brand color (it's a
// graphic); the number uses the darker high-contrast text variant.
function makeHudMeter(
  icon: string,
  label: string,
  barColor: string,
  textColor: string,
): { row: HTMLElement; value: HTMLElement; fill: HTMLElement } {
  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.alignItems = "center";
  row.style.gap = "8px";
  row.style.marginBottom = "7px";

  const labelEl = document.createElement("span");
  labelEl.textContent = icon + " " + label;
  labelEl.style.color = "#1F3A5F";
  labelEl.style.fontWeight = "700";
  labelEl.style.width = "118px";
  labelEl.style.whiteSpace = "nowrap";

  // The meter track + its colored fill (width set from the score by refreshHUD).
  const track = document.createElement("div");
  track.style.width = "90px";
  track.style.height = "12px";
  track.style.background = "#e4ddd0";
  track.style.borderRadius = "6px";
  track.style.overflow = "hidden";
  track.style.flexShrink = "0";

  const fill = document.createElement("div");
  fill.style.height = "100%";
  fill.style.width = "50%";
  fill.style.background = barColor;
  fill.style.borderRadius = "6px";
  fill.style.transition = "width 0.45s ease"; // bars glide to new values
  track.appendChild(fill);

  const value = document.createElement("span");
  value.style.color = textColor;
  value.style.fontWeight = "800";
  value.style.minWidth = "26px";
  value.style.textAlign = "right";
  value.style.transition = "transform 0.18s ease";

  row.appendChild(labelEl);
  row.appendChild(track);
  row.appendChild(value);
  return { row, value, fill };
}

// createHUD(): build the panel once and drop it into the page. Called a single
// time at startup (just below).
function createHUD() {
  const hud = document.createElement("div");
  hud.style.position = "fixed";
  hud.style.top = "16px";
  hud.style.left = "16px";
  hud.style.zIndex = "1000";
  hud.style.background = "rgba(255, 252, 244, 0.95)";
  hud.style.padding = "12px 16px 10px";
  hud.style.borderRadius = "14px";
  hud.style.border = "2px solid #1F3A5F";
  hud.style.fontFamily = "system-ui, sans-serif";
  hud.style.fontSize = "14px";
  hud.style.boxShadow = "0 4px 14px rgba(31, 58, 95, 0.3)";
  hud.style.pointerEvents = "none"; // display-only; never blocks clicks

  // Header row: the game name + a little season chip.
  const header = document.createElement("div");
  header.style.display = "flex";
  header.style.alignItems = "center";
  header.style.justifyContent = "space-between";
  header.style.gap = "12px";
  header.style.marginBottom = "8px";

  const title = document.createElement("span");
  title.textContent = "🌾 My Farm";
  title.style.color = "#1F3A5F";
  title.style.fontWeight = "800";
  title.style.fontSize = "15px";

  hudSeasonChip = document.createElement("span");
  hudSeasonChip.textContent = "Getting Ready";
  hudSeasonChip.style.background = TEXT_GREEN; // dark enough for white text
  hudSeasonChip.style.color = "#ffffff";
  hudSeasonChip.style.fontWeight = "700";
  hudSeasonChip.style.fontSize = "12px";
  hudSeasonChip.style.padding = "2px 10px";
  hudSeasonChip.style.borderRadius = "10px";

  header.appendChild(title);
  header.appendChild(hudSeasonChip);
  hud.appendChild(header);

  // The three meters. (Friendly names; same three scores as always.)
  const revenueRow = makeHudMeter("🪙", "Farm Coins", "#c8962a", TEXT_GOLD);
  const healthRow = makeHudMeter("🌱", "Crop Health", "#5fae4a", TEXT_GREEN);
  const adaptabilityRow = makeHudMeter("🧠", "Market Smarts", "#4a8fd6", TEXT_BLUE);

  hudRevenueValue = revenueRow.value;
  hudHealthValue = healthRow.value;
  hudAdaptabilityValue = adaptabilityRow.value;
  hudRevenueFill = revenueRow.fill;
  hudHealthFill = healthRow.fill;
  hudAdaptabilityFill = adaptabilityRow.fill;

  hud.appendChild(revenueRow.row);
  hud.appendChild(healthRow.row);
  hud.appendChild(adaptabilityRow.row);

  // Coins-earned line at the bottom.
  const coinsRow = document.createElement("div");
  coinsRow.style.borderTop = "1px solid #e4ddd0";
  coinsRow.style.paddingTop = "6px";
  coinsRow.style.display = "flex";
  coinsRow.style.justifyContent = "space-between";
  const coinsLabel = document.createElement("span");
  coinsLabel.textContent = "💰 Coins earned";
  coinsLabel.style.color = "#1F3A5F";
  coinsLabel.style.fontWeight = "700";
  hudCoinsValue = document.createElement("span");
  hudCoinsValue.textContent = "0";
  hudCoinsValue.style.color = TEXT_GOLD;
  hudCoinsValue.style.fontWeight = "800";
  coinsRow.appendChild(coinsLabel);
  coinsRow.appendChild(hudCoinsValue);
  hud.appendChild(coinsRow);

  // Objective row: a gold pill telling the student what to do RIGHT NOW.
  // setObjective() updates it at every step of the game.
  hudObjectiveValue = document.createElement("div");
  hudObjectiveValue.textContent = "";
  hudObjectiveValue.style.marginTop = "8px";
  hudObjectiveValue.style.background = TEXT_GOLD; // dark amber: white text reads
  hudObjectiveValue.style.color = "#ffffff";
  hudObjectiveValue.style.fontWeight = "800";
  hudObjectiveValue.style.fontSize = "13px";
  hudObjectiveValue.style.padding = "6px 10px";
  hudObjectiveValue.style.borderRadius = "10px";
  hudObjectiveValue.style.maxWidth = "260px";
  hudObjectiveValue.style.display = "none"; // hidden until the first objective
  hud.appendChild(hudObjectiveValue);

  document.body.appendChild(hud);

  // Fill in the starting numbers right away.
  refreshHUD();
}

// ============================================================================
// OBJECTIVE TRACKER
// ----------------------------------------------------------------------------
// One short line that always tells the student their CURRENT goal ("Walk to
// Samuel's stall — he has news!"). It shows in the HUD's gold pill and on the
// world-space scoreboard (which is what headset players see).
// ============================================================================
let currentObjective = "";
let scoreboardSeasonLabel = "Getting Ready"; // drawn on the world scoreboard

function setObjective(text: string) {
  currentObjective = text;
  if (hudObjectiveValue) {
    hudObjectiveValue.textContent = "👉 " + text;
    hudObjectiveValue.style.display = text ? "block" : "none";
    // A quick pop so the change catches the eye.
    hudObjectiveValue.style.transform = "scale(1.08)";
    setTimeout(() => {
      if (hudObjectiveValue) hudObjectiveValue.style.transform = "scale(1)";
    }, 180);
  }
  if (onObjectiveChange) onObjectiveChange(); // redraw the world scoreboard
  console.log("[OBJECTIVE] " + text);
}

// Assigned inside the world setup (it redraws the 3D scoreboard).
let onObjectiveChange: (() => void) | null = null;

// bumpHudValue(): a quick "pop" animation on a number that just changed.
function bumpHudValue(el: HTMLElement | null) {
  if (!el) return;
  el.style.transform = "scale(1.45)";
  setTimeout(() => {
    el.style.transform = "scale(1)";
  }, 200);
}

// refreshHUD(): copy the three current scores (numbers AND bar widths) plus the
// coin total into the HUD. updateScore() calls this every time a score changes,
// so the panel always shows live values. Safe to call before createHUD() runs.
function refreshHUD() {
  if (hudRevenueValue) hudRevenueValue.textContent = String(scoreRevenue);
  if (hudHealthValue) hudHealthValue.textContent = String(scoreCropHealth);
  if (hudAdaptabilityValue) {
    hudAdaptabilityValue.textContent = String(scoreAdaptability);
  }
  if (hudRevenueFill) hudRevenueFill.style.width = scoreRevenue + "%";
  if (hudHealthFill) hudHealthFill.style.width = scoreCropHealth + "%";
  if (hudAdaptabilityFill) {
    hudAdaptabilityFill.style.width = scoreAdaptability + "%";
  }
  if (hudCoinsValue) hudCoinsValue.textContent = String(farmRevenue);
  if (onHudRefresh) onHudRefresh(); // keep the 3D scoreboard in sync too
}

// Assigned inside the world setup: redraws the world-space scoreboard whenever
// the HUD refreshes. Null until the world exists.
let onHudRefresh: (() => void) | null = null;

// setHudSeason(phase): update the little season chip in the HUD header (and
// remember the label so the world scoreboard can draw it too).
function setHudSeason(phase: string) {
  const labels: Record<string, string> = {
    setup: "Getting Ready",
    season1: "Season 1 of 3",
    season2: "Season 2 of 3",
    season3: "Season 3 of 3",
    report: "Year Report!",
  };
  scoreboardSeasonLabel = labels[phase] || phase;
  if (hudSeasonChip) hudSeasonChip.textContent = scoreboardSeasonLabel;
}

// NOTE: createHUD() is called a little further down (right after the Season 1
// state block) because refreshHUD() reads `farmRevenue`, which is declared
// there — calling it earlier would crash on the not-yet-initialized variable.

// ============================================================================
// SEASON 1 STATE
// ----------------------------------------------------------------------------
// Plain variables that remember what the student has done on the Season 1
// screen. They live here at the top level so later phases can read them too.
// ============================================================================
let season1Beat = 1; // which of the 3 beats is showing (1, 2, or 3)
let season1Decision: "sell" | "hold" | null = null; // the student's final choice
let farmRevenue = 0; // total coins earned from selling crops (starts at 0)

// How many plots of each crop the student planted (crop name -> plot count).
const plotCounts: Record<string, number> = {};
// The market price rolled for each crop on entering Beat 3 (crop name -> price).
const marketPrices: Record<string, number> = {};
// Crops kept back instead of sold, if the student chooses "Hold for Later".
// Typed loosely as any[] because the new world-space Season 1 stores a plain
// copy of plantingRecord here ([...plantingRecord]), while older code stored
// richer { crop, units, price } objects. Starts empty.
let heldInventory: any[] = [];

// The market price rolled for each PLANTED crop when Season 1's market opens.
// Keyed by crop id, e.g. { tobacco: 9, corn: 2 }. Filled in startSeason1Market().
let currentPrices: Record<string, number> = {};

// Yield-per-plot for each crop, pulled from CONSTANTS and keyed by crop name so
// we can look it up from the selectedCrops list (which stores names).
const YIELD_BY_NAME: Record<string, number> = {
  Tobacco: CONSTANTS.YIELD_TOBACCO,
  Wheat: CONSTANTS.YIELD_WHEAT,
  Corn: CONSTANTS.YIELD_CORN,
  Cotton: CONSTANTS.YIELD_COTTON,
};
// Find a crop's full data object (name, price, ...) from its name.
function getCropByName(name: string) {
  return CROPS.find((crop) => crop.name === name);
}

// The Season 1 panel registers this hook so it can (re)build its Beat 1 content
// the moment the student actually enters Season 1 (crops aren't chosen yet when
// the panel is first created at startup).
let onEnterSeason1: (() => void) | null = null;

// Build the HUD now that every variable it reads exists.
createHUD();

// ============================================================================
// SEASON 2 STATE — THE MARKET EVENT
// ----------------------------------------------------------------------------
// Season 2 is the big disruption: a random market event shakes up prices and
// yields, and the student has to react. All of the moving parts for that screen
// live here so later phases (and the panel wiring below) can read them.
// ============================================================================

// Which event happened this playthrough. SEASON2_EVENT was rolled once at the
// top of the file (0 = Drought, 1 = Cotton surge, 2 = Tobacco oversupply).
let season2Event = SEASON2_EVENT;

// The student's reaction to the event: 'shift', 'doubledown', or 'diversify'.
// Stays null until they tap one of the three choice buttons in Beat 2.
let season2Decision: "shift" | "doubledown" | "diversify" | null = null;

// The crop prices AFTER the event's effect is applied. Keyed by lowercase crop
// id (matching the ids in the CROPS list) so other code can look a price up by
// crop. Filled in by applySeason2Event() when the student reaches Season 2.
let activePrices: Record<string, number> = {
  tobacco: 0,
  wheat: 0,
  corn: 0,
  cotton: 0,
};

// The crop yields AFTER the event's effect (only the drought changes a yield,
// but we keep all four here so the data stays in one predictable shape).
let activeYields: Record<string, number> = {
  tobacco: 0,
  wheat: 0,
  corn: 0,
  cotton: 0,
};

// One entry per possible market event. The index matches SEASON2_EVENT, so
// SEASON2_EVENTS[season2Event] is "the event that happened". Each entry holds
// every piece of text the Season 2 screen needs, plus which crop is affected.
const SEASON2_EVENTS = [
  {
    // Event 0 — Drought. SUPPLY lesson: the drought halves how much corn
    // exists, and because corn is now SCARCE its price goes UP.
    name: "Summer Drought",
    crop: "Corn", // crop name, matches the CROPS list
    // The big headline shown on the report card.
    headline:
      "A summer drought has hit Virginia. Corn is scarce — there is only half as much as usual.",
    // Samuel's spoken line in Beat 1.
    samuel:
      "Bad news, friend. A fierce drought dried the fields. 🌞 There's only HALF the usual corn this year.",
    // Plain-language summary of the price/yield change for the report card.
    change:
      "Corn yields are cut in half — but scarce corn sells for MORE, so its price rises by 3 coins.",
  },
  {
    // Event 1 — Cotton Demand Surge
    name: "Cotton Demand Surge",
    crop: "Cotton",
    headline:
      "England has opened new textile mills. Demand for Virginia cotton has surged.",
    samuel:
      "Word from the docks - England cannot get enough cotton. Ships are waiting. This is your moment if you planted it.",
    change: "Cotton price rises by 4 coins this season.",
  },
  {
    // Event 2 — Tobacco Oversupply
    name: "Tobacco Oversupply",
    crop: "Tobacco",
    headline:
      "Too many Virginia farmers grew tobacco this year. The market is flooded.",
    samuel:
      "I'll be straight with you. Everyone and their neighbor grew tobacco this year. The price has fallen hard.",
    change: "Tobacco price drops by 3 coins this season.",
  },
];

// applySeason2Event(): start every crop from its base price/yield (in CONSTANTS)
// then apply the effect of whichever event was rolled. Runs once when the
// student enters Season 2. After this, activePrices/activeYields hold the
// "this season" numbers that the rest of Season 2 should use.
function applySeason2Event() {
  // 1. Reset to the unmodified base values from CONSTANTS.
  activePrices = {
    tobacco: CONSTANTS.PRICE_TOBACCO,
    wheat: CONSTANTS.PRICE_WHEAT,
    corn: CONSTANTS.PRICE_CORN,
    cotton: CONSTANTS.PRICE_COTTON,
  };
  activeYields = {
    tobacco: CONSTANTS.YIELD_TOBACCO,
    wheat: CONSTANTS.YIELD_WHEAT,
    corn: CONSTANTS.YIELD_CORN,
    cotton: CONSTANTS.YIELD_COTTON,
  };

  // 2. Apply just the one effect that matches this playthrough's event.
  if (season2Event === 0) {
    // Drought: only half as much corn exists (yield halved) — and because
    // corn is now SCARCE, each unit sells for MORE (+3 coins). That's the
    // supply half of supply-and-demand.
    activePrices.corn = activePrices.corn + 3;
    activeYields.corn = Math.round(activeYields.corn / 2);
  } else if (season2Event === 1) {
    // Cotton demand surge: cotton is worth 4 coins more.
    activePrices.cotton = activePrices.cotton + 4;
  } else if (season2Event === 2) {
    // Tobacco oversupply: tobacco is worth 3 coins less.
    activePrices.tobacco = Math.max(1, activePrices.tobacco - 3);
  }

  console.log(
    "Season 2 event applied (" +
      SEASON2_EVENTS[season2Event].name +
      "). Active prices: " +
      JSON.stringify(activePrices),
  );
}

// The Season 2 panel registers this hook so it can rebuild its content the
// moment the student actually enters Season 2 (the event and the student's
// Season 1 portfolio aren't known when the panel is first created at startup).
let onEnterSeason2: (() => void) | null = null;

// ============================================================================
// SAMUEL'S MARKET QUESTIONS (the supply & demand quiz)
// ----------------------------------------------------------------------------
// After Samuel shares each season's news, he asks the student to PREDICT what
// the news does to prices — the heart of how markets work. One entry per
// Season 2 event (indexed by season2Event) and per Season 3 event.
//   up:    the correct answer ("will prices go UP?")
//   right / wrong: Samuel's explanation either way (the lesson itself).
// ============================================================================
const S2_QUIZ = [
  {
    // Drought — SUPPLY falls, so price rises.
    question: "🤔 The drought means LESS corn for sale. Will CORN prices go UP or DOWN?",
    up: true,
    right:
      "Right! 🌽 When there's LESS of a crop for sale, each one is worth MORE. Scarce things cost more — check the price board!",
    wrong:
      "Good try! It's the opposite: when there's LESS corn for sale, buyers compete for it — so corn's price goes UP. 📈 Check the board!",
  },
  {
    // Cotton surge — DEMAND rises, so price rises.
    question: "🤔 England suddenly wants LOTS more cotton. Will COTTON prices go UP or DOWN?",
    up: true,
    right:
      "Right! ☁️ When MORE buyers want a crop, they'll pay more for it — so the price goes UP. Check the price board!",
    wrong:
      "Good try! When MORE buyers want a crop, they'll pay more to get it — so cotton's price goes UP. 📈 Check the board!",
  },
  {
    // Tobacco oversupply — SUPPLY floods, so price falls.
    question: "🤔 Everyone grew tobacco — there's WAY too much for sale. Will TOBACCO prices go UP or DOWN?",
    up: false,
    right:
      "Right! 🌿 When there's TOO MUCH of a crop for sale, sellers must drop their prices to find buyers. Check the board!",
    wrong:
      "Good try! With TOO MUCH tobacco for sale, sellers had to lower prices to find buyers — tobacco went DOWN. 📉 Check the board!",
  },
];

const S3_QUIZ = [
  {
    // New competition — MORE sellers, so prices fall.
    question: "🤔 Another colony now sells the SAME crops as Virginia. Will crop prices go UP or DOWN?",
    up: false,
    right:
      "Right! 🛶 More sellers competing means buyers can shop around — so prices go DOWN. Check the price board!",
    wrong:
      "Good try! With MORE sellers of the same crops, buyers can shop around — so prices go DOWN. 📉 Check the board!",
  },
  {
    // New trade route — MORE buyers, so prices rise.
    question: "🤔 A new trade route brings MANY more buyers. Will crop prices go UP or DOWN?",
    up: true,
    right:
      "Right! ⛵ More buyers wanting Virginia's goods means prices go UP. Check the price board!",
    wrong:
      "Good try! With MORE buyers wanting our goods, prices go UP. 📈 Check the board!",
  },
];

// ============================================================================
// SEASON 3 STATE — THE FINAL COMPETITIVE CHALLENGE
// ----------------------------------------------------------------------------
// Season 3 is the last season before the results. A second piece of news from
// Samuel shifts every crop price one more time, then the student makes one
// final strategy decision and the year's harvest is tallied up.
// ============================================================================

// The two possible Season 3 events. We roll a random one when the student
// enters the phase (see onEnterSeason3 below) and remember which one happened.
//   priceDelta is how much EVERY crop's current price changes:
//     Event A — New competition: prices fall  (-1 coin each)
//     Event B — New trade route: prices rise   (+1 coin each)
const SEASON3_EVENTS = [
  {
    // Event A — prices drop because a rival colony floods the market.
    name: "New competition",
    samuel:
      "A colony to the south has started exporting the same crops as Virginia. Prices across the board are under pressure.",
    priceDelta: -1, // every crop loses 1 coin
    effect: "All crop prices drop by 1 coin this season.",
  },
  {
    // Event B — prices rise because a new trade route boosts demand.
    name: "New trade route",
    samuel:
      "A new trade route has opened to the Caribbean. Demand for Virginia goods just got stronger.",
    priceDelta: 1, // every crop gains 1 coin
    effect: "All crop prices rise by 1 coin this season.",
  },
];

// Which Season 3 event happened (index into SEASON3_EVENTS). It's re-rolled
// every time the phase loads, so we just start it at 0 here.
let season3Event = 0;

// The student's final strategy choice: 'expand', 'protect', or null until they
// tap one of the two option buttons in Beat 2.
let season3Decision: "expand" | "protect" | null = null;

// applySeason3Event(): nudge EVERY current crop price by the event's delta.
// Unlike Season 2, we do NOT reset to base prices first — Season 3 builds on
// top of whatever Season 2 left in activePrices, so the price swings stack.
function applySeason3Event() {
  const delta = SEASON3_EVENTS[season3Event].priceDelta;
  for (const id in activePrices) {
    // Apply the change, but never let a crop fall below 1 coin.
    activePrices[id] = Math.max(1, activePrices[id] + delta);
  }
  console.log(
    "Season 3 event applied (" +
      SEASON3_EVENTS[season3Event].name +
      "). Active prices: " +
      JSON.stringify(activePrices),
  );
}

// The Season 3 panel registers this hook so it can rebuild its content the
// moment the student actually enters Season 3 (the event is rolled fresh here,
// and the student's portfolio isn't final until they arrive).
let onEnterSeason3: (() => void) | null = null;

// ============================================================================
// REPORT STATE — THE FINAL RESULTS SCREEN
// ----------------------------------------------------------------------------
// The Market Report is the last phase. It reads the three running scores and
// the saved season decisions to show the student how their year turned out.
// ============================================================================

// The play-style "rank" the student earned (e.g. "Savvy Merchant"). It's worked
// out from the final scores when the report appears, and is also handed to the
// surrounding course in the onSimulationComplete event. Empty until then.
let currentRank = "";

// The report panel registers this hook so it can fill in the final numbers,
// animate its score bars, and fire the completion event the moment the student
// actually reaches the report (by which time all scores are final).
let onEnterReport: (() => void) | null = null;

// ============================================================================
// PHASE MANAGER
// ----------------------------------------------------------------------------
// The experience is split into "phases" — basically the screens a student
// moves through: a setup screen, three growing seasons, then a final report.
// The phase manager is the single source of truth for WHICH screen is showing,
// and it guarantees that exactly one phase panel is visible at a time.
//
// No panels exist yet — we build those in later steps. For now this is just the
// bookkeeping (which phase are we on?) and the two helper functions that switch
// between phases.
// ============================================================================

// One constant per phase. Using named constants instead of typing the raw
// strings ("season1", etc.) everywhere means a typo becomes an obvious error
// the editor can catch, rather than a silent bug.
const PHASE_SETUP = "setup";
const PHASE_SEASON1 = "season1";
const PHASE_SEASON2 = "season2";
const PHASE_SEASON3 = "season3";
const PHASE_REPORT = "report";

// The order the phases run in. nextPhase() walks down this list to figure out
// what comes after the current phase.
const PHASE_ORDER = [
  PHASE_SETUP,
  PHASE_SEASON1,
  PHASE_SEASON2,
  PHASE_SEASON3,
  PHASE_REPORT,
];

// Tracks which phase the student is on right now. We always start at setup.
let currentPhase = PHASE_SETUP;

// A lookup table mapping a phase name -> that phase's panel entity. It's empty
// for now; later steps will register each panel here (e.g. phasePanels[PHASE_SETUP] = ...)
// so that showPhase() can find the right panel to show or hide.
const phasePanels: Record<string, any> = {};

// showPhase(phase): switch the visible screen to the given phase.
function showPhase(phase: string) {
  // 1. Remember the phase we're switching to.
  currentPhase = phase;

  // 2. Hide every panel we know about. (Looping over phasePanels does nothing
  //    yet because it's empty, but it'll hide all panels once they're added.)
  for (const key in phasePanels) {
    const panel = phasePanels[key];
    if (panel && panel.object3D) {
      panel.object3D.visible = false;
    }
  }

  // 3. NOTE: we deliberately do NOT show the matching flat panel here. Every
  //    phase now plays out in the 3D world (the crop board, corkboards, the
  //    notice board...), and the old flat panels are kept loaded only so the
  //    season wiring inside them keeps running. Un-hiding one — which this
  //    step used to do — made the abandoned "Plan Your Farm" panel pop up
  //    over the farm whenever Play Again returned to the setup phase.

  // 4. If we just switched INTO Season 1, let that panel rebuild its content
  //    now that we finally know which crops the student chose.
  if (phase === PHASE_SEASON1 && onEnterSeason1) {
    onEnterSeason1();
  }

  // 4b. Same idea for Season 2: rebuild its content now that we know both the
  //     market event and what the student planted in Season 1.
  if (phase === PHASE_SEASON2 && onEnterSeason2) {
    onEnterSeason2();
  }

  // 4c. Same idea for Season 3: roll the final event and rebuild its content
  //     now that we know the student's portfolio and current prices.
  if (phase === PHASE_SEASON3 && onEnterSeason3) {
    onEnterSeason3();
  }

  // 4d. Report: now that every score is final, fill in the results, grow the
  //     score bars, and announce that the simulation is complete.
  if (phase === PHASE_REPORT && onEnterReport) {
    onEnterReport();
  }

  // 5. Keep the HUD's season chip in sync, and let the world show its big
  //    season banner (the hook is assigned once the world exists).
  setHudSeason(phase);
  if (onPhaseBanner) onPhaseBanner(phase);

  // 6. Log the change so we can follow phase transitions in the browser console.
  console.log("Phase: " + phase);
}

// Assigned inside the world setup: shows a big floating "Season 1!" style
// banner over the farm whenever the phase changes. Null until the world exists.
let onPhaseBanner: ((phase: string) => void) | null = null;

// nextPhase(): advance one step in PHASE_ORDER (setup -> season1 -> season2 ->
// season3 -> report). If we're already on the last phase, we stay there.
function nextPhase() {
  const index = PHASE_ORDER.indexOf(currentPhase);
  const isLast = index === PHASE_ORDER.length - 1;
  // Pick the next phase if there is one, otherwise keep the current phase.
  const next = isLast ? currentPhase : PHASE_ORDER[index + 1];
  showPhase(next);
}

// ============================================================================
// WORLD + WEBXR BOOTSTRAP (core IWSDK setup — leave intact)
// ----------------------------------------------------------------------------
// World.create() builds the 3D world, wires up the renderer, and offers the
// WebXR session. The returned promise resolves with the `world` once it's ready.
// ============================================================================
World.create(document.getElementById("scene-container") as HTMLDivElement, {
  assets: {
    // Stylized models from Meta's asset library (downloaded into
    // public/gltf/market/). environment.ts places them with auto-scaling.
    treeModel: {
      url: "./gltf/market/stylized-tree.glb",
      type: AssetType.GLTF,
      priority: "critical",
    },
    windmillModel: {
      url: "./gltf/market/windmill.glb",
      type: AssetType.GLTF,
      priority: "critical",
    },
  },
  xr: {
    sessionMode: SessionMode.ImmersiveVR,
    offer: "always",
    // Optional (not required): the emulator/runtime can still grant an XR
    // session when these aren't available, and they're used if present.
    features: { handTracking: { required: false }, layers: { required: false } },
  },
  features: {
    locomotion: {
      useWorker: true, // lets the player move; needs a LocomotionEnvironment (our ground below)
      // Enable browser navigation: WASD / arrow keys to walk, Space to jump.
      // (Turning the view is app-controlled — the keyboard bindings only move
      // world.player along the camera's forward direction.)
      browserControls: true,
    },
    grabbing: true,
    physics: true,
    sceneUnderstanding: false,
    environmentRaycast: false,
  },
}).then((world) => {
  const { scene, camera } = world;

  // --------------------------------------------------------------------------
  // Camera: stand the viewer a little back and at roughly eye height so the
  // title panel (placed ahead at -Z) is comfortably in view on load.
  // --------------------------------------------------------------------------
  camera.position.set(0, 1.6, 2);

  // --------------------------------------------------------------------------
  // BROWSER MOUSE-DRAG LOOK
  // --------------------------------------------------------------------------
  // In the browser (non-immersive) there is no headset to aim the view, so we let
  // the player click-and-drag on the canvas to rotate the camera, like a typical
  // 3D web viewer. Keyboard locomotion (WASD / arrow keys, enabled via
  // features.locomotion.browserControls) then moves the player along whatever
  // direction the camera is facing. In XR this is skipped entirely — there the
  // headset owns the camera pose.
  //
  // CONTROL SPLIT (so look never steals a click or a grab):
  //   - LEFT button  -> interaction only: click UI buttons, and click-drag a
  //                     seed bag onto a plot to plant it.
  //   - RIGHT button -> drag to look around (rotate the camera).
  // Because look is bound to the RIGHT button, a left press/drag is left
  // completely alone for the framework's pointer handling (panel clicks + the
  // grab handle). Pitch is clamped so the player can't flip upside-down.
  // --------------------------------------------------------------------------
  const lookContainer = document.getElementById(
    "scene-container",
  ) as HTMLDivElement;
  const LOOK_BUTTON = 2; // right mouse button
  let lookDragging = false; // is the right button currently held for looking?
  let lookHasLooked = false; // has the player ever looked? (gates the camera write)
  let lookLastX = 0; // last pointer position while actively dragging
  let lookLastY = 0;
  let lookYaw = 0; // accumulated left/right rotation, in radians
  let lookPitch = 0; // accumulated up/down rotation, in radians
  const LOOK_SENSITIVITY = 0.0025; // radians of rotation per pixel dragged
  const LOOK_PITCH_LIMIT = 1.4; // ~80 deg up/down, so the view never flips over

  // Suppress the browser context menu so right-drag-to-look feels clean.
  lookContainer.addEventListener("contextmenu", (e) => e.preventDefault());

  lookContainer.addEventListener("pointerdown", (e) => {
    if (e.button !== LOOK_BUTTON) return; // left button stays for click/grab
    lookDragging = true;
    lookHasLooked = true;
    lookLastX = e.clientX;
    lookLastY = e.clientY;
    lookContainer.style.cursor = "grabbing";
  });
  // Move/up are on window so a drag that slips off the canvas still tracks.
  window.addEventListener("pointermove", (e) => {
    if (!lookDragging) return;
    const dx = e.clientX - lookLastX;
    const dy = e.clientY - lookLastY;
    lookLastX = e.clientX;
    lookLastY = e.clientY;
    lookYaw -= dx * LOOK_SENSITIVITY; // drag right -> look right
    lookPitch -= dy * LOOK_SENSITIVITY; // drag down  -> look down
    // Clamp pitch so the player can't somersault the camera.
    if (lookPitch > LOOK_PITCH_LIMIT) lookPitch = LOOK_PITCH_LIMIT;
    if (lookPitch < -LOOK_PITCH_LIMIT) lookPitch = -LOOK_PITCH_LIMIT;
  });
  window.addEventListener("pointerup", (e) => {
    if (e.button !== LOOK_BUTTON) return;
    lookDragging = false;
    lookContainer.style.cursor = "";
  });

  // Re-apply the look rotation every frame — but ONLY once the player has
  // actually looked, and ONLY in browser (non-immersive) mode so we never fight
  // the headset's own camera pose in XR. Until the first look, the camera is left
  // entirely alone.
  function browserLookLoop() {
    if (
      lookHasLooked &&
      world.visibilityState.peek() === VisibilityState.NonImmersive
    ) {
      camera.rotation.set(lookPitch, lookYaw, 0, "YXZ");
    }
    requestAnimationFrame(browserLookLoop);
  }
  browserLookLoop();

  // --------------------------------------------------------------------------
  // HIDDEN-ELEMENT CLICK GUARD (why "many things weren't clickable")
  // --------------------------------------------------------------------------
  // This app keeps every phase's buttons (setup crop cards, all three seasons'
  // market cards, the report board, Samuel's dialogue, etc.) alive in ONE scene
  // and just toggles object3D.visible to switch phases. That collides with how
  // pointer hit-testing works:
  //
  //   - The pointer system raycasts each RayInteractable by calling
  //     object.raycast(...) DIRECTLY (@pmndrs/pointer-events ray intersector).
  //   - three's Mesh.raycast does NOT skip invisible objects — only the
  //     Raycaster.intersectObjectS path checks visibility, and pmndrs bypasses it.
  //   - InputSystem feeds ALL RayInteractable entities into the hit-test set,
  //     visible or not.
  //
  // Net effect: a HIDDEN button from another phase that happens to sit closer to
  // the camera than the button you're aiming at silently swallows the click. The
  // result is "many interactive elements aren't clickable."
  //
  // Fix: every frame, look at ONLY the actual ray targets — the array the
  // InputSystem publishes as `scene.rayDescendants` (every RayInteractable's
  // object3D) — and, for any that are EFFECTIVELY hidden (itself or any ancestor
  // invisible), set pmndrs's `pointerEvents = 'none'` so pmndrs skips that object
  // AND its subtree during hit-testing. When a target becomes visible again we
  // restore whatever value it had before we touched it.
  //
  // IMPORTANT: we only ever write to a target while it is hidden, and only the
  // target root (not its children). pmndrs already inherits a parent's 'none'
  // down into its subtree, so the root is enough. Visible targets are left
  // completely untouched — critical because UIKitML panels manage their own
  // `pointerEvents` on their internal elements, and clobbering those would break
  // panel button clicks. We must use EFFECTIVE visibility because a button
  // parented under a hidden group (e.g. Samuel's "Got it" under his bubble) still
  // reports visible === true on itself.
  function hitTestVisibilityLoop() {
    const targets = (scene as any).rayDescendants as any[] | undefined;
    if (targets) {
      for (let i = 0; i < targets.length; i++) {
        const obj = targets[i] as any;
        // Effective visibility: the object AND every ancestor must be visible.
        let visible = obj.visible;
        let p = obj.parent;
        while (visible && p) {
          visible = p.visible;
          p = p.parent;
        }
        if (!visible) {
          // Going hidden: remember the value we're about to override (once).
          if (!obj.__guardHidden) {
            obj.__savedPointerEvents = obj.pointerEvents;
            obj.__guardHidden = true;
          }
          obj.pointerEvents = "none";
        } else if (obj.__guardHidden) {
          // Back to visible: restore exactly what was there before.
          obj.pointerEvents = obj.__savedPointerEvents;
          obj.__guardHidden = false;
        }
      }
    }
  }
  // setInterval, NOT requestAnimationFrame: the browser suspends window rAF
  // during immersive WebXR sessions, which would freeze this guard (and every
  // watcher loop below) on a real headset. Timers keep ticking in XR.
  setInterval(hitTestVisibilityLoop, 33);

  // ==========================================================================
  // FARM ENVIRONMENT
  // --------------------------------------------------------------------------
  // All the heavy scenery (sky, lighting, terrain, farmhouse, fence, stall,
  // trees, windmill, clouds...) lives in src/environment.ts. The gameplay
  // anchor positions stay exactly where they've always been: the field at
  // z = -3, the farmhouse front face at z = -5, the stall at x = 8.
  // --------------------------------------------------------------------------

  // Layout anchors. Other game code reads these all over the file.
  const PLOT_SIZE = 0.8; // width and depth of one plot tile
  const PLOT_GAP = 0.1; // gap between neighboring plots
  const PLOT_PITCH = PLOT_SIZE + PLOT_GAP; // center-to-center spacing (0.9)
  const FIELD_CENTER_Z = -3; // ~3 units in front of the farmhouse at z = -6
  const fenceZ = FIELD_CENTER_Z + 1.5 * PLOT_PITCH + 0.4; // just past the front row
  const STALL_X = 8; // 8 units right of the farmhouse (which is at x = 0)
  const STALL_Z = -6; // on the dirt path, level with the farmhouse
  const samuelStallPosition: [number, number, number] = [STALL_X, 0, STALL_Z];

  // The colors plot tiles return to. Both tint the grayscale furrow texture.
  const PLOT_SOIL_COLOR = "#aa744d"; // freshly tilled soil (start + replay)
  const PLOT_FALLOW_COLOR = "#c4a878"; // end-of-year fallow straw

  // Build the whole visual world. It hands back the walkable ground entity so
  // we can mark it for locomotion (the player stands and walks on it).
  const { ground } = buildEnvironment(world, {
    fieldCenterZ: FIELD_CENTER_Z,
    fenceZ,
    stallX: STALL_X,
    stallZ: STALL_Z,
  });
  ground.addComponent(LocomotionEnvironment, { type: EnvironmentType.STATIC });

  // --------------------------------------------------------------------------
  // consumePress(): remove the Pressed tag from an entity after a watcher has
  // handled its click. The InputSystem can fail to clear Pressed when a target
  // hides or turns away mid-press (the release event never reaches it), and a
  // stuck Pressed permanently latches that watcher's rising-edge flag — the
  // button dies for the rest of the session. Consuming the press ourselves
  // makes every 3D button reliable.
  // --------------------------------------------------------------------------
  function consumePress(entity: any) {
    if (entity && entity.hasComponent(Pressed)) {
      entity.removeComponent(Pressed);
    }
  }

  // --------------------------------------------------------------------------
  // makeBox(): the shared box builder the game logic uses for its props
  // (corkboards, sign posts, choice cards...). Scenery boxes are lit
  // (MeshLambertMaterial) so they sit naturally in the world; UI-ish boxes that
  // must stay bright and readable pass `unlit = true` to keep the old flat look.
  // --------------------------------------------------------------------------
  function makeBox(
    width: number,
    height: number,
    depth: number,
    colorHex: string,
    position: [number, number, number],
    unlit = false,
  ) {
    const material = unlit
      ? new MeshBasicMaterial({ color: new Color(colorHex) })
      : new MeshLambertMaterial({ color: new Color(colorHex) });
    const mesh = new Mesh(new BoxGeometry(width, height, depth), material);
    if (!unlit) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
    const entity = world.createTransformEntity(mesh);
    entity.object3D!.position.set(position[0], position[1], position[2]);
    return entity;
  }

  // --------------------------------------------------------------------------
  // CROP FIELD: a 4x4 grid of 16 plots, now textured with furrow ridges. The
  // texture is grayscale, so the material's color keeps tinting it — planting
  // recolors a plot to the crop's color, year-end turns it fallow, and replay
  // resets it to tilled soil, exactly like before.
  // --------------------------------------------------------------------------
  const fieldPlots: any[] = []; // holds all 16 crop-plot entities
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      // Spread the 4x4 grid evenly around its center point.
      const x = (col - 1.5) * PLOT_PITCH;
      const z = FIELD_CENTER_Z + (row - 1.5) * PLOT_PITCH;
      // y = 0.045 lifts the 0.09-tall tile so it reads as a raised soil bed.
      // Typed as `any` so we can attach our own `cropType` tag to the entity.
      const plot: any = makeBox(PLOT_SIZE, 0.09, PLOT_SIZE, PLOT_SOIL_COLOR, [
        x,
        0.045,
        z,
      ]);
      const plotMaterial = (plot.object3D as Mesh).material as MeshBasicMaterial;
      plotMaterial.map = getFurrowTexture();
      plotMaterial.needsUpdate = true;
      plot.cropType = null; // nothing planted here yet
      fieldPlots.push(plot);
    }
  }

  // ==========================================================================
  // CROP SELECTION SETUP SCREEN
  // --------------------------------------------------------------------------
  // The first thing students see. A flat spatial panel (built from
  // ui/setup.uikitml) showing a heading, instructions, a 2x2 grid of crop
  // cards, and a "Begin Season 1" button.
  //
  // PanelUI renders the compiled UIKitML; Interactable lets controller rays and
  // the mouse pointer "tap" elements on the panel (this is the same tap mechanic
  // used elsewhere in the project). We give each interactive element an id in
  // the .uikitml file so we can find it here and react to taps.
  // ==========================================================================
  const setupPanel = world
    .createTransformEntity()
    .addComponent(PanelUI, {
      config: "./ui/setup.json",
      maxWidth: 2.4,
      maxHeight: 1.8,
    });
  // NOTE: no Interactable here on purpose. This flat panel is abandoned (the
  // experience is played with 3D world objects/buttons instead) and is kept
  // hidden. Pointer raycasting does NOT skip invisible meshes, so if this panel
  // were a ray target it would sit stacked at the same spot as the welcome panel
  // and silently swallow clicks meant for it. Leaving Interactable off keeps it
  // out of the hit-test set entirely.

  // Center of the world, a little above the ground, facing the player.
  setupPanel.object3D!.position.set(0, 1.3, -1.2);

  // The setup phase now happens in the 3D world (the seed shelf + bags built near
  // the bottom of this file), NOT on this flat panel. So we hide the panel on
  // load and keep it hidden — its old crop-card wiring below still runs harmlessly
  // but is never seen.
  setupPanel.object3D!.visible = false;

  // Register this panel with the phase manager so showPhase()/nextPhase() can
  // hide it automatically when we move on to Season 1.
  phasePanels[PHASE_SETUP] = setupPanel;

  // --------------------------------------------------------------------------
  // The panel's UI document loads asynchronously (PanelUISystem builds it over
  // the next frame or two). whenPanelReady() simply waits until the document is
  // available, then runs our wiring code exactly once.
  // --------------------------------------------------------------------------
  function whenPanelReady(entity: any, callback: (doc: any) => void) {
    const check = () => {
      // Once the panel is loaded it gains a PanelDocument component that holds
      // the live UI document (the thing with getElementById()).
      if (entity.hasComponent(PanelDocument)) {
        const doc = entity.getValue(PanelDocument, "document");
        if (doc) {
          callback(doc);
          return; // done — stop polling
        }
      }
      requestAnimationFrame(check); // not ready yet, check again next frame
    };
    check();
  }

  // Wire up all the crop cards and the Begin button once the panel is ready.
  whenPanelReady(setupPanel, (doc) => {
    // The Begin button + its text label. We grab them once and reuse them.
    const beginButton = doc.getElementById("begin-button");
    const beginLabel = doc.getElementById("begin-label");

    // Refresh the Begin button's look based on whether anything is selected.
    // Empty selection  -> grayed-out (disabled look).
    // 1+ crops chosen  -> gold background with navy text (active look).
    function updateBeginButton() {
      const active = selectedCrops.length > 0;
      beginButton?.setProperties({
        backgroundColor: active ? COLOR_GOLD : COLOR_DISABLED_BG,
      });
      beginLabel?.setProperties({
        color: active ? COLOR_NAVY : COLOR_DISABLED_TEXT,
      });
    }

    // Set up each crop card: fill its text from CONSTANTS, then make it tappable.
    for (const crop of CROPS) {
      // Fill in the card text. setProperties({ text }) overwrites the placeholder
      // text from the .uikitml file, keeping CONSTANTS as the single source.
      doc.getElementById("name-" + crop.id)?.setProperties({ text: crop.name });
      doc
        .getElementById("desc-" + crop.id)
        ?.setProperties({ text: crop.description });
      doc
        .getElementById("price-" + crop.id)
        ?.setProperties({ text: "Base price: " + crop.price + " coins/unit" });
      doc
        .getElementById("risk-" + crop.id)
        ?.setProperties({ text: "Risk: " + riskLabel(crop.risk) });

      // The card itself is the tap target.
      const card = doc.getElementById("card-" + crop.id);

      // Tapping a card toggles it between selected and unselected.
      card?.setProperties({
        onClick: () => toggleCrop(crop, card),
      });
    }

    // Select / unselect a single crop and update its card's border color.
    function toggleCrop(crop: (typeof CROPS)[number], card: any) {
      const alreadySelected = selectedCrops.indexOf(crop.name) !== -1;
      if (alreadySelected) {
        // Unselect: remove from the list and restore the default navy border.
        selectedCrops = selectedCrops.filter((name) => name !== crop.name);
        card.setProperties({ borderColor: COLOR_NAVY });
      } else {
        // Select: add to the list and switch to a gold border.
        selectedCrops.push(crop.name);
        card.setProperties({ borderColor: COLOR_GOLD });
      }
      console.log("Selected crops: " + selectedCrops.join(", "));
      updateBeginButton(); // selection changed, so refresh the button
    }

    // Start Season 1 — but only if at least one crop is chosen.
    function beginSeason() {
      // Guard: while disabled (nothing selected) the tap does nothing.
      if (selectedCrops.length === 0) {
        return;
      }
      // selectedCrops already holds the student's choices (kept up to date as
      // they tapped). Advance to Season 1 and hide this setup panel.
      console.log("Beginning Season 1 with: " + selectedCrops.join(", "));
      nextPhase();
      setupPanel.object3D!.visible = false;
    }

    // Tapping the Begin button runs beginSeason().
    beginButton?.setProperties({ onClick: () => beginSeason() });

    // Set the Begin button's initial (disabled) look now that it's wired up.
    updateBeginButton();
  });

  // ==========================================================================
  // WELCOME + TUTORIAL PANEL
  // --------------------------------------------------------------------------
  // The VERY FIRST thing the student sees. A spatial panel (built from
  // ui/welcome.uikitml) that introduces the premise and walks through how to
  // navigate the experience: planting, moving, talking to Samuel, and reading
  // the score HUD. It floats centered in front of the player at startup.
  //
  // The 3D farm setup props (the seed shelf, seed bags, and instruction sign
  // built lower in this file) start HIDDEN so the tour has the student's full
  // attention. revealFarmSetup() is assigned once those props exist and runs
  // when the student presses "Start Farming" on the final tutorial step.
  //
  // This is a one-time onboarding: replaying the game (handlePlayAgain) brings
  // the setup props back directly and never re-opens this panel.
  // ==========================================================================
  let revealFarmSetup: (() => void) | null = null;

  const welcomePanel = world
    .createTransformEntity()
    .addComponent(PanelUI, {
      config: "./ui/welcome.json",
      maxWidth: 2.4,
      maxHeight: 1.9,
    })
    .addComponent(Interactable);

  // Centered in front of the player, at a comfortable reading height.
  welcomePanel.object3D!.position.set(0, 1.5, -1.2);

  // Hidden until its first step is initialized below — this avoids a one-frame
  // flash of all five steps stacked before the wiring runs.
  welcomePanel.object3D!.visible = false;

  // How many tutorial steps there are (the text for each lives in welcome.uikitml).
  const WELCOME_STEPS = 5;
  let welcomeStep = 1; // which step is currently showing (1..WELCOME_STEPS)

  // Wire up the tutorial once the panel's UI document has loaded.
  whenPanelReady(welcomePanel, (doc) => {
    const backButton = doc.getElementById("back-button");
    const backLabel = doc.getElementById("back-label");
    const nextButton = doc.getElementById("next-button");
    const nextLabel = doc.getElementById("next-label");
    const indicator = doc.getElementById("step-indicator");

    // finishWelcome(): close the tutorial and bring the farm setup into view.
    function finishWelcome() {
      welcomePanel.object3D!.visible = false;
      if (revealFarmSetup) revealFarmSetup();
      console.log("Tutorial complete - farm setup revealed.");
    }

    // showWelcomeStep(n): reveal step n, hide the rest, and refresh the footer
    // (the "Step n of 5" counter, plus each button's label / disabled look).
    function showWelcomeStep(n: number) {
      welcomeStep = n;

      // Show exactly one step container; hide the others.
      for (let i = 1; i <= WELCOME_STEPS; i++) {
        doc
          .getElementById("step-" + i)
          ?.setProperties({ display: i === n ? "flex" : "none" });
      }

      indicator?.setProperties({ text: "Step " + n + " of " + WELCOME_STEPS });

      // Back is disabled (grayed out) on the first step, active afterward.
      const canGoBack = n > 1;
      backButton?.setProperties({
        backgroundColor: canGoBack ? COLOR_GOLD : COLOR_DISABLED_BG,
      });
      backLabel?.setProperties({
        color: canGoBack ? COLOR_NAVY : COLOR_DISABLED_TEXT,
      });

      // On the final step, Next becomes the call-to-action that starts the game.
      const isLast = n === WELCOME_STEPS;
      nextLabel?.setProperties({ text: isLast ? "Start Farming" : "Next" });
    }

    // Back: step back one (the guard makes it a no-op while disabled on step 1).
    backButton?.setProperties({
      onClick: () => {
        if (welcomeStep > 1) {
          sfxClick();
          showWelcomeStep(welcomeStep - 1);
        }
      },
    });

    // Next: advance a step, or finish the tutorial when on the last step.
    nextButton?.setProperties({
      onClick: () => {
        sfxClick();
        if (welcomeStep < WELCOME_STEPS) {
          showWelcomeStep(welcomeStep + 1);
        } else {
          finishWelcome();
        }
      },
    });

    // Initialize on step 1, then reveal the now-ready panel.
    showWelcomeStep(1);
    welcomePanel.object3D!.visible = true;
  });

  // ==========================================================================
  // SEASON 1 SCREEN (planting -> tending -> first harvest)
  // --------------------------------------------------------------------------
  // A second spatial panel placed at the SAME spot as the setup panel. It stays
  // hidden until showPhase('season1') runs (the phase manager handles that).
  //
  // The screen has three "beats" (mini-steps). We keep all three laid out in
  // ui/season1.uikitml and simply show one beat at a time:
  //   Beat 1 — Planting:  choose how many plots of each crop to plant.
  //   Beat 2 — Tending:   watch a 3-second progress bar fill.
  //   Beat 3 — Market:    see prices, then "Sell Now" or "Hold and Wait".
  // ==========================================================================
  const season1Panel = world
    .createTransformEntity()
    .addComponent(PanelUI, {
      config: "./ui/season1.json",
      maxWidth: 2.4,
      maxHeight: 1.8,
    });
  // NOTE: no Interactable here on purpose. This flat panel is abandoned (the
  // experience is played with 3D world objects/buttons instead) and is kept
  // hidden. Pointer raycasting does NOT skip invisible meshes, so if this panel
  // were a ray target it would sit stacked at the same spot as the welcome panel
  // and silently swallow clicks meant for it. Leaving Interactable off keeps it
  // out of the hit-test set entirely.

  // Same world position as the setup panel: center of the world, eye height.
  season1Panel.object3D!.position.set(0, 1.3, -1.2);

  // Hidden by default. showPhase('season1') will reveal it (and hide setup).
  season1Panel.object3D!.visible = false;

  // Register with the phase manager so showPhase()/nextPhase() can show this
  // panel and hide the setup panel automatically when Season 1 begins.
  phasePanels[PHASE_SEASON1] = season1Panel;

  // Wire up all three beats once the panel's UI document has loaded. (The same
  // whenPanelReady helper used by the setup screen above.)
  whenPanelReady(season1Panel, (doc) => {
    // ------------------------------------------------------------------------
    // Beat switching: show exactly one beat by flipping each beat container's
    // `display` between "flex" (visible) and "none" (hidden).
    // ------------------------------------------------------------------------
    function showSeason1Beat(beat: number) {
      season1Beat = beat; // remember which beat is active
      doc
        .getElementById("beat1")
        ?.setProperties({ display: beat === 1 ? "flex" : "none" });
      doc
        .getElementById("beat2")
        ?.setProperties({ display: beat === 2 ? "flex" : "none" });
      doc
        .getElementById("beat3")
        ?.setProperties({ display: beat === 3 ? "flex" : "none" });
    }

    // ========================================================================
    // BEAT 1 — PLANTING
    // ========================================================================

    // Add up the plots across every selected crop (used for the 12-plot cap).
    function totalPlots() {
      let sum = 0;
      for (const name of selectedCrops) {
        sum += plotCounts[name] || 0;
      }
      return sum;
    }

    // Refresh the "Total plots: X / 12" line.
    function updateTotalText() {
      doc
        .getElementById("total-text")
        ?.setProperties({ text: "Total plots: " + totalPlots() + " / 12" });
    }

    // Fill in the plot rows from the selected crops, hiding any unused slots.
    function renderBeat1() {
      for (let i = 0; i < 4; i++) {
        const row = doc.getElementById("plot-row-" + i);
        const name = selectedCrops[i]; // undefined if fewer than 4 crops chosen
        if (name) {
          // Show this row and fill in the crop's name + current plot count.
          row?.setProperties({ display: "flex" });
          doc.getElementById("plot-name-" + i)?.setProperties({ text: name });
          doc
            .getElementById("plot-count-" + i)
            ?.setProperties({ text: String(plotCounts[name]) });
        } else {
          // No crop for this slot — hide the whole row.
          row?.setProperties({ display: "none" });
        }
      }
      updateTotalText();
    }

    // Add (+1) or remove (-1) a plot for the crop in a given row slot.
    function changePlots(slot: number, delta: number) {
      const name = selectedCrops[slot];
      if (!name) return; // empty slot — nothing to change
      const current = plotCounts[name] || 1;

      if (delta > 0) {
        // Adding a plot: max 6 per crop, and 12 total across all crops.
        if (current >= 6) return;
        if (totalPlots() >= 12) return;
        plotCounts[name] = current + 1;
      } else {
        // Removing a plot: never go below 1 plot for a planted crop.
        if (current <= 1) return;
        plotCounts[name] = current - 1;
      }

      // Update just this row's count, then refresh the running total.
      doc
        .getElementById("plot-count-" + slot)
        ?.setProperties({ text: String(plotCounts[name]) });
      updateTotalText();
    }

    // Wire each row's "+" and "-" buttons. The ids are fixed, so we only do
    // this once. We capture `i` in `slot` so each handler edits its own row.
    for (let i = 0; i < 4; i++) {
      const slot = i;
      doc
        .getElementById("plot-plus-" + slot)
        ?.setProperties({ onClick: () => changePlots(slot, +1) });
      doc
        .getElementById("plot-minus-" + slot)
        ?.setProperties({ onClick: () => changePlots(slot, -1) });
    }

    // "Tend Your Crops" advances to Beat 2.
    doc
      .getElementById("tend-button")
      ?.setProperties({ onClick: () => startBeat2() });

    // ========================================================================
    // BEAT 2 — TENDING (3-second progress bar)
    // ========================================================================
    const progressFill = doc.getElementById("progress-fill");
    const marketButton = doc.getElementById("market-button");

    // Show Beat 2 and start the timer that fills the progress bar.
    function startBeat2() {
      showSeason1Beat(2);
      runProgressBar();
    }

    // Animate the gold fill from width 0 up to the full track width (120, which
    // matches the .progress-track width in season1.uikitml) over 3 seconds.
    // We use a simple setInterval timer — NOT a CSS animation.
    function runProgressBar() {
      // Hide the "Check the Market" button until the bar is full.
      marketButton?.setProperties({ display: "none" });

      const fullWidth = 120; // must match the track width in the .uikitml
      const durationMs = 3000; // 3 seconds total
      const stepMs = 50; // update about 20 times per second
      let elapsed = 0;

      const timer = setInterval(() => {
        elapsed += stepMs;
        const progress = Math.min(elapsed / durationMs, 1); // goes 0 -> 1
        progressFill?.setProperties({ width: fullWidth * progress });

        if (progress >= 1) {
          clearInterval(timer); // stop the timer
          // Bar is full — reveal the button that moves on to Beat 3.
          marketButton?.setProperties({ display: "flex" });
        }
      }, stepMs);
    }

    // "Check the Market" advances to Beat 3.
    marketButton?.setProperties({ onClick: () => enterBeat3() });

    // ========================================================================
    // BEAT 3 — FIRST MARKET PRICES
    // ========================================================================

    // Roll each crop's current market price ONCE, when entering Beat 3, and
    // remember it. Current price = base price +/- a random 1 or 2 coins.
    function computeMarketPrices() {
      for (const name of selectedCrops) {
        const crop = getCropByName(name);
        if (!crop) continue;
        const magnitude = 1 + Math.floor(Math.random() * 2); // 1 or 2 coins
        const sign = Math.random() < 0.5 ? -1 : 1; // minus or plus
        let price = crop.price + sign * magnitude;
        if (price < 1) price = 1; // a crop is never worth less than 1 coin
        marketPrices[name] = price;
      }
    }

    // Fill in the price cards from the selected crops, hiding unused slots.
    function renderBeat3() {
      for (let i = 0; i < 4; i++) {
        const card = doc.getElementById("price-card-" + i);
        const name = selectedCrops[i];
        if (name) {
          const crop = getCropByName(name);
          card?.setProperties({ display: "flex" });
          doc.getElementById("price-name-" + i)?.setProperties({ text: name });
          doc
            .getElementById("price-base-" + i)
            ?.setProperties({ text: "Base price: " + (crop?.price ?? 0) + " coins" });
          doc.getElementById("price-current-" + i)?.setProperties({
            text: "Current market price: " + marketPrices[name] + " coins",
          });
        } else {
          card?.setProperties({ display: "none" });
        }
      }
    }

    // Show Beat 3: roll prices first, then fill the cards.
    function enterBeat3() {
      computeMarketPrices();
      renderBeat3();
      showSeason1Beat(3);
    }

    // "Sell Now": sell every crop at its current price and bank the earnings.
    function sellNow() {
      season1Decision = "sell";

      // Earnings = current price x units harvested, summed over all crops.
      // Units harvested = yield-per-plot (CONSTANTS) x number of plots planted.
      let earnings = 0;
      for (const name of selectedCrops) {
        const price = marketPrices[name] || 0;
        const yieldPerPlot = YIELD_BY_NAME[name] || 0;
        const plots = plotCounts[name] || 0;
        earnings += price * yieldPerPlot * plots;
      }

      farmRevenue += earnings; // add this season's sale to the running total
      console.log(
        "Sold all crops for " + earnings + " coins. Farm revenue: " + farmRevenue,
      );

      updateScore("revenue", 10); // reward for earning money
      nextPhase(); // move on to Season 2
    }

    // "Hold and Wait": keep the crops as inventory for later instead of selling.
    function holdAndWait() {
      season1Decision = "hold";

      // Store what we're holding: how many units of each crop, plus the price
      // we saw, so a later season can decide what the held crops are worth.
      heldInventory = [];
      for (const name of selectedCrops) {
        const yieldPerPlot = YIELD_BY_NAME[name] || 0;
        const plots = plotCounts[name] || 0;
        heldInventory.push({
          crop: name,
          units: yieldPerPlot * plots,
          price: marketPrices[name] || 0,
        });
      }
      console.log("Holding crops for later. Decision: " + season1Decision);

      updateScore("adaptability", 5); // reward for a flexible, wait-and-see move
      nextPhase(); // move on to Season 2
    }

    // Wire the two final choice buttons.
    doc.getElementById("sell-button")?.setProperties({ onClick: () => sellNow() });
    doc.getElementById("hold-button")?.setProperties({ onClick: () => holdAndWait() });

    // ========================================================================
    // SEASON 1 — NOW PLAYED IN THE 3D WORLD (not on the flat panel above)
    // ------------------------------------------------------------------------
    // The old flat-panel "beats" (planting / tending / market) are no longer
    // shown. Instead, when the student enters Season 1 we:
    //   1. Hide the Season 1 panel entirely.
    //   2. Grow the sprouts the student planted (a short animation).
    //   3. Open a world-space market: a price board near Samuel's stall and a
    //      corkboard on the farmhouse with "Sell Now" / "Hold for Later" cards.
    //
    // Everything below is created FRESH each time Season 1 begins, so replaying
    // the game works cleanly.
    // ========================================================================

    // Lowercase crop id -> base price / yield, read straight from CONSTANTS.
    // (We only READ from CONSTANTS here; we never change it.)
    const BASE_PRICE: Record<string, number> = {
      tobacco: CONSTANTS.PRICE_TOBACCO,
      wheat: CONSTANTS.PRICE_WHEAT,
      corn: CONSTANTS.PRICE_CORN,
      cotton: CONSTANTS.PRICE_COTTON,
    };
    const BASE_YIELD: Record<string, number> = {
      tobacco: CONSTANTS.YIELD_TOBACCO,
      wheat: CONSTANTS.YIELD_WHEAT,
      corn: CONSTANTS.YIELD_CORN,
      cotton: CONSTANTS.YIELD_COTTON,
    };

    // Turn a crop id ("tobacco") into its friendly display name ("Tobacco").
    function cropDisplayName(cropId: string): string {
      const crop = CROPS.find((c) => c.id === cropId);
      return crop ? crop.name : cropId;
    }

    // makeMarketTextPlane(): draw one or more lines of text onto a transparent
    // canvas and hang it in the world as a flat plane (so ONLY the letters show,
    // never a box around them). `blocks` is a list of text lines; each line can
    // set its own font size / boldness / color. Returns the new entity.
    function makeMarketTextPlane(
      blocks: { text: string; bold?: boolean; fontPx?: number; color?: string }[],
      widthM: number,
      heightM: number,
      position: [number, number, number],
      defaultColor = "#1F3A5F",
    ) {
      const PX_PER_M = 512; // canvas pixels per meter (keeps the text crisp)
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(widthM * PX_PER_M);
      canvas.height = Math.round(heightM * PX_PER_M);
      const ctx = canvas.getContext("2d")!;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const maxWidth = canvas.width * 0.92; // leave a small side margin

      // 1. Word-wrap every block into the display lines that actually fit.
      const lines: { text: string; bold: boolean; fontPx: number; color: string }[] = [];
      for (const b of blocks) {
        const fontPx = b.fontPx ?? 30;
        const bold = b.bold ?? false;
        const color = b.color ?? defaultColor;
        ctx.font = (bold ? "bold " : "") + fontPx + "px system-ui, sans-serif";
        let line = "";
        for (const word of b.text.split(" ")) {
          const candidate = line ? line + " " + word : word;
          if (ctx.measureText(candidate).width > maxWidth && line) {
            lines.push({ text: line, bold, fontPx, color });
            line = word; // current line is full — start a new one
          } else {
            line = candidate;
          }
        }
        lines.push({ text: line, bold, fontPx, color });
      }

      // 2. Stack the lines vertically, centered as a group.
      let totalH = 0;
      for (const l of lines) totalH += l.fontPx * 1.35;
      let y = canvas.height / 2 - totalH / 2;
      for (const l of lines) {
        y += (l.fontPx * 1.35) / 2;
        ctx.font = (l.bold ? "bold " : "") + l.fontPx + "px system-ui, sans-serif";
        ctx.fillStyle = l.color;
        ctx.fillText(l.text, canvas.width / 2, y);
        y += (l.fontPx * 1.35) / 2;
      }

      // 3. Wrap the canvas in a texture and make a flat plane entity from it.
      const texture = new CanvasTexture(canvas);
      texture.colorSpace = SRGBColorSpace;
      const mesh = new Mesh(
        new PlaneGeometry(widthM, heightM),
        new MeshBasicMaterial({ map: texture, transparent: true, side: DoubleSide }),
      );
      const entity = world.createTransformEntity(mesh);
      entity.object3D!.position.set(position[0], position[1], position[2]);
      return entity;
    }

    // --- Bookkeeping for the world market -----------------------------------
    // We keep references to everything we create so we can hide it (after a
    // choice) and dispose it (when Season 1 restarts). dispose() also frees the
    // GPU memory of the box/plane geometries and materials.
    let marketEntities: any[] = [];
    let arrowPulseTimer: ReturnType<typeof setInterval> | null = null;
    let growthTimer: ReturnType<typeof setInterval> | null = null;
    let growingText: any = null; // the floating "Your crops are growing..." text

    // The two corkboard cards (set when the market opens). The single watch loop
    // further down reads whichever cards currently exist.
    let sellCard: any = null;
    let holdCard: any = null;
    let marketActive = false; // true only while the cards are live & clickable

    // clearMarket(): tear down anything left over from a previous Season 1 so a
    // replay starts from a clean slate.
    function clearMarket() {
      marketActive = false;
      if (arrowPulseTimer !== null) {
        clearInterval(arrowPulseTimer);
        arrowPulseTimer = null;
      }
      if (growthTimer !== null) {
        clearInterval(growthTimer);
        growthTimer = null;
      }
      if (growingText) {
        growingText.dispose();
        growingText = null;
      }
      for (const e of marketEntities) e.dispose();
      marketEntities = [];
      sellCard = null;
      holdCard = null;
    }

    // ------------------------------------------------------------------------
    // ENTER SEASON 1: runs from showPhase('season1') via the onEnterSeason1 hook,
    // by which time selectedCrops + plantingRecord hold the student's planting.
    // ------------------------------------------------------------------------
    onEnterSeason1 = () => {
      season1Decision = null; // clear any previous choice
      clearMarket(); // remove leftovers if the student is replaying
      setObjective("Your crops are growing… 🌱");

      // HIDE SEASON 1 PANEL — Season 1 now lives entirely in the 3D world.
      season1Panel.object3D!.visible = false;

      // Season 2 and Season 3 still read plotCounts to size their harvests, so we
      // keep seeding it here (one plot minimum per planted crop) exactly as the
      // old flat-panel code did. This keeps the later seasons working unchanged.
      for (const name of selectedCrops) {
        if (plotCounts[name] === undefined) {
          plotCounts[name] = 1;
        }
      }

      // The plots the student actually planted. These line up 1:1 with the
      // entries in plantingRecord (both are simply "field plots that have a crop"),
      // so animating these sprouts IS animating each plantingRecord entry's crop.
      const plantedPlots = fieldPlots.filter((p: any) => p.cropType);

      // Safety net: if somehow nothing was planted, skip the growth animation
      // and open the market right away.
      if (plantedPlots.length === 0) {
        startSeason1Market();
        return;
      }

      // CROP GROWTH ANIMATION ------------------------------------------------
      // Floating reassurance text above the field, on a navy ribbon so it
      // stays readable against the sky and grass behind it.
      const growingHandle = makeSamuelTextPlane(2.4, 0.5, {
        fontPx: 56,
        color: "#ffe9b0",
        bgColor: "rgba(31, 58, 95, 0.88)",
        bold: true,
      });
      growingHandle.entity.object3D!.position.set(0, 1.7, FIELD_CENTER_Z);
      growingHandle.setText("Your crops are growing… 🌱");
      growingText = growingHandle.entity;

      // Grow each sprout's Y scale from 0.2 up to 0.8 over 4 seconds, nudging it
      // every 150 ms. A single shared timer drives every sprout together, so
      // "all sprouts finished" simply means "this one timer reached the end".
      const startScale = 0.2;
      const endScale = 0.8;
      const durationMs = 4000;
      const stepMs = 150;
      let elapsed = 0;

      // Start every sprout small so the growth reads clearly from the start.
      for (const plot of plantedPlots) {
        if (plot.sproutEntity) plot.sproutEntity.object3D!.scale.y = startScale;
      }

      growthTimer = setInterval(() => {
        elapsed += stepMs;
        const progress = Math.min(elapsed / durationMs, 1); // climbs 0 -> 1
        const scaleY = startScale + (endScale - startScale) * progress;
        for (const plot of plantedPlots) {
          if (plot.sproutEntity) plot.sproutEntity.object3D!.scale.y = scaleY;
        }

        // All sprouts have finished growing.
        if (progress >= 1) {
          if (growthTimer !== null) {
            clearInterval(growthTimer);
            growthTimer = null;
          }
          // Hide the "growing..." message now that growth is complete.
          if (growingText) {
            growingText.dispose();
            growingText = null;
          }
          startSeason1Market(); // move on to the market
        }
      }, stepMs);
    };

    // ========================================================================
    // THE WORLD-SPACE MARKET (price board near Samuel + corkboard choice)
    // ========================================================================
    function startSeason1Market() {
      // -- Roll this season's price for each PLANTED crop --------------------
      // Unique crop ids the student planted, e.g. ["tobacco", "corn"].
      const uniqueCrops = [...new Set(plantingRecord.map((r) => r.cropType))];
      currentPrices = {}; // fresh prices each season
      for (const crop of uniqueCrops) {
        // Base price from CONSTANTS, nudged by a small -2..+2 random swing.
        const swing = Math.floor(Math.random() * 5) - 2; // -2, -1, 0, +1, or +2
        currentPrices[crop] = BASE_PRICE[crop] + swing;
      }

      // Helper: how many plots the student planted of one crop.
      function plotsOf(cropId: string): number {
        return plantingRecord.filter((r) => r.cropType === cropId).length;
      }

      // -- PRICE SIGN POST near Samuel's stall -------------------------------
      // Placed just in front-left of the stall so the student walks over to read it.
      const signX = samuelStallPosition[0] - 1.4;
      const signZ = samuelStallPosition[2] + 0.9; // nudged toward the player
      // A thin vertical wooden post with a cream board (the board keeps the
      // colored price text readable against the grass behind it).
      const post = makeBox(0.08, 1.4, 0.08, "#5b3a21", [signX, 0.7, signZ]);
      marketEntities.push(post);
      const signBoard = makeBox(
        1.04,
        0.78,
        0.04,
        "#f7eed9",
        [signX, 1.55, signZ + 0.02],
        true,
      );
      marketEntities.push(signBoard);

      // A flat panel on top of the post listing each planted crop's price.
      // Green ▲ = today's price is above the base price, red ▼ = below it, so
      // a student can read the market at a glance.
      const priceLines = uniqueCrops.map((crop) => {
        const price = currentPrices[crop];
        const base = BASE_PRICE[crop] || 0;
        const arrow = price > base ? " ▲" : price < base ? " ▼" : "";
        const color =
          price > base ? "#2e7d32" : price < base ? "#b3402e" : "#1F3A5F";
        return {
          text: cropDisplayName(crop) + ": " + price + " 🪙" + arrow,
          fontPx: 30,
          color,
        };
      });
      const signPanel = makeMarketTextPlane(
        [
          { text: "🪙 Market Prices", bold: true, fontPx: 34, color: TEXT_GOLD },
          ...priceLines,
        ],
        0.95,
        0.7,
        [signX, 1.55, signZ + 0.05],
      );
      marketEntities.push(signPanel);

      // A floating arrow above the sign (a 4-sided cone, point aimed downward)
      // that pulses to draw the student's eye toward the board.
      const arrowMesh = new Mesh(
        new CylinderGeometry(0, 0.12, 0.28, 4), // top radius 0 => a pointed cone
        new MeshBasicMaterial({ color: new Color("#c8962a") }),
      );
      const arrow = world.createTransformEntity(arrowMesh);
      arrow.object3D!.position.set(signX, 2.05, signZ + 0.05);
      arrow.object3D!.rotation.x = Math.PI; // flip so the point aims downward
      marketEntities.push(arrow);

      // Pulse the arrow's scale 1.0 -> 1.2 -> 1.0 once every 1.5 seconds. A
      // sine wave gives the smooth up-and-down swing (same trick Samuel's hat uses).
      {
        const periodMs = 1500; // one full pulse every 1.5 s
        const tickMs = 50; // update ~20 times per second
        let pulseElapsed = 0;
        arrowPulseTimer = setInterval(() => {
          pulseElapsed += tickMs;
          const phase = (pulseElapsed % periodMs) / periodMs; // loops 0 -> 1
          const s = 1.1 + 0.1 * Math.sin(phase * Math.PI * 2); // swings 1.0..1.2
          arrow.object3D!.scale.setScalar(s);
        }, tickMs);
      }

      // -- SAMUEL GATE --------------------------------------------------------
      // The Sell/Hold board stays LOCKED until the student walks to Samuel and
      // reads his news ("Got it!"). A locked note hangs where the cards will
      // appear, and the objective line points the way.
      const s1LockedNote = makeLockedNote();
      marketEntities.push(s1LockedNote);
      setObjective("Walk to Samuel's stall — he has news! ❗");
      samuelSpeak(
        "The market is open! Check my price board, then unlock the farmhouse choice board: sell your harvest now, or hold it. 🪙",
      );
      onSamuelNewsRead = () => {
        s1LockedNote.object3D!.visible = false;
        openSeason1Corkboard();
        setObjective("Farmhouse board: Sell Now 🪙 or Hold for Later ⏳?");
      };

      // -- CORKBOARD on the farmhouse front wall -----------------------------
      // Built only when the gate above fires. The farmhouse walls box is
      // centered at z = -6 and 2 deep, so its FRONT face (toward the player)
      // is at z = -5. We mount the board just in front so it faces the player.
      function openSeason1Corkboard() {
      const boardZ = -4.9;
      const board = makeBox(1.8, 1.0, 0.05, "#c8a560", [0, 1.3, boardZ]);
      marketEntities.push(board);

      // Estimated earnings if the student sells everything at today's prices:
      // sum over crops of (plots * yield-per-plot * current price).
      let estEarnings = 0;
      for (const crop of uniqueCrops) {
        estEarnings += plotsOf(crop) * (BASE_YIELD[crop] || 0) * currentPrices[crop];
      }

      // SELL NOW card (left) -- a cream card box, raised slightly off the board
      // so it reads as "pinned". The box itself is the clickable target.
      sellCard = makeBox(
        0.7,
        0.8,
        0.03,
        "#f3e9d2",
        [-0.45, 1.3, boardZ + 0.06],
        true, // unlit so the card stays bright and readable
      );
      sellCard.addComponent(RayInteractable); // clickable by mouse / controller ray
      marketEntities.push(sellCard);
      // The card's text sits just in front of the card box (text planes are not
      // interactable, so they never block the ray from reaching the card box).
      const sellText = makeMarketTextPlane(
        [
          { text: "Sell Now 🪙", bold: true, fontPx: 34 },
          { text: "Trade your harvest for coins today.", fontPx: 22 },
          {
            text: "You'd earn about " + estEarnings + " 🪙",
            fontPx: 24,
            color: TEXT_GOLD,
          },
        ],
        0.62,
        0.72,
        [-0.45, 1.3, boardZ + 0.08],
      );
      marketEntities.push(sellText);

      // HOLD FOR LATER card (right).
      holdCard = makeBox(
        0.7,
        0.8,
        0.03,
        "#f3e9d2",
        [0.45, 1.3, boardZ + 0.06],
        true,
      );
      holdCard.addComponent(RayInteractable);
      marketEntities.push(holdCard);
      const holdText = makeMarketTextPlane(
        [
          { text: "Hold for Later ⏳", bold: true, fontPx: 32 },
          {
            text: "Wait until Season 3 — prices could go up… or down!",
            fontPx: 22,
          },
        ],
        0.62,
        0.72,
        [0.45, 1.3, boardZ + 0.08],
      );
      marketEntities.push(holdText);

      // The cards are now live: the watch loop below will react to clicks.
      marketActive = true;
      } // end of openSeason1Corkboard
    }

    // onSellNow(): the SELL NOW card was clicked -- bank the harvest right now.
    function onSellNow() {
      // Actual earnings: for each planted plot, add (yield-per-plot * price).
      // Looping over plantingRecord (one entry per plot) is the same as
      // (plots-of-crop * yield * price) summed across crops.
      let earnings = 0;
      for (const record of plantingRecord) {
        const crop = record.cropType;
        earnings += (BASE_YIELD[crop] || 0) * (currentPrices[crop] || 0);
      }
      farmRevenue += earnings; // add to the running farm revenue
      console.log(
        "Season 1 SELL: earned " + earnings + " coins. Revenue: " + farmRevenue,
      );

      updateScore("revenue", 10); // reward for earning money
      season1Decision = "sell";
      hideMarketAndAdvance();
    }

    // onHoldForLater(): the HOLD card was clicked -- keep the harvest for later.
    // Stores a plain copy of plantingRecord ({ cropType: <id> } items, one per
    // held plot). Season 3's finishHarvest() reads this exact shape when tallying
    // the held sale.
    function onHoldForLater() {
      heldInventory = [...plantingRecord];
      console.log(
        "Season 1 HOLD: keeping " + heldInventory.length + " plots for later.",
      );

      updateScore("adaptability", 5); // reward for a flexible, wait-and-see move
      season1Decision = "hold";
      hideMarketAndAdvance();
    }

    // hideMarketAndAdvance(): hide the corkboard + price sign (and arrow/text),
    // stop the pulse timer, then move on to Season 2.
    function hideMarketAndAdvance() {
      marketActive = false; // ignore any further card clicks
      if (arrowPulseTimer !== null) {
        clearInterval(arrowPulseTimer);
        arrowPulseTimer = null;
      }
      for (const e of marketEntities) {
        if (e.object3D) e.object3D.visible = false;
      }
      nextPhase(); // advance to Season 2
    }

    // One watch loop drives BOTH cards. The InputSystem adds the Pressed tag
    // while a ray/pointer is clicking a card; we fire ONCE on the rising edge
    // (was-not-pressed -> now-pressed), and only while the market is active and
    // Season 1 is the current phase (so a stray hit can't fire after we leave).
    function watchMarketCards() {
      // A press is consumed the frame we see it, so seeing one IS the click.
      if (sellCard && sellCard.hasComponent(Pressed)) {
        if (marketActive && currentPhase === PHASE_SEASON1) onSellNow();
        consumePress(sellCard);
      }
      if (holdCard && holdCard.hasComponent(Pressed)) {
        if (marketActive && currentPhase === PHASE_SEASON1) onHoldForLater();
        consumePress(holdCard);
      }
    }
    // setInterval (not rAF): keeps working inside immersive XR sessions.
    setInterval(watchMarketCards, 33); // idles until the market opens

    // Clean initial state while the panel is still hidden at startup: show only
    // Beat 1 and keep the "Check the Market" button hidden until its timer runs.
    showSeason1Beat(1);
    marketButton?.setProperties({ display: "none" });
  });

  // ==========================================================================
  // SEASON 2 SCREEN (the market event)
  // --------------------------------------------------------------------------
  // A third spatial panel placed at the SAME spot as the Season 1 panel. It
  // stays hidden until showPhase('season2') runs (the phase manager handles
  // that). When the student arrives, a random market event has already changed
  // prices, and they choose how to react.
  //
  // The screen has two "beats" (mini-steps), laid out in ui/season2.uikitml:
  //   Beat 1 — Samuel's News:    the NPC explains the event + a market report.
  //   Beat 2 — Student Response: Shift Crops / Double Down / Diversify.
  // ==========================================================================
  const season2Panel = world
    .createTransformEntity()
    .addComponent(PanelUI, {
      config: "./ui/season2.json",
      maxWidth: 2.4,
      maxHeight: 1.8,
    });
  // NOTE: no Interactable here on purpose. This flat panel is abandoned (the
  // experience is played with 3D world objects/buttons instead) and is kept
  // hidden. Pointer raycasting does NOT skip invisible meshes, so if this panel
  // were a ray target it would sit stacked at the same spot as the welcome panel
  // and silently swallow clicks meant for it. Leaving Interactable off keeps it
  // out of the hit-test set entirely.

  // Same world position as the setup + Season 1 panels: center, eye height.
  season2Panel.object3D!.position.set(0, 1.3, -1.2);

  // Hidden by default. showPhase('season2') reveals it (and hides Season 1).
  season2Panel.object3D!.visible = false;

  // Register with the phase manager so showPhase()/nextPhase() can show this
  // panel and hide the Season 1 panel automatically when Season 2 begins.
  phasePanels[PHASE_SEASON2] = season2Panel;

  // Wire up both beats once the panel's UI document has loaded.
  whenPanelReady(season2Panel, (doc) => {
    // ------------------------------------------------------------------------
    // Beat switching: show exactly one beat by flipping each beat container's
    // `display` between "flex" (visible) and "none" (hidden).
    // ------------------------------------------------------------------------
    function showSeason2Beat(beat: number) {
      doc
        .getElementById("s2-beat1")
        ?.setProperties({ display: beat === 1 ? "flex" : "none" });
      doc
        .getElementById("s2-beat2")
        ?.setProperties({ display: beat === 2 ? "flex" : "none" });
    }

    // ========================================================================
    // BEAT 1 — SAMUEL'S NEWS
    // ========================================================================

    // Fill Beat 1's text from whichever event was rolled this playthrough.
    function renderBeat1() {
      const event = SEASON2_EVENTS[season2Event]; // the event that happened

      // Samuel's name label + his spoken line.
      doc.getElementById("npc-name")?.setProperties({ text: CONSTANTS.NPC_NAME });
      doc.getElementById("samuel-line")?.setProperties({ text: event.samuel });

      // The MARKET REPORT stat card: event name, affected crop, the change.
      doc.getElementById("report-event")?.setProperties({ text: event.name });
      doc
        .getElementById("report-crop")
        ?.setProperties({ text: "Crop affected: " + event.crop });
      doc.getElementById("report-change")?.setProperties({ text: event.change });
    }

    // "Decide Your Strategy" advances to Beat 2.
    doc
      .getElementById("strategy-button")
      ?.setProperties({ onClick: () => enterBeat2() });

    // ========================================================================
    // BEAT 2 — STUDENT RESPONSE
    // ========================================================================

    // Build the "Your crops: Tobacco (3 plots), ..." line from what the student
    // planted in Season 1 (selectedCrops holds names, plotCounts holds counts).
    function portfolioText() {
      if (selectedCrops.length === 0) return "Your crops: (none planted)";
      const parts = selectedCrops.map((name) => {
        const plots = plotCounts[name] || 0;
        return name + " (" + plots + " plots)";
      });
      return "Your crops: " + parts.join(", ");
    }

    // Show the three choice buttons; hide the shift picker + confirmation.
    // This is the starting state of Beat 2 every time the student arrives.
    function resetBeat2View() {
      doc.getElementById("portfolio-text")?.setProperties({ text: portfolioText() });
      doc.getElementById("options-row")?.setProperties({ display: "flex" });
      doc.getElementById("shift-picker")?.setProperties({ display: "none" });
      doc.getElementById("confirm-area")?.setProperties({ display: "none" });
    }

    // Enter Beat 2: refresh its content and switch to it.
    function enterBeat2() {
      resetBeat2View();
      showSeason2Beat(2);
    }

    // Show a confirmation message + the "Begin Harvest" button, and hide the
    // choices so the decision is final. Called by every strategy once it's done.
    function showConfirmation(message: string) {
      doc.getElementById("options-row")?.setProperties({ display: "none" });
      doc.getElementById("shift-picker")?.setProperties({ display: "none" });
      doc.getElementById("confirm-line")?.setProperties({ text: message });
      doc.getElementById("confirm-area")?.setProperties({ display: "flex" });
    }

    // ----- Strategy 1: SHIFT CROPS -----------------------------------------
    // The student pivots toward a crop NOT hurt by the event. We first show a
    // picker of eligible crops; tapping one performs the shift.

    // Reveal the crop picker, filling it with every crop except the affected
    // one. Up to 4 buttons exist in the markup; we fill + show only what we need.
    function openShiftPicker() {
      const affected = SEASON2_EVENTS[season2Event].crop; // e.g. "Corn"
      // Eligible crops = all crops except the one the event hurt.
      const options = CROPS.filter((crop) => crop.name !== affected);

      for (let i = 0; i < 4; i++) {
        const button = doc.getElementById("shift-opt-" + i);
        const option = options[i]; // undefined past the end of the list
        if (option) {
          button?.setProperties({
            display: "flex",
            onClick: () => shiftToCrop(option.name),
          });
          doc
            .getElementById("shift-opt-label-" + i)
            ?.setProperties({ text: option.name });
        } else {
          button?.setProperties({ display: "none" });
        }
      }

      // Hide the three main choices and reveal the picker.
      doc.getElementById("options-row")?.setProperties({ display: "none" });
      doc.getElementById("shift-picker")?.setProperties({ display: "flex" });
    }

    // Actually move the student's plots toward the chosen crop.
    function shiftToCrop(targetName: string) {
      season2Decision = "shift";
      const affected = SEASON2_EVENTS[season2Event].crop;

      // Make sure the new crop is part of the plan and has a plot count.
      if (!selectedCrops.includes(targetName)) selectedCrops.push(targetName);
      if (plotCounts[targetName] === undefined) plotCounts[targetName] = 0;

      // Move the affected crop's plots over to the new crop. If the student
      // wasn't even growing the affected crop, just give the pivot 2 fresh plots.
      const movedPlots = plotCounts[affected] || 0;
      if (movedPlots > 0) {
        plotCounts[targetName] += movedPlots;
        plotCounts[affected] = 0;
      } else {
        plotCounts[targetName] += 2;
      }

      // Shifting is a smart, flexible move -> reward adaptability.
      updateScore("adaptability", 15);

      // activePrices already reflects the event; the new crop is priced from it.
      console.log(
        "Shifted plots toward " + targetName + ". Plot counts: " + JSON.stringify(plotCounts),
      );
      showConfirmation(
        "You shifted your plots toward " + targetName + ". A flexible move - your adaptability rises. (+15 Adaptability)",
      );
    }

    // ----- Strategy 2: DOUBLE DOWN -----------------------------------------
    // The student keeps their current plan. No score change, EXCEPT a small
    // revenue bonus if they happened to be growing the crop the event helped.
    function doubleDown() {
      season2Decision = "doubledown";

      // The only event that HELPS a crop is the cotton demand surge (event 1).
      const benefited =
        season2Event === 1 && selectedCrops.includes("Cotton");

      if (benefited) {
        updateScore("revenue", 10); // their cotton bet paid off
        console.log("Double down: cotton bet paid off (+10 revenue).");
        showConfirmation(
          "You held firm - and your cotton is exactly what England wants. (+10 Revenue)",
        );
      } else {
        console.log("Double down: kept the original plan, no score change.");
        showConfirmation(
          "You held firm with your original plan. Time will tell if it pays off.",
        );
      }
    }

    // ----- Strategy 3: DIVERSIFY -------------------------------------------
    // The student spreads their plots more evenly across all selected crops.
    function diversify() {
      season2Decision = "diversify";

      // Spread the total plots as evenly as possible across the chosen crops.
      const cropCount = selectedCrops.length;
      if (cropCount > 0) {
        let totalPlots = 0;
        for (const name of selectedCrops) totalPlots += plotCounts[name] || 0;

        const base = Math.floor(totalPlots / cropCount); // even share each
        let remainder = totalPlots - base * cropCount; // leftover plots to hand out
        for (const name of selectedCrops) {
          // Give everyone the base share, plus one extra until the remainder runs out.
          plotCounts[name] = base + (remainder > 0 ? 1 : 0);
          if (remainder > 0) remainder--;
        }
      }

      // Spreading risk keeps the crops healthier overall.
      updateScore("crophealth", 10);
      console.log(
        "Diversified plots evenly: " + JSON.stringify(plotCounts),
      );
      showConfirmation(
        "You spread your plots evenly across your crops. A balanced field is a healthy field. (+10 Crop Health)",
      );
    }

    // Wire the three strategy buttons to their handlers.
    doc
      .getElementById("shift-button")
      ?.setProperties({ onClick: () => openShiftPicker() });
    doc
      .getElementById("doubledown-button")
      ?.setProperties({ onClick: () => doubleDown() });
    doc
      .getElementById("diversify-button")
      ?.setProperties({ onClick: () => diversify() });

    // "Begin Harvest" leaves Season 2 and moves on to Season 3.
    doc
      .getElementById("harvest-button")
      ?.setProperties({ onClick: () => nextPhase() });

    // ========================================================================
    // WORLD-SPACE SEASON 2 (event effects + price sign + strategy corkboard)
    // ------------------------------------------------------------------------
    // Instead of reading the flat panel above, the student now experiences
    // Season 2 out in the 3D world: the market event physically changes the
    // field, an updated price sign appears at Samuel's stall, and a corkboard
    // of three strategy cards is pinned to the farmhouse wall. Everything here
    // is self-contained so it doesn't touch Samuel's core structure, the
    // scenery, the phase manager, or the Season 1 market code.
    // ========================================================================

    // -- Bookkeeping ---------------------------------------------------------
    // We remember every entity and timer we create so we can clean them all up
    // (when the student chooses, or if the game is replayed from the start).
    let s2WorldEntities: any[] = []; // boxes, planes, sprouts we spawned
    let s2Timers: ReturnType<typeof setInterval>[] = []; // animation timers

    // Named handles for the special event props (so they read clearly).
    let droughtHaze: any = null; // event 0: pulsing heat-shimmer plane
    let horizonShip: any = null; // event 1: distant ship silhouette
    let competitorSprouts: any[] = []; // event 2: rival tobacco sprouts

    // The three corkboard cards (created when Season 2 opens). The watch loop
    // below reads whichever cards currently exist.
    let shiftCard: any = null;
    let doubleDownCard: any = null;
    let diversifyCard: any = null;
    let s2CorkboardActive = false; // true only while the cards are clickable

    // makeS2TextPlane(): draw stacked, word-wrapped text onto a canvas and turn
    // it into a flat plane entity. This mirrors Season 1's market text helper,
    // which lives in a different callback and isn't reachable from here.
    function makeS2TextPlane(
      blocks: { text: string; bold?: boolean; fontPx?: number; color?: string }[],
      widthM: number,
      heightM: number,
      position: [number, number, number],
      defaultColor = "#1F3A5F",
    ) {
      const PX_PER_M = 512; // canvas pixels per meter (keeps the text crisp)
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(widthM * PX_PER_M);
      canvas.height = Math.round(heightM * PX_PER_M);
      const ctx = canvas.getContext("2d")!;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const maxWidth = canvas.width * 0.92; // leave a small side margin

      // 1. Word-wrap every block into the display lines that actually fit.
      const lines: { text: string; bold: boolean; fontPx: number; color: string }[] = [];
      for (const b of blocks) {
        const fontPx = b.fontPx ?? 30;
        const bold = b.bold ?? false;
        const color = b.color ?? defaultColor;
        ctx.font = (bold ? "bold " : "") + fontPx + "px system-ui, sans-serif";
        let line = "";
        for (const word of b.text.split(" ")) {
          const candidate = line ? line + " " + word : word;
          if (ctx.measureText(candidate).width > maxWidth && line) {
            lines.push({ text: line, bold, fontPx, color });
            line = word; // current line is full — start a new one
          } else {
            line = candidate;
          }
        }
        lines.push({ text: line, bold, fontPx, color });
      }

      // 2. Stack the lines vertically, centered as a group.
      let totalH = 0;
      for (const l of lines) totalH += l.fontPx * 1.35;
      let y = canvas.height / 2 - totalH / 2;
      for (const l of lines) {
        y += (l.fontPx * 1.35) / 2;
        ctx.font = (l.bold ? "bold " : "") + l.fontPx + "px system-ui, sans-serif";
        ctx.fillStyle = l.color;
        ctx.fillText(l.text, canvas.width / 2, y);
        y += (l.fontPx * 1.35) / 2;
      }

      // 3. Wrap the canvas in a texture and make a flat plane entity from it.
      const texture = new CanvasTexture(canvas);
      texture.colorSpace = SRGBColorSpace;
      const mesh = new Mesh(
        new PlaneGeometry(widthM, heightM),
        new MeshBasicMaterial({ map: texture, transparent: true, side: DoubleSide }),
      );
      const entity = world.createTransformEntity(mesh);
      entity.object3D!.position.set(position[0], position[1], position[2]);
      return entity;
    }

    // animateSproutScaleY(): smoothly change one sprout's vertical scale toward a
    // target value over `durationMs`, nudging it every 50 ms with a setInterval.
    function animateSproutScaleY(
      sproutEntity: any,
      targetY: number,
      durationMs: number,
    ) {
      const obj = sproutEntity?.object3D;
      if (!obj) return; // nothing to animate
      const startY = obj.scale.y; // where the sprout is right now
      const tickMs = 50; // update ~20 times per second
      let elapsed = 0;
      const timer = setInterval(() => {
        elapsed += tickMs;
        const t = Math.min(elapsed / durationMs, 1); // progress 0 -> 1
        obj.scale.y = startY + (targetY - startY) * t; // ease linearly
        if (t >= 1) clearInterval(timer); // done — stop this timer
      }, tickMs);
      s2Timers.push(timer);
    }

    // teardownSeason2World(): dispose every prop and stop every timer. Used on
    // (re)entry so a replay starts from a clean slate with no leftovers.
    function teardownSeason2World() {
      for (const t of s2Timers) clearInterval(t);
      s2Timers = [];
      for (const e of s2WorldEntities) {
        if (e && e.dispose) e.dispose(); // dispose() also frees GPU memory
      }
      s2WorldEntities = [];
      droughtHaze = null;
      horizonShip = null;
      competitorSprouts = [];
      shiftCard = null;
      doubleDownCard = null;
      diversifyCard = null;
      s2CorkboardActive = false;
    }

    // hideSeason2World(): after the student chooses, hide all the props and stop
    // the animations (we don't fully dispose here — teardown handles replay).
    function hideSeason2World() {
      s2CorkboardActive = false; // ignore any further card clicks
      for (const t of s2Timers) clearInterval(t);
      s2Timers = [];
      for (const e of s2WorldEntities) {
        if (e && e.object3D) e.object3D.visible = false;
      }
    }

    // ------------------------------------------------------------------------
    // EVENT 0 — DROUGHT: corn wilts, heat shimmers over the field, corn price
    // drops by 2 coins.
    // ------------------------------------------------------------------------
    function applyDroughtEvent() {
      // Shrink every corn sprout to HALF its current height over 2 seconds.
      for (const plot of fieldPlots) {
        if (plot.cropType === "corn" && plot.sproutEntity) {
          const halfHeight = plot.sproutEntity.object3D!.scale.y * 0.5;
          animateSproutScaleY(plot.sproutEntity, halfHeight, 2000);
        }
      }

      // A large flat plane hanging above the field, tinted hot orange and very
      // see-through, that gently pulses opacity to read as wavering heat haze.
      const hazeMaterial = new MeshBasicMaterial({
        color: new Color("#cc6600"),
        transparent: true,
        opacity: 0.12,
        side: DoubleSide,
      });
      const hazeMesh = new Mesh(new PlaneGeometry(10, 10), hazeMaterial);
      droughtHaze = world.createTransformEntity(hazeMesh);
      droughtHaze.object3D!.position.set(0, 3, FIELD_CENTER_Z); // above the field
      droughtHaze.object3D!.rotation.x = -Math.PI / 2; // lie flat, facing down
      s2WorldEntities.push(droughtHaze);

      // Pulse opacity between 0.07 and 0.17, one full cycle every 2 seconds.
      {
        const periodMs = 2000;
        const tickMs = 50;
        let elapsed = 0;
        const timer = setInterval(() => {
          elapsed += tickMs;
          const phase = (elapsed % periodMs) / periodMs; // loops 0 -> 1
          // sin() swings -1..1; map it onto the 0.07 .. 0.17 opacity range.
          hazeMaterial.opacity = 0.12 + 0.05 * Math.sin(phase * Math.PI * 2);
        }, tickMs);
        s2Timers.push(timer);
      }

      // Scarce corn sells for MORE — raise the price as Samuel breaks the news.
      activePrices.corn = CONSTANTS.PRICE_CORN + 3;
      samuelSpeak(
        "Bad news, friend. A fierce drought dried the fields. 🌞 There's only HALF the usual corn this year. Hmm… what do you think that does to corn's price?",
      );
    }

    // ------------------------------------------------------------------------
    // EVENT 1 — COTTON DEMAND SURGE: cotton grows taller, a ship appears on the
    // horizon (England waiting to buy), cotton price rises by 4 coins.
    // ------------------------------------------------------------------------
    function applyCottonSurgeEvent() {
      // Grow every cotton sprout a little taller (+0.3 scale) over 2 seconds.
      for (const plot of fieldPlots) {
        if (plot.cropType === "cotton" && plot.sproutEntity) {
          const taller = plot.sproutEntity.object3D!.scale.y + 0.3;
          animateSproutScaleY(plot.sproutEntity, taller, 2000);
        }
      }

      // A small dark box far behind the farmhouse reads as a distant ship on
      // the horizon. The farmhouse sits at z = -6, so ~15 units back is z = -21.
      horizonShip = makeBox(2, 0.6, 0.5, "#1F3A5F", [0, 0.8, -21]);
      s2WorldEntities.push(horizonShip);

      // Raise the cotton price and let Samuel share the good word.
      activePrices.cotton = CONSTANTS.PRICE_COTTON + 4;
      samuelSpeak(
        "Word from the docks — England wants all the cotton we can grow! ☁️ Ships are waiting. If you planted cotton, this is your moment!",
      );
    }

    // ------------------------------------------------------------------------
    // EVENT 2 — TOBACCO OVERSUPPLY: rival tobacco sprouts crowd in behind the
    // fence, tobacco price falls by 3 coins.
    // ------------------------------------------------------------------------
    function applyTobaccoOversupplyEvent() {
      // Stand up 5 short golden cylinders just behind the fence line to show
      // that every neighbor grew tobacco too. fenceZ is the fence row; we nudge
      // a little further from the player (toward -Z) so they sit behind it.
      const rivalZ = fenceZ - 0.3;
      for (let i = 0; i < 5; i++) {
        const x = (i - 2) * 0.9; // spread 5 sprouts across the field's width
        const mesh = new Mesh(
          new CylinderGeometry(0.06, 0.06, 0.6, 8), // 0.6 units tall
          new MeshBasicMaterial({ color: new Color("#c8962a") }),
        );
        const sprout = world.createTransformEntity(mesh);
        // y = 0.3 (half the 0.6 height) rests the cylinder on the ground.
        sprout.object3D!.position.set(x, 0.3, rivalZ);
        competitorSprouts.push(sprout);
        s2WorldEntities.push(sprout);
      }

      // Lower the tobacco price and let Samuel level with the student.
      activePrices.tobacco = CONSTANTS.PRICE_TOBACCO - 3;
      samuelSpeak(
        "I'll be honest with you. Everyone grew tobacco this year. 🌿 With so much for sale, the price has dropped — hard. 📉",
      );
    }

    // ------------------------------------------------------------------------
    // PRICE SIGN at Samuel's stall — shows the updated activePrices so the
    // student can walk over and read exactly what the event changed.
    // ------------------------------------------------------------------------
    function buildS2PriceSign() {
      // Same spot Season 1 used: just in front-left of the stall counter.
      const signX = samuelStallPosition[0] - 1.4;
      const signZ = samuelStallPosition[2] + 0.9; // nudged toward the player

      // A thin vertical wooden post with a cream board behind the price text.
      const post = makeBox(0.08, 1.4, 0.08, "#5b3a21", [signX, 0.7, signZ]);
      s2WorldEntities.push(post);
      const s2SignBoard = makeBox(
        1.04,
        0.78,
        0.04,
        "#f7eed9",
        [signX, 1.55, signZ + 0.02],
        true,
      );
      s2WorldEntities.push(s2SignBoard);

      // A flat panel listing all four crops' current (post-event) prices, with
      // green ▲ / red ▼ arrows showing how each compares to its base price.
      const s2BasePrices: Record<string, number> = {
        tobacco: CONSTANTS.PRICE_TOBACCO,
        wheat: CONSTANTS.PRICE_WHEAT,
        corn: CONSTANTS.PRICE_CORN,
        cotton: CONSTANTS.PRICE_COTTON,
      };
      const s2PriceLines = ["tobacco", "wheat", "corn", "cotton"].map((id) => {
        const price = activePrices[id];
        const base = s2BasePrices[id];
        const arrow = price > base ? " ▲" : price < base ? " ▼" : "";
        const color =
          price > base ? "#2e7d32" : price < base ? "#b3402e" : "#1F3A5F";
        const name = id.charAt(0).toUpperCase() + id.slice(1);
        return { text: name + ": " + price + " 🪙" + arrow, fontPx: 28, color };
      });
      const signPanel = makeS2TextPlane(
        [
          { text: "🪙 Market Prices", bold: true, fontPx: 34, color: TEXT_GOLD },
          ...s2PriceLines,
        ],
        0.95,
        0.7,
        [signX, 1.55, signZ + 0.05],
      );
      s2WorldEntities.push(signPanel);
    }

    // ------------------------------------------------------------------------
    // STRATEGY HELPERS — figure out whether the student planted the crop that
    // benefited from this event (only the cotton surge helps a crop).
    // ------------------------------------------------------------------------
    function eventBeneficiaryCrop(): string | null {
      // Event 1 (cotton surge) is the only event that RAISES a crop's value.
      // Drought (0) and oversupply (2) only hurt a crop — nobody benefits.
      if (season2Event === 1) return "cotton";
      return null;
    }

    function plantedBeneficiary(): boolean {
      const benefit = eventBeneficiaryCrop();
      if (!benefit) return false; // this event helped no one
      // plantingRecord holds one { cropType } entry per planted plot.
      return plantingRecord.some((r) => r.cropType === benefit);
    }

    // finishSeason2(decision): record the choice, hide the world props, and
    // advance to Season 3. Score changes happen in each card's handler first.
    function finishSeason2(decision: "shift" | "doubledown" | "diversify") {
      season2Decision = decision;
      hideSeason2World();
      nextPhase();
    }

    // The three card click handlers, one per strategy.
    function onShiftCrops() {
      // Adapting your plan is the smart, flexible move.
      updateScore("adaptability", 15);
      finishSeason2("shift");
    }
    function onDoubleDown() {
      // Sticking with the plan only pays off if you grew the crop that benefited.
      if (plantedBeneficiary()) updateScore("revenue", 10);
      finishSeason2("doubledown");
    }
    function onDiversify() {
      // Spreading effort across crops keeps the field healthier overall.
      updateScore("crophealth", 10);
      finishSeason2("diversify");
    }

    // ------------------------------------------------------------------------
    // STRATEGY CORKBOARD on the farmhouse front wall — three clickable cards.
    // ------------------------------------------------------------------------
    function buildS2Corkboard() {
      // The farmhouse walls box is centered at z = -6 and 2 deep, so its FRONT
      // face is at z = -5. Mount the board just in front so it faces the player.
      const boardZ = -4.9;
      const board = makeBox(1.8, 1.0, 0.05, "#c8a560", [0, 1.3, boardZ]);
      s2WorldEntities.push(board);

      // A tiny helper to build one card: a clickable cream box plus its text.
      function makeCard(
        x: number,
        title: string,
        body: string,
      ) {
        // The card box itself is the clickable ray target (RayInteractable).
        // Unlit so it stays bright and readable like a UI card.
        const card = makeBox(
          0.5,
          0.8,
          0.03,
          "#f3e9d2",
          [x, 1.3, boardZ + 0.06],
          true,
        );
        card.addComponent(RayInteractable);
        s2WorldEntities.push(card);

        // The text sits just in front of the card box. Text planes aren't
        // interactable, so they never block the ray from reaching the card.
        const label = makeS2TextPlane(
          [
            { text: title, bold: true, fontPx: 30 },
            { text: body, fontPx: 20 },
          ],
          0.46,
          0.74,
          [x, 1.3, boardZ + 0.08],
        );
        s2WorldEntities.push(label);
        return card;
      }

      // Three cards spread across the board: Shift / Double Down / Diversify.
      shiftCard = makeCard(
        -0.6,
        "Shift Crops 🔄",
        "Switch away from the crop in trouble.",
      );
      doubleDownCard = makeCard(
        0,
        "Double Down 🎯",
        "Stick with your plan and ride it out!",
      );
      diversifyCard = makeCard(
        0.6,
        "Diversify 🧺",
        "Spread out across all crops — safer!",
      );

      // The cards are now live: the watch loop below reacts to clicks.
      s2CorkboardActive = true;
    }

    // One watch loop drives all three cards. The InputSystem adds the Pressed
    // tag while a ray/pointer is clicking a card; we fire ONCE on the rising
    // edge (was-not-pressed -> now-pressed), only while the corkboard is active
    // and Season 2 is the current phase (so a stray hit can't fire afterwards).
    function watchSeason2Cards() {
      // A press is consumed the frame we see it, so seeing one IS the click.
      const live = s2CorkboardActive && currentPhase === PHASE_SEASON2;
      if (shiftCard && shiftCard.hasComponent(Pressed)) {
        if (live) onShiftCrops();
        consumePress(shiftCard);
      }
      if (doubleDownCard && doubleDownCard.hasComponent(Pressed)) {
        if (live) onDoubleDown();
        consumePress(doubleDownCard);
      }
      if (diversifyCard && diversifyCard.hasComponent(Pressed)) {
        if (live) onDiversify();
        consumePress(diversifyCard);
      }
    }
    // setInterval (not rAF): keeps working inside immersive XR sessions.
    setInterval(watchSeason2Cards, 33); // idles until the corkboard opens

    // buildSeason2World(): assemble everything for whichever event was rolled.
    function buildSeason2World() {
      // Clear out anything left from a previous playthrough (replay safety).
      teardownSeason2World();

      // 1. Start activePrices from the untouched base prices in CONSTANTS.
      //    (applySeason2Event already does this; we re-assert it here so the
      //    price math sits right next to the visuals it explains.)
      activePrices = {
        tobacco: CONSTANTS.PRICE_TOBACCO,
        wheat: CONSTANTS.PRICE_WHEAT,
        corn: CONSTANTS.PRICE_CORN,
        cotton: CONSTANTS.PRICE_COTTON,
      };

      // 2. Apply this event's world effects + price change (and Samuel's line).
      if (season2Event === 0) {
        applyDroughtEvent();
      } else if (season2Event === 1) {
        applyCottonSurgeEvent();
      } else if (season2Event === 2) {
        applyTobaccoOversupplyEvent();
      }

      // 3. SAMUEL GATE + MARKET QUIZ. The strategy board stays locked until
      //    the student (a) reads Samuel's news, then (b) predicts what the
      //    news does to prices. Only then do the price sign and the three
      //    strategy cards appear.
      const s2LockedNote = makeLockedNote();
      s2WorldEntities.push(s2LockedNote);
      setObjective("Walk to Samuel's stall — big market news! ❗");
      onSamuelNewsRead = () => {
        setObjective("Answer Samuel's market question! 🤔");
        const quiz = S2_QUIZ[season2Event];
        askMarketQuestion({
          question: quiz.question,
          correctIsUp: quiz.up,
          explainRight: quiz.right,
          explainWrong: quiz.wrong,
          onDone: () => {
            // Reveal the new prices and unlock the strategy board.
            s2LockedNote.object3D!.visible = false;
            buildS2PriceSign();
            buildS2Corkboard();
            setObjective("Farmhouse board: choose your strategy! 📌");
          },
        });
      };
    }

    // ------------------------------------------------------------------------
    // ENTER SEASON 2: runs from showPhase('season2') via the onEnterSeason2
    // hook, once both the event and the student's Season 1 portfolio are known.
    // ------------------------------------------------------------------------
    onEnterSeason2 = () => {
      season2Decision = null; // clear any previous choice
      applySeason2Event(); // bake the event into activePrices/activeYields

      // Hide the flat Season 2 panel — this season now plays out in the 3D
      // world (field effects, the stall price sign, and the wall corkboard).
      season2Panel.object3D!.visible = false;

      // The panel beats are no longer shown, but we keep their setup running so
      // Samuel's core structure stays untouched.
      renderBeat1(); // fill Samuel's line + the market report
      resetBeat2View(); // prep Beat 2 (hidden until the student advances)
      showSeason2Beat(1); // start on Beat 1 (Samuel's news)

      // Build all the world-space pieces for whichever event was rolled.
      buildSeason2World();
    };

    // Clean initial state while the panel is still hidden at startup.
    showSeason2Beat(1);
  });

  // ==========================================================================
  // SEASON 3 SCREEN (the final competitive challenge)
  // --------------------------------------------------------------------------
  // The last spatial panel, placed at the SAME spot as every other phase panel.
  // It stays hidden until showPhase('season3') runs (the phase manager handles
  // that). When the student arrives, a fresh random event has already nudged
  // prices one last time, and they make their final strategy decision.
  //
  // The screen has two "beats" (mini-steps), laid out in ui/season3.uikitml:
  //   Beat 1 — Samuel's News:   the NPC reveals the new market event + effect.
  //   Beat 2 — Final Decision:  Expand Production / Protect Your Land, then the
  //                             year's harvest is tallied and summarized.
  // ==========================================================================

  // A shared list of the Season 3 world props (price sign, corkboard, crates,
  // floating text). It lives out here at the closure level — instead of inside
  // the Season 3 callback — so the Report phase further below can also reach in
  // and hide every leftover prop when the year ends.
  let s3WorldEntities: any[] = [];

  // The report's confetti + fanfare, assigned down in the GAME FEEL section
  // (the confetti helpers are built there). showReportBoard() fires it once
  // the notice board finishes rising.
  let fireReportCelebration: (() => void) | null = null;

  const season3Panel = world
    .createTransformEntity()
    .addComponent(PanelUI, {
      config: "./ui/season3.json",
      maxWidth: 2.4,
      maxHeight: 1.8,
    });
  // NOTE: no Interactable here on purpose. This flat panel is abandoned (the
  // experience is played with 3D world objects/buttons instead) and is kept
  // hidden. Pointer raycasting does NOT skip invisible meshes, so if this panel
  // were a ray target it would sit stacked at the same spot as the welcome panel
  // and silently swallow clicks meant for it. Leaving Interactable off keeps it
  // out of the hit-test set entirely.

  // Same world position as every other phase panel: center of the world, eye
  // height, facing the player.
  season3Panel.object3D!.position.set(0, 1.3, -1.2);

  // Hidden by default. showPhase('season3') reveals it (and hides Season 2).
  season3Panel.object3D!.visible = false;

  // Register with the phase manager so showPhase()/nextPhase() can show this
  // panel and hide the Season 2 panel automatically when Season 3 begins.
  phasePanels[PHASE_SEASON3] = season3Panel;

  // Wire up both beats once the panel's UI document has loaded.
  whenPanelReady(season3Panel, (doc) => {
    // ------------------------------------------------------------------------
    // Beat switching: show exactly one beat by flipping each beat container's
    // `display` between "flex" (visible) and "none" (hidden).
    // ------------------------------------------------------------------------
    function showSeason3Beat(beat: number) {
      doc
        .getElementById("s3-beat1")
        ?.setProperties({ display: beat === 1 ? "flex" : "none" });
      doc
        .getElementById("s3-beat2")
        ?.setProperties({ display: beat === 2 ? "flex" : "none" });
    }

    // Add up the plots across every crop the student is growing. Used to
    // enforce the 12-plot cap when the student chooses to expand.
    function totalPlots() {
      let sum = 0;
      for (const name of selectedCrops) {
        sum += plotCounts[name] || 0;
      }
      return sum;
    }

    // ========================================================================
    // BEAT 1 — SAMUEL DELIVERS NEW COMPETITION NEWS
    // ========================================================================

    // Fill Beat 1's text from whichever Season 3 event was rolled this time.
    function renderS3Beat1() {
      const event = SEASON3_EVENTS[season3Event]; // the event that happened

      // Samuel's name label + his spoken line (shown again, as in Season 2).
      doc.getElementById("s3-npc-name")?.setProperties({ text: CONSTANTS.NPC_NAME });
      doc.getElementById("s3-samuel-line")?.setProperties({ text: event.samuel });

      // The stat card beneath Samuel's line summarizing the price effect.
      doc.getElementById("s3-report-event")?.setProperties({ text: event.name });
      doc.getElementById("s3-report-change")?.setProperties({ text: event.effect });
    }

    // "Make Your Final Decision" advances to Beat 2.
    doc
      .getElementById("s3-decision-button")
      ?.setProperties({ onClick: () => enterS3Beat2() });

    // ========================================================================
    // BEAT 2 — FINAL STRATEGY DECISION
    // ========================================================================

    // Build the "Your crops: Tobacco (3 plots), ..." line from what the student
    // is currently growing (selectedCrops holds names, plotCounts holds counts).
    function portfolioText() {
      if (selectedCrops.length === 0) return "Your crops: (none planted)";
      const parts = selectedCrops.map((name) => {
        const plots = plotCounts[name] || 0;
        return name + " (" + plots + " plots)";
      });
      return "Your crops: " + parts.join(", ");
    }

    // Build the "Current prices: Tobacco 7, Wheat 5, ..." line from the updated
    // activePrices, listing only the crops the student is actually growing.
    function pricesText() {
      if (selectedCrops.length === 0) return "Current prices: (no crops)";
      const parts = selectedCrops.map((name) => {
        const crop = getCropByName(name);
        const price = crop ? activePrices[crop.id] || 0 : 0;
        return name + " " + price;
      });
      return "Current prices: " + parts.join(", ") + " coins";
    }

    // Show Beat 2's starting state: heading, portfolio, prices, and the two
    // option buttons. The harvest summary + report button stay hidden until the
    // student picks an option.
    function resetS3Beat2View() {
      doc
        .getElementById("s3-heading")
        ?.setProperties({ text: "Final Season: Your Last Move" });
      doc.getElementById("s3-portfolio-text")?.setProperties({ text: portfolioText() });
      doc.getElementById("s3-prices-text")?.setProperties({ text: pricesText() });

      // Show the two choices; hide the post-decision summary area.
      doc.getElementById("s3-options-row")?.setProperties({ display: "flex" });
      doc.getElementById("s3-summary-area")?.setProperties({ display: "none" });
    }

    // Enter Beat 2: refresh its content and switch to it.
    function enterS3Beat2() {
      resetS3Beat2View();
      showSeason3Beat(2);
    }

    // ----- Option 1: EXPAND PRODUCTION -------------------------------------
    // The student grows their farm by up to 3 more plots (capped at 12 total),
    // betting on volume. The reward depends on whether prices rose or fell.
    function expandProduction() {
      season3Decision = "expand";

      // Hand out up to 3 extra plots, one at a time, spread across the crops the
      // student already grows — but never push the farm past the 12-plot cap.
      let plotsToAdd = 3;
      // Cap 20, not 12: the field itself holds 16 plots now (every plot must
      // be planted), so expanding rents extra land beyond the visible field.
      while (plotsToAdd > 0 && totalPlots() < 20 && selectedCrops.length > 0) {
        for (const name of selectedCrops) {
          if (plotsToAdd <= 0 || totalPlots() >= 20) break;
          plotCounts[name] = (plotCounts[name] || 0) + 1;
          plotsToAdd--;
        }
      }

      // Reward expanding when prices are up; penalize it when prices dropped.
      // (priceDelta > 0 means the "New trade route" event raised every price.)
      if (SEASON3_EVENTS[season3Event].priceDelta > 0) {
        updateScore("revenue", 10); // good year to grow more
      } else {
        updateScore("revenue", -5); // expanding into falling prices stings
      }

      finishHarvest(); // tally the year now that plots are final
    }

    // ----- Option 2: PROTECT YOUR LAND -------------------------------------
    // The student keeps their current plots and invests in soil quality instead,
    // improving crop health for a safer, steadier finish.
    function protectLand() {
      season3Decision = "protect";
      updateScore("crophealth", 15); // healthier soil and crops
      finishHarvest(); // tally the year (plots unchanged)
    }

    // finishHarvest(): calculate the final harvest earnings, add them to the
    // running farmRevenue total, and show the summary line + report button.
    function finishHarvest() {
      // 1. Earnings = plots x yield x current price, summed over every crop.
      //    activeYields already holds the CONSTANTS yields modified by any
      //    earlier event (e.g. the Season 2 drought halved corn's yield).
      let earnings = 0;
      for (const name of selectedCrops) {
        const crop = getCropByName(name);
        if (!crop) continue;
        const plots = plotCounts[name] || 0;
        const yieldPerPlot = activeYields[crop.id] || 0;
        const price = activePrices[crop.id] || 0;
        earnings += plots * yieldPerPlot * price;
      }

      // 2. If the student HELD their Season 1 crops instead of selling, sell that
      //    inventory now at this season's prices and add it to the harvest total.
      let heldSale = 0;
      if (season1Decision === "hold") {
        // heldInventory is a copy of plantingRecord: one { cropType: <id> } entry
        // per held plot. Sell each plot's yield at THIS season's price, both keyed
        // by lowercase id. (Reading the old { crop, units, price } shape here is
        // what produced NaN — those fields don't exist on these items.)
        for (const item of heldInventory) {
          const id = item.cropType;
          const unitsPerPlot = activeYields[id] || 0;
          const price = activePrices[id] || 0;
          heldSale += unitsPerPlot * price;
        }
      }

      // 3. Bank this final season's earnings into the running farm revenue,
      //    and refresh the HUD/scoreboard so the coin total updates right away.
      const seasonEarnings = earnings + heldSale;
      farmRevenue += seasonEarnings;
      refreshHUD();
      console.log(
        "Final harvest: " +
          seasonEarnings +
          " coins (harvest " +
          earnings +
          " + held " +
          heldSale +
          "). Farm revenue: " +
          farmRevenue,
      );

      // 4. Show the summary line and swap the option buttons for the report button.
      doc.getElementById("s3-summary-line")?.setProperties({
        text:
          "Harvest complete. Total earnings this year: " +
          seasonEarnings +
          " coins.",
      });
      doc.getElementById("s3-options-row")?.setProperties({ display: "none" });
      doc.getElementById("s3-summary-area")?.setProperties({ display: "flex" });
    }

    // Wire the two final-decision buttons to their handlers.
    doc
      .getElementById("s3-expand-button")
      ?.setProperties({ onClick: () => expandProduction() });
    doc
      .getElementById("s3-protect-button")
      ?.setProperties({ onClick: () => protectLand() });

    // "See Your Market Report" leaves Season 3 and moves on to the report phase.
    doc
      .getElementById("s3-report-button")
      ?.setProperties({ onClick: () => nextPhase() });

    // ========================================================================
    // WORLD-SPACE SEASON 3 (stall price sign + final-decision corkboard + the
    // animated harvest). Just like Season 2, the student now experiences the
    // final season out in the 3D world instead of reading the flat panel above.
    // Everything here is self-contained: it never touches Samuel's structure,
    // the scenery, the phase manager, or the earlier seasons' code.
    // ========================================================================

    // -- Bookkeeping for the props/timers we spawn (so a replay can clean up) -
    let s3CorkboardEntities: any[] = []; // the board + its two cards and labels
    let s3Timers: ReturnType<typeof setInterval>[] = []; // grow / harvest timers
    let expandCard: any = null; // the "Expand Production" card (clickable)
    let protectCard: any = null; // the "Protect the Land" card (clickable)
    let s3CorkboardActive = false; // true only while the two cards are clickable
    let s3FloatingText: any = null; // the "Harvest complete..." text over the field

    // makeS3TextPlane(): draw stacked, word-wrapped lines onto an off-screen
    // canvas and turn it into a flat plane entity. This is a local copy of
    // Season 2's text helper (which lives in another callback we can't reach).
    function makeS3TextPlane(
      blocks: { text: string; bold?: boolean; fontPx?: number; color?: string }[],
      widthM: number,
      heightM: number,
      position: [number, number, number],
      defaultColor = "#1F3A5F",
    ) {
      const S3_PX_PER_M = 512; // canvas pixels per meter (keeps the text crisp)
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(widthM * S3_PX_PER_M);
      canvas.height = Math.round(heightM * S3_PX_PER_M);
      const ctx = canvas.getContext("2d")!;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const maxWidth = canvas.width * 0.92; // leave a small side margin

      // 1. Word-wrap every block into the display lines that actually fit.
      const lines: { text: string; bold: boolean; fontPx: number; color: string }[] = [];
      for (const b of blocks) {
        const fontPx = b.fontPx ?? 30;
        const bold = b.bold ?? false;
        const color = b.color ?? defaultColor;
        ctx.font = (bold ? "bold " : "") + fontPx + "px system-ui, sans-serif";
        let line = "";
        for (const word of b.text.split(" ")) {
          const candidate = line ? line + " " + word : word;
          if (ctx.measureText(candidate).width > maxWidth && line) {
            lines.push({ text: line, bold, fontPx, color });
            line = word; // current line is full — start a new one
          } else {
            line = candidate;
          }
        }
        lines.push({ text: line, bold, fontPx, color });
      }

      // 2. Stack the lines vertically, centered as a group.
      let totalH = 0;
      for (const l of lines) totalH += l.fontPx * 1.35;
      let y = canvas.height / 2 - totalH / 2;
      for (const l of lines) {
        y += (l.fontPx * 1.35) / 2;
        ctx.font = (l.bold ? "bold " : "") + l.fontPx + "px system-ui, sans-serif";
        ctx.fillStyle = l.color;
        ctx.fillText(l.text, canvas.width / 2, y);
        y += (l.fontPx * 1.35) / 2;
      }

      // 3. Wrap the canvas in a texture and make a flat plane entity from it.
      const texture = new CanvasTexture(canvas);
      texture.colorSpace = SRGBColorSpace;
      const mesh = new Mesh(
        new PlaneGeometry(widthM, heightM),
        new MeshBasicMaterial({ map: texture, transparent: true, side: DoubleSide }),
      );
      const entity = world.createTransformEntity(mesh);
      entity.object3D!.position.set(position[0], position[1], position[2]);
      return entity;
    }

    // teardownSeason3World(): dispose every prop and stop every timer, so a
    // replay (Play Again) restarts Season 3 from a clean slate with no leftovers.
    function teardownSeason3World() {
      for (const t of s3Timers) clearInterval(t);
      s3Timers = [];
      for (const e of s3WorldEntities) {
        if (e && e.dispose) e.dispose(); // dispose() also frees GPU memory
      }
      s3WorldEntities = [];
      s3CorkboardEntities = [];
      expandCard = null;
      protectCard = null;
      s3CorkboardActive = false;
      s3FloatingText = null;
    }

    // buildS3PriceSign(): a wooden post + a panel at Samuel's stall listing the
    // new (post-event) prices, so the student can read exactly what changed.
    function buildS3PriceSign() {
      const signX = samuelStallPosition[0] - 1.4; // front-left of the stall
      const signZ = samuelStallPosition[2] + 0.9; // nudged toward the player
      const post = makeBox(0.08, 1.4, 0.08, "#5b3a21", [signX, 0.7, signZ]);
      s3WorldEntities.push(post);
      const s3SignBoard = makeBox(
        1.04,
        0.78,
        0.04,
        "#f7eed9",
        [signX, 1.55, signZ + 0.02],
        true,
      );
      s3WorldEntities.push(s3SignBoard);
      // Same ▲ / ▼ price arrows as the earlier seasons, against base prices.
      const s3BasePrices: Record<string, number> = {
        tobacco: CONSTANTS.PRICE_TOBACCO,
        wheat: CONSTANTS.PRICE_WHEAT,
        corn: CONSTANTS.PRICE_CORN,
        cotton: CONSTANTS.PRICE_COTTON,
      };
      const s3PriceLines = ["tobacco", "wheat", "corn", "cotton"].map((id) => {
        const price = activePrices[id];
        const base = s3BasePrices[id];
        const arrow = price > base ? " ▲" : price < base ? " ▼" : "";
        const color =
          price > base ? "#2e7d32" : price < base ? "#b3402e" : "#1F3A5F";
        const name = id.charAt(0).toUpperCase() + id.slice(1);
        return { text: name + ": " + price + " 🪙" + arrow, fontPx: 28, color };
      });
      const signPanel = makeS3TextPlane(
        [
          { text: "🪙 Market Prices", bold: true, fontPx: 34, color: TEXT_GOLD },
          ...s3PriceLines,
        ],
        0.95,
        0.7,
        [signX, 1.55, signZ + 0.05],
      );
      s3WorldEntities.push(signPanel);
    }

    // hideS3Corkboard(): switch the cards off and hide the board after a choice.
    function hideS3Corkboard() {
      s3CorkboardActive = false; // ignore any further card clicks
      for (const e of s3CorkboardEntities) {
        if (e && e.object3D) e.object3D.visible = false;
      }
    }

    // triggerHarvest(): the animated end-of-season payoff. It grows the crops,
    // stacks up the harvested crates, runs the (existing) farm-revenue math,
    // floats an earnings message, then moves on to the Market Report.
    function triggerHarvest() {
      // 1. Grow every planted sprout's height up to 1.2x over 2 seconds. We
      //    capture each sprout's starting scale so the growth eases smoothly.
      const grown = fieldPlots.filter(
        (p) => p.cropType !== null && p.sproutEntity,
      );
      const startScales = grown.map((p) => p.sproutEntity.object3D!.scale.y);
      const growDurationMs = 2000;
      const tickMs = 50; // update ~20 times per second
      let elapsed = 0;
      const growTimer = setInterval(() => {
        elapsed += tickMs;
        const t = Math.min(elapsed / growDurationMs, 1); // progress 0 -> 1
        for (let i = 0; i < grown.length; i++) {
          grown[i].sproutEntity.object3D!.scale.y =
            startScales[i] + (1.2 - startScales[i]) * t;
        }
        if (t >= 1) {
          clearInterval(growTimer);
          afterGrowth(); // crops are fully grown — show the payoff
        }
      }, tickMs);
      s3Timers.push(growTimer);

      // 2. afterGrowth(): runs once the grow animation finishes.
      function afterGrowth() {
        // a. Stack three wooden crates in a small pile beside the field (the
        //    field's right edge is near x = 1.75, so we sit them at x = 2.4).
        const crateX = 2.4;
        s3WorldEntities.push(
          makeBox(0.4, 0.4, 0.4, "#8b5e3c", [crateX, 0.2, FIELD_CENTER_Z - 0.25]),
        );
        s3WorldEntities.push(
          makeBox(0.4, 0.4, 0.4, "#8b5e3c", [crateX, 0.2, FIELD_CENTER_Z + 0.25]),
        );
        s3WorldEntities.push(
          makeBox(0.4, 0.4, 0.4, "#8b5e3c", [crateX, 0.6, FIELD_CENTER_Z]),
        );

        // b. Run the EXISTING farm-revenue calculation. finishHarvest tallies
        //    plots x yield x price (+ any held inventory) and banks it into
        //    farmRevenue. We do not change that math — we just call it here.
        finishHarvest();

        // c. Float a message above the field showing the year's earnings, on
        //    a navy ribbon (readable against any backdrop), with a coin jingle.
        sfxCoin();
        const harvestHandle = makeSamuelTextPlane(2.6, 0.5, {
          fontPx: 40,
          color: "#ffe9b0",
          bgColor: "rgba(31, 58, 95, 0.88)",
          bold: true,
        });
        harvestHandle.entity.object3D!.position.set(0, 2.5, FIELD_CENTER_Z);
        harvestHandle.setText(
          "Harvest done! You earned " + farmRevenue + " coins this year. 🪙",
        );
        s3FloatingText = harvestHandle.entity;
        s3WorldEntities.push(s3FloatingText);

        // d. After 3 seconds, clear the message and advance to the report.
        const doneTimer = setTimeout(() => {
          if (s3FloatingText && s3FloatingText.object3D) {
            s3FloatingText.object3D.visible = false;
          }
          nextPhase(); // advance to the Market Report
        }, 3000);
        // Remember the timeout so teardown can cancel it on an early replay.
        s3Timers.push(doneTimer as unknown as ReturnType<typeof setInterval>);
      }
    }

    // buildS3Corkboard(): pin the two final-decision cards to the farmhouse wall.
    function buildS3Corkboard() {
      // The farmhouse walls box is centered at z = -6 and 2 deep, so its FRONT
      // face is at z = -5. Mount the board just in front so it faces the player.
      const boardZ = -4.9;
      const board = makeBox(1.8, 1.0, 0.05, "#c8a560", [0, 1.3, boardZ]);
      s3WorldEntities.push(board);
      s3CorkboardEntities.push(board);

      // Build one clickable card: a cream box (the ray target) plus its text.
      function makeCard(
        x: number,
        title: string,
        body: string,
        onSelect: () => void,
      ) {
        const card: any = makeBox(
          0.62,
          0.8,
          0.03,
          "#f3e9d2",
          [x, 1.3, boardZ + 0.06],
          true, // unlit so the card stays bright and readable
        );
        card.addComponent(RayInteractable); // makes the box clickable by ray/pointer
        card.onSelect = onSelect; // the action this card runs when chosen
        s3WorldEntities.push(card);
        s3CorkboardEntities.push(card);
        // The text sits just in front of the card. Text planes aren't
        // interactable, so they never block the ray from reaching the card.
        const label = makeS3TextPlane(
          [
            { text: title, bold: true, fontPx: 28 },
            { text: body, fontPx: 20 },
          ],
          0.58,
          0.74,
          [x, 1.3, boardZ + 0.08],
        );
        s3WorldEntities.push(label);
        s3CorkboardEntities.push(label);
        return card;
      }

      // ----- The two final-decision actions ---------------------------------
      // EXPAND: reuse the existing expand scoring exactly — hand out up to 3
      // extra plots (capped at 12 total) and reward/punish by the price swing.
      function onExpandCard() {
        season3Decision = "expand";

        // Hand out up to 3 extra plots across the crops already grown (cap 12).
        let plotsToAdd = 3;
        // Cap 20, not 12 — see the matching note in the flat-panel handler.
        while (plotsToAdd > 0 && totalPlots() < 20 && selectedCrops.length > 0) {
          for (const name of selectedCrops) {
            if (plotsToAdd <= 0 || totalPlots() >= 20) break;
            plotCounts[name] = (plotCounts[name] || 0) + 1;
            plotsToAdd--;
          }
        }
        // Reward expanding when prices are up; penalize it when prices dropped.
        if (SEASON3_EVENTS[season3Event].priceDelta > 0) {
          updateScore("revenue", 10); // good year to grow more
        } else {
          updateScore("revenue", -5); // expanding into falling prices stings
        }

        hideS3Corkboard();
        triggerHarvest(); // animate the harvest and tally the earnings
      }

      // PROTECT: invest in the soil for a healthier, steadier finish.
      function onProtectCard() {
        season3Decision = "protect";
        updateScore("crophealth", 15); // healthier soil and crops
        hideS3Corkboard();
        triggerHarvest(); // animate the harvest and tally the earnings
      }

      // Two final cards, side by side on the board.
      expandCard = makeCard(
        -0.45,
        "Grow Big 🌾",
        "Go for a bigger harvest this season!",
        onExpandCard,
      );
      protectCard = makeCard(
        0.45,
        "Protect the Land 🛡️",
        "Help your soil now for better harvests later.",
        onProtectCard,
      );

      s3CorkboardActive = true; // the cards are now live for the watch loop below
    }

    // One watch loop drives BOTH cards: fire ONCE on the rising edge of each
    // card's Pressed tag, only while the corkboard is live and Season 3 is the
    // current phase (so a stray hit can never fire afterward).
    function watchSeason3Cards() {
      // A press is consumed the frame we see it, so seeing one IS the click.
      const live = s3CorkboardActive && currentPhase === PHASE_SEASON3;
      if (expandCard && expandCard.hasComponent(Pressed)) {
        if (live) expandCard.onSelect();
        consumePress(expandCard);
      }
      if (protectCard && protectCard.hasComponent(Pressed)) {
        if (live) protectCard.onSelect();
        consumePress(protectCard);
      }
    }
    // setInterval (not rAF): keeps working inside immersive XR sessions.
    setInterval(watchSeason3Cards, 33); // idles until the corkboard opens

    // buildSeason3World(): clear any leftovers, then gate the final decision
    // behind Samuel's news + one last market quiz — the price sign and the
    // two decision cards only appear after the student answers.
    function buildSeason3World() {
      teardownSeason3World();

      const s3LockedNote = makeLockedNote();
      s3WorldEntities.push(s3LockedNote);
      setObjective("One last visit — Samuel has final-season news! ❗");
      onSamuelNewsRead = () => {
        setObjective("Answer Samuel's market question! 🤔");
        const quiz = S3_QUIZ[season3Event];
        askMarketQuestion({
          question: quiz.question,
          correctIsUp: quiz.up,
          explainRight: quiz.right,
          explainWrong: quiz.wrong,
          onDone: () => {
            s3LockedNote.object3D!.visible = false;
            buildS3PriceSign();
            buildS3Corkboard();
            setObjective("Farmhouse board: Grow Big 🌾 or Protect the Land 🛡️?");
          },
        });
      };
    }

    // ------------------------------------------------------------------------
    // ENTER SEASON 3: runs from showPhase('season3') via the onEnterSeason3
    // hook. We roll the event fresh here so prices shift the moment the student
    // arrives, then play the whole season out in the 3D world.
    // ------------------------------------------------------------------------
    onEnterSeason3 = () => {
      season3Decision = null; // clear any previous choice

      // 1. Hide the flat Season 3 panel — this season now plays out in the world.
      season3Panel.object3D!.visible = false;

      // 2. Roll one of the two events and bake its +/-1 price swing into prices.
      season3Event = Math.floor(Math.random() * SEASON3_EVENTS.length);
      applySeason3Event();

      // 3. Keep the (now hidden) panel beats in sync so Samuel's core structure
      //    stays untouched — they are built but never shown.
      renderS3Beat1();
      resetS3Beat2View();
      showSeason3Beat(1);

      // 4. Build the world-space pieces: the updated stall price sign and the
      //    two final-decision cards on the farmhouse corkboard.
      buildSeason3World();

      // 5. Route Samuel's second piece of news through his speech bubble. The
      //    student must walk over to him to read it (proximity reveals it).
      if (SEASON3_EVENTS[season3Event].name === "New competition") {
        samuelSpeak(
          "A colony down south is selling the same crops as us. More sellers means lower prices for everyone. 📉",
        );
      } else {
        samuelSpeak(
          "Great news! A new trade route just opened to the Caribbean. ⛵ More buyers want Virginia goods — prices are looking up! 📈",
        );
      }
    };

    // Clean initial state while the panel is still hidden at startup.
    showSeason3Beat(1);
  });

  // ==========================================================================
  // MARKET REPORT — RESULTS SCREEN (the final phase)
  // --------------------------------------------------------------------------
  // Unlike the earlier phases (which load pre-built UIKitML panels), this whole
  // screen is assembled BY HAND out of plain 3D entities: flat rectangles for
  // the score bars, and small "text planes" (text drawn onto an off-screen
  // canvas, then shown on a flat plane). Everything is parented under ONE
  // transform entity — reportPanel — so we can show or hide the entire screen
  // at once, exactly like the other phase panels.
  // ==========================================================================

  // --- Shared colors for the report screen ----------------------------------
  const REPORT_BG = "#f3e9d2"; // cream panel background (matches the score HUD)
  const REPORT_NAVY = "#1F3A5F"; // headings and labels
  const REPORT_GOLD = "#c8962a"; // the gold fill bars + the rank name
  const REPORT_BAR_BG = "#3b3b3b"; // the dark "empty" part of each score bar

  // The cream backdrop the whole report sits on. By making this the reportPanel
  // entity's OWN mesh, hiding reportPanel hides the backdrop AND every text/bar
  // entity we parent under it (Three.js hides a whole branch when a parent is
  // set invisible).
  const reportBg = new Mesh(
    new PlaneGeometry(2.3, 2.0),
    new MeshBasicMaterial({ color: new Color(REPORT_BG) }),
  );
  const reportPanel = world.createTransformEntity(reportBg);

  // Same spot as every other phase panel: centered, eye height, facing player.
  reportPanel.object3D!.position.set(0, 1.3, -1.2);

  // Hidden until showPhase('report') reveals it (the phase manager does this).
  reportPanel.object3D!.visible = false;

  // Register with the phase manager so it shows/hides like the other panels.
  phasePanels[PHASE_REPORT] = reportPanel;

  // --------------------------------------------------------------------------
  // makeTextPlane(): create a flat 3D entity that displays text. We draw the
  // text onto an off-screen HTML <canvas>, wrap that canvas in a CanvasTexture,
  // and put it on a PlaneGeometry. The returned object has a setText() so the
  // words can be changed later (e.g. once the final scores are known).
  //
  //   widthM/heightM   - the plane's real size in meters (its footprint in 3D)
  //   x, y             - local position ON the panel (0,0 is the panel's center)
  //   opts.fontPx      - text size in CANVAS pixels (bigger number = bigger text)
  //   opts.color       - text color
  //   opts.align       - "center" or "left"
  //   opts.bold        - draw the text in bold
  // --------------------------------------------------------------------------
  const PX_PER_M = 600; // canvas resolution: how many pixels we use per meter
  function makeTextPlane(
    widthM: number,
    heightM: number,
    x: number,
    y: number,
    opts: {
      fontPx?: number;
      color?: string;
      align?: "left" | "center";
      bold?: boolean;
    } = {},
  ) {
    // Fill in sensible defaults for any option the caller left out.
    const fontPx = opts.fontPx ?? 40;
    const color = opts.color ?? REPORT_NAVY;
    const align = opts.align ?? "center";
    const bold = opts.bold ?? false;

    // Size the canvas from the plane's real size so the text stays sharp.
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(widthM * PX_PER_M);
    canvas.height = Math.round(heightM * PX_PER_M);
    const ctx = canvas.getContext("2d")!;

    // A CanvasTexture lets a <canvas> be used as a Three.js material image.
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace; // keep the drawn colors looking right

    // transparent:true so ONLY the letters show (no opaque box around the text).
    const mesh = new Mesh(
      new PlaneGeometry(widthM, heightM),
      new MeshBasicMaterial({ map: texture, transparent: true, side: DoubleSide }),
    );

    // Parent under reportPanel and place it in local coords, a hair in front of
    // the backdrop (z = 0.012) so the text is never hidden by the panel itself.
    const entity = world.createTransformEntity(mesh, { parent: reportPanel });
    entity.object3D!.position.set(x, y, 0.012);

    // (Re)draw the text, wrapping long lines so they fit the canvas width.
    function setText(text: string) {
      ctx.clearRect(0, 0, canvas.width, canvas.height); // wipe the old text
      ctx.fillStyle = color;
      ctx.textBaseline = "middle";
      ctx.textAlign = align === "center" ? "center" : "left";
      ctx.font = (bold ? "bold " : "") + fontPx + "px system-ui, sans-serif";

      // Word-wrap: add words to a line until the next one would overflow.
      const maxWidth = canvas.width * 0.96; // leave a small side margin
      const words = text.split(" ");
      const lines: string[] = [];
      let line = "";
      for (const word of words) {
        const candidate = line ? line + " " + word : word;
        if (ctx.measureText(candidate).width > maxWidth && line) {
          lines.push(line); // current line is full — start a new one
          line = word;
        } else {
          line = candidate;
        }
      }
      if (line) lines.push(line); // push the last line

      // Vertically center the block of lines within the canvas.
      const lineHeight = fontPx * 1.25;
      const startY = canvas.height / 2 - ((lines.length - 1) * lineHeight) / 2;
      const startX = align === "center" ? canvas.width / 2 : canvas.width * 0.02;
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], startX, startY + i * lineHeight);
      }

      texture.needsUpdate = true; // tell Three.js the canvas pixels changed
    }

    return { entity, setText };
  }

  // --------------------------------------------------------------------------
  // makeBar(): build one labeled score bar. It returns the text label (so we can
  // write the score into it) and the gold "fill" entity (so we can animate it).
  //
  // The fill grows from the LEFT. We get that by shifting the fill's geometry so
  // its left edge sits at the entity's origin, then placing the entity at the
  // bar's left edge and animating scale.x from 0 (empty) up to 1 (full).
  // --------------------------------------------------------------------------
  const BAR_WIDTH = 1.7; // full width of a score bar, in meters
  const BAR_HEIGHT = 0.05; // thickness of a score bar, in meters
  const BAR_LEFT = -BAR_WIDTH / 2; // x of the bar's left edge on the panel

  function makeBar(labelY: number, barY: number) {
    // The label sits just above the bar, left-aligned with the bar's left edge.
    const label = makeTextPlane(BAR_WIDTH, 0.07, 0, labelY, {
      fontPx: 34,
      color: REPORT_NAVY,
      align: "left",
      bold: true,
    });

    // Dark background bar (the full-width "track"), centered on the panel.
    const bgBar = new Mesh(
      new PlaneGeometry(BAR_WIDTH, BAR_HEIGHT),
      new MeshBasicMaterial({ color: new Color(REPORT_BAR_BG) }),
    );
    const bgEntity = world.createTransformEntity(bgBar, { parent: reportPanel });
    bgEntity.object3D!.position.set(0, barY, 0.006);

    // Gold foreground bar (the actual fill). Translating the geometry right by
    // half its width puts its LEFT edge at the local origin; then placing the
    // entity at BAR_LEFT and scaling scale.x grows the bar rightward from there.
    const fgGeo = new PlaneGeometry(BAR_WIDTH, BAR_HEIGHT);
    fgGeo.translate(BAR_WIDTH / 2, 0, 0);
    const fgBar = new Mesh(
      fgGeo,
      new MeshBasicMaterial({ color: new Color(REPORT_GOLD) }),
    );
    const fgEntity = world.createTransformEntity(fgBar, { parent: reportPanel });
    fgEntity.object3D!.position.set(BAR_LEFT, barY, 0.009);
    fgEntity.object3D!.scale.x = 0; // start empty; the animation grows it

    return { label, fgEntity };
  }

  // --------------------------------------------------------------------------
  // Build the (mostly static) layout once, top to bottom. We keep references to
  // anything whose TEXT or SIZE changes when the report appears.
  // --------------------------------------------------------------------------

  // Heading (set once — it never changes).
  const reportHeading = makeTextPlane(2.1, 0.14, 0, 0.88, {
    fontPx: 56,
    color: REPORT_NAVY,
    align: "center",
    bold: true,
  });
  reportHeading.setText("Market Report: End of Year");

  // Three score meters (labeled gold bars). We keep each label + fill so the
  // enter hook can write the score and animate the bar.
  const revenueMeter = makeBar(0.74, 0.695);
  const healthMeter = makeBar(0.625, 0.58);
  const adaptMeter = makeBar(0.51, 0.465);

  // Play-style rank: a big gold name plus a one-line description (both filled in
  // when the report appears).
  const rankName = makeTextPlane(2.1, 0.14, 0, 0.37, {
    fontPx: 60,
    color: REPORT_GOLD,
    align: "center",
    bold: true,
  });
  const rankDesc = makeTextPlane(2.1, 0.1, 0, 0.25, {
    fontPx: 28,
    color: REPORT_NAVY,
    align: "center",
  });

  // Season recap: a title plus one bullet line per season (filled in on enter).
  const recapTitle = makeTextPlane(2.1, 0.06, 0, 0.15, {
    fontPx: 32,
    color: REPORT_NAVY,
    align: "center",
    bold: true,
  });
  recapTitle.setText("Season Recap");
  const recap1 = makeTextPlane(2.1, 0.07, 0, 0.07, { fontPx: 26, align: "left" });
  const recap2 = makeTextPlane(2.1, 0.07, 0, 0.0, { fontPx: 26, align: "left" });
  const recap3 = makeTextPlane(2.1, 0.07, 0, -0.07, { fontPx: 26, align: "left" });

  // Reflection prompts: a title plus three fixed questions students answer in
  // their written Rise reflection (NOT inside the VR). These never change, so we
  // set their text right here.
  const reflectTitle = makeTextPlane(2.1, 0.06, 0, -0.18, {
    fontPx: 32,
    color: REPORT_NAVY,
    align: "center",
    bold: true,
  });
  reflectTitle.setText("Reflection Prompts");
  const prompt1 = makeTextPlane(2.15, 0.15, 0, -0.3, { fontPx: 24, align: "left" });
  prompt1.setText(
    "1. Think about a time in the game when prices changed unexpectedly. What did you do, and would you do anything differently?",
  );
  const prompt2 = makeTextPlane(2.15, 0.15, 0, -0.48, { fontPx: 24, align: "left" });
  prompt2.setText(
    "2. Which crop turned out to be the best choice for you this year? What made it a good or bad pick?",
  );
  const prompt3 = makeTextPlane(2.15, 0.15, 0, -0.64, { fontPx: 24, align: "left" });
  prompt3.setText(
    "3. How is making decisions on a Virginia farm similar to decisions people make about money today?",
  );

  // Play Again button: a gold rectangle with a navy label. RayInteractable makes
  // the rectangle a target for the mouse pointer and XR controller rays; we
  // watch for the Pressed tag (added by the InputSystem) in the loop below.
  const buttonMesh = new Mesh(
    new PlaneGeometry(0.7, 0.16),
    new MeshBasicMaterial({ color: new Color(REPORT_GOLD) }),
  );
  const playAgainButton = world.createTransformEntity(buttonMesh, {
    parent: reportPanel,
  });
  playAgainButton.object3D!.position.set(0, -0.86, 0.006);
  playAgainButton.addComponent(RayInteractable);

  // The button's text label sits just in front of the gold rectangle.
  const buttonLabel = makeTextPlane(0.7, 0.12, 0, -0.86, {
    fontPx: 34,
    color: REPORT_NAVY,
    align: "center",
    bold: true,
  });
  buttonLabel.setText("Play Again");

  // --------------------------------------------------------------------------
  // Score-bar animation. Each time the report appears we grow all three gold
  // bars from empty to their final width (score / 100) over about one second.
  // We drive it with a setInterval timer and update the bars' scale.x on every
  // tick — no CSS transitions involved, just JavaScript.
  // --------------------------------------------------------------------------
  let barTimer: ReturnType<typeof setInterval> | null = null;
  function animateBars(revenueFrac: number, healthFrac: number, adaptFrac: number) {
    if (barTimer) clearInterval(barTimer); // cancel any animation still running

    const durationMs = 1000; // about one second
    const stepMs = 16; // ~60 updates per second
    let elapsed = 0;

    barTimer = setInterval(() => {
      elapsed += stepMs;
      const progress = Math.min(elapsed / durationMs, 1); // climbs 0 -> 1

      // Final width fraction x how far through the grow animation we are.
      revenueMeter.fgEntity.object3D!.scale.x = revenueFrac * progress;
      healthMeter.fgEntity.object3D!.scale.x = healthFrac * progress;
      adaptMeter.fgEntity.object3D!.scale.x = adaptFrac * progress;

      if (progress >= 1 && barTimer) {
        clearInterval(barTimer); // bars are full — stop the timer
        barTimer = null;
      }
    }, stepMs);
  }

  // --------------------------------------------------------------------------
  // determineRank(): pick the play-style rank from the three final scores. We
  // check the rules in priority order and return the first one that matches,
  // along with a one-sentence description of what that rank means.
  // --------------------------------------------------------------------------
  function determineRank(): { name: string; desc: string } {
    // Quick, adaptable trader who also earned well.
    if (scoreAdaptability >= 70 && scoreRevenue >= 60) {
      return {
        name: "Savvy Merchant",
        desc: "You watched the market and changed your plan at just the right time. 🧠",
      };
    }
    // Patient grower with healthy crops and steady earnings.
    if (scoreCropHealth >= 70 && scoreRevenue >= 50) {
      return {
        name: "Steady Farmer",
        desc: "You kept your crops healthy and earned steady coins all year. 🌾",
      };
    }
    // A bold all-in bet on revenue (wins regardless of the other two scores).
    if (scoreRevenue >= 75) {
      return {
        name: "Bold Speculator",
        desc: "You went for the big win and bet boldly when prices swung. Daring! 🎲",
      };
    }
    // Balanced, middle-of-the-road across all three scores.
    if (
      scoreRevenue >= 40 &&
      scoreRevenue <= 65 &&
      scoreCropHealth >= 40 &&
      scoreCropHealth <= 65 &&
      scoreAdaptability >= 40 &&
      scoreAdaptability <= 65
    ) {
      return {
        name: "Cautious Grower",
        desc: "You made balanced choices and stayed clear of big risks. 🛡️",
      };
    }
    // Any score that fell very low (below 35) marks a tough learning year.
    if (scoreRevenue < 35 || scoreCropHealth < 35 || scoreAdaptability < 35) {
      return {
        name: "Learning the Land",
        desc: "Tough year? Every great farmer grows from one. You'll be back! 🌱",
      };
    }
    // Nothing matched exactly — treat it as a steady, balanced run.
    return {
      name: "Cautious Grower",
      desc: "You made balanced choices and stayed clear of big risks. 🛡️",
    };
  }

  // --------------------------------------------------------------------------
  // handlePlayAgain(): wipe the slate clean for a brand-new playthrough, then
  // jump back to the very first screen. Resets the scores, the chosen crops, and
  // every per-game decision, and rolls a fresh Season 2 market event.
  // --------------------------------------------------------------------------
  function handlePlayAgain() {
    // Scores back to their CONSTANTS starting values.
    scoreRevenue = CONSTANTS.FARM_REVENUE_START;
    scoreCropHealth = CONSTANTS.CROP_HEALTH_START;
    scoreAdaptability = CONSTANTS.MARKET_ADAPTABILITY_START;

    // Forget the chosen crops plus every per-crop plot count and market price.
    selectedCrops = [];
    for (const key in plotCounts) delete plotCounts[key];
    for (const key in marketPrices) delete marketPrices[key];

    // Clear all of the decision + bookkeeping variables from the last run.
    season1Decision = null;
    season2Decision = null;
    season3Decision = null;
    farmRevenue = 0;
    heldInventory = [];

    // Refresh the HUD/scoreboard AFTER everything above is zeroed — refreshing
    // first left last year's coin total ("Coins earned: 904") on screen.
    refreshHUD();

    // Roll a fresh random Season 2 market event for the new game (0, 1, or 2).
    // (SEASON2_EVENT itself is a const set at load; season2Event is the value
    // the game actually reads, so we re-randomize that.)
    season2Event = Math.floor(Math.random() * 3);

    // Back to the setup / crop-selection screen to start over.
    showPhase(PHASE_SETUP);
  }

  // Watch for clicks on the Play Again button. The InputSystem adds the Pressed
  // tag while a ray/pointer is clicking the button; we fire ONCE on the rising
  // edge (was-not-pressed -> now-pressed). We also require the report to be the
  // current phase so a stray hit on the hidden button can never restart a game.
  function watchPlayAgainButton() {
    // A press is consumed the frame we see it, so seeing one IS the click.
    if (playAgainButton.hasComponent(Pressed)) {
      if (currentPhase === PHASE_REPORT) handlePlayAgain();
      playAgainButton.removeComponent(Pressed);
    }
  }
  // setInterval (not rAF): keeps working inside immersive XR sessions.
  setInterval(watchPlayAgainButton, 33);

  // --------------------------------------------------------------------------
  // ENTER REPORT: runs from showPhase('report') via the onEnterReport hook, once
  // all three scores are final. It fills in the numbers, animates the bars, and
  // tells the surrounding course (Rise) that the simulation is complete.
  // --------------------------------------------------------------------------
  onEnterReport = () => {
    // 0. The year is over: clear any leftover Samuel gate or quiz, and point
    //    the student at their report.
    onSamuelNewsRead = null;
    clearQuiz();
    setObjective("Read your Year-End Report! 🏆");

    // 1. Hide the flat report panel — the results now appear on a world-space
    //    notice board that rises out of the ground near the farmhouse.
    reportPanel.object3D!.visible = false;

    // 2. END-OF-YEAR WORLD STATE: turn the fields fallow, hide the sprouts, and
    //    clear away the season's props (the price sign, the corkboard, and the
    //    harvest crates — all tracked in s3WorldEntities). The Season 2 event
    //    props (drought haze, ship, rival sprouts) were already hidden when
    //    Season 2 ended, so nothing more is needed for those here.
    for (const plot of fieldPlots) {
      ((plot.object3D as Mesh).material as MeshBasicMaterial).color.set(
        PLOT_FALLOW_COLOR, // straw-colored fallow soil
      );
      if (plot.sproutEntity && plot.sproutEntity.object3D) {
        plot.sproutEntity.object3D.visible = false; // hide the grown sprout
      }
    }
    for (const e of s3WorldEntities) {
      if (e && e.object3D) e.object3D.visible = false;
    }

    // 3. Work out the play-style rank and show it. Store it in currentRank so
    //    the completion event (step 5) can report it to the course shell.
    const rank = determineRank();
    currentRank = rank.name;

    // 4. Build the season recap, one bullet per season, from the saved choices
    //    (season1Decision / season2Decision) and the events that struck
    //    (season2Event / season3Event).
    const s1 =
      season1Decision === "sell"
        ? "Season 1: You sold your first harvest right away to lock in early coins."
        : season1Decision === "hold"
          ? "Season 1: You held your harvest, betting prices would climb later on."
          : "Season 1: You planted and tended your very first crops on the farm.";

    const event2 = SEASON2_EVENTS[season2Event].name; // e.g. "Summer Drought"
    const response2 =
      season2Decision === "shift"
        ? "you shifted your plots toward a safer crop"
        : season2Decision === "doubledown"
          ? "you doubled down and stuck with your plan"
          : season2Decision === "diversify"
            ? "you spread your plots out to diversify"
            : "you weighed your options carefully";
    const s2 = "Season 2: " + event2 + " struck — " + response2 + ".";

    const event3 = SEASON3_EVENTS[season3Event].name; // "New competition" / "New trade route"
    const response3 =
      season3Decision === "expand"
        ? "you expanded production to grow even more"
        : season3Decision === "protect"
          ? "you protected your land and invested in healthy soil"
          : "you made your final call";
    const s3 = "Season 3: " + event3 + " arrived — " + response3 + ".";

    // 5. Fill in the world-space notice board and reveal the reflection signs,
    //    then slide the board up out of the ground and animate its score bars.
    //    Once the board finishes rising, Samuel says his rank-appropriate line.
    //    (showReportBoard is defined down with the notice-board entities below.)
    showReportBoard(rank, s1, s2, s3);

    // 6. Fire the completion event the course shell (Rise) listens for, handing
    //    over the final scores and the rank the student earned. We also log it so
    //    the event is visible in the console for anyone wiring up the course.
    const completionDetail = {
      scoreRevenue: scoreRevenue,
      scoreCropHealth: scoreCropHealth,
      scoreAdaptability: scoreAdaptability,
      playStyleRank: currentRank,
    };
    console.log("[EVENT] onSimulationComplete", completionDetail);
    window.dispatchEvent(
      new CustomEvent("onSimulationComplete", { detail: completionDetail }),
    );
  };

  // ==========================================================================
  // SAMUEL — THE MARKET NPC
  // --------------------------------------------------------------------------
  // Samuel is a friendly merchant who stands at his market stall. He is built
  // entirely out of simple 3D shapes (a cylinder body, a sphere head, and a
  // disc-shaped hat) — no 3D model file needed. Floating above him are two
  // pieces of UI, both drawn by hand the SAME way the Market Report above is:
  //
  //   1. A "Samuel" name tag that is always visible.
  //   2. A speech bubble that holds whatever Samuel is currently "saying",
  //      plus a "Got it" button to dismiss it. The bubble stays hidden until
  //      the player walks close to Samuel (the proximity check below), so the
  //      student has to actually approach him to read his message.
  //
  // Samuel stands at samuelStallPosition (defined up in the farm scenery, where
  // we built his stall). samuelStallPosition is [STALL_X, 0, STALL_Z] — the
  // ground spot at the stall.
  // ==========================================================================

  // Samuel now stands BEHIND his market counter (the counter front faces the
  // player, so we tuck him 0.75 m further back than the stall anchor).
  const samuelX = samuelStallPosition[0];
  const samuelZ = samuelStallPosition[2] - 0.75;

  // Build his upgraded body (coat, apron, arms, friendly face, tricorn hat)
  // from environment.ts. It also returns a floating "!" news indicator that
  // replaces the old hat pulse: it appears whenever Samuel has unread news.
  const samuelParts = buildSamuel(world, samuelX, samuelZ);
  const samuel = {
    body: samuelParts.body,
    head: samuelParts.head,
    hat: samuelParts.hat,
  };
  const samuelIndicator = samuelParts.indicator;
  // Make the "!" big enough to read from across the farm — it's the player's
  // main "go talk to Samuel" beacon.
  samuelIndicator.object3D!.scale.setScalar(1.6);

  // Heights used by the name tag and speech bubble below. The new Samuel is
  // about 1.7 m tall to the top of his hat; the tag floats just over it,
  // safely under the (raised) stall awning.
  const samuelLabelY = 2.05; // name tag floats here


  // --------------------------------------------------------------------------
  // makeSamuelTextPlane(): the SAME draw-text-on-a-canvas trick used by the
  // Market Report's makeTextPlane above, but standalone (it doesn't parent under
  // the report). It returns the entity, a setText() to change the words later,
  // and a getText() so we can ask "is there anything to say right now?".
  //
  //   widthM/heightM - the plane's real size in meters
  //   opts.fontPx    - text size in canvas pixels
  //   opts.color     - text color
  //   opts.bgColor   - optional background fill (e.g. a dark semi-transparent
  //                    box behind the name tag). Leave it out for transparent.
  //   opts.bold      - draw the text bold
  //   opts.parent    - optional entity to parent this text under
  // --------------------------------------------------------------------------
  function makeSamuelTextPlane(
    widthM: number,
    heightM: number,
    opts: {
      fontPx?: number;
      color?: string;
      bgColor?: string;
      bold?: boolean;
      parent?: any;
    } = {},
  ) {
    const fontPx = opts.fontPx ?? 36;
    const color = opts.color ?? COLOR_GOLD;
    const bgColor = opts.bgColor; // undefined => no background box
    const bold = opts.bold ?? false;

    // Size the off-screen canvas from the plane's real size so text stays sharp.
    // PX_PER_M is the canvas-resolution constant defined up in the Report code.
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(widthM * PX_PER_M);
    canvas.height = Math.round(heightM * PX_PER_M);
    const ctx = canvas.getContext("2d")!;

    // Wrap the canvas in a texture and put it on a flat plane.
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace; // keep drawn colors looking right
    const mesh = new Mesh(
      new PlaneGeometry(widthM, heightM),
      // transparent:true so only the drawn pixels show (letters, and the
      // semi-transparent background box if we drew one).
      new MeshBasicMaterial({ map: texture, transparent: true, side: DoubleSide }),
    );

    // Create the entity, optionally as a child of some parent (the bubble).
    const entity = opts.parent
      ? world.createTransformEntity(mesh, { parent: opts.parent })
      : world.createTransformEntity(mesh);

    // Remember the current words so getText() can report them.
    let currentText = "";

    // (Re)draw the text. Long lines wrap so they fit inside the canvas width.
    function setText(text: string) {
      currentText = text;
      ctx.clearRect(0, 0, canvas.width, canvas.height); // wipe the old drawing

      // Optional dark background box behind the text (used by the name tag).
      if (bgColor) {
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      ctx.fillStyle = color;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = (bold ? "bold " : "") + fontPx + "px system-ui, sans-serif";

      // Word-wrap: keep adding words to a line until the next one would overflow.
      const maxWidth = canvas.width * 0.92; // small side margin
      const words = text.split(" ");
      const lines: string[] = [];
      let line = "";
      for (const word of words) {
        const candidate = line ? line + " " + word : word;
        if (ctx.measureText(candidate).width > maxWidth && line) {
          lines.push(line);
          line = word;
        } else {
          line = candidate;
        }
      }
      if (line) lines.push(line);

      // Center the block of lines vertically in the canvas.
      const lineHeight = fontPx * 1.25;
      const startY = canvas.height / 2 - ((lines.length - 1) * lineHeight) / 2;
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], canvas.width / 2, startY + i * lineHeight);
      }

      texture.needsUpdate = true; // tell Three.js the canvas pixels changed
    }

    return { entity, setText, getText: () => currentText };
  }

  // --------------------------------------------------------------------------
  // NAME TAG — a small "Samuel" label floating 0.5 m above his hat. Gold text on
  // a dark semi-transparent box. It is created visible and stays visible.
  // --------------------------------------------------------------------------
  const samuelNameLabel = makeSamuelTextPlane(0.7, 0.18, {
    fontPx: 40,
    color: "#ffd97a", // bright gold — high contrast on the dark backing
    bgColor: "rgba(20, 20, 20, 0.7)", // dark, semi-transparent backing
    bold: true,
  });
  samuelNameLabel.entity.object3D!.position.set(samuelX, samuelLabelY, samuelZ);
  samuelNameLabel.setText("Samuel");

  // --------------------------------------------------------------------------
  // DIALOGUE BUBBLE — a cream panel with a navy border, floating 0.7 m above the
  // name tag. It contains the dialogue text and a "Got it" button. We build it
  // as three layered planes (border behind, cream panel in front) parented under
  // ONE entity (samuelBubble) so hiding that entity hides the whole bubble.
  // --------------------------------------------------------------------------
  const BUBBLE_WIDTH = 0.95;
  const BUBBLE_HEIGHT = 0.6;

  // The cream background IS the samuelBubble entity's own mesh — so toggling
  // samuelBubble's visibility shows/hides the panel and everything under it.
  const samuelBubbleMesh = new Mesh(
    new PlaneGeometry(BUBBLE_WIDTH, BUBBLE_HEIGHT),
    new MeshBasicMaterial({ color: new Color("#f3e9d2") }), // cream
  );
  const samuelBubble = world.createTransformEntity(samuelBubbleMesh);
  // The WHOLE bubble is a click target (kid-sized): tapping anywhere on it
  // counts as "Got it!". The gold button below stays as the visual cue.
  samuelBubble.addComponent(RayInteractable);
  // The bubble floats low over the stall counter, in front of Samuel — fully
  // under the raised awning so nothing ever hides it from an approaching
  // player. (Putting it above his head hid it behind the awning up close.)
  const samuelBubbleY = 2.0;
  samuelBubble.object3D!.position.set(samuelX, samuelBubbleY, samuelZ + 1.2);

  // Navy border: a slightly LARGER plane sitting just behind the cream panel, so
  // a thin navy frame peeks out around all four edges.
  const samuelBorderMesh = new Mesh(
    new PlaneGeometry(BUBBLE_WIDTH + 0.04, BUBBLE_HEIGHT + 0.04),
    new MeshBasicMaterial({ color: new Color("#1F3A5F") }), // navy
  );
  const samuelBorder = world.createTransformEntity(samuelBorderMesh, {
    parent: samuelBubble,
  });
  samuelBorder.object3D!.position.set(0, 0, -0.002); // a hair behind the cream

  // The dialogue text itself (starts empty). Navy text, sitting in the upper
  // portion of the bubble. This is the entity the rest of the code reads/writes.
  const samuelDialogueText = makeSamuelTextPlane(BUBBLE_WIDTH * 0.9, 0.34, {
    fontPx: 28,
    color: "#1F3A5F", // navy
    parent: samuelBubble,
  });
  samuelDialogueText.entity.object3D!.position.set(0, 0.06, 0.01); // in front of cream
  samuelDialogueText.setText(""); // starts with nothing to say

  // "Got it" button: a gold rectangle near the bottom of the bubble, made
  // clickable with RayInteractable (the same mechanic as the Play Again button).
  const samuelGotItMesh = new Mesh(
    new PlaneGeometry(0.42, 0.13),
    new MeshBasicMaterial({ color: new Color("#c8962a") }), // gold
  );
  const samuelGotItButton = world.createTransformEntity(samuelGotItMesh, {
    parent: samuelBubble,
  });
  samuelGotItButton.object3D!.position.set(0, -BUBBLE_HEIGHT / 2 + 0.1, 0.01);
  samuelGotItButton.addComponent(RayInteractable);

  // The button's "Got it" label, sitting just in front of the gold rectangle.
  const samuelGotItLabel = makeSamuelTextPlane(0.42, 0.11, {
    fontPx: 26,
    color: "#1F3A5F", // navy
    bold: true,
    parent: samuelBubble,
  });
  samuelGotItLabel.entity.object3D!.position.set(
    0,
    -BUBBLE_HEIGHT / 2 + 0.1,
    0.02,
  );
  samuelGotItLabel.setText("Got it!");

  // CRITICAL: the bubble's child planes (border, dialogue text, button, label)
  // sit in FRONT of the bubble plane, and the pointer system maps a ray hit to
  // the entity of the exact mesh it struck — a hit on a non-interactable child
  // goes nowhere. Marking every child pointerEvents='none' lets rays pass
  // through to the bubble itself, making its WHOLE surface reliably clickable.
  (samuelBorder.object3D as any).pointerEvents = "none";
  (samuelDialogueText.entity.object3D as any).pointerEvents = "none";
  (samuelGotItButton.object3D as any).pointerEvents = "none";
  (samuelGotItLabel.entity.object3D as any).pointerEvents = "none";

  // The bubble starts HIDDEN — it only appears once Samuel has something to say
  // AND the player walks close to him (see the proximity check below).
  samuelBubble.object3D!.visible = false;

  // --------------------------------------------------------------------------
  // NEWS INDICATOR — when Samuel has something new to say, a bright gold "!"
  // bobs above his hat (a familiar "talk to me!" signal from kids' games).
  // samuelPulseInterval drives the bobbing; we stop it when the news is read.
  // --------------------------------------------------------------------------
  let samuelPulseInterval: ReturnType<typeof setInterval> | null = null;

  // --------------------------------------------------------------------------
  // samuelSpeak(line, immediate): give Samuel a new thing to say.
  //
  // Default (immediate = false) — NEWS mode: the bubble hides, the bobbing "!"
  // appears, and the student must WALK to Samuel to read it (the proximity
  // check reveals it once they're close enough).
  //
  // immediate = true — REPLY mode: the bubble pops open right away with no "!".
  // Used when Samuel is responding to something the student just did at his
  // stall (like answering his market question) — they're already talking to
  // him, so making them tap him again would be a chore.
  // --------------------------------------------------------------------------
  const SAMUEL_INDICATOR_Y = 3.05; // resting height of the "!" above the stall
  function samuelSpeak(line: string, immediate = false) {
    // 1. Set the bubble's text to the new line.
    samuelDialogueText.setText(line);

    // Stop any previous "!" bobbing before deciding what to show.
    if (samuelPulseInterval !== null) {
      clearInterval(samuelPulseInterval);
      samuelPulseInterval = null;
    }

    if (immediate) {
      // 2a. REPLY mode: open the bubble now; no beacon needed.
      samuelIndicator.object3D!.visible = false;
      samuelIndicator.object3D!.position.y = SAMUEL_INDICATOR_Y;
      samuelBubble.object3D!.visible = true;
      return;
    }

    // 2b. NEWS mode: hide the bubble — it waits for the player to come near.
    samuelBubble.object3D!.visible = false;

    // 3. Show the "!" and start it gently bobbing (and slowly turning so it
    //    reads from every direction). A friendly chime announces the news.
    samuelIndicator.object3D!.visible = true;
    sfxNotify();
    const periodMs = 1500; // one full bob every 1.5 s
    const stepMs = 50; // update ~20 times per second
    let elapsed = 0;
    samuelPulseInterval = setInterval(() => {
      elapsed += stepMs;
      const phase = (elapsed % periodMs) / periodMs; // loops 0 -> 1 every 1.5 s
      samuelIndicator.object3D!.position.y =
        SAMUEL_INDICATOR_Y + 0.09 * Math.sin(phase * Math.PI * 2);
      samuelIndicator.object3D!.rotation.y += 0.03;
    }, stepMs);
  }

  // Expose samuelSpeak on the window so other code (or a quick console test) can
  // trigger Samuel's lines without us touching the phase manager or panels.
  // Example from the browser console:  samuelSpeak("Welcome to the market!")
  (window as any).samuelSpeak = samuelSpeak;

  // --------------------------------------------------------------------------
  // onSamuelNewsRead: the SEASON GATE. Each season assigns a callback here
  // before Samuel speaks; pressing "Got it!" on his bubble consumes it exactly
  // once. The seasons use it to unlock their choice boards (and to start the
  // market quiz) — so the student literally cannot skip talking to Samuel.
  // --------------------------------------------------------------------------
  let onSamuelNewsRead: (() => void) | null = null;

  // --------------------------------------------------------------------------
  // dismissSamuelBubble(): what the "Got it!" button does. Hides the bubble,
  // clears the line (so the bubble doesn't instantly reopen while the player
  // is still standing next to Samuel), stops the bobbing timer, hides the "!",
  // and fires the one-shot season gate above.
  // --------------------------------------------------------------------------
  function dismissSamuelBubble() {
    samuelBubble.object3D!.visible = false; // close the bubble
    samuelDialogueText.setText(""); // nothing to say -> proximity won't reopen
    sfxClick();
    if (samuelPulseInterval !== null) {
      clearInterval(samuelPulseInterval); // stop the bobbing timer
      samuelPulseInterval = null;
    }
    samuelIndicator.object3D!.visible = false; // news has been read
    samuelIndicator.object3D!.position.y = SAMUEL_INDICATOR_Y;

    // Fire the season gate exactly once (the callback may make Samuel speak
    // again, which can re-assign the gate — so consume it first).
    const newsRead = onSamuelNewsRead;
    onSamuelNewsRead = null;
    if (newsRead) newsRead();
  }

  // Watch for clicks on the "Got it!" button OR anywhere on the bubble itself
  // (the whole bubble is a target so small hands can't miss). Fire ONCE on the
  // rising edge, and only while the bubble is actually open.
  function watchSamuelGotItButton() {
    // A press is consumed the frame we see it, so seeing one IS the click.
    const pressed =
      samuelGotItButton.hasComponent(Pressed) ||
      samuelBubble.hasComponent(Pressed);
    if (pressed) {
      if (samuelBubble.object3D!.visible) dismissSamuelBubble();
      consumePress(samuelGotItButton);
      consumePress(samuelBubble);
    }
  }
  // setInterval (not rAF): keeps working inside immersive XR sessions.
  setInterval(watchSamuelGotItButton, 33);

  // --------------------------------------------------------------------------
  // checkSamuelProximity(): runs every frame. If the player's head/camera is
  // within 2.5 m of Samuel, AND Samuel has something to say, AND the bubble is
  // not already open, then pop the bubble open. This is what makes the student
  // walk over to Samuel to hear him.
  //
  // We allocate the two temporary vectors ONCE here (outside the per-frame
  // function) so we don't create garbage every frame — important for smooth VR.
  // --------------------------------------------------------------------------
  const samuelPlayerPos = new Vector3(); // reused: the player's world position
  const samuelWorldPos = new Vector3(); // reused: Samuel's world position
  function checkSamuelProximity() {
    // The camera lives under the player rig, so its LOCAL position isn't the real
    // world position — getWorldPosition() gives us the actual spot in the world.
    camera.getWorldPosition(samuelPlayerPos);
    samuel.body.object3D!.getWorldPosition(samuelWorldPos);

    // Straight-line distance between the player and Samuel, in meters.
    const distance = samuelPlayerPos.distanceTo(samuelWorldPos);

    // Show the bubble only when: close enough, there's a line to read, and it
    // isn't already showing. The radius is generous (3.2 m) because the stall
    // counter keeps players from getting truly close, and head height counts
    // toward the 3D distance.
    if (
      distance < 3.2 &&
      samuelDialogueText.getText().length > 0 &&
      !samuelBubble.object3D!.visible
    ) {
      samuelBubble.object3D!.visible = true;
    }

    // Turn the name tag and bubble to face the player so the text is always
    // readable. We aim them at the player's x/z but keep their OWN height, which
    // keeps them standing upright instead of tilting toward the floor.
    samuelNameLabel.entity.object3D!.lookAt(
      samuelPlayerPos.x,
      samuelNameLabel.entity.object3D!.position.y,
      samuelPlayerPos.z,
    );
    samuelBubble.object3D!.lookAt(
      samuelPlayerPos.x,
      samuelBubble.object3D!.position.y,
      samuelPlayerPos.z,
    );
  }

  // Wire checkSamuelProximity() into the per-frame loop so it runs every frame,
  // right alongside the world's own update loop. (requestAnimationFrame is the
  // same per-frame mechanism used by the Play Again button watcher above.)
  function samuelFrameLoop() {
    checkSamuelProximity();
  }
  // setInterval (not rAF): keeps working inside immersive XR sessions.
  setInterval(samuelFrameLoop, 33);

  // ==========================================================================
  // SAMUEL'S MARKET QUIZ — "Will prices go UP or DOWN?"
  // --------------------------------------------------------------------------
  // After Samuel's news in Seasons 2 and 3, two big answer cards appear at his
  // stall and the student PREDICTS what the news does to prices. A correct
  // call earns +5 Market Smarts; either way Samuel explains the supply-and-
  // demand reason. The season's choice board only unlocks afterward.
  // ==========================================================================
  let quizEntities: any[] = []; // question board + both cards + labels
  let quizUpCard: any = null;
  let quizDownCard: any = null;
  let quizActive = false;
  let quizOnAnswer: ((answeredUp: boolean) => void) | null = null;

  // clearQuiz(): remove any quiz props (answered, or replay cleanup).
  function clearQuiz() {
    quizActive = false;
    quizOnAnswer = null;
    for (const e of quizEntities) e.dispose();
    quizEntities = [];
    quizUpCard = null;
    quizDownCard = null;
  }

  // askMarketQuestion(): pop the question + answer cards at the stall front.
  function askMarketQuestion(opts: {
    question: string;
    correctIsUp: boolean;
    explainRight: string;
    explainWrong: string;
    onDone: () => void;
  }) {
    clearQuiz(); // never two quizzes at once

    // The question, on a navy ribbon floating over the stall counter.
    const questionBoard = makeSamuelTextPlane(1.9, 0.55, {
      fontPx: 34,
      color: "#ffe9b0",
      bgColor: "rgba(31, 58, 95, 0.92)",
      bold: true,
    });
    questionBoard.entity.object3D!.position.set(samuelX, 2.1, -5.35);
    questionBoard.setText(opts.question);
    quizEntities.push(questionBoard.entity);

    // One big answer card: a bright cream box (the ray target) + its labels.
    function makeAnswerCard(
      x: number,
      title: string,
      subtitle: string,
      titleColor: string,
    ) {
      const card = makeBox(0.66, 0.6, 0.04, "#fdf3dd", [x, 1.35, -5.35], true);
      card.addComponent(RayInteractable);
      quizEntities.push(card);
      const title3d = makeSamuelTextPlane(0.6, 0.3, {
        fontPx: 52,
        color: titleColor,
        bold: true,
      });
      title3d.entity.object3D!.position.set(x, 1.43, -5.32);
      title3d.setText(title);
      quizEntities.push(title3d.entity);
      const sub3d = makeSamuelTextPlane(0.6, 0.16, {
        fontPx: 22,
        color: "#1F3A5F",
      });
      sub3d.entity.object3D!.position.set(x, 1.21, -5.32);
      sub3d.setText(subtitle);
      quizEntities.push(sub3d.entity);
      return card;
    }
    quizUpCard = makeAnswerCard(samuelX - 0.7, "▲ UP", "prices rise", "#2e7d32");
    quizDownCard = makeAnswerCard(samuelX + 0.7, "▼ DOWN", "prices fall", "#b3402e");

    // What a click on either card does.
    quizOnAnswer = (answeredUp: boolean) => {
      const correct = answeredUp === opts.correctIsUp;
      if (correct) {
        updateScore("adaptability", 5); // Market Smarts reward (+ coin sound)
      } else {
        sfxDown(); // a gentle "not quite" — no points lost
      }
      // Samuel explains the supply-and-demand reason either way — the bubble
      // pops open by itself (REPLY mode), no need to tap him again.
      samuelSpeak(correct ? opts.explainRight : opts.explainWrong, true);
      clearQuiz();
      opts.onDone(); // unlock the season's choice board
    };
    quizActive = true;
  }

  // One watch loop drives both answer cards (same rising-edge trick as every
  // other 3D button in this file).
  function watchQuizCards() {
    // A press is consumed the frame we see it, so seeing one IS the click.
    if (quizUpCard && quizUpCard.hasComponent(Pressed)) {
      consumePress(quizUpCard);
      if (quizActive && quizOnAnswer) quizOnAnswer(true);
    } else if (quizDownCard && quizDownCard.hasComponent(Pressed)) {
      consumePress(quizDownCard);
      if (quizActive && quizOnAnswer) quizOnAnswer(false);
    }
  }
  // setInterval (not rAF): keeps working inside immersive XR sessions.
  setInterval(watchQuizCards, 33);

  // --------------------------------------------------------------------------
  // makeLockedNote(): the "this board is locked" sign that hangs where a
  // season's choice cards will appear. It tells students who run straight to
  // the farmhouse board exactly where to go instead.
  // --------------------------------------------------------------------------
  function makeLockedNote() {
    const note = makeSamuelTextPlane(1.7, 0.42, {
      fontPx: 30,
      color: "#ffffff",
      bgColor: "rgba(31, 58, 95, 0.88)",
      bold: true,
    });
    note.entity.object3D!.position.set(0, 1.3, -4.84);
    note.setText("🔒 Locked! Go hear Samuel's news at his stall first →");
    return note.entity;
  }

  // ==========================================================================
  // PHYSICAL SEED-BAG PLANTING (the new 3D setup phase)
  // --------------------------------------------------------------------------
  // Instead of tapping crop cards on a flat panel, the student now physically
  // grabs a seed bag off a shelf and carries it onto a crop plot to plant it.
  // Everything for that lives here:
  //   - a wooden seed shelf beside the crop field
  //   - four grabbable seed bags (one per crop) with floating labels
  //   - "plant on release": dropping a bag near a plot plants that crop
  //   - a "Begin Season 1" button that appears once something is planted
  //   - an instruction sign explaining what to do
  //
  // Helpers used here (makeBox, makeSamuelTextPlane) are function declarations
  // defined earlier/above in this same closure, so they are safe to call here.
  // ==========================================================================

  // The color each crop's plot tile + sprout turns when planted. Keyed by the
  // lowercase crop id we store on each bag (bag.cropType).
  const CROP_PLANT_COLOR: Record<string, string> = {
    tobacco: "#c8962a",
    wheat: "#d4a843",
    corn: "#5a8a3c",
    cotton: "#f0ede4",
  };

  // One entry per seed bag: its crop id, its box color, and the floating label.
  const SEED_BAG_DEFS = [
    // labelColor keeps each label high-contrast against its card color:
    // navy on the light cards, white on the darker corn green.
    { cropType: "tobacco", color: "#c8962a", labelColor: "#1F3A5F", label: "🌿 Tobacco — 8 🪙 · Risky!" },
    { cropType: "wheat", color: "#d4a843", labelColor: "#1F3A5F", label: "🌾 Wheat — 4 🪙 · Safe bet" },
    { cropType: "corn", color: "#5a8a3c", labelColor: "#ffffff", label: "🌽 Corn — 3 🪙 · Safe bet" },
    { cropType: "cotton", color: "#f0ede4", labelColor: "#1F3A5F", label: "☁️ Cotton — 6 🪙 · Some risk" },
  ];

  // --------------------------------------------------------------------------
  // SELECTION BOARD — a vertical wooden board just to the LEFT of the crop field
  // (the field's left edge is near x = -1.75; we sit the board at x = -2.3). It
  // backs the four crop buttons and faces the player (+z). Replaces the old seed
  // shelf the drag-and-drop flow used.
  // --------------------------------------------------------------------------
  const SHELF_X = -2.3; // left of the field's left edge
  const SHELF_Z = FIELD_CENTER_Z; // centered alongside the field (z = -3)
  // A tall, thin board (1.5 wide × 1.7 high, 0.08 deep) centered at y = 1.1, so
  // its face spans y ≈ 0.25..1.95 — comfortable reading/clicking height.
  const seedShelf = makeBox(1.5, 1.7, 0.08, "#8b5e3c", [SHELF_X, 1.1, SHELF_Z]);
  // Hidden at startup — the welcome tutorial reveals it (revealFarmSetup) once
  // the student finishes the tour.
  seedShelf.object3D!.visible = false;

  // --------------------------------------------------------------------------
  // CROP BUTTONS — four clickable cards stacked vertically on the board, one per
  // crop. Each card is a colored plane (the crop's color) with a label, and is a
  // ray target. Clicking a card plants that crop on the next empty plot, so the
  // farm fills in order. We keep the variable name `seedBags` because the reveal
  // / reset / confirm code elsewhere already toggles this array's visibility.
  // --------------------------------------------------------------------------
  const seedBags: any[] = [];
  // Y positions for the four stacked cards (top -> bottom), in front of the board.
  const BUTTON_YS = [1.55, 1.15, 0.75, 0.35];
  for (let i = 0; i < SEED_BAG_DEFS.length; i++) {
    const def = SEED_BAG_DEFS[i];
    // A flat card facing the player (+z), sitting just in front of the board face.
    const cardMesh = new Mesh(
      new PlaneGeometry(1.3, 0.32),
      new MeshBasicMaterial({ color: new Color(def.color), side: DoubleSide }),
    );
    // Typed `any` so we can hang our own fields (cropType, ...).
    const bag: any = world.createTransformEntity(cardMesh);
    bag.object3D!.position.set(SHELF_X, BUTTON_YS[i], SHELF_Z + 0.06);
    bag.cropType = def.cropType; // which crop this button plants

    // Mark it as a ray target so the mouse pointer / XR ray can click it. The
    // Pressed tag (watched in the frame loop below) drives the plant action.
    bag.addComponent(RayInteractable);

    // The crop's name/price/risk label, parented to the card so it shows/hides
    // with it. Navy text reads clearly on every crop color.
    const label = makeSamuelTextPlane(1.25, 0.18, {
      fontPx: 24,
      color: def.labelColor, // navy on light cards, white on the dark one
      bold: true,
      parent: bag,
    });
    label.entity.object3D!.position.set(0, 0, 0.01); // just in front of the card
    label.setText(def.label);
    // Let rays pass through the label to the clickable card behind it.
    (label.entity.object3D as any).pointerEvents = "none";
    bag.label = label;

    // Hidden at startup alongside the board; revealFarmSetup shows them together.
    bag.object3D!.visible = false;

    seedBags.push(bag);
  }

  // --------------------------------------------------------------------------
  // CONFIRM BUTTON — "Begin Season 1 →". Built the same way as Samuel's "Got it"
  // button (a gold plane + navy text + RayInteractable, clicked via the Pressed
  // tag), since this file builds all its 3D buttons that way. It starts hidden
  // and only appears once at least one plot has a crop planted.
  //
  // It floats front-and-center at the field gate, at eye height, facing the
  // player — impossible to miss once planting starts. (It used to hide at
  // knee height beside the crop board.) A gentle breathing pulse draws the
  // eye while it waits.
  // --------------------------------------------------------------------------
  const confirmBtnMesh = new Mesh(
    new PlaneGeometry(1.1, 0.26),
    new MeshBasicMaterial({ color: new Color("#c8962a") }), // gold background
  );
  const confirmButton = world.createTransformEntity(confirmBtnMesh);
  // Centered over the fence gate (the gap is at x 0, z = -1.25), eye height.
  confirmButton.object3D!.position.set(0, 1.22, -1.05);
  // Angled a touch toward the crop board on the left, where the player stands
  // while planting; still reads fine from the spawn point.
  confirmButton.object3D!.rotation.y = -0.2;
  confirmButton.addComponent(RayInteractable); // makes it clickable by ray/pointer
  confirmButton.object3D!.visible = false; // revealed (locked) with the farm setup

  // The button stays LOCKED (gray, shows planting progress) until every plot
  // is planted; only then does it turn gold and accept the click.
  let confirmReady = false;
  const confirmMaterial = confirmBtnMesh.material as MeshBasicMaterial;

  // Navy label sitting just in front of the gold plane. Parented to the button
  // so it hides/shows (and pulses) together with it.
  const confirmLabel = makeSamuelTextPlane(1.05, 0.2, {
    fontPx: 30,
    color: "#1F3A5F", // navy text
    bold: true,
    parent: confirmButton,
  });
  confirmLabel.entity.object3D!.position.set(0, 0, 0.01);
  confirmLabel.setText("Begin Season 1 →");
  // Let rays pass through the label to the clickable button behind it.
  (confirmLabel.entity.object3D as any).pointerEvents = "none";

  // The gentle "look at me" pulse: a slow 1.00 → 1.06 breathing scale — but
  // only once the button is UNLOCKED. While locked it sits still in gray.
  // (setInterval, not rAF — keeps working in XR.)
  {
    let confirmPulseMs = 0;
    setInterval(() => {
      if (!confirmButton.object3D!.visible || !confirmReady) {
        confirmButton.object3D!.scale.setScalar(1);
        return;
      }
      confirmPulseMs += 50;
      const phase = (confirmPulseMs % 1200) / 1200; // loops 0 -> 1 every 1.2 s
      confirmButton.object3D!.scale.setScalar(
        1 + 0.06 * Math.sin(phase * Math.PI * 2),
      );
    }, 50);
  }

  // --------------------------------------------------------------------------
  // INSTRUCTION SIGN — a small flat cream board beside the shelf telling the
  // student what to do. Visible during setup; hidden once they tap Confirm.
  // --------------------------------------------------------------------------
  const signBoardMesh = new Mesh(
    new PlaneGeometry(1.3, 0.5),
    new MeshBasicMaterial({ color: new Color("#f3e9d2"), side: DoubleSide }), // cream
  );
  const instructionSign = world.createTransformEntity(signBoardMesh);
  // Float just above the selection board, facing the player (+z).
  instructionSign.object3D!.position.set(SHELF_X, 2.15, SHELF_Z);
  const signLabel = makeSamuelTextPlane(1.25, 0.45, {
    fontPx: 26,
    color: "#1F3A5F", // navy text
    bold: true,
    parent: instructionSign,
  });
  signLabel.entity.object3D!.position.set(0, 0, 0.01);
  signLabel.setText("Click a crop to plant it in your next plot! 🌱");
  // Hidden at startup alongside the shelf and bags.
  instructionSign.object3D!.visible = false;

  // Now that the setup props exist, give the welcome tutorial a way to reveal
  // them. finishWelcome() (up in the welcome-panel block) calls this when the
  // student presses "Start Farming". The confirm button appears right away in
  // its LOCKED state ("🔒 Plant every plot! 0 / 16") so the goal is clear.
  revealFarmSetup = () => {
    seedShelf.object3D!.visible = true;
    for (const seedBag of seedBags) seedBag.object3D!.visible = true;
    instructionSign.object3D!.visible = true;
    updateConfirmVisibility(); // shows the locked progress button
    // Kick the game off with a banner, a flourish, and the first objective.
    spawnBanner("🌱 Time to Plant!");
    sfxSeason();
    setObjective("Plant a crop in every plot — fill all 16! 🌱");
  };

  // --------------------------------------------------------------------------
  // Reused temp vector so the sprout placement never allocates garbage.
  // --------------------------------------------------------------------------
  const plotWorldPos = new Vector3(); // a plot's world position (for the sprout)

  // plantOnPlot(): mark a plot as planted, recolor its soil, and stand a real
  // little crop plant on it — a corn stalk with a cob, a tuft of wheat, a
  // cotton bush with white puffs, or a leafy tobacco plant (see environment.ts).
  // Re-planting a plot replaces its old plant.
  function plantOnPlot(plot: any, cropType: string) {
    plot.cropType = cropType; // remember what's growing here
    const hex = CROP_PLANT_COLOR[cropType]; // crop's color

    // Tint the plot's furrowed soil toward the crop's color.
    ((plot.object3D as Mesh).material as MeshBasicMaterial).color.set(hex);

    // If something was already planted here, remove the old plant first.
    if (plot.sproutEntity) {
      plot.sproutEntity.dispose(); // dispose() also frees the GPU geometry/material
    }

    // Stand the crop's plant model on the plot. The plant's origin is at its
    // base, so it sits right on top of the soil bed (y = 0.09). The seasons
    // animate object3D.scale.y exactly like they did for the old sprouts.
    plot.object3D!.getWorldPosition(plotWorldPos);
    const sprout = makeCropPlant(world, cropType);
    sprout.object3D!.position.set(plotWorldPos.x, 0.09, plotWorldPos.z);
    sprout.object3D!.scale.set(0.95, 0.55, 0.95); // seedling-sized for now
    // A random turn so a field of one crop doesn't look like rubber stamps.
    sprout.object3D!.rotation.y = Math.random() * Math.PI * 2;
    plot.sproutEntity = sprout;

    sfxPlant(); // a satisfying little "plop"
    console.log("Planted " + cropType + " on a plot.");
  }

  // plantedCount(): how many of the 16 plots have a crop on them.
  function plantedCount() {
    return fieldPlots.filter((p) => p.cropType !== null).length;
  }

  // updateConfirmVisibility(): the Begin button is LOCKED until every plot is
  // planted. While locked it shows the planting progress in gray; once the
  // whole field is full it turns gold, becomes clickable, and starts pulsing.
  function updateConfirmVisibility() {
    const planted = plantedCount();
    confirmReady = planted >= fieldPlots.length;
    confirmButton.object3D!.visible = true;
    if (confirmReady) {
      confirmMaterial.color.set("#c8962a"); // gold = ready to press
      confirmLabel.setText("Begin Season 1 →");
      setObjective("Field full! Press Begin Season 1 →");
    } else {
      confirmMaterial.color.set("#b0a896"); // gray = locked
      confirmLabel.setText(
        "🔒 Plant every plot!  " + planted + " / " + fieldPlots.length,
      );
    }
  }

  // nextEmptyPlot(): the first plot (in grid order) that has nothing planted yet,
  // or null when the whole 4×4 field is full. fieldPlots was filled row-major, so
  // clicking crops fills the field row by row.
  function nextEmptyPlot() {
    return fieldPlots.find((p) => p.cropType === null) || null;
  }

  // handleCropClick(): runs when a crop button is clicked. Plant that crop on the
  // next empty plot (recoloring it + standing a matching sprout), then maybe
  // reveal the Confirm button. Does nothing once the field is full.
  function handleCropClick(cropType: string) {
    const plot = nextEmptyPlot();
    if (!plot) {
      console.log("All plots are planted — clear the field to plant more.");
      return;
    }
    plantOnPlot(plot, cropType);
    updateConfirmVisibility();
  }

  // onConfirm(): what tapping "Begin Season 1 →" does. Reads the planted plots
  // into the data later phases expect, clears the setup props from the world,
  // and advances the phase manager. Only runs once every plot is planted.
  function onConfirm() {
    if (!confirmReady) return; // locked until the whole field is full

    // Lowercase crop ids of every planted plot, in grid order (e.g. ["tobacco",
    // "tobacco", "corn"]). plot.cropType is the lowercase id we store when planting.
    const plantedIds = fieldPlots
      .filter((p) => p.cropType)
      .map((p) => p.cropType as string);
    // id ("tobacco") -> display name ("Tobacco"), falling back to the id.
    const idToName = (id: string) =>
      CROPS.find((c) => c.id === id)?.name ?? id;

    // selectedCrops holds the unique crop NAMES. This is the key convention the
    // rest of the game expects: getCropByName(), YIELD_BY_NAME, plotCounts, and
    // the report summary are all keyed by capitalized name. (Storing lowercase
    // ids here is what made later earnings come out as 0 / NaN.)
    selectedCrops = [...new Set(plantedIds.map(idToName))];

    // plantingRecord keeps one entry per planted plot, keyed by lowercase ID,
    // because Season 1's market (currentPrices / BASE_PRICE / BASE_YIELD) looks
    // crops up by id. Do NOT change this to names.
    plantingRecord = plantedIds.map((id) => ({ cropType: id }));

    // plotCounts = how many plots of each crop, keyed by NAME to match the
    // consumers above. Rebuild it from scratch (a replay may have left old keys).
    for (const key of Object.keys(plotCounts)) delete plotCounts[key];
    for (const id of plantedIds) {
      const name = idToName(id);
      plotCounts[name] = (plotCounts[name] || 0) + 1;
    }

    console.log(
      "Confirmed planting. Crops: " +
        selectedCrops.join(", ") +
        " | plots: " +
        JSON.stringify(plotCounts),
    );

    // Clear the setup-phase props out of the scene.
    seedShelf.object3D!.visible = false;
    for (const bag of seedBags) {
      bag.object3D!.visible = false; // hides each bag AND its child label
    }
    confirmButton.object3D!.visible = false;
    instructionSign.object3D!.visible = false;

    // Move on to Season 1.
    nextPhase();
  }

  // --------------------------------------------------------------------------
  // Per-frame loop for the setup phase. It watches two things using the same
  // rising-edge detection trick the rest of this file uses:
  //   1. Each crop button's Pressed tag — fire once per click to plant the next
  //      empty plot with that crop.
  //   2. The Confirm button's Pressed tag — fire once on the rising edge.
  // --------------------------------------------------------------------------
  function seedFrameLoop() {
    for (let i = 0; i < seedBags.length; i++) {
      const bag = seedBags[i];
      // A press is consumed the frame we see it (one click = one Pressed tag),
      // so seeing one IS the click. Only act while the button is shown.
      if (bag.hasComponent(Pressed)) {
        if (bag.object3D!.visible) handleCropClick(bag.cropType);
        consumePress(bag);
      }
    }

    // Confirm button: act once per press, and only while it's actually shown.
    if (confirmButton.hasComponent(Pressed)) {
      if (confirmButton.object3D!.visible) {
        if (confirmReady) {
          onConfirm();
        } else {
          sfxDown(); // a gentle "not yet" — the label shows what's left
        }
      }
      consumePress(confirmButton);
    }

  }
  // setInterval (not rAF): keeps working inside immersive XR sessions.
  setInterval(seedFrameLoop, 33);

  // ==========================================================================
  // MARKET REPORT — WORLD-SPACE NOTICE BOARD (the results, out in the 3D world)
  // --------------------------------------------------------------------------
  // Instead of the flat report panel, the end-of-year results appear on a big
  // wooden notice board that rises out of the ground near the farmhouse. We
  // build the board + all its content ONCE here; onEnterReport (further up)
  // refreshes the numbers and raises the board each time the student reaches the
  // report. The board's "panel" is drawn with the SAME canvas-text-plane
  // technique the rest of this file uses (makeSamuelTextPlane), so no new
  // UIKitML files are needed — it reads as a UI panel attached to the board.
  // ==========================================================================

  // The board itself: a large flat wooden panel. makeBox places it BELOW the
  // ground (y = -0.5) to start; showReportBoard() slides it up to y = 0.1. It
  // sits just in front of the farmhouse's front face (z = -5), facing the player.
  const NOTICE_W = 3.4; // board width in meters
  const NOTICE_H = 3.4; // board height in meters
  const noticeBoard = makeBox(NOTICE_W, NOTICE_H, 0.1, "#8b5e3c", [0, -0.5, -4.9]);
  noticeBoard.object3D!.visible = false; // hidden until the report phase

  // A cream face over the wood so every line of the report is dark-on-light
  // (navy text straight on brown wood was only ~2.5:1 contrast — unreadable
  // for many kids). The wood stays visible as a frame around the edges.
  {
    const faceMesh = new Mesh(
      new PlaneGeometry(NOTICE_W - 0.16, NOTICE_H - 0.16),
      new MeshBasicMaterial({ color: new Color("#fff8ea") }),
    );
    const face = world.createTransformEntity(faceMesh, { parent: noticeBoard });
    face.object3D!.position.set(0, 0, 0.052); // behind the text (z 0.06+)
  }

  // boardText(): make a line of text PARENTED to the board (so it rides up with
  // it) at a given local height. z = 0.06 sits it just in front of the board face.
  function boardText(
    localY: number,
    widthM: number,
    heightM: number,
    text: string,
    opts: { fontPx?: number; color?: string; bold?: boolean } = {},
  ) {
    const t = makeSamuelTextPlane(widthM, heightM, { ...opts, parent: noticeBoard });
    t.entity.object3D!.position.set(0, localY, 0.06);
    t.setText(text);
    return t;
  }

  // makeBoardBar(): build one labeled score bar on the board — a centered label,
  // a dark "track" box, and a gold "fill" box anchored to the track's LEFT edge
  // (so growing its scale.x fills the bar rightward). Returns the label and fill
  // so showReportBoard() can set the number and animate the fill.
  const NB_BARW = 2.6; // full width of a score bar, in meters
  const NB_BARH = 0.07; // thickness of a score bar, in meters
  function makeBoardBar(labelY: number, barY: number) {
    const label = boardText(labelY, 2.6, 0.08, "", {
      fontPx: 26,
      color: "#1F3A5F",
      bold: true,
    });
    // Dark background "track" (the full-width empty bar).
    const track = new Mesh(
      new PlaneGeometry(NB_BARW, NB_BARH),
      new MeshBasicMaterial({ color: new Color("#3b3b3b") }),
    );
    const trackE = world.createTransformEntity(track, { parent: noticeBoard });
    trackE.object3D!.position.set(0, barY, 0.06);
    // Gold "fill". Translating the geometry right by half its width puts its LEFT
    // edge at the local origin; placing the entity at the bar's left edge and
    // scaling scale.x then grows the fill rightward from there.
    const fgGeo = new PlaneGeometry(NB_BARW, NB_BARH);
    fgGeo.translate(NB_BARW / 2, 0, 0);
    const fill = new Mesh(
      fgGeo,
      new MeshBasicMaterial({ color: new Color("#c8962a") }),
    );
    const fillE = world.createTransformEntity(fill, { parent: noticeBoard });
    fillE.object3D!.position.set(-NB_BARW / 2, barY, 0.07);
    fillE.object3D!.scale.x = 0; // start empty; the animation grows it
    return { label, fillE };
  }

  // --- Build the board's content once, top to bottom -------------------------
  // Heading (static — it never changes).
  boardText(1.52, 3.2, 0.16, "📜 Your Year-End Report", {
    fontPx: 46,
    color: "#1F3A5F",
    bold: true,
  });
  // Three score meters (label + gold bar).
  const nbRevBar = makeBoardBar(1.33, 1.27);
  const nbHealthBar = makeBoardBar(1.13, 1.07);
  const nbAdaptBar = makeBoardBar(0.93, 0.87);
  // Play-style rank: a big gold name plus a one-line description. (The darker
  // readable gold — the bright brand gold washes out on the cream face.)
  const nbRankName = boardText(0.69, 3.0, 0.14, "", {
    fontPx: 50,
    color: TEXT_GOLD,
    bold: true,
  });
  const nbRankDesc = boardText(0.55, 3.1, 0.1, "", {
    fontPx: 24,
    color: "#1F3A5F",
  });
  // Season recap: a title plus one line per season (filled in on enter).
  boardText(0.42, 3.0, 0.07, "🍂 Season Recap", {
    fontPx: 28,
    color: "#1F3A5F",
    bold: true,
  });
  const nbRecap1 = boardText(0.33, 3.2, 0.07, "", { fontPx: 22, color: "#1F3A5F" });
  const nbRecap2 = boardText(0.26, 3.2, 0.07, "", { fontPx: 22, color: "#1F3A5F" });
  const nbRecap3 = boardText(0.19, 3.2, 0.07, "", { fontPx: 22, color: "#1F3A5F" });

  // Play Again button: a gold rectangle with a navy label, made clickable with
  // RayInteractable (the same mechanic as every other 3D button in this file).
  const nbBtnMesh = new Mesh(
    new PlaneGeometry(0.9, 0.18),
    new MeshBasicMaterial({ color: new Color("#c8962a") }),
  );
  const nbPlayAgain = world.createTransformEntity(nbBtnMesh, {
    parent: noticeBoard,
  });
  nbPlayAgain.object3D!.position.set(0, 0.06, 0.06);
  nbPlayAgain.addComponent(RayInteractable);
  const nbBtnLabel = boardText(0.06, 0.9, 0.14, "🔁 Play Again", {
    fontPx: 30,
    color: "#1F3A5F",
    bold: true,
  });
  nbBtnLabel.entity.object3D!.position.set(0, 0.06, 0.08); // sit in front of the gold box

  // --------------------------------------------------------------------------
  // REFLECTION SIGNS — three small cream boards on the fence line, each showing
  // one reflection question. They are shown only during the report phase.
  // --------------------------------------------------------------------------
  const REFLECTION_QUESTIONS = [
    "🤔 When prices suddenly changed, what did you do? Would you do it differently?",
    "🌽 Which crop was your best pick this year? Why did it work — or not?",
    "🪙 How is choosing what to plant like the money choices people make today?",
  ];
  // Three of the fence-post x positions (the fence posts sit at x = -1.8..1.8).
  const reflectionSignXs = [-1.8, 0, 1.8];
  const reflectionSigns: any[] = [];
  for (let i = 0; i < REFLECTION_QUESTIONS.length; i++) {
    const sx = reflectionSignXs[i];
    // A small cream board lifted to ~1.35 m (just above the fence posts).
    const sign = makeBox(0.9, 0.7, 0.05, "#f3e9d2", [sx, 1.35, fenceZ], true);
    const q = makeSamuelTextPlane(0.86, 0.66, {
      fontPx: 20,
      color: "#1F3A5F",
      bold: true,
      parent: sign,
    });
    q.entity.object3D!.position.set(0, 0, 0.04); // just in front of the board face
    q.setText(REFLECTION_QUESTIONS[i]);
    sign.object3D!.visible = false; // hidden until the report phase
    reflectionSigns.push(sign);
  }

  // --------------------------------------------------------------------------
  // rankFinalLine(): Samuel's closing line, chosen to match the earned rank.
  // --------------------------------------------------------------------------
  function rankFinalLine(name: string): string {
    switch (name) {
      case "Bold Speculator":
        return "You've got the heart of a bold merchant! Big bets, big moves. Well played! 🎩";
      case "Savvy Merchant":
        return "You read the market better than most. Smart moves! I'll remember your name. 🌟";
      case "Steady Farmer":
        return "Good, honest work. Virginia needs farmers like you. 💪";
      case "Cautious Grower":
        return "Careful and wise — a steady hand keeps the farm alive. 🛡️";
      case "Learning the Land":
        return "Every farmer has a hard year. You learned a lot — next year will be better! 🌱";
      default:
        return "Careful and wise — a steady hand keeps the farm alive. 🛡️";
    }
  }

  // Timers for the two report animations (so a replay can cancel/restart them).
  let nbRiseTimer: ReturnType<typeof setInterval> | null = null;
  let nbBarTimer: ReturnType<typeof setInterval> | null = null;

  // --------------------------------------------------------------------------
  // showReportBoard(): fill in the board's text, reveal it + the reflection
  // signs, slide the board up from the ground, animate the score bars, and have
  // Samuel deliver his closing line once the board is fully risen. Called by
  // onEnterReport (above) each time the student reaches the report.
  // --------------------------------------------------------------------------
  function showReportBoard(
    rank: { name: string; desc: string },
    s1: string,
    s2: string,
    s3: string,
  ) {
    // a. Fill in the text content from the final scores, rank, and recap.
    nbRevBar.label.setText("🪙 Farm Coins:  " + scoreRevenue + " / 100");
    nbHealthBar.label.setText("🌱 Crop Health:  " + scoreCropHealth + " / 100");
    nbAdaptBar.label.setText("🧠 Market Smarts:  " + scoreAdaptability + " / 100");
    // Star rating from the average score: ★★★ at 70+, ★★ at 55+, ★ below.
    const avgScore = (scoreRevenue + scoreCropHealth + scoreAdaptability) / 3;
    const stars = avgScore >= 70 ? "⭐⭐⭐" : avgScore >= 55 ? "⭐⭐" : "⭐";
    nbRankName.setText(rank.name + "  " + stars);
    nbRankDesc.setText(rank.desc);
    nbRecap1.setText(s1);
    nbRecap2.setText(s2);
    nbRecap3.setText(s3);

    // b. Reveal the board and the reflection signs.
    noticeBoard.object3D!.visible = true;
    for (const s of reflectionSigns) s.object3D!.visible = true;

    // c. Reset the bars to empty and the board to below ground.
    nbRevBar.fillE.object3D!.scale.x = 0;
    nbHealthBar.fillE.object3D!.scale.x = 0;
    nbAdaptBar.fillE.object3D!.scale.x = 0;
    noticeBoard.object3D!.position.y = -0.5;

    // d. Slide the board up from y -0.5 to 0.1 over 1 second.
    if (nbRiseTimer) clearInterval(nbRiseTimer);
    {
      const startY = -0.5;
      const endY = 0.1;
      const durationMs = 1000;
      const tickMs = 16; // ~60 updates per second
      let elapsed = 0;
      nbRiseTimer = setInterval(() => {
        elapsed += tickMs;
        const t = Math.min(elapsed / durationMs, 1); // climbs 0 -> 1
        noticeBoard.object3D!.position.y = startY + (endY - startY) * t;
        if (t >= 1) {
          if (nbRiseTimer) {
            clearInterval(nbRiseTimer);
            nbRiseTimer = null;
          }
          // Once the board is fully up: confetti + fanfare, and Samuel says
          // his rank-appropriate line.
          if (fireReportCelebration) fireReportCelebration();
          samuelSpeak(rankFinalLine(currentRank));
        }
      }, tickMs);
    }

    // e. Grow the three gold fills to score/100 over 1.5 seconds.
    if (nbBarTimer) clearInterval(nbBarTimer);
    {
      const revFrac = scoreRevenue / 100;
      const healthFrac = scoreCropHealth / 100;
      const adaptFrac = scoreAdaptability / 100;
      const durationMs = 1500;
      const tickMs = 16;
      let elapsed = 0;
      nbBarTimer = setInterval(() => {
        elapsed += tickMs;
        const t = Math.min(elapsed / durationMs, 1); // climbs 0 -> 1
        nbRevBar.fillE.object3D!.scale.x = revFrac * t;
        nbHealthBar.fillE.object3D!.scale.x = healthFrac * t;
        nbAdaptBar.fillE.object3D!.scale.x = adaptFrac * t;
        if (t >= 1 && nbBarTimer) {
          clearInterval(nbBarTimer);
          nbBarTimer = null;
        }
      }, tickMs);
    }
  }

  // --------------------------------------------------------------------------
  // handlePlayAgainWorld(): the board's "Play Again" action. It does the extra
  // world resets the new world-space flow needs, then calls the EXISTING
  // handlePlayAgain() to reset scores/decisions and jump back to setup.
  // --------------------------------------------------------------------------
  function handlePlayAgainWorld() {
    // 0. Clear any Samuel gate, open bubble, or leftover quiz from last year.
    //    (Null the gate FIRST so dismissing the bubble can't fire it.)
    onSamuelNewsRead = null;
    clearQuiz();
    dismissSamuelBubble();
    setObjective("Plant a crop in every plot — fill all 16! 🌱");

    // a. Return every field plot to tilled soil and clear its crop + sprout.
    for (const plot of fieldPlots) {
      plot.cropType = null;
      ((plot.object3D as Mesh).material as MeshBasicMaterial).color.set(
        PLOT_SOIL_COLOR,
      );
      if (plot.sproutEntity) {
        plot.sproutEntity.dispose(); // dispose() also frees the sprout's GPU memory
        plot.sproutEntity = null;
      }
    }
    // b. Bring the selection board + crop buttons (and the instruction sign) back
    //    for setup. The buttons are fixed in place, so just re-show them.
    seedShelf.object3D!.visible = true;
    for (const bag of seedBags) {
      bag.object3D!.visible = true; // shows the button AND its child label
    }
    instructionSign.object3D!.visible = true;
    updateConfirmVisibility(); // back to its locked "0 / 16" state
    // c. Hide this notice board and the reflection signs.
    noticeBoard.object3D!.visible = false;
    for (const s of reflectionSigns) s.object3D!.visible = false;
    // d. Run the existing reset logic (scores, decisions, fresh event, -> setup).
    handlePlayAgain();
  }

  // Watch for clicks on the board's Play Again button. Fire ONCE on the rising
  // edge, and only while the report is the current phase (so a stray hit on the
  // hidden button can never restart a game).
  function watchBoardPlayAgain() {
    // A press is consumed the frame we see it, so seeing one IS the click.
    if (nbPlayAgain.hasComponent(Pressed)) {
      if (currentPhase === PHASE_REPORT) {
        sfxClick();
        handlePlayAgainWorld();
      }
      consumePress(nbPlayAgain);
    }
  }
  // setInterval (not rAF): keeps working inside immersive XR sessions.
  setInterval(watchBoardPlayAgain, 33);

  // ==========================================================================
  // GAME FEEL — world scoreboard, floating score popups, season banners, and
  // confetti. These give every choice immediate, juicy feedback (and make the
  // scores visible inside a headset, where the HTML HUD doesn't exist).
  // ==========================================================================

  // --------------------------------------------------------------------------
  // WORLD SCOREBOARD — a standing wooden sign beside the field showing the
  // same three meters as the HUD plus the coin total, drawn on a canvas.
  // --------------------------------------------------------------------------
  const SCOREBOARD_X = 3.6;
  const SCOREBOARD_Z = -2.0;

  const scoreboardCanvas = document.createElement("canvas");
  scoreboardCanvas.width = 512;
  scoreboardCanvas.height = 560; // extra room for the season + objective lines
  const scoreboardCtx = scoreboardCanvas.getContext("2d")!;
  const scoreboardTexture = new CanvasTexture(scoreboardCanvas);
  scoreboardTexture.colorSpace = SRGBColorSpace;

  // The three meters' display info, shared by the scoreboard and the popups.
  // `color` is the bright bar color (a graphic); `textColor` is the darker
  // high-contrast variant used for any words/numbers on light backgrounds.
  const METER_INFO: Record<
    string,
    { label: string; icon: string; color: string; textColor: string }
  > = {
    revenue: { label: "Farm Coins", icon: "🪙", color: "#c8962a", textColor: TEXT_GOLD },
    crophealth: { label: "Crop Health", icon: "🌱", color: "#5fae4a", textColor: TEXT_GREEN },
    adaptability: { label: "Market Smarts", icon: "🧠", color: "#4a8fd6", textColor: TEXT_BLUE },
  };

  // (Re)draw the whole scoreboard from the current scores, season, and
  // objective. Called whenever any of those change.
  function updateScoreboard() {
    const ctx = scoreboardCtx;
    ctx.clearRect(0, 0, 512, 560);
    // Cream board with a navy frame.
    ctx.fillStyle = "#1F3A5F";
    ctx.fillRect(0, 0, 512, 560);
    ctx.fillStyle = "#fff8ea";
    ctx.fillRect(10, 10, 492, 540);
    // Title + season chip line.
    ctx.fillStyle = "#1F3A5F";
    ctx.font = "bold 40px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("🌾 My Farm", 256, 48);
    ctx.fillStyle = TEXT_GREEN;
    ctx.font = "bold 28px system-ui, sans-serif";
    ctx.fillText("— " + scoreboardSeasonLabel + " —", 256, 88);
    // The three meters.
    const meters: [string, number][] = [
      ["revenue", scoreRevenue],
      ["crophealth", scoreCropHealth],
      ["adaptability", scoreAdaptability],
    ];
    let y = 134;
    for (const [key, score] of meters) {
      const info = METER_INFO[key];
      ctx.textAlign = "left";
      ctx.font = "bold 30px system-ui, sans-serif";
      ctx.fillStyle = "#1F3A5F";
      ctx.fillText(info.icon + " " + info.label, 36, y);
      ctx.textAlign = "right";
      ctx.fillStyle = info.textColor; // darker variant: readable on cream
      ctx.fillText(String(score), 476, y);
      // Meter track + fill.
      ctx.fillStyle = "#e4ddd0";
      ctx.beginPath();
      ctx.roundRect(36, y + 18, 440, 26, 13);
      ctx.fill();
      ctx.fillStyle = info.color;
      ctx.beginPath();
      ctx.roundRect(36, y + 18, Math.max(26, 440 * (score / 100)), 26, 13);
      ctx.fill();
      y += 86;
    }
    // Coin total.
    ctx.textAlign = "center";
    ctx.font = "bold 32px system-ui, sans-serif";
    ctx.fillStyle = TEXT_GOLD;
    ctx.fillText("💰 Coins earned: " + farmRevenue, 256, y + 4);
    // Objective banner: a dark-amber band so the white goal text stays crisp.
    if (currentObjective) {
      ctx.fillStyle = TEXT_GOLD;
      ctx.beginPath();
      ctx.roundRect(22, 452, 468, 90, 14);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 26px system-ui, sans-serif";
      // Simple two-line word wrap.
      const words = ("👉 " + currentObjective).split(" ");
      const lines: string[] = [];
      let line = "";
      for (const word of words) {
        const candidate = line ? line + " " + word : word;
        if (ctx.measureText(candidate).width > 440 && line) {
          lines.push(line);
          line = word;
        } else {
          line = candidate;
        }
      }
      if (line) lines.push(line);
      const startY = lines.length > 1 ? 480 : 497;
      for (let i = 0; i < Math.min(lines.length, 2); i++) {
        ctx.fillText(lines[i], 256, startY + i * 32);
      }
    }
    scoreboardTexture.needsUpdate = true;
  }

  // Build the physical sign: two posts, a wood frame, and the canvas face.
  {
    const sb = new Group();
    for (const sx of [-0.5, 0.5]) {
      const post = new Mesh(
        new BoxGeometry(0.08, 1.8, 0.08),
        new MeshLambertMaterial({ color: new Color("#5b3a21") }),
      );
      post.castShadow = true;
      post.position.set(sx, 0.9, -0.04);
      sb.add(post);
    }
    const frame = new Mesh(
      new BoxGeometry(1.34, 1.5, 0.06),
      new MeshLambertMaterial({ color: new Color("#8b5e3c") }),
    );
    frame.castShadow = true;
    frame.position.set(0, 1.36, 0);
    sb.add(frame);
    const face = new Mesh(
      new PlaneGeometry(1.24, 1.36),
      new MeshBasicMaterial({ map: scoreboardTexture }),
    );
    face.position.set(0, 1.36, 0.035);
    sb.add(face);
    const sbEntity = world.createTransformEntity(sb);
    sbEntity.object3D!.position.set(SCOREBOARD_X, 0, SCOREBOARD_Z);
    sbEntity.object3D!.lookAt(0, 0, 2); // angled toward the player spawn
    updateScoreboard(); // first draw
  }

  // Keep the scoreboard fresh whenever the HUD refreshes or the objective
  // changes (headset players read their goal off this sign).
  onHudRefresh = () => updateScoreboard();
  onObjectiveChange = () => updateScoreboard();

  // --------------------------------------------------------------------------
  // SCORE POPUPS — a floating "+10 🪙 Farm Coins" that rises off the
  // scoreboard and fades. Spawned on every score change.
  // --------------------------------------------------------------------------
  function spawnScorePopup(text: string, colorHex: string) {
    // A soft cream pill behind the words — without it the green/red text
    // floats over sky and grass with no guaranteed contrast.
    const popup = makeSamuelTextPlane(1.6, 0.3, {
      fontPx: 44,
      color: colorHex,
      bgColor: "rgba(255, 252, 244, 0.92)",
      bold: true,
    });
    const obj = popup.entity.object3D!;
    obj.position.set(SCOREBOARD_X, 2.05, SCOREBOARD_Z);
    obj.lookAt(0, 2.05, 2); // face the player spawn, staying upright
    popup.setText(text);

    const material = (popup.entity.object3D as Mesh)
      .material as MeshBasicMaterial;
    const durationMs = 1400;
    const tickMs = 30;
    let elapsed = 0;
    const timer = setInterval(() => {
      elapsed += tickMs;
      const t = Math.min(elapsed / durationMs, 1);
      obj.position.y = 2.05 + 0.55 * t; // drift upward
      material.opacity = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3; // fade at the end
      if (t >= 1) {
        clearInterval(timer);
        popup.entity.dispose();
      }
    }, tickMs);
  }

  // React to every score change: refresh the scoreboard, float a popup, and
  // play a cheerful (or sympathetic) sound.
  onScoreChange = (meter: string, delta: number) => {
    updateScoreboard();
    const info = METER_INFO[meter];
    if (!info) return;
    const signText = (delta > 0 ? "+" : "") + delta;
    spawnScorePopup(
      signText + " " + info.icon + " " + info.label,
      delta >= 0 ? "#2e7d32" : "#b3402e",
    );
    if (delta >= 0) sfxCoin();
    else sfxDown();
  };

  // --------------------------------------------------------------------------
  // SEASON BANNERS — a big friendly headline that pops up over the farm at the
  // start of every phase, then fades away.
  // --------------------------------------------------------------------------
  const BANNER_TEXTS: Record<string, string> = {
    setup: "🌱 Time to Plant!",
    season1: "🌞 Season 1: Watch Them Grow!",
    season2: "⛈️ Season 2: The Market Moves!",
    season3: "🍂 Season 3: The Big Harvest!",
    report: "🏆 The Results Are In!",
  };

  function spawnBanner(text: string) {
    const banner = makeSamuelTextPlane(3.4, 0.62, {
      fontPx: 64,
      color: "#ffe9b0",
      bgColor: "rgba(31, 58, 95, 0.88)", // navy ribbon behind the words
      bold: true,
    });
    const obj = banner.entity.object3D!;
    obj.position.set(0, 2.6, -1.6);
    obj.scale.setScalar(0.5);
    banner.setText(text);

    const material = (banner.entity.object3D as Mesh)
      .material as MeshBasicMaterial;
    const durationMs = 4200; // long enough to actually read
    const tickMs = 30;
    let elapsed = 0;
    const timer = setInterval(() => {
      elapsed += tickMs;
      const t = Math.min(elapsed / durationMs, 1);
      // Pop in over the first 12%, hold, fade over the last 20%.
      const popT = Math.min(t / 0.12, 1);
      obj.scale.setScalar(0.5 + 0.5 * (1 - (1 - popT) * (1 - popT))); // ease out
      material.opacity = t < 0.8 ? 1 : 1 - (t - 0.8) / 0.2;
      if (t >= 1) {
        clearInterval(timer);
        banner.entity.dispose();
      }
    }, tickMs);
  }

  // Each phase has its own LOOK: the sky, sunlight, grass, and trees retint so
  // the passage of seasons is unmistakable (spring planting → bright summer →
  // dry late summer → golden autumn → a warm golden-hour finale).
  const SEASON_LOOK_BY_PHASE: Record<
    string,
    "spring" | "summer" | "lateSummer" | "autumn" | "golden"
  > = {
    setup: "spring",
    season1: "summer",
    season2: "lateSummer",
    season3: "autumn",
    report: "golden",
  };

  onPhaseBanner = (phase: string) => {
    const text = BANNER_TEXTS[phase];
    if (text) spawnBanner(text);
    if (phase !== PHASE_REPORT) sfxSeason(); // the report plays its own fanfare
    const look = SEASON_LOOK_BY_PHASE[phase];
    if (look) setSeasonLook(look);
    updateScoreboard(); // the scoreboard shows the season label
  };
  // The world starts in spring (the setup phase never goes through showPhase
  // on a fresh load, so set the opening look directly).
  setSeasonLook("spring");

  // --------------------------------------------------------------------------
  // CONFETTI — a celebratory burst of colored squares for the final report.
  // --------------------------------------------------------------------------
  function spawnConfetti(cx: number, cy: number, cz: number) {
    const COLORS = ["#e85d75", "#f3c53d", "#5fae4a", "#4a8fd6", "#ef8b4e", "#8f6fd1"];
    const pieces: {
      obj: any;
      vx: number;
      vy: number;
      vz: number;
      spin: number;
    }[] = [];
    for (let i = 0; i < 36; i++) {
      const mesh = new Mesh(
        new PlaneGeometry(0.06, 0.06),
        new MeshBasicMaterial({
          color: new Color(COLORS[i % COLORS.length]),
          side: DoubleSide,
        }),
      );
      const e = world.createTransformEntity(mesh);
      e.object3D!.position.set(cx, cy, cz);
      const angle = Math.random() * Math.PI * 2;
      pieces.push({
        obj: e,
        vx: Math.cos(angle) * (0.4 + Math.random() * 0.9),
        vy: 1.6 + Math.random() * 1.4,
        vz: Math.sin(angle) * (0.4 + Math.random() * 0.9) + 0.5,
        spin: (Math.random() - 0.5) * 0.5,
      });
    }
    const tickMs = 30;
    const dt = tickMs / 1000;
    let lifeMs = 0;
    const timer = setInterval(() => {
      lifeMs += tickMs;
      for (const p of pieces) {
        p.vy -= 3.4 * dt; // gravity
        const o = p.obj.object3D!;
        o.position.x += p.vx * dt;
        o.position.y += p.vy * dt;
        o.position.z += p.vz * dt;
        o.rotation.x += p.spin;
        o.rotation.y += p.spin * 0.7;
      }
      if (lifeMs >= 2200) {
        clearInterval(timer);
        for (const p of pieces) p.obj.dispose();
      }
    }, tickMs);
  }

  // Hand the confetti cannon to the report code (it fires once the notice
  // board has risen out of the ground).
  fireReportCelebration = () => {
    spawnConfetti(0, 2.2, -4.3);
    sfxFanfare();
  };
});
