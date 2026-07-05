// ============================================================================
// environment.ts — the visual world of Market Harvest
// ----------------------------------------------------------------------------
// Everything in this file is "set dressing": the sky, lighting, terrain,
// farmhouse, fence, market stall, trees, clouds, and other scenery. None of it
// holds game logic — index.ts builds the world, calls buildEnvironment(), and
// keeps using the same gameplay anchor positions it always has (the field at
// z = -3, the farmhouse front face at z = -5, the stall at x = 8).
//
// Visual style: bright, stylized low-poly — flat-shaded shapes lit by a warm
// sun (DirectionalLight) + soft sky light (HemisphereLight), under a custom
// gradient sky dome. Scenery uses MeshLambertMaterial so the light gives every
// shape depth; UI cards and text planes stay MeshBasicMaterial in index.ts so
// they always read bright and clear.
// ============================================================================

import {
  World,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  BoxGeometry,
  CylinderGeometry,
  SphereGeometry,
  ConeGeometry,
  PlaneGeometry,
  CircleGeometry,
  CanvasTexture,
  SRGBColorSpace,
  RepeatWrapping,
  DirectionalLight,
  HemisphereLight,
  Fog,
  BackSide,
  DoubleSide,
  AssetManager,
  Box3,
  Vector3,
  Object3D,
} from "@iwsdk/core";

// ----------------------------------------------------------------------------
// PALETTE — one place for the scene's colors so everything stays cohesive.
// ----------------------------------------------------------------------------
export const PALETTE = {
  grass: "#6fb24c", // main lawn green
  grassFar: "#5d9a40", // distant ground, slightly deeper
  soil: "#7d5433", // tilled field dirt
  plotSoil: "#7a4e2d", // un-planted plot tiles (texture-tinted)
  path: "#d8b97f", // sandy walking path
  wood: "#8b5e3c", // mid wood (stall, fence rails)
  woodDark: "#5b3a21", // dark wood (posts, beams)
  wallCream: "#f7eed9", // farmhouse walls
  roofRed: "#b85432", // farmhouse roof
  brick: "#9c4a32", // chimney bricks
  skyTop: "#3f8fd6", // sky zenith
  skyMid: "#8ec4ea", // sky middle
  horizon: "#dceefb", // sky at the horizon (also the fog color)
  sun: "#fff3c4",
  cloud: "#ffffff",
  hill: "#74a857",
  leaf: "#4e8f3a", // tree foliage
  leafDark: "#3f7830",
  trunk: "#6e4a2c",
};

// The fog color must match the horizon so distant objects melt into the sky.
const FOG_COLOR = PALETTE.horizon;

// ----------------------------------------------------------------------------
// SEASONAL LOOKS — the world visibly changes with the seasons. buildEnvironment
// stashes references to the sky material, lights, fog, and every "foliage"
// material here; setSeasonLook() then retints them per season so the change of
// season is unmistakable (spring greens → dry late summer → golden autumn →
// a warm golden-hour finale for the report).
// ----------------------------------------------------------------------------
const seasonState = {
  skyMat: null as MeshBasicMaterial | null,
  sunLight: null as DirectionalLight | null,
  hemi: null as HemisphereLight | null,
  fog: null as Fog | null,
  groundMats: [] as MeshLambertMaterial[], // textured mats (tint = color.set)
  // Plain-colored foliage mats keep their original color so tints can be
  // re-applied idempotently: color = original × tint.
  foliageMats: [] as { mat: { color: Color }; orig: Color }[],
};

function registerFoliage(mesh: Mesh) {
  const mat = mesh.material as MeshLambertMaterial;
  seasonState.foliageMats.push({ mat, orig: mat.color.clone() });
}

type SeasonLook = "spring" | "summer" | "lateSummer" | "autumn" | "golden";

const SEASON_LOOKS: Record<
  SeasonLook,
  {
    skyTop: string;
    skyMid: string;
    horizon: string;
    sun: string;
    sunIntensity: number;
    hemiIntensity: number;
    ground: string; // tint over the grass texture
    foliage: string; // multiplied over each foliage color
  }
> = {
  spring: {
    skyTop: "#3f8fd6",
    skyMid: "#8ec4ea",
    horizon: "#dceefb",
    sun: "#fff2d4",
    sunIntensity: 2.4,
    hemiIntensity: 1.15,
    ground: "#ffffff",
    foliage: "#ffffff",
  },
  summer: {
    skyTop: "#2f86d8",
    skyMid: "#7fbcec",
    horizon: "#d2eafb",
    sun: "#ffefbe",
    sunIntensity: 2.7,
    hemiIntensity: 1.2,
    ground: "#fdffe8",
    foliage: "#f2ffd2",
  },
  lateSummer: {
    skyTop: "#3a7fc0",
    skyMid: "#93b8e0",
    horizon: "#e4ddc8",
    sun: "#ffe3a0",
    sunIntensity: 2.5,
    hemiIntensity: 1.05,
    ground: "#ecd592", // visibly drier grass
    foliage: "#d8cc7e",
  },
  autumn: {
    skyTop: "#5a93c8",
    skyMid: "#a9c2d8",
    horizon: "#eedcc0",
    sun: "#ffd9a0",
    sunIntensity: 2.2,
    hemiIntensity: 1.0,
    ground: "#e0b964", // golden autumn lawn
    foliage: "#ff9f5e",
  },
  golden: {
    skyTop: "#6f7fb8",
    skyMid: "#d9a878",
    horizon: "#f6cf9a",
    sun: "#ffba78",
    sunIntensity: 2.0,
    hemiIntensity: 0.95,
    ground: "#eccf9e",
    foliage: "#e8a05e",
  },
};

/**
 * Retint the whole world for a season. Safe to call any number of times in
 * any order — every tint is computed from stored originals, never stacked.
 */
export function setSeasonLook(look: SeasonLook) {
  const preset = SEASON_LOOKS[look];
  if (!preset) return;

  // Sky dome: redraw the gradient texture with the season's colors.
  if (seasonState.skyMat) {
    const old = seasonState.skyMat.map;
    seasonState.skyMat.map = makeSkyTexture(
      preset.skyTop,
      preset.skyMid,
      preset.horizon,
    );
    seasonState.skyMat.needsUpdate = true;
    if (old) old.dispose();
  }

  // Sunlight + ambient.
  if (seasonState.sunLight) {
    seasonState.sunLight.color.set(preset.sun);
    seasonState.sunLight.intensity = preset.sunIntensity;
  }
  if (seasonState.hemi) seasonState.hemi.intensity = preset.hemiIntensity;

  // Fog melts into the new horizon color.
  if (seasonState.fog) seasonState.fog.color.set(preset.horizon);

  // Grass (textured — tint is the material color over the white-based map).
  for (const mat of seasonState.groundMats) mat.color.set(preset.ground);

  // Foliage: original color × season tint.
  const tint = new Color(preset.foliage);
  for (const f of seasonState.foliageMats) {
    f.mat.color.copy(f.orig).multiply(tint);
  }
}

