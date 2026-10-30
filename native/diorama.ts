// The decorative papercraft diorama behind the UI, as the browser build's
// js/diorama.js drew it with three.js (now starhermit:scene): an open travel
// journal on a wood-grain desk — a leather cover under stacked paper pages,
// a cylinder ground disc, faceted hills around the sides and back, cone
// trees, a pond and a lantern post with an emissive glass and a point light.
// With detailed scenery it adds paper-fibre textures, a ribbon bookmark,
// three layered paper-cut hill silhouettes at the back like a pop-up page,
// two-tier trees, a striped lighthouse with a pulsing beacon, three cottages
// with lit windows, two paper boats on the pond and a brass lantern cap.
// Everything is placed by the `<seed>-deco` stream, so each page has its own
// scenery, and recoloured by the theme. It never carries information.
//
// The graphics level sets the look (quality.ts): materials, texture sizes,
// geometry detail, shadows, reflections, ambient occlusion, bloom limited to
// the emissive lights, the colour grade and vignette, anti-aliasing and the
// firefly count. Motion: the camera drifts ±0.9 units on a ~2-minute sine,
// the lantern flickers, the beacon pulses, the water bobs, ripples scroll
// and the boats rock, fireflies drift; all frozen with reduced motion.
//
// Port notes: the page's three.js r160 light intensities and shadow box as
// they were (engine minor 28); per-material envMaps stand for r160's
// envMapIntensity on scene.environment. The sky dome's GLSL shader became a background
// texture painted once per theme (sRGB, so the theme's sky shows at its true
// hue); the fog colour is still pre-inverted through ACES as the browser
// build's post path did. The post chain (GTAO, UnrealBloom, the grade pass,
// SMAA/FXAA/MSAA) is the renderer's ao / bloom / grade / antialias.
import {
  ACESFilmicToneMapping, AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, Color, ConeGeometry,
  CylinderGeometry, DirectionalLight, DoubleSide, ExtrudeGeometry, Fog, Group, HemisphereLight, Mesh, MeshLambertMaterial,
  MeshPhysicalMaterial, MeshStandardMaterial, PMREMGenerator, PerspectiveCamera, PlaneGeometry, PointLight, Points, PointsMaterial,
  RepeatWrapping, RoomEnvironment, SRGBColorSpace, Shape, ShapeGeometry, SphereGeometry, Vector2, Vector3, renderer, scene,
  type Material, type Object3D, type OrthographicCamera, type Texture,
} from "starhermit:scene";
import { OffscreenCanvas, type OffscreenCanvasRenderingContext2D } from "starhermit:canvas";
import { createStream } from "../js/rules.js";
import type { Look } from "./quality.ts";

export interface Theme {
  id: string; paper: string; ink: string; accent: string; sky: string; ground: string;
  water: string; hill: string; tree: string; rock: string;
}

const PI = Math.PI;
const EXPOSURE = 1.25;
/** three.js's physically based light intensities in the engine's units. */
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = EXPOSURE;
const camera = new PerspectiveCamera(46, 16 / 9, 0.1, 200);
camera.position.set(0, 4.2, 12.5);
camera.lookAt(0, -0.6, 0);
renderer.camera = camera;

// three.js r160 ACES filmic curve, mirrored so the fog colour can be pre-inverted.
function aces(c: number[]): number[] {
  const e = EXPOSURE / 0.6;
  const r = c[0]! * e, g = c[1]! * e, b = c[2]! * e;
  const i = [0.59719 * r + 0.35458 * g + 0.04823 * b, 0.076 * r + 0.90834 * g + 0.01566 * b, 0.0284 * r + 0.13383 * g + 0.83777 * b];
  const f = i.map((v) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081));
  return [
    1.60475 * f[0]! - 0.53108 * f[1]! - 0.07367 * f[2]!,
    -0.10208 * f[0]! + 1.10813 * f[1]! - 0.00605 * f[2]!,
    -0.00327 * f[0]! - 0.07276 * f[1]! + 1.07602 * f[2]!,
  ];
}
/** HDR colour that ACES maps onto `target` (a linear display colour). */
function preToneMap(target: Color): Color {
  const t = [target.r, target.g, target.b].map((v) => Math.min(0.92, Math.max(0.002, v)));
  const x = t.slice();
  for (let n = 0; n < 80; n++) {
    const y = aces(x);
    for (let k = 0; k < 3; k++) x[k] = Math.max(0, x[k]! + (t[k]! - y[k]!) * 1.2);
  }
  return new Color(x[0]!, x[1]!, x[2]!);
}