// ----------------------------------------------------------------------------
// Small builders — every scenery piece below is made out of these.
// ----------------------------------------------------------------------------

// Plain (non-entity) lit meshes for building grouped props. Children added to
// a Group BEFORE the group becomes an entity render and transform correctly.
function meshBox(w: number, h: number, d: number, color: string): Mesh {
  const m = new Mesh(
    new BoxGeometry(w, h, d),
    new MeshLambertMaterial({ color: new Color(color) }),
  );
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
function meshCylinder(
  rTop: number,
  rBottom: number,
  h: number,
  color: string,
  segments = 12,
): Mesh {
  const m = new Mesh(
    new CylinderGeometry(rTop, rBottom, h, segments),
    new MeshLambertMaterial({ color: new Color(color) }),
  );
  m.castShadow = true;
  return m;
}
function meshSphere(r: number, color: string, segments = 12): Mesh {
  const m = new Mesh(
    new SphereGeometry(r, segments, segments),
    new MeshLambertMaterial({ color: new Color(color) }),
  );
  m.castShadow = true;
  return m;
}
function meshCone(r: number, h: number, color: string, segments = 10): Mesh {
  const m = new Mesh(
    new ConeGeometry(r, h, segments),
    new MeshLambertMaterial({ color: new Color(color) }),
  );
  m.castShadow = true;
  return m;
}

// ----------------------------------------------------------------------------
// CANVAS TEXTURES — tiny procedural textures drawn once at startup.
// ----------------------------------------------------------------------------

/** Soft mottled grass: green base with lighter/darker dabs. */
function makeGrassTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = PALETTE.grass;
  ctx.fillRect(0, 0, 256, 256);
  // Random dabs of nearby greens give the lawn a hand-painted feel.
  const tones = ["#79bb55", "#65a844", "#7fc05c", "#5fa03f"];
  for (let i = 0; i < 420; i++) {
    ctx.fillStyle = tones[i % tones.length];
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const r = 2 + Math.random() * 5;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(8, 8);
  return tex;
}

/**
 * Grayscale furrow texture for crop-plot tiles. It is drawn in grays so the
 * material's `color` keeps tinting it — index.ts recolors plots when crops are
 * planted (crop color), at year end (fallow), and on replay (dark soil), and
 * all of those keep working because color multiplies over this texture.
 */
function makeFurrowTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#d6cec4"; // light gray base (tinted by material color)
  ctx.fillRect(0, 0, 128, 128);
  // Horizontal furrow ridges: alternating light/dark bands.
  for (let row = 0; row < 8; row++) {
    const y = row * 16;
    ctx.fillStyle = "#a89d90";
    ctx.fillRect(0, y + 9, 128, 7);
    ctx.fillStyle = "#e6ded4";
    ctx.fillRect(0, y + 2, 128, 3);
  }
  // A few pebbles.
  ctx.fillStyle = "#bfb4a8";
  for (let i = 0; i < 26; i++) {
    ctx.beginPath();
    ctx.arc(Math.random() * 128, Math.random() * 128, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** Sandy path with scattered pebbles. */
function makePathTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = PALETTE.path;
  ctx.fillRect(0, 0, 256, 64);
  const tones = ["#cbae77", "#e2c48c", "#c4a76e"];
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = tones[i % tones.length];
    ctx.beginPath();
    ctx.arc(Math.random() * 256, Math.random() * 64, 1 + Math.random() * 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.repeat.set(4, 1);
  return tex;
}

/** Red-and-cream awning stripes for the market stall. */
function makeAwningTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 === 0 ? "#c0503a" : "#f7eed9";
    ctx.fillRect(i * 32, 0, 32, 64);
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** Vertical sky gradient used inside the custom sky dome. */
function makeSkyTexture(
  top = PALETTE.skyTop,
  mid = PALETTE.skyMid,
  horizon = PALETTE.horizon,
): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 512;
  const ctx = c.getContext("2d")!;
  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0.0, top);
  grad.addColorStop(0.45, mid);
  grad.addColorStop(0.62, horizon);
  grad.addColorStop(1.0, horizon);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 4, 512);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

// Shared textures (created lazily so this module stays import-safe).
let furrowTexture: CanvasTexture | null = null;
export function getFurrowTexture(): CanvasTexture {
  if (!furrowTexture) furrowTexture = makeFurrowTexture();
  return furrowTexture;
}

// ----------------------------------------------------------------------------
// GLB PLACEMENT — drop a preloaded model into the world at a given spot,
// auto-scaled to a target height with its base resting on the ground. Returns
// null if the asset isn't available (callers fall back to procedural shapes).
// ----------------------------------------------------------------------------
function placeGLB(
  world: World,
  assetKey: string,
  x: number,
  z: number,
  targetHeight: number,
  rotY = 0,
  sinkY = 0,
  tintWithSeasons = false,
) {
  let modelRoot: Object3D | null = null;
  try {
    const gltf = AssetManager.getGLTF(assetKey); // fresh clone per call
    modelRoot = (gltf && (gltf.scene || (gltf.scenes && gltf.scenes[0]))) || null;
  } catch {
    modelRoot = null;
  }
  if (!modelRoot) return null;

  // Measure the model, then scale it to the target height and shift it inside
  // a wrapper group so its base sits at y = 0, centered on the group origin.
  const box = new Box3().setFromObject(modelRoot);
  const size = new Vector3();
  box.getSize(size);
  const center = new Vector3();
  box.getCenter(center);
  const s = targetHeight / (size.y || 1);
  modelRoot.scale.setScalar(s);
  modelRoot.position.set(-center.x * s, -box.min.y * s - sinkY, -center.z * s);
  modelRoot.traverse((obj: any) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
      // Trees join the seasonal tinting (their textured materials start with a
      // white color, so the tint multiplies cleanly over the texture).
      if (tintWithSeasons && obj.material && obj.material.color) {
        seasonState.foliageMats.push({
          mat: obj.material,
          orig: obj.material.color.clone(),
        });
      }
    }
  });

  const wrapper = new Group();
  wrapper.add(modelRoot);
  const entity = world.createTransformEntity(wrapper);
  entity.object3D!.position.set(x, 0, z);
  entity.object3D!.rotation.y = rotY;
  return entity;
}

// ----------------------------------------------------------------------------
// SKY + LIGHTING
// ----------------------------------------------------------------------------
function buildSkyAndLights(world: World) {
  const { scene } = world;

  // Gentle distance fog melts faraway scenery into the horizon color. The sky
  // dome, sun, and clouds opt OUT of fog (material.fog = false) so the sky
  // itself never grays out.
  const fog = new Fog(new Color(FOG_COLOR), 30, 90);
  scene.fog = fog;
  seasonState.fog = fog;

  // Custom gradient sky dome: a big inverted sphere drawn from the inside.
  const skyMat = new MeshBasicMaterial({
    map: makeSkyTexture(),
    side: BackSide,
  });
  skyMat.fog = false;
  seasonState.skyMat = skyMat;
  const skyMesh = new Mesh(new SphereGeometry(110, 24, 16), skyMat);
  const sky = world.createTransformEntity(skyMesh);
  sky.object3D!.position.set(0, 0, 0);

  // The sun: a soft warm disc high behind the player's right shoulder (it
  // lights the farmhouse front, so shadows fall AWAY from the crop field).
  const sunMat = new MeshBasicMaterial({ color: new Color(PALETTE.sun) });
  sunMat.fog = false;
  const sunMesh = new Mesh(new CircleGeometry(5, 24), sunMat);
  const sun = world.createTransformEntity(sunMesh);
  sun.object3D!.position.set(-45, 60, 55);
  sun.object3D!.lookAt(0, 0, 0);
  const haloMat = new MeshBasicMaterial({
    color: new Color(PALETTE.sun),
    transparent: true,
    opacity: 0.35,
  });
  haloMat.fog = false;
  const haloMesh = new Mesh(new CircleGeometry(8, 24), haloMat);
  const halo = world.createTransformEntity(haloMesh);
  halo.object3D!.position.set(-44.5, 60, 54.4);
  halo.object3D!.lookAt(0, 0, 0);

  // Soft ambient: blue-ish from the sky above, warm green bounce from below.
  const hemi = new HemisphereLight(
    new Color("#cfe6ff"),
    new Color("#9a7c52"),
    1.15,
  );
  seasonState.hemi = hemi;
  const hemiEntity = world.createTransformEntity(new Group());
  hemiEntity.object3D!.add(hemi);

  // The sun's direct light. Angled from the same direction as the sun disc,
  // so the farmhouse front and the crop field sit in full light and shadows
  // fall back-right, away from the play area.
  const sunLight = new DirectionalLight(new Color("#fff2d4"), 2.4);
  sunLight.position.set(-13, 24, 16);
  sunLight.target.position.set(0, 0, -4);
  // One mid-size shadow map covering the whole farm. Cheap and cheerful.
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(1024, 1024); // plenty for the stylized look; kind to Quest GPUs
  sunLight.shadow.camera.left = -20;
  sunLight.shadow.camera.right = 20;
  sunLight.shadow.camera.top = 20;
  sunLight.shadow.camera.bottom = -20;
  sunLight.shadow.camera.near = 1;
  sunLight.shadow.camera.far = 80;
  sunLight.shadow.bias = -0.002;
  seasonState.sunLight = sunLight;
  const sunEntity = world.createTransformEntity(new Group());
  sunEntity.object3D!.add(sunLight);
  sunEntity.object3D!.add(sunLight.target);

  // Turn shadow rendering on. The renderer has usually drawn a frame or two
  // before this code runs, so also flag every existing material for recompile
  // — otherwise three.js keeps the shadow-less shader programs it already
  // built and no shadows ever appear.
  world.renderer.shadowMap.enabled = true;
  world.scene.traverse((obj: any) => {
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) m.needsUpdate = true;
    }
  });
}

// ----------------------------------------------------------------------------
// TERRAIN — lawn, distant ground + hills, field dirt, paths.
// ----------------------------------------------------------------------------
function buildTerrain(world: World, fieldCenterZ: number) {
  // The walkable ground: same 30 x 30 box the game has always used (index.ts
  // adds LocomotionEnvironment to the returned entity). Grass-textured top.
  const groundMat = new MeshLambertMaterial({
    map: makeGrassTexture(),
  });
  seasonState.groundMats.push(groundMat); // tinted by the seasons
  const groundMesh = new Mesh(new BoxGeometry(30, 0.2, 30), groundMat);
  groundMesh.receiveShadow = true;
  const ground = world.createTransformEntity(groundMesh);
  ground.object3D!.position.set(0, -0.1, 0);

  // A huge ring of distant ground so the horizon is never bare.
  const farMat = new MeshLambertMaterial({ color: new Color(PALETTE.grassFar) });
  const farMesh = new Mesh(new CircleGeometry(110, 40), farMat);
  farMesh.rotation.x = -Math.PI / 2;
  farMesh.receiveShadow = true;
  registerFoliage(farMesh); // distant grass changes with the seasons too
  const far = world.createTransformEntity(farMesh);
  far.object3D!.position.set(0, -0.05, 0);

  // Rolling hills on the horizon: big squashed spheres, softened by fog.
  const hillSpots: [number, number, number, number][] = [
    // x, z, radius, squash
    [-45, -55, 26, 0.28],
    [10, -65, 32, 0.24],
    [55, -45, 24, 0.3],
    [-60, 5, 28, 0.26],
    [60, 20, 26, 0.24],
    [-25, 60, 30, 0.22],
    [35, 62, 26, 0.26],
  ];
  for (const [x, z, r, squash] of hillSpots) {
    const hill = new Mesh(
      new SphereGeometry(r, 18, 12),
      new MeshLambertMaterial({ color: new Color(PALETTE.hill) }),
    );
    hill.scale.y = squash;
    registerFoliage(hill); // hills turn golden in autumn
    const e = world.createTransformEntity(hill);
    e.object3D!.position.set(x, -1.5, z);
  }

  // Tilled dirt patch under the 4 x 4 crop field.
  const dirtMesh = new Mesh(
    new BoxGeometry(4.6, 0.04, 4.6),
    new MeshLambertMaterial({ color: new Color(PALETTE.soil) }),
  );
  dirtMesh.receiveShadow = true;
  const dirt = world.createTransformEntity(dirtMesh);
  dirt.object3D!.position.set(0, 0.012, fieldCenterZ);

  // Sandy path from the farmhouse door area out to Samuel's stall (+X), and a
  // short spur from the player spawn up to the field.
  const pathTex = makePathTexture();
  const pathMat = new MeshLambertMaterial({ map: pathTex });
  const path1 = new Mesh(new PlaneGeometry(9.5, 1.3), pathMat);
  path1.rotation.x = -Math.PI / 2;
  path1.receiveShadow = true;
  const p1 = world.createTransformEntity(path1);
  p1.object3D!.position.set(6.2, 0.015, -6);

  const path2 = new Mesh(new PlaneGeometry(1.2, 4.5), pathMat.clone());
  path2.rotation.x = -Math.PI / 2;
  path2.receiveShadow = true;
  const p2 = world.createTransformEntity(path2);
  p2.object3D!.position.set(0.9, 0.015, 0.4);

  return ground;
}