// ---------------------------------------------------------------------------- textures
function noiseCanvas(size: number, paint: (g: OffscreenCanvasRenderingContext2D, n: number) => void, px = size): OffscreenCanvas {
  const c = new OffscreenCanvas(px, px);
  const g = c.getContext("2d");
  g.scale(px / size, px / size);
  paint(g, size);
  return c;
}
interface Tex { paper: Texture; wood: Texture; ripple: Texture; dot: Texture }
const TEX_CACHE = new Map<string, Tex>();
function textures(b: Look["budget"]): Tex {
  const key = `${b.paperTexture}|${b.woodTexture}`;
  const hit = TEX_CACHE.get(key);
  if (hit) return hit;
  let seed = 7;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // Paper: near-white with fibres and faint mottling (multiplies the tint).
  const paper = noiseCanvas(256, (g, n) => {
    g.fillStyle = "#fbfaf7"; g.fillRect(0, 0, n, n);
    for (let i = 0; i < 1400; i++) {
      const v = 228 + Math.floor(rnd() * 24);
      g.fillStyle = `rgba(${v},${v - 3},${v - 10},0.35)`;
      g.fillRect(rnd() * n, rnd() * n, 1 + rnd() * 3, 1 + rnd() * 3);
    }
    g.lineWidth = 0.6;
    for (let i = 0; i < 220; i++) {
      g.strokeStyle = `rgba(170,160,140,${0.08 + rnd() * 0.1})`;
      const x = rnd() * n, y = rnd() * n, a = rnd() * PI;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 9, y + Math.sin(a) * 9); g.stroke();
    }
  }, b.paperTexture);
  // Wood: long grain streaks for the desk.
  const wood = noiseCanvas(512, (g, n) => {
    g.fillStyle = "#8a5a3a"; g.fillRect(0, 0, n, n);
    for (let y = 0; y < n; y += 2) {
      const v = Math.sin(y * 0.09) * 12 + Math.sin(y * 0.31) * 6 + (rnd() - 0.5) * 10;
      g.fillStyle = `rgba(${v > 0 ? "60,34,18" : "176,124,84"},${Math.min(0.5, Math.abs(v) / 40)})`;
      g.fillRect(0, y, n, 2);
    }
    for (let i = 0; i < 6; i++) { g.fillStyle = "rgba(40,22,10,0.55)"; g.fillRect(0, Math.floor(rnd() * n), n, 2); }
  }, b.woodTexture);
  // Ripples: tangent-space normal map from summed sines (tiles seamlessly).
  const ripple = noiseCanvas(128, (g, n) => {
    const img = g.createImageData(n, n);
    const hgt = (x: number, y: number): number => Math.sin((x / n) * PI * 2 * 3 + Math.sin((y / n) * PI * 2 * 2) * 1.2)
      + Math.sin((y / n) * PI * 2 * 4 + (x / n) * PI * 2) * 0.6;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const dx = hgt(x + 1, y) - hgt(x - 1, y);
        const dy = hgt(x, y + 1) - hgt(x, y - 1);
        const k = (y * n + x) * 4;
        img.data[k] = 128 - dx * 40; img.data[k + 1] = 128 - dy * 40; img.data[k + 2] = 255; img.data[k + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  });
  // Soft round sprite for fireflies.
  const dot = noiseCanvas(64, (g, n) => {
    const grd = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(0.25, "rgba(255,240,200,0.8)");
    grd.addColorStop(1, "rgba(255,220,150,0)");
    g.fillStyle = grd; g.fillRect(0, 0, n, n);
  });
  const mk = (canvas: OffscreenCanvas, srgb: boolean, repeat: number): Texture => {
    const t = new CanvasTexture(canvas);
    if (srgb) t.colorSpace = SRGBColorSpace;
    t.wrapS = t.wrapT = RepeatWrapping;
    if (repeat) t.repeat.set(repeat, repeat);
    t.anisotropy = 4;
    return t;
  };
  const tex: Tex = { paper: mk(paper, true, 2), wood: mk(wood, true, 1), ripple: mk(ripple, false, 3), dot: mk(dot, true, 0) };
  tex.wood.repeat.set(2, 1);
  TEX_CACHE.set(key, tex);
  return tex;
}