// ----------------------------------------------------------------------------
// FARMHOUSE — gabled roof, chimney, door, windows, timber trim.
// The front face stays exactly at z = -5 (the game hangs its corkboards there).
// ----------------------------------------------------------------------------
function buildFarmhouse(world: World) {
  const HX = 0; // house center x
  const HZ = -6; // house center z  (front face at -5, depth 2)
  const W = 5.0; // width
  const D = 2.0; // depth
  const WALL_H = 2.3;

  const house = new Group();

  // Stone foundation, slightly larger than the walls.
  const foundation = meshBox(W + 0.2, 0.25, D + 0.2, "#9a948a");
  foundation.position.set(0, 0.125, 0);
  house.add(foundation);

  // Cream walls.
  const walls = meshBox(W, WALL_H, D, PALETTE.wallCream);
  walls.position.set(0, 0.25 + WALL_H / 2, 0);
  house.add(walls);

  // Dark timber corner posts + a horizontal beam, for that colonial look.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const post = meshBox(0.12, WALL_H, 0.12, PALETTE.woodDark);
      post.position.set(sx * (W / 2 - 0.04), 0.25 + WALL_H / 2, sz * (D / 2 - 0.04));
      house.add(post);
    }
  }
  const beam = meshBox(W + 0.04, 0.12, D + 0.04, PALETTE.woodDark);
  beam.position.set(0, 0.25 + WALL_H - 0.05, 0);
  house.add(beam);

  // Gabled roof: a 3-sided "cylinder" (triangular prism). Rotating the
  // GEOMETRY (not the mesh) by 90° around Z lays the prism along X with the
  // triangle's apex pointing up and its flat side down — a deterministic
  // gable. The triangle is inscribed in radius 1 (apex y=+1, base y=-0.5,
  // base width √3 in z), so we scale y/z to fit the house.
  const roofGeo = new CylinderGeometry(1, 1, W + 0.8, 3, 1);
  roofGeo.rotateZ(Math.PI / 2);
  const roof = new Mesh(
    roofGeo,
    new MeshLambertMaterial({ color: new Color(PALETTE.roofRed) }),
  );
  roof.castShadow = true;
  roof.scale.set(1, 0.75, (D + 0.9) / Math.sqrt(3)); // ~1.1 tall, overhangs depth
  // Base of the scaled triangle sits 0.5 * 0.75 below the mesh center.
  roof.position.set(0, 0.25 + WALL_H + 0.5 * 0.75, 0);
  house.add(roof);

  // Chimney poking through the right side of the roof.
  const chimney = meshBox(0.45, 1.5, 0.45, PALETTE.brick);
  chimney.position.set(W / 2 - 0.8, 0.25 + WALL_H + 0.85, 0);
  house.add(chimney);
  const chimneyCap = meshBox(0.58, 0.12, 0.58, "#7d3a26");
  chimneyCap.position.set(W / 2 - 0.8, 0.25 + WALL_H + 1.62, 0);
  house.add(chimneyCap);

  // Front door on the left half of the front face (the corkboard the game
  // hangs at x = 0 stays clear). z is the front face plus a hair.
  const door = meshBox(0.62, 1.25, 0.06, PALETTE.woodDark);
  door.position.set(-1.7, 0.25 + 0.625, D / 2 + 0.03);
  house.add(door);
  const knob = meshSphere(0.035, "#d8b04a", 8);
  knob.position.set(-1.5, 0.25 + 0.62, D / 2 + 0.07);
  house.add(knob);
  const stoop = meshBox(0.9, 0.1, 0.5, "#9a948a");
  stoop.position.set(-1.7, 0.05, D / 2 + 0.3);
  house.add(stoop);

  // Windows: white frame + sky-blue glass, two on the front, one per side.
  function addWindow(x: number, y: number, z: number, rotY: number) {
    const frame = meshBox(0.6, 0.7, 0.05, "#ffffff");
    const glass = new Mesh(
      new PlaneGeometry(0.48, 0.58),
      new MeshLambertMaterial({ color: new Color("#bcd8ec") }),
    );
    const crossV = meshBox(0.05, 0.62, 0.02, "#ffffff");
    const crossH = meshBox(0.52, 0.05, 0.02, "#ffffff");
    const win = new Group();
    glass.position.z = 0.03;
    crossV.position.z = 0.045;
    crossH.position.z = 0.045;
    win.add(frame, glass, crossV, crossH);
    win.position.set(x, y, z);
    win.rotation.y = rotY;
    house.add(win);
  }
  addWindow(1.75, 0.25 + 1.45, D / 2 + 0.04, 0); // front right, above corkboard side
  addWindow(-0.6, 0.25 + 1.45, D / 2 + 0.04, 0); // front left-of-center, high
  addWindow(W / 2 + 0.04, 0.25 + 1.2, 0, Math.PI / 2); // right side
  addWindow(-(W / 2 + 0.04), 0.25 + 1.2, 0, -Math.PI / 2); // left side

  const entity = world.createTransformEntity(house);
  entity.object3D!.position.set(HX, 0, HZ);
  return entity;
}

// ----------------------------------------------------------------------------
// FENCE — post-and-double-rail fence wrapping the crop field, with a gate gap
// at the front center. The front rail line sits exactly on the game's fenceZ.
// ----------------------------------------------------------------------------
// buildFence(): the front line sits on fenceZ; the side rails run back to backZ.
// Exported so index.ts can rebuild it at a new depth when the farm size changes
// (a smaller farm has fewer plot rows, so its fence is shorter front-to-back).
export function buildFence(world: World, fenceZ: number, backZ: number) {
  const fence = new Group();
  const POST_H = 0.85;
  const RAIL_T = 0.06;

  function post(x: number, z: number) {
    const p = meshBox(0.09, POST_H, 0.09, PALETTE.woodDark);
    p.position.set(x, POST_H / 2, z);
    fence.add(p);
  }
  function railX(x1: number, x2: number, z: number, y: number) {
    const len = Math.abs(x2 - x1);
    const r = meshBox(len, RAIL_T, 0.05, PALETTE.wood);
    r.position.set((x1 + x2) / 2, y, z);
    fence.add(r);
  }
  function railZ(z1: number, z2: number, x: number, y: number) {
    const len = Math.abs(z2 - z1);
    const r = meshBox(0.05, RAIL_T, len, PALETTE.wood);
    r.position.set(x, y, (z1 + z2) / 2);
    fence.add(r);
  }

  const LEFT = -2.6;
  const RIGHT = 2.6;
  const BACK = backZ; // behind the last plot row (varies with farm size)
  const GATE_HALF = 0.55; // half-width of the front gate opening

  // Front line (with gate gap at the middle).
  for (const x of [LEFT, -1.55, -GATE_HALF, GATE_HALF, 1.55, RIGHT]) post(x, fenceZ);
  for (const y of [0.38, 0.68]) {
    railX(LEFT, -GATE_HALF, fenceZ, y);
    railX(GATE_HALF, RIGHT, fenceZ, y);
  }
  // Side lines going back toward the house.
  for (const x of [LEFT, RIGHT]) {
    post(x, fenceZ - 1.2);
    post(x, BACK);
    for (const y of [0.38, 0.68]) railZ(fenceZ, BACK, x, y);
  }

  const entity = world.createTransformEntity(fence);
  entity.object3D!.position.set(0, 0, 0);
  return entity;
}