/** The sky: a vertical gradient from the horizon to the top with the warm glow toward the sun (the old dome's shader), painted once per theme. */
const skyCache = new Map<string, Texture>();
function skyTexture(top: Color, horizon: Color): Texture {
  const key = top.getHex() + ":" + horizon.getHex();
  const hit = skyCache.get(key);
  if (hit) return hit;
  const c = new OffscreenCanvas(4, 256);
  const g = c.getContext("2d");
  const css = (col: Color): string => `#${col.getHex().toString(16).padStart(6, "0")}`;
  // The view spans about 46° vertically from just below the horizon: the dome's smoothstep(-0.05, 0.55, h).
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, css(top.clone().lerp(horizon, 0.35)));
  grd.addColorStop(0.55, css(top.clone().lerp(horizon, 0.75)));
  grd.addColorStop(1, css(horizon));
  g.fillStyle = grd; g.fillRect(0, 0, 4, 256);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  skyCache.set(key, t);
  return t;
}

// ---------------------------------------------------------------------------- the scene
let look: Look | null = null;
let theme: Theme | null = null;
let seed = "title";
let builtKey = "";
let root: Group | null = null;
let env: Texture | null = null;
let time = 0;
let reducedMotion = false;
interface Anim {
  water: Mesh; boats: { obj: Group; phase: number; baseY: number; baseRot: number }[];
  lanternLight: PointLight; lampMat: MeshStandardMaterial; lampBase: number; lightBase: number;
  beacon: MeshStandardMaterial | null;
  flies: { geo: BufferGeometry; pos: Float32Array; seeds: Float32Array; count: number } | null;
  ripple: Texture | null;
}
let anim: Anim | null = null;

function environment(): Texture | null {
  if (!env) {
    try { env = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(renderer), 0.04).texture; }
    catch (e) { console.warn("environment:", e instanceof Error ? e.message : String(e)); }
  }
  return env;
}

function dispose(o: Object3D): void {
  o.traverse((x) => {
    const m = x as Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = (m as unknown as { material?: Material | Material[] }).material;
    if (mat) for (const mm of Array.isArray(mat) ? mat : [mat]) mm.dispose();
  });
}

function build(): void {
  const t = theme!, L = look!;
  const detailed = L.detailed;
  const b = L.budget;
  const tex = textures(b);
  const seg = (n: number, min = 3): number => Math.max(min, Math.round(n * b.segments));
  if (root) { scene.remove(root); dispose(root); }
  const g = new Group();
  root = g;
  const skyTop = new Color(t.sky).lerp(new Color("#ffffff"), 0.25).offsetHSL(0, 0.05, 0.02);
  const horizon = new Color(t.sky).lerp(new Color(t.paper), 0.45);
  scene.background = skyTexture(skyTop, horizon);
  scene.fog = new Fog(preToneMap(horizon), 15, 31);
  const sunDir = new Vector3(6, 10, 5).normalize();

  // Lights: hemisphere fill + warm key sun whose soft shadow covers the diorama.
  const reflections = L.reflections;
  const hemi = new HemisphereLight(new Color(t.sky).lerp(new Color("#ffffff"), 0.4), new Color(t.ground).multiplyScalar(0.7), reflections ? 0.34 : 0.48);
  const key = new DirectionalLight(0xfff0d8, 0.8);
  key.position.copy(sunDir).multiplyScalar(16);
  key.target.position.set(0, -1.2, -1);
  const sc = key.shadow.camera as OrthographicCamera;
  Object.assign(sc, { left: -10.5, right: 10.5, top: 9, bottom: -9, near: 4, far: 34 });
  sc.updateProjectionMatrix();
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.025;
  key.shadow.radius = 3;
  key.castShadow = L.shadows > 0;
  if (L.shadows > 0) key.shadow.mapSize = L.shadows;
  renderer.shadowMap.enabled = L.shadows > 0;
  g.add(hemi, key, key.target);

  const deco = createStream(seed + "-deco");
  const mat = (color: string | Color, extra: Record<string, unknown> = {}): Material => {
    if (b.material === "lambert") {
      const { roughness: _r, metalness: _m, envMapIntensity: _e, clearcoat: _c, clearcoatRoughness: _cr, normalMap: _n, normalScale: _ns, ...lp } = extra;
      return new MeshLambertMaterial({ color: new Color(color), ...lp });
    }
    return new MeshStandardMaterial({ color: new Color(color), roughness: 0.92, envMapIntensity: reflections ? 0.18 : 0, ...extra, ...(reflections ? {} : { envMapIntensity: 0 }) });
  };
  const paperMat = (color: string | Color, extra: Record<string, unknown> = {}): Material => mat(color, detailed ? { map: tex.paper, ...extra } : extra);
  const casters: Mesh[] = [];
  const receivers: Mesh[] = [];
  const add = (m: Mesh, cast: boolean, receive: boolean): Mesh => { if (cast) casters.push(m); if (receive) receivers.push(m); return m; };

  // Desk + journal: leather boards under a stack of pages.
  const desk = new Mesh(new PlaneGeometry(70, 40), mat("#b58a64", detailed ? { map: tex.wood, roughness: 0.7 } : { roughness: 0.8 }));
  desk.rotation.x = -PI / 2;
  desk.position.y = -2.62;
  g.add(add(desk, false, true));
  const cover = new Mesh(new BoxGeometry(16.8, 0.26, 11.8), mat("#6d3b2a", { roughness: 0.6, envMapIntensity: 0.6 }));
  cover.position.set(0, -2.45, 0);
  g.add(add(cover, true, true));
  const pageGeo = new BoxGeometry(16, 0.18, 11);
  for (let i = 0; i < 4; i++) {
    const page = new Mesh(pageGeo, paperMat(t.paper));
    page.position.set((deco.next() - 0.5) * 0.6, -1.6 - i * 0.2, (deco.next() - 0.5) * 0.6);
    page.rotation.y = (deco.next() - 0.5) * 0.16;
    g.add(add(page, true, true));
  }
  if (detailed) {
    const ribbon = new Mesh(new BoxGeometry(0.34, 0.02, 2.4), mat(t.accent, { roughness: 0.5 }));
    ribbon.position.set(4.2, -1.5, 5.6);
    ribbon.rotation.x = 0.35;
    g.add(add(ribbon, true, false));
  }

  // Ground disc of the diorama.
  const ground = new Mesh(new CylinderGeometry(9, 9.6, 0.5, seg(detailed ? 48 : 40, 32)), paperMat(t.ground));
  ground.position.y = -1.3;
  g.add(add(ground, true, true));

  // Pond: clear-coat Physical on High/Ultra detailed scenes, Standard with ripples otherwise, Lambert on Low.
  const waterColor = new Color(t.water);
  const waterMat = b.material === "lambert"
    ? new MeshLambertMaterial({ color: waterColor.clone().multiplyScalar(0.8) })
    : detailed && b.material === "physical"
      ? new MeshPhysicalMaterial({ color: waterColor.clone().multiplyScalar(0.7), roughness: 0.22, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.12, normalMap: tex.ripple, normalScale: new Vector2(0.35, 0.35), envMapIntensity: reflections ? 0.45 : 0 })
      : new MeshStandardMaterial({ color: waterColor.clone().multiplyScalar(0.8), roughness: 0.3, metalness: 0.05, normalMap: tex.ripple, normalScale: new Vector2(0.25, 0.25), envMapIntensity: reflections ? 0.45 : 0 });
  const water = new Mesh(new CylinderGeometry(3.2, 3.4, 0.56, seg(36, 24)), waterMat);
  water.position.set(-4.4 + deco.next() * 1.5, -1.26, 2.6 + deco.next());
  g.add(add(water, false, true));

  // Hills: faceted papercraft domes around the sides and back.
  const hillCount = detailed ? 6 : 3;
  const hillGeo = (r: number): SphereGeometry => new SphereGeometry(r, seg(detailed ? 10 : 20, 6), seg(detailed ? 6 : 12, 4), 0, PI * 2, 0, PI / 2);
  for (let i = 0; i < hillCount; i++) {
    const r = 1.5 + deco.next() * 2;
    const ang = PI * (0.95 + deco.next() * 1.1);
    const dist = 5.6 + deco.next() * 2.6;
    const tint = new Color(t.hill).offsetHSL((deco.next() - 0.5) * 0.03, 0, (deco.next() - 0.5) * 0.08);
    const hill = new Mesh(hillGeo(r), paperMat(tint, { flatShading: detailed }));
    hill.position.set(Math.cos(ang) * dist, -1.1, Math.sin(ang) * dist - 0.5);
    hill.scale.y = 0.75 + deco.next() * 0.35;
    g.add(add(hill, true, true));
  }

  // Paper-cut backdrop: layered hill silhouettes standing at the back like a pop-up page.
  if (detailed) {
    for (let layer = 0; layer < 3; layer++) {
      const shape = new Shape();
      const w = 18 - layer * 1.5;
      shape.moveTo(-w / 2, 0);
      const steps = 9;
      for (let s = 0; s <= steps; s++) {
        const x = -w / 2 + (w * s) / steps;
        const y = 1.6 + layer * 0.5 + Math.sin(s * 1.3 + layer * 2 + deco.next()) * 0.8 + deco.next() * 0.9;
        shape.lineTo(x, y);
      }
      shape.lineTo(w / 2, 0);
      shape.lineTo(-w / 2, 0);
      const tint = new Color(t.hill).lerp(new Color(t.sky), 0.55 - layer * 0.2);
      const cut = new Mesh(new ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: false }), paperMat(tint, { roughness: 1 }));
      cut.position.set(0, -1.08, -8.2 + layer * 1.1);
      g.add(add(cut, true, true));
    }
  }

  // Trees: faceted cones (two tiers when detailed) on trunks.
  const trunkGeo = new CylinderGeometry(0.07, 0.1, 0.5, 6);
  const canopyGeo = new ConeGeometry(0.42, 1.1, detailed ? 7 : 8);
  const topGeo = new ConeGeometry(0.3, 0.8, 7);
  const trunkMat = mat(t.rock);
  const treeMat = mat(t.tree, { flatShading: detailed, roughness: 0.85 });
  const treeCount = detailed ? 18 : 8;
  for (let i = 0; i < treeCount; i++) {
    const ang = deco.next() * PI * 2;
    const dist = 3.4 + deco.next() * 4.6;
    const x = Math.cos(ang) * dist;
    const z = Math.sin(ang) * dist - 2.5;
    if (Math.hypot(x - water.position.x, z - water.position.z) < 3.6) continue;
    if (z > 4.5 && Math.abs(x) < 3) continue; // keep the view to the lantern clear
    const s = 0.7 + deco.next() * 0.8;
    const trunk = new Mesh(trunkGeo, trunkMat);
    trunk.position.set(x, -1.05 + 0.25 * s, z);
    trunk.scale.setScalar(s);
    const canopy = new Mesh(canopyGeo, treeMat);
    canopy.position.set(x, -1.05 + 1.05 * s, z);
    canopy.scale.setScalar(s);
    canopy.rotation.y = deco.next() * 3;
    g.add(add(trunk, true, false), add(canopy, true, false));
    if (detailed) {
      const top = new Mesh(topGeo, treeMat);
      top.position.set(x, -1.05 + 1.5 * s, z);
      top.scale.setScalar(s);
      g.add(add(top, true, false));
    }
  }

  let beacon: MeshStandardMaterial | null = null;
  const boats: Anim["boats"] = [];
  if (detailed) {
    // Lighthouse on the far shore of the pond.
    const lh = new Group();
    const white = mat("#e6dfd2", { roughness: 0.7 });
    const band = mat(t.accent, { roughness: 0.55 });
    const tower = new Mesh(new CylinderGeometry(0.26, 0.38, 1.9, seg(12, 6)), white);
    tower.position.y = 0.95;
    const stripe = new Mesh(new CylinderGeometry(0.33, 0.35, 0.28, seg(12, 6)), band);
    stripe.position.y = 0.7;
    beacon = new MeshStandardMaterial({ color: 0xfff1c9, emissive: 0xffc46b, emissiveIntensity: 2.4 });
    const light = new Mesh(new CylinderGeometry(0.2, 0.2, 0.26, 10), beacon);
    light.position.y = 2.03;
    const roof = new Mesh(new ConeGeometry(0.3, 0.36, seg(12, 6)), band);
    roof.position.y = 2.34;
    lh.add(add(tower, true, false), add(stripe, true, false), light, add(roof, true, false));
    lh.position.set(water.position.x - 1.6, -1.05, water.position.z - 3.3);
    g.add(lh);

    // Cottages: paper boxes with pyramid roofs and a lit window.
    for (let i = 0; i < 3; i++) {
      const house = new Group();
      const body = new Mesh(new BoxGeometry(0.7, 0.5, 0.55), paperMat(t.paper, { roughness: 0.8 }));
      body.position.y = 0.25;
      const roof = new Mesh(new ConeGeometry(0.56, 0.42, 4), mat(i % 2 ? t.accent : t.rock, { roughness: 0.7, flatShading: true }));
      roof.position.y = 0.71;
      roof.rotation.y = PI / 4;
      const win = new Mesh(new PlaneGeometry(0.14, 0.14), new MeshStandardMaterial({ color: 0xffe2a8, emissive: 0xffb45a, emissiveIntensity: 2.2 }));
      win.position.set(0, 0.28, 0.28);
      house.add(add(body, true, false), add(roof, true, false), win);
      house.position.set(1.2 + i * 1.05 + deco.next() * 0.3, -1.05, -3.2 + deco.next() * 0.8 - i * 0.35);
      house.rotation.y = (deco.next() - 0.5) * 0.7;
      g.add(house);
    }

    // Paper boats bobbing on the pond.
    const hullGeo = new CylinderGeometry(0.3, 0.14, 0.16, 4, 1);
    hullGeo.rotateY(PI / 4);
    hullGeo.scale(1.6, 1, 0.7);
    const sailShape = new Shape();
    sailShape.moveTo(0, 0); sailShape.lineTo(0.3, 0); sailShape.lineTo(0, 0.5); sailShape.lineTo(0, 0);
    const sailGeo = new ShapeGeometry(sailShape);
    const boatMat = paperMat("#fbf7ee", { roughness: 0.7, side: DoubleSide });
    for (let i = 0; i < 2; i++) {
      const boat = new Group();
      const hull = new Mesh(hullGeo, boatMat);
      const sail = new Mesh(sailGeo, i ? mat(t.accent, { side: DoubleSide, roughness: 0.7 }) : boatMat);
      sail.position.set(-0.08, 0.06, 0);
      boat.add(add(hull, true, false), add(sail, true, false));
      const a = deco.next() * PI * 2;
      boat.position.set(water.position.x + Math.cos(a) * 1.4, -0.9, water.position.z + Math.sin(a) * 1.2);
      boat.rotation.y = deco.next() * PI * 2;
      g.add(boat);
      boats.push({ obj: boat, phase: deco.next() * 6, baseY: boat.position.y, baseRot: boat.rotation.y });
    }
  }

  // Lantern: brass post, glowing glass and a warm point light.
  const brass = mat("#b08a3e", { metalness: 0.85, roughness: 0.32, envMapIntensity: 1.2 });
  const post = new Mesh(new CylinderGeometry(0.05, 0.07, 1.5, 8), detailed ? brass : mat(t.ink));
  post.position.set(3.6, -0.55, 1.8);
  const lampMat = new MeshStandardMaterial({ color: 0xffe2b0, emissive: 0xffb85c, emissiveIntensity: detailed ? 3 : 0.9 });
  const lamp = new Mesh(new SphereGeometry(0.18, seg(16, 8), seg(12, 6)), lampMat);
  lamp.position.set(3.6, 0.28, 1.8);
  g.add(add(post, true, false), lamp);
  if (detailed) {
    const cap = new Mesh(new ConeGeometry(0.24, 0.2, 8), brass);
    cap.position.set(3.6, 0.54, 1.8);
    const base = new Mesh(new CylinderGeometry(0.2, 0.2, 0.06, 8), brass);
    base.position.set(3.6, 0.07, 1.8);
    g.add(cap, base);
  }
  const lanternLight = new PointLight(0xffc27a, detailed ? 2.5 : 1.2, 12, detailed ? 1.6 : 2);
  lanternLight.position.copy(lamp.position);
  g.add(lanternLight);

  // Fireflies: soft additive sprites drifting around the lantern and meadow.
  let flies: Anim["flies"] = null;
  const count = b.fireflies;
  if (count) {
    const pos = new Float32Array(count * 3);
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      const nearLamp = i < count * 0.35;
      const a = deco.next() * PI * 2;
      const r = nearLamp ? 0.4 + deco.next() * 1.4 : 1 + deco.next() * 7;
      seeds[i * 4] = (nearLamp ? 3.6 : 0) + Math.cos(a) * r;
      seeds[i * 4 + 1] = (nearLamp ? 0.2 : -0.6) + deco.next() * 1.6;
      seeds[i * 4 + 2] = (nearLamp ? 1.8 : -1.5) + Math.sin(a) * r * 0.8;
      seeds[i * 4 + 3] = deco.next() * 100;
      pos.set([seeds[i * 4]!, seeds[i * 4 + 1]!, seeds[i * 4 + 2]!], i * 3);
    }
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(pos, 3));
    const pm = new PointsMaterial({
      color: new Color(0xffd27a).multiplyScalar(2.2), size: 0.16, map: tex.dot,
      transparent: true, depthWrite: false, blending: AdditiveBlending, sizeAttenuation: true, fog: false,
    });
    const pts = new Points(geo, pm);
    pts.frustumCulled = false;
    g.add(pts);
    flies = { geo, pos, seeds, count };
  }

  for (const m of casters) m.castShadow = true;
  for (const m of receivers) m.receiveShadow = true;
  scene.environment = reflections ? environment() : null;
  // r160 scaled scene.environment by each material's envMapIntensity: give each lit material its own envMap.
  const envMap = scene.environment;
  g.traverse((o) => {
    const m = (o as Mesh).material;
    for (const x of Array.isArray(m) ? m : m ? [m] : []) if (x instanceof MeshStandardMaterial || x instanceof MeshPhysicalMaterial) x.envMap = envMap;
  });
  scene.add(g);
  const waterTex = (waterMat as MeshStandardMaterial).normalMap ?? null;
  anim = { water, boats, lanternLight, lampMat, lampBase: lampMat.emissiveIntensity, lightBase: lanternLight.intensity, beacon, flies, ripple: waterTex };
}