// ----------------------------------------------------------------------------
// MARKET STALL — counter, corner posts, striped awning, produce, and a
// hanging "Samuel's Market" sign. Built around the game's stall anchor.
// ----------------------------------------------------------------------------
function buildStall(world: World, stallX: number, stallZ: number) {
  const stall = new Group();

  // Counter with wood-slat front.
  const counter = meshBox(2.0, 0.9, 0.7, PALETTE.wood);
  counter.position.set(0, 0.45, 0.15);
  stall.add(counter);
  const counterTop = meshBox(2.16, 0.07, 0.86, PALETTE.woodDark);
  counterTop.position.set(0, 0.93, 0.15);
  stall.add(counterTop);

  // Four corner posts holding up the awning. The awning sits high (2.4 m) so
  // Samuel's speech bubble and the market-quiz cards fit underneath without
  // being hidden behind it.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const p = meshBox(0.09, 2.35, 0.09, PALETTE.woodDark);
      p.position.set(sx * 1.0, 1.175, sz * 0.55 + 0.15);
      stall.add(p);
    }
  }

  // Striped awning, gently sloped toward the shopper.
  const awning = new Mesh(
    new BoxGeometry(2.3, 0.06, 1.5),
    new MeshLambertMaterial({ map: makeAwningTexture() }),
  );
  awning.castShadow = true;
  awning.position.set(0, 2.4, 0.18);
  awning.rotation.x = -0.18;
  stall.add(awning);
  // Scalloped awning lip.
  for (let i = 0; i < 6; i++) {
    const lip = new Mesh(
      new CylinderGeometry(0.17, 0.17, 0.05, 10, 1, false, 0, Math.PI),
      new MeshLambertMaterial({
        color: new Color(i % 2 === 0 ? "#c0503a" : "#f7eed9"),
        side: DoubleSide,
      }),
    );
    lip.rotation.z = Math.PI / 2;
    lip.rotation.y = Math.PI / 2;
    lip.position.set(-1.0 + 0.39 * i + 0.2, 2.26, 0.97);
    stall.add(lip);
  }

  // Produce on the counter: three baskets (squat cylinders) of colored goods.
  const basketColors: [string, string][] = [
    ["#a87b4a", "#e8c84a"], // basket, corn-yellow goods
    ["#a87b4a", "#f5f3ec"], // cotton-white goods
    ["#a87b4a", "#cd7f3a"], // amber goods
  ];
  basketColors.forEach(([basket, goods], i) => {
    const x = -0.6 + i * 0.6;
    const b = meshCylinder(0.17, 0.13, 0.14, basket, 10);
    b.position.set(x, 1.04, 0.2);
    stall.add(b);
    for (let g = 0; g < 3; g++) {
      const ball = meshSphere(0.05, goods, 8);
      ball.position.set(x + (g - 1) * 0.055, 1.13, 0.2 + (g % 2) * 0.04 - 0.02);
      stall.add(ball);
    }
  });

  // Crates and a barrel beside the stall.
  const crate1 = meshBox(0.42, 0.42, 0.42, PALETTE.wood);
  crate1.position.set(1.35, 0.21, 0.5);
  stall.add(crate1);
  const crate2 = meshBox(0.36, 0.36, 0.36, "#a07248");
  crate2.position.set(1.42, 0.6, 0.46);
  crate2.rotation.y = 0.4;
  stall.add(crate2);
  const barrel = meshCylinder(0.22, 0.26, 0.55, "#7b4f2e", 12);
  barrel.position.set(-1.35, 0.275, 0.45);
  stall.add(barrel);
  const barrelRing = meshCylinder(0.265, 0.265, 0.05, "#4a4a4a", 12);
  barrelRing.position.set(-1.35, 0.4, 0.45);
  stall.add(barrelRing);

  // Hanging sign: canvas-drawn "SAMUEL'S MARKET" board under the awning front.
  const signCanvas = document.createElement("canvas");
  signCanvas.width = 512;
  signCanvas.height = 128;
  const sctx = signCanvas.getContext("2d")!;
  sctx.fillStyle = "#5b3a21";
  sctx.fillRect(0, 0, 512, 128);
  sctx.fillStyle = "#f3e9d2";
  sctx.fillRect(8, 8, 496, 112);
  sctx.fillStyle = "#1F3A5F";
  sctx.font = "bold 56px system-ui, sans-serif";
  sctx.textAlign = "center";
  sctx.textBaseline = "middle";
  sctx.fillText("SAMUEL'S MARKET", 256, 66);
  const signTex = new CanvasTexture(signCanvas);
  signTex.colorSpace = SRGBColorSpace;
  const signMesh = new Mesh(
    new PlaneGeometry(1.5, 0.375),
    new MeshBasicMaterial({ map: signTex, side: DoubleSide }),
  );
  // Mounted marquee-style above the awning lip so it never blocks the view of
  // Samuel, his speech bubble, or the quiz cards under the awning.
  signMesh.position.set(0, 2.46, 1.0);
  stall.add(signMesh);

  const entity = world.createTransformEntity(stall);
  entity.object3D!.position.set(stallX, 0, stallZ);
  return entity;
}