function sceneKey(): string {
  if (!look || !theme) return "";
  const b = look.budget;
  return [theme.id, seed, look.detailed, look.reflections, look.shadows, b.material, b.paperTexture, b.woodTexture, b.segments, b.fireflies].join("|");
}
function refresh(): void {
  const k = sceneKey();
  if (!k || k === builtKey) return;
  builtKey = k;
  build();
}

/** The graphics level's look (quality.ts): post effects at once, the scene rebuilt when its assets change. */
export function applyLook(next: Look): void {
  look = next;
  renderer.ao = next.ao === "off" ? null : {
    blendIntensity: 0.7, radius: 0.6, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: next.ao === "high" ? 16 : 8, resolution: next.budget.aoRes,
    denoise: { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: next.ao === "high" ? 6 : 4, rings: 2, samples: next.ao === "high" ? 16 : 8, radiusExponent: 2 },
  };
  // High threshold: only the lantern, beacon, windows and fireflies bloom.
  // r160 page: its UnrealBloomPass(0.7, 0.5, 0.92) exactly (model "r160", strength as written).
  renderer.bloom = next.bloom ? { model: "r160", strength: 0.7, radius: 0.5, threshold: 0.92, resolution: next.budget.bloomRes } : null;
  // The browser build's grade pass (before OutputPass, so on linear light): a gentle S-curve, a touch more saturation,
  // warm highlights / cool shadows, the 0.24 vignette.
  renderer.grade = next.grade ? {
    space: "linear", contrastCurve: "s", contrast: 0.18, saturation: 1.1,
    shadows: [0.95, 0.98, 1.05], highlights: [1.05, 1.01, 0.95], split: [0.15, 0.8],
    vignette: { amount: 0.24, inner: 0.32, outer: 0.9, scale: [1.15, 1] },
    overRange: "keep", // mix(c, s + max(c - 1, 0), amount) as the page's grade
  } : null;
  renderer.antialias = next.antialias;
  refresh();
}
export function setTheme(t: Theme): void { theme = t; refresh(); }
/** The page's decoration seed (the round's seed; "title" on the menus). */
export function setSeed(s: string): void { seed = s; refresh(); }
export function setReducedMotion(on: boolean): void { reducedMotion = on; }