// ----------------------------------------------------------------------------
// TREES, BUSHES & FLOWERS — scattered around the play space edges.
// ----------------------------------------------------------------------------
function buildVegetation(world: World) {
  function tree(x: number, z: number, scale: number, variant: number) {
    const t = new Group();
    const trunk = meshCylinder(0.09, 0.13, 1.0, PALETTE.trunk, 8);
    trunk.position.y = 0.5;
    t.add(trunk);
    if (variant === 0) {
      // Round canopy: three stacked leaf blobs.
      const blobs: [number, number, number, number, string][] = [
        [0, 1.35, 0, 0.55, PALETTE.leaf],
        [0.3, 1.15, 0.15, 0.4, PALETTE.leafDark],
        [-0.28, 1.2, -0.1, 0.42, PALETTE.leaf],
      ];
      for (const [bx, by, bz, r, c] of blobs) {
        const blob = meshSphere(r, c, 10);
        blob.position.set(bx, by, bz);
        registerFoliage(blob);
        t.add(blob);
      }
    } else {
      // Conifer: two stacked cones.
      const c1 = meshCone(0.55, 0.9, PALETTE.leafDark, 9);
      c1.position.y = 1.15;
      registerFoliage(c1);
      t.add(c1);
      const c2 = meshCone(0.42, 0.75, PALETTE.leaf, 9);
      c2.position.y = 1.7;
      registerFoliage(c2);
      t.add(c2);
    }
    t.scale.setScalar(scale);
    const e = world.createTransformEntity(t);
    e.object3D!.position.set(x, 0, z);
  }

  // A friendly scattering around the edges of the farm (clear of the field at
  // |x| < 3 / z -1..-5, the stall path at z = -6, and the spawn at z = 2).
  // Round-canopy spots use the stylized GLB tree when it loaded; conifers stay
  // procedural for variety.
  const roundSpots: [number, number, number, number][] = [
    [-6.5, -9, 2.6, 0.4],
    [-11, 3, 2.9, 2.1],
    [-5, 6.5, 2.2, 4.2],
    [11, 2.5, 2.7, 1.2],
    [4.5, -11, 2.5, 3.0],
    [10.5, -2.5, 2.1, 5.3],
  ];
  for (const [x, z, height, rot] of roundSpots) {
    // sinkY hides the GLB tree's baked-in ground disc inside the lawn; the
    // final flag opts the tree into seasonal tinting (autumn oranges).
    const glb = placeGLB(world, "treeModel", x, z, height, rot, 0.03, true);
    if (!glb) tree(x, z, height / 1.9, 0);
  }
  tree(-9.5, -4, 1.3, 1);
  tree(5.5, 7, 1.4, 1);
  tree(12, -10, 1.7, 1);
  tree(-3.5, -11.5, 1.2, 1);

  // Bushes.
  const bushSpots: [number, number, number][] = [
    [-3.4, -5.2, 0.34],
    [3.4, -5.2, 0.3],
    [-2.9, 1.6, 0.3],
    [9.2, -4.6, 0.32],
    [6.4, -7.4, 0.28],
  ];
  for (const [x, z, r] of bushSpots) {
    const bush = meshSphere(r, PALETTE.leafDark, 9);
    bush.scale.y = 0.75;
    registerFoliage(bush);
    const e = world.createTransformEntity(bush);
    e.object3D!.position.set(x, r * 0.55, z);
  }

  // Flowers near the farmhouse door: stem + bright head.
  const flowerColors = ["#e85d75", "#f3c53d", "#8f6fd1", "#ef8b4e"];
  for (let i = 0; i < 8; i++) {
    const f = new Group();
    const stem = meshCylinder(0.012, 0.012, 0.18, "#4e8f3a", 5);
    stem.position.y = 0.09;
    f.add(stem);
    const head = meshSphere(0.045, flowerColors[i % flowerColors.length], 8);
    head.position.y = 0.2;
    f.add(head);
    const e = world.createTransformEntity(f);
    e.object3D!.position.set(-2.6 + (i % 4) * 0.35, 0, -4.55 - Math.floor(i / 4) * 0.3);
  }
}

// ----------------------------------------------------------------------------
// EXTRAS — scarecrow, hay bales, windmill, clouds, chimney smoke.
// ----------------------------------------------------------------------------
function buildScarecrow(world: World, x: number, z: number) {
  const s = new Group();
  const pole = meshCylinder(0.04, 0.05, 1.5, PALETTE.woodDark, 8);
  pole.position.y = 0.75;
  s.add(pole);
  const arms = meshBox(1.0, 0.06, 0.06, PALETTE.woodDark);
  arms.position.y = 1.1;
  s.add(arms);
  // Shirt.
  const shirt = meshBox(0.34, 0.45, 0.2, "#c0503a");
  shirt.position.y = 1.0;
  s.add(shirt);
  // Burlap head with a straw hat.
  const head = meshSphere(0.14, "#d8b988", 10);
  head.position.y = 1.42;
  s.add(head);
  const brim = meshCylinder(0.24, 0.24, 0.04, "#caa14f", 12);
  brim.position.y = 1.52;
  s.add(brim);
  const crown = meshCylinder(0.12, 0.14, 0.14, "#caa14f", 10);
  crown.position.y = 1.6;
  s.add(crown);
  // Straw hands.
  for (const sx of [-0.5, 0.5]) {
    const tuft = meshCone(0.05, 0.14, "#e3cf7a", 6);
    tuft.rotation.z = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
    tuft.position.set(sx, 1.1, 0);
    s.add(tuft);
  }
  const e = world.createTransformEntity(s);
  e.object3D!.position.set(x, 0, z);
  e.object3D!.rotation.y = 0.5;
}

function buildHayBales(world: World) {
  const spots: [number, number, number][] = [
    [3.6, -7.6, 0.3],
    [4.3, -7.4, -0.2],
  ];
  for (const [x, z, rot] of spots) {
    const bale = meshCylinder(0.32, 0.32, 0.5, "#dcbf63", 12);
    bale.rotation.z = Math.PI / 2;
    const e = world.createTransformEntity(bale);
    e.object3D!.position.set(x, 0.32, z);
    e.object3D!.rotation.y = rot;
  }
}

function buildWindmill(world: World): () => void {
  // Prefer the hand-painted GLB windmill. If its blade assembly can be found
  // by name we spin it slowly; otherwise it stands as a (still lovely) static
  // landmark. Falls back to the procedural windmill if the asset failed.
  const glb = placeGLB(world, "windmillModel", -8.5, -11.5, 5.2, 0.35);
  if (glb) {
    let blades: Object3D | null = null;
    glb.object3D!.traverse((obj: Object3D) => {
      if (!blades && /blade|wing|fan|rotor|sail|prop/i.test(obj.name)) {
        blades = obj;
      }
    });
    if (blades) {
      const spin = blades as Object3D;
      return () => {
        spin.rotation.z += 0.004;
      };
    }
    return () => {};
  }

  const m = new Group();
  // Tapered tower.
  const tower = meshCylinder(0.45, 0.85, 3.6, "#a8896a", 8);
  tower.position.y = 1.8;
  m.add(tower);
  const cap = meshCone(0.6, 0.7, PALETTE.roofRed, 8);
  cap.position.y = 3.9;
  m.add(cap);
  // Hub + four blades, on their own group so we can spin them.
  const bladeGroup = new Group();
  const hub = meshSphere(0.12, PALETTE.woodDark, 8);
  bladeGroup.add(hub);
  for (let i = 0; i < 4; i++) {
    const blade = meshBox(0.16, 1.5, 0.04, "#e8dcc0");
    blade.position.y = 0.85;
    const arm = new Group();
    arm.add(blade);
    arm.rotation.z = (i * Math.PI) / 2;
    bladeGroup.add(arm);
  }
  bladeGroup.position.set(0, 3.55, 0.62);
  m.add(bladeGroup);

  const e = world.createTransformEntity(m);
  e.object3D!.position.set(-8.5, 0, -11.5);
  e.object3D!.rotation.y = 0.35;

  // Return a per-frame tick that slowly spins the blades.
  return () => {
    bladeGroup.rotation.z += 0.004;
  };
}

function buildClouds(world: World): () => void {
  const cloudObjs: Group[] = [];
  const speeds: number[] = [];
  const spots: [number, number, number, number][] = [
    [-30, 17, -45, 1.6],
    [10, 21, -55, 2.2],
    [38, 15, -30, 1.4],
    [-15, 19, 40, 1.8],
    [30, 23, 25, 2.0],
    [-45, 16, 5, 1.5],
  ];
  for (const [x, y, z, s] of spots) {
    const cloud = new Group();
    const puffs: [number, number, number, number][] = [
      [0, 0, 0, 1.6],
      [1.5, -0.2, 0.2, 1.15],
      [-1.5, -0.25, -0.1, 1.05],
      [0.4, 0.55, -0.3, 1.0],
    ];
    for (const [px, py, pz, pr] of puffs) {
      const mat = new MeshBasicMaterial({ color: new Color(PALETTE.cloud) });
      mat.fog = false;
      const puff = new Mesh(new SphereGeometry(pr, 10, 8), mat);
      puff.position.set(px, py, pz);
      puff.scale.y = 0.62;
      cloud.add(puff);
    }
    cloud.scale.setScalar(s);
    const e = world.createTransformEntity(cloud);
    e.object3D!.position.set(x, y, z);
    cloudObjs.push(e.object3D as Group);
    speeds.push(0.006 + Math.random() * 0.008);
  }
  // Drift the clouds slowly along +X, wrapping around the world.
  return () => {
    for (let i = 0; i < cloudObjs.length; i++) {
      cloudObjs[i].position.x += speeds[i];
      if (cloudObjs[i].position.x > 70) cloudObjs[i].position.x = -70;
    }
  };
}

function buildChimneySmoke(world: World): () => void {
  // Three soft gray puffs that rise from the chimney and fade, then loop.
  // Each puff IS its entity's object3D, so we move that object directly.
  const CHIMNEY = { x: 5.0 / 2 - 0.8, y: 4.3, z: -6 };
  const puffs: { obj: Mesh; mat: MeshBasicMaterial; t: number }[] = [];
  for (let i = 0; i < 3; i++) {
    const mat = new MeshBasicMaterial({
      color: new Color("#eceae6"),
      transparent: true,
      opacity: 0,
    });
    mat.fog = false;
    const puff = new Mesh(new SphereGeometry(0.16, 8, 6), mat);
    const e = world.createTransformEntity(puff);
    e.object3D!.position.set(CHIMNEY.x, CHIMNEY.y, CHIMNEY.z);
    puffs.push({ obj: e.object3D as Mesh, mat, t: i / 3 });
  }
  return () => {
    for (const p of puffs) {
      p.t += 0.0035;
      if (p.t > 1) p.t -= 1;
      // Rise ~1.6 m over the cycle while swaying, fading in then out.
      const rise = p.t * 1.6;
      const sway = Math.sin(p.t * Math.PI * 2) * 0.12;
      p.obj.position.set(CHIMNEY.x + sway, CHIMNEY.y + rise, CHIMNEY.z);
      p.mat.opacity = p.t < 0.15 ? (p.t / 0.15) * 0.5 : 0.5 * (1 - (p.t - 0.15) / 0.85);
      p.obj.scale.setScalar(1 + p.t * 1.4);
    }
  };
}

// ----------------------------------------------------------------------------
// CROP PLANTS — one little procedural plant model per crop type. Each plant is
// a Group with its origin at the BASE (soil level), so index.ts can place it on
// a plot and animate object3D.scale.y exactly as it always has.
// ----------------------------------------------------------------------------
export function makeCropPlant(world: World, cropType: string) {
  const plant = new Group();

  if (cropType === "corn") {
    const stalk = meshCylinder(0.03, 0.045, 0.52, "#4a8a3a", 8);
    stalk.position.y = 0.26;
    plant.add(stalk);
    // Leaves: flattened cones angled outward.
    const leafSpots: [number, number, number][] = [
      [0.5, 0.2, 0],
      [-0.55, 0.3, Math.PI],
      [0.45, 0.4, Math.PI / 2],
    ];
    for (const [tilt, y, spin] of leafSpots) {
      const leaf = meshCone(0.05, 0.3, "#5fa845", 6);
      leaf.scale.z = 0.4;
      leaf.rotation.z = tilt > 0 ? -1.9 : 1.9;
      leaf.rotation.y = spin;
      leaf.position.set(Math.cos(spin) * 0.12 * Math.sign(tilt), y, Math.sin(spin) * 0.12);
      plant.add(leaf);
    }
    // The corn cob.
    const cob = meshCylinder(0.045, 0.045, 0.16, "#e8c84a", 8);
    cob.position.set(0.07, 0.34, 0);
    cob.rotation.z = -0.25;
    plant.add(cob);
    // Tassel on top.
    const tassel = meshCone(0.035, 0.12, "#d9b44a", 6);
    tassel.position.y = 0.58;
    plant.add(tassel);
  } else if (cropType === "wheat") {
    // A tuft of thin golden stalks, each with a seed head.
    for (let i = 0; i < 7; i++) {
      const ang = (i / 7) * Math.PI * 2;
      const dist = i === 0 ? 0 : 0.05 + (i % 3) * 0.018;
      const h = 0.4 + (i % 3) * 0.05;
      const stalk = meshCylinder(0.008, 0.008, h, "#d9b44a", 5);
      stalk.position.set(Math.cos(ang) * dist, h / 2, Math.sin(ang) * dist);
      stalk.rotation.z = Math.cos(ang) * 0.12;
      stalk.rotation.x = Math.sin(ang) * 0.12;
      plant.add(stalk);
      const head = meshBox(0.035, 0.1, 0.035, "#e6c965");
      head.position.set(Math.cos(ang) * (dist + Math.cos(ang) * 0.04), h + 0.04, Math.sin(ang) * (dist + Math.sin(ang) * 0.04));
      plant.add(head);
    }
  } else if (cropType === "cotton") {
    // A leafy bush studded with white cotton puffs.
    const bushSpots: [number, number, number, number][] = [
      [0, 0.14, 0, 0.13],
      [0.1, 0.22, 0.06, 0.1],
      [-0.1, 0.2, -0.05, 0.1],
    ];
    for (const [x, y, z, r] of bushSpots) {
      const blob = meshSphere(r, "#4f7d3c", 8);
      blob.position.set(x, y, z);
      plant.add(blob);
    }
    const puffSpots: [number, number, number][] = [
      [0.0, 0.34, 0.0],
      [0.12, 0.28, 0.08],
      [-0.13, 0.27, -0.04],
      [0.05, 0.25, -0.11],
      [-0.05, 0.3, 0.1],
    ];
    for (const [x, y, z] of puffSpots) {
      const puff = meshSphere(0.055, "#f7f5ee", 8);
      puff.position.set(x, y, z);
      plant.add(puff);
    }
  } else {
    // Tobacco: a stem with big drooping leaves and a pink blossom.
    const stem = meshCylinder(0.02, 0.03, 0.46, "#5a7a3a", 7);
    stem.position.y = 0.23;
    plant.add(stem);
    for (let i = 0; i < 5; i++) {
      const ang = (i / 5) * Math.PI * 2 + 0.4;
      const y = 0.14 + (i % 3) * 0.09;
      const leaf = meshSphere(0.13, "#6a9a4a", 8);
      leaf.scale.set(1.5, 0.18, 0.75);
      leaf.position.set(Math.cos(ang) * 0.14, y, Math.sin(ang) * 0.14);
      leaf.rotation.y = -ang;
      leaf.rotation.z = -0.35;
      plant.add(leaf);
    }
    const blossom = meshSphere(0.05, "#e8a8c0", 8);
    blossom.position.y = 0.5;
    plant.add(blossom);
  }

  return world.createTransformEntity(plant);
}