/** Per frame: the window's aspect and the ambient motion. */
export function update(width: number, height: number, dt: number): void {
  camera.aspect = width / Math.max(1, height);
  camera.updateProjectionMatrix();
  const a = anim;
  if (!a || reducedMotion) return;
  time += Math.min(0.25, dt);
  const t = time;
  camera.position.x = Math.sin(t * 0.05) * 0.9;
  camera.lookAt(0, -0.6, 0);
  const flicker = Math.sin(t * 2.3) * 0.12 + Math.sin(t * 7.1) * 0.05;
  a.lanternLight.intensity = a.lightBase * (1 + flicker);
  a.lampMat.emissiveIntensity = a.lampBase * (1 + flicker * 0.8);
  if (a.beacon) a.beacon.emissiveIntensity = 2 + Math.max(0, Math.sin(t * 1.2)) * 1.6;
  a.water.position.y = -1.26 + Math.sin(t * 0.8) * 0.03;
  if (look?.water) {
    if (a.ripple) { a.ripple.offset.x = (t * 0.02) % 1; a.ripple.offset.y = (t * 0.013) % 1; }
    for (const b of a.boats) {
      b.obj.position.y = b.baseY + Math.sin(t * 1.3 + b.phase) * 0.035;
      b.obj.rotation.z = Math.sin(t * 1.1 + b.phase) * 0.07;
      b.obj.rotation.y = b.baseRot + Math.sin(t * 0.2 + b.phase) * 0.25;
    }
  }
  if (a.flies) {
    const { pos, seeds, count, geo } = a.flies;
    for (let i = 0; i < count; i++) {
      const s = seeds[i * 4 + 3]!;
      pos[i * 3] = seeds[i * 4]! + Math.sin(t * 0.4 + s) * 0.35;
      pos[i * 3 + 1] = seeds[i * 4 + 1]! + Math.sin(t * 0.7 + s * 1.7) * 0.22;
      pos[i * 3 + 2] = seeds[i * 4 + 2]! + Math.cos(t * 0.33 + s * 0.9) * 0.35;
    }
    (geo.attributes as unknown as { position: BufferAttribute }).position.needsUpdate = true;
  }
}