// ----------------------------------------------------------------------------
// SAMUEL — the merchant, now with arms, a face, an apron, and a proper hat.
// index.ts keeps wiring his name tag, speech bubble, and proximity logic; this
// just builds a much friendlier body. The returned parts keep the same names
// index.ts expects (body / head / hat) plus a new floating `indicator` ("!")
// shown whenever Samuel has unread news.
// ----------------------------------------------------------------------------
export function buildSamuel(world: World, x: number, z: number) {
  const samuelGroup = new Group();

  // Coat: a tapered cylinder reads as a long colonial coat.
  const coat = meshCylinder(0.22, 0.3, 1.05, "#5d4630", 14);
  coat.position.y = 0.525;
  samuelGroup.add(coat);
  // Cream shirt front.
  const shirtFront = meshBox(0.16, 0.45, 0.04, "#f3e9d2");
  shirtFront.position.set(0, 0.78, 0.255);
  samuelGroup.add(shirtFront);
  // Apron (he's a merchant!).
  const apron = meshBox(0.34, 0.5, 0.03, "#7a8a5a");
  apron.position.set(0, 0.5, 0.27);
  samuelGroup.add(apron);
  // Arms angled outward, with hands.
  for (const side of [-1, 1]) {
    const arm = meshCylinder(0.05, 0.055, 0.5, "#5d4630", 8);
    arm.position.set(side * 0.3, 0.78, 0.05);
    arm.rotation.z = side * 0.5;
    samuelGroup.add(arm);
    const hand = meshSphere(0.055, "#d8ac82", 8);
    hand.position.set(side * 0.42, 0.56, 0.07);
    samuelGroup.add(hand);
  }

  // Head with simple, friendly facial features.
  const headGroup = new Group();
  const skull = meshSphere(0.21, "#d8ac82", 14);
  headGroup.add(skull);
  for (const side of [-1, 1]) {
    const eye = meshSphere(0.026, "#2b2b2b", 6);
    eye.position.set(side * 0.075, 0.03, 0.185);
    headGroup.add(eye);
  }
  // A warm smile: a thin, curved torus slice approximated with a squashed box.
  const smile = meshBox(0.09, 0.018, 0.02, "#9c5a3c");
  smile.position.set(0, -0.07, 0.2);
  headGroup.add(smile);
  const nose = meshSphere(0.03, "#cf9c72", 6);
  nose.position.set(0, -0.015, 0.21);
  headGroup.add(nose);
  headGroup.position.y = 1.28;
  samuelGroup.add(headGroup);

  // Tricorn-ish hat: brim disc + crown.
  const hatGroup = new Group();
  const brim = meshCylinder(0.3, 0.3, 0.04, "#2e2a26", 14);
  hatGroup.add(brim);
  const crown = meshCylinder(0.16, 0.19, 0.18, "#2e2a26", 12);
  crown.position.y = 0.1;
  hatGroup.add(crown);
  const band = meshCylinder(0.195, 0.2, 0.05, "#c8962a", 12);
  band.position.y = 0.04;
  hatGroup.add(band);
  hatGroup.position.y = 1.46;
  samuelGroup.add(hatGroup);

  const body = world.createTransformEntity(samuelGroup);
  body.object3D!.position.set(x, 0, z);

  // "!" news indicator: a bright gold exclamation mark floating over his hat.
  // index.ts shows it when Samuel has unread news and hides it on "Got it".
  const indicatorGroup = new Group();
  const bar = new Mesh(
    new BoxGeometry(0.07, 0.22, 0.07),
    new MeshBasicMaterial({ color: new Color("#ffcf4d") }),
  );
  bar.position.y = 0.12;
  indicatorGroup.add(bar);
  const dot = new Mesh(
    new SphereGeometry(0.045, 8, 8),
    new MeshBasicMaterial({ color: new Color("#ffcf4d") }),
  );
  dot.position.y = -0.08;
  indicatorGroup.add(dot);
  const indicator = world.createTransformEntity(indicatorGroup);
  // High above the stall awning, so the "go talk to Samuel" beacon is visible
  // from anywhere on the farm. index.ts bobs it around this height.
  indicator.object3D!.position.set(x, 3.05, z);
  indicator.object3D!.visible = false;

  return {
    body,
    head: { object3D: headGroup } as any, // same shape index.ts expects
    hat: { object3D: hatGroup } as any,
    indicator,
  };
}

// ----------------------------------------------------------------------------
// buildEnvironment(): assembles everything above. Returns the ground entity
// (index.ts adds LocomotionEnvironment to it) and starts one shared animation
// loop for the gentle ambient motion (windmill, clouds, smoke).
// ----------------------------------------------------------------------------
export function buildEnvironment(
  world: World,
  layout: {
    fieldCenterZ: number;
    fenceZ: number;
    fenceBackZ: number;
    stallX: number;
    stallZ: number;
  },
) {
  buildSkyAndLights(world);
  const ground = buildTerrain(world, layout.fieldCenterZ);
  buildFarmhouse(world);
  const fence = buildFence(world, layout.fenceZ, layout.fenceBackZ);
  buildStall(world, layout.stallX, layout.stallZ);
  buildVegetation(world);
  buildScarecrow(world, -2.95, -4.6);
  buildHayBales(world);
  const tickWindmill = buildWindmill(world);
  const tickClouds = buildClouds(world);
  const tickSmoke = buildChimneySmoke(world);

  // One shared ambient loop (windmill spin, cloud drift, chimney smoke).
  // setInterval, not requestAnimationFrame: window rAF is suspended during
  // immersive WebXR sessions, and the farm should stay alive in the headset.
  function ambientLoop() {
    tickWindmill();
    tickClouds();
    tickSmoke();
  }
  setInterval(ambientLoop, 33);

  return { ground, fence };
}
