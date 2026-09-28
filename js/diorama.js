// Crossword Journey — decorative Three.js diorama and its graphics settings.
// A papercraft scene on an open travel journal: layered paper-cut hills,
// faceted trees, a pond with paper boats, a lighthouse, cottages and a brass
// lantern with fireflies. Purely decorative; never intercepts input.
//
// Graphics: ACES tone mapping, hemisphere + key light with PCF soft shadows
// fitted to the diorama, RoomEnvironment IBL, and an optional post chain
// (RenderPass → GTAO → UnrealBloom → grade/vignette → OutputPass → SMAA/FXAA).
// Quality tiers come from gfx.js; settings apply live.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { detectPreset, resolve, SHADOW_MAP, PARTICLE_COUNT } from './gfx.js';
import { createStream } from './rules.js';

// Colour grade + vignette: gentle S-curve, a touch more saturation, warm
// highlights / cool shadows. Runs on linear HDR before OutputPass.
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uAmount: { value: 1.0 }, uVignette: { value: 0.24 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uAmount; uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 c = src.rgb;
      vec3 lc = clamp(c, 0.0, 1.0);
      vec3 s = mix(lc, lc * lc * (3.0 - 2.0 * lc), 0.18);
      float l = dot(s, vec3(0.299, 0.587, 0.114));
      s = mix(vec3(l), s, 1.1);
      s *= mix(vec3(0.95, 0.98, 1.05), vec3(1.05, 1.01, 0.95), smoothstep(0.15, 0.8, l));
      c = mix(c, s + max(c - 1.0, 0.0), uAmount);
      float d = length((vUv - 0.5) * vec2(1.15, 1.0));
      c *= 1.0 - uVignette * smoothstep(0.32, 0.9, d);
      gl_FragColor = vec4(c, src.a);
    }`,
};

// Sky dome: vertical gradient with a warm glow toward the sun. Includes the
// tone-mapping and colour-space chunks so direct and post paths match.
const SKY_VERT = `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }`;
const SKY_FRAG = `
  uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uGlow; uniform vec3 uSun;
  varying vec3 vDir;
  void main() {
    float h = vDir.y;
    vec3 c = mix(uHorizon, uTop, smoothstep(-0.05, 0.55, h));
    float sun = max(dot(normalize(vDir), normalize(uSun)), 0.0);
    c += uGlow * (pow(sun, 6.0) * 0.35 + pow(sun, 60.0) * 0.4);
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

// three.js r160 ACES filmic curve, mirrored in JS so sky/fog colours can be
// pre-inverted: the theme's sky then shows at its true hue after tone mapping.
const EXPOSURE = 1.25;
function aces(c) {
  const e = EXPOSURE / 0.6;
  const r = c[0] * e, g = c[1] * e, b = c[2] * e;
  const i = [0.59719 * r + 0.35458 * g + 0.04823 * b, 0.07600 * r + 0.90834 * g + 0.01566 * b, 0.02840 * r + 0.13383 * g + 0.83777 * b];
  const f = i.map((v) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.4329510) + 0.238081));
  return [
    1.60475 * f[0] - 0.53108 * f[1] - 0.07367 * f[2],
    -0.10208 * f[0] + 1.10813 * f[1] - 0.00605 * f[2],
    -0.00327 * f[0] - 0.07276 * f[1] + 1.07602 * f[2],
  ];
}
/** HDR colour that ACES maps onto `target` (a linear display colour). */
function preToneMap(target) {
  const t = [target.r, target.g, target.b].map((v) => Math.min(0.92, Math.max(0.002, v)));
  const x = t.slice();
  for (let n = 0; n < 80; n++) {
    const y = aces(x);
    for (let k = 0; k < 3; k++) x[k] = Math.max(0, x[k] + (t[k] - y[k]) * 1.2);
  }
  return new THREE.Color(x[0], x[1], x[2]);
}

// ---------------------------------------------------------------------------
// Procedural textures (built once, shared across rebuilds)
// ---------------------------------------------------------------------------

function noiseCanvas(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  return c;
}

let TEX = null;
function textures() {
  if (TEX) return TEX;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // Paper: near-white with fibres and faint mottling (multiplies the tint).
  const paper = noiseCanvas(256, (g, n) => {
    g.fillStyle = '#fbfaf7'; g.fillRect(0, 0, n, n);
    for (let i = 0; i < 1400; i++) {
      const v = 228 + Math.floor(rnd() * 24);
      g.fillStyle = `rgba(${v},${v - 3},${v - 10},0.35)`;
      g.fillRect(rnd() * n, rnd() * n, 1 + rnd() * 3, 1 + rnd() * 3);
    }
    g.lineWidth = 0.6;
    for (let i = 0; i < 220; i++) {
      g.strokeStyle = `rgba(170,160,140,${0.08 + rnd() * 0.1})`;
      const x = rnd() * n, y = rnd() * n, a = rnd() * Math.PI;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 9, y + Math.sin(a) * 9); g.stroke();
    }
  });
  // Wood: long grain streaks for the desk.
  const wood = noiseCanvas(512, (g, n) => {
    g.fillStyle = '#8a5a3a'; g.fillRect(0, 0, n, n);
    for (let y = 0; y < n; y += 2) {
      const v = Math.sin(y * 0.09) * 12 + Math.sin(y * 0.31) * 6 + (rnd() - 0.5) * 10;
      g.fillStyle = `rgba(${v > 0 ? '60,34,18' : '176,124,84'},${Math.min(0.5, Math.abs(v) / 40)})`;
      g.fillRect(0, y, n, 2);
    }
    for (let i = 0; i < 6; i++) { // plank seams
      g.fillStyle = 'rgba(40,22,10,0.55)';
      g.fillRect(0, Math.floor(rnd() * n), n, 2);
    }
  });
  // Ripples: tangent-space normal map from summed sines (tiles seamlessly).
  const ripple = noiseCanvas(128, (g, n) => {
    const img = g.createImageData(n, n);
    const hgt = (x, y) => Math.sin((x / n) * Math.PI * 2 * 3 + Math.sin((y / n) * Math.PI * 2 * 2) * 1.2)
      + Math.sin((y / n) * Math.PI * 2 * 4 + (x / n) * Math.PI * 2) * 0.6;
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
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,240,200,0.8)');
    grd.addColorStop(1, 'rgba(255,220,150,0)');
    g.fillStyle = grd; g.fillRect(0, 0, n, n);
  });
  const mk = (canvas, srgb, repeat) => {
    const t = new THREE.CanvasTexture(canvas);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (repeat) t.repeat.set(repeat, repeat);
    t.anisotropy = 4;
    return t;
  };
  TEX = { paper: mk(paper, true, 2), wood: mk(wood, true, 1), ripple: mk(ripple, false, 3), dot: mk(dot, true) };
  TEX.wood.repeat.set(2, 1);
  return TEX;
}

// ---------------------------------------------------------------------------
// Diorama
// ---------------------------------------------------------------------------

export function createDiorama(canvas, { isReducedMotion, mobile = false }) {
  const d = {
    canvas, renderer: null, scene: null, camera: null, composer: null,
    gpu: '', detected: 'balanced', saved: {}, q: null,
    theme: null, seed: 'title', sceneKey: '',
    size: [0, 0], pixelRatio: 1, adaptiveScale: 1, frames: [], fps: 0, last: 0,
    postKey: null, postFailed: false, env: null, time: 0,
    anim: null, // animated objects from the last build
    canvasAA: true, rafId: null, onChange: null,
  };

  function makeRenderer(aa) {
    const r = new THREE.WebGLRenderer({ canvas: d.canvas, antialias: aa, powerPreference: 'high-performance' });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = EXPOSURE;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    d.canvasAA = aa;
    d.env = null;
    d.size = [0, 0];
    d.postKey = null;
    return r;
  }

  d.renderer = makeRenderer(true);
  try {
    const gl = d.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    d.gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) || '');
  } catch { d.gpu = ''; }
  d.detected = detectPreset(d.gpu, { mobile });

  // Swap the canvas when the canvas's own MSAA must change (it is fixed at context creation).
  function ensureCanvasAA() {
    const g = d.q;
    const want = g.antialias === 'msaa' && !g.post ? true : g.antialias === 'off' && !g.post ? false : d.canvasAA;
    if (want === d.canvasAA) return;
    d.composer?.dispose(); d.composer = null;
    d.renderer.dispose();
    const fresh = d.canvas.cloneNode(false);
    d.canvas.replaceWith(fresh);
    d.canvas = fresh;
    d.renderer = makeRenderer(want);
    d.sceneKey = ''; // env map belonged to the old context; rebuild on the new one
  }

  function environment() {
    if (!d.env) {
      const pmrem = new THREE.PMREMGenerator(d.renderer);
      d.env = pmrem.fromScene(new RoomEnvironment(d.renderer), 0.04).texture;
      pmrem.dispose();
    }
    return d.env;
  }

  function disposeScene() {
    if (!d.scene) return;
    d.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
    });
    d.scene = null;
  }

  // ------------------------------------------------------------- scene build
  function build() {
    const t = d.theme;
    const g = d.q;
    const detailed = g.detail === 'detailed';
    const tex = textures();
    disposeScene();
    const scene = new THREE.Scene();
    const skyTop = new THREE.Color(t.sky).lerp(new THREE.Color('#ffffff'), 0.25).offsetHSL(0, 0.05, 0.02);
    const horizon = new THREE.Color(t.sky).lerp(new THREE.Color(t.paper), 0.45);
    scene.background = horizon.clone();
    scene.fog = new THREE.Fog(horizon.clone(), 15, 31);
    // Fog mixes after tone mapping on the direct path, before it with post-processing.
    d.fogDisplay = horizon.clone();
    d.fogHdr = preToneMap(horizon);
    const sunDir = new THREE.Vector3(6, 10, 5).normalize();

    // Sky dome.
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(80, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: {
          uTop: { value: preToneMap(skyTop) }, uHorizon: { value: preToneMap(horizon) }, uGlow: { value: new THREE.Color('#ffd9a0') },
          uSun: { value: new THREE.Vector3(sunDir.x, 0.35, sunDir.z) },
        },
        vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false,
      }),
    );
    sky.renderOrder = -1;
    scene.add(sky);

    // Lights: hemisphere fill + warm key sun with a shadow box fitted to the diorama.
    // Lit paper stays just under the bloom threshold; exposure brightens it after bloom.
    const env = g.reflections === 'on';
    const hemi = new THREE.HemisphereLight(new THREE.Color(t.sky).lerp(new THREE.Color('#ffffff'), 0.4), new THREE.Color(t.ground).multiplyScalar(0.7), env ? 0.34 : 0.48);
    const key = new THREE.DirectionalLight(0xfff0d8, 0.8);
    key.position.copy(sunDir).multiplyScalar(16);
    key.target.position.set(0, -1.2, -1);
    const sc = key.shadow.camera;
    Object.assign(sc, { left: -10.5, right: 10.5, top: 9, bottom: -9, near: 4, far: 34 });
    sc.updateProjectionMatrix();
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.025;
    key.shadow.radius = 3;
    scene.add(hemi, key, key.target);
    d.key = key;

    const deco = createStream(d.seed + '-deco');
    const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.92, envMapIntensity: 0.18, ...extra });
    const paperMat = (color, extra = {}) => mat(color, detailed ? { map: tex.paper, ...extra } : extra);
    const casters = [];
    const receivers = [];

    // Desk + journal: leather boards under a stack of pages.
    const desk = new THREE.Mesh(new THREE.PlaneGeometry(70, 40), mat('#b58a64', detailed ? { map: tex.wood, roughness: 0.7 } : { roughness: 0.8 }));
    desk.rotation.x = -Math.PI / 2;
    desk.position.y = -2.62;
    receivers.push(desk);
    scene.add(desk);
    const cover = new THREE.Mesh(new THREE.BoxGeometry(16.8, 0.26, 11.8), mat('#6d3b2a', { roughness: 0.6, envMapIntensity: 0.6 }));
    cover.position.set(0, -2.45, 0);
    receivers.push(cover); casters.push(cover);
    scene.add(cover);
    const pageGeo = new THREE.BoxGeometry(16, 0.18, 11);
    for (let i = 0; i < 4; i++) {
      const page = new THREE.Mesh(pageGeo, paperMat(t.paper));
      page.position.set((deco.next() - 0.5) * 0.6, -1.6 - i * 0.2, (deco.next() - 0.5) * 0.6);
      page.rotation.y = (deco.next() - 0.5) * 0.16;
      receivers.push(page); casters.push(page);
      scene.add(page);
    }
    if (detailed) {
      // Ribbon bookmark trailing off the front edge.
      const ribbon = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 2.4), mat(t.accent, { roughness: 0.5 }));
      ribbon.position.set(4.2, -1.5, 5.6);
      ribbon.rotation.x = 0.35;
      casters.push(ribbon);
      scene.add(ribbon);
    }

    // Ground disc of the diorama.
    const ground = new THREE.Mesh(new THREE.CylinderGeometry(9, 9.6, 0.5, detailed ? 48 : 40), paperMat(t.ground));
    ground.position.y = -1.3;
    receivers.push(ground); casters.push(ground);
    scene.add(ground);

    // Pond.
    const waterColor = new THREE.Color(t.water);
    const waterMat = detailed
      ? new THREE.MeshPhysicalMaterial({ color: waterColor.clone().multiplyScalar(0.7), roughness: 0.22, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.12, normalMap: tex.ripple, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 0.45 })
      : new THREE.MeshStandardMaterial({ color: waterColor.clone().multiplyScalar(0.8), roughness: 0.3, metalness: 0.05, normalMap: tex.ripple, normalScale: new THREE.Vector2(0.25, 0.25), envMapIntensity: 0.45 });
    const water = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.4, 0.56, 36), waterMat);
    water.position.set(-4.4 + deco.next() * 1.5, -1.26, 2.6 + deco.next());
    receivers.push(water);
    scene.add(water);

    // Hills: faceted papercraft domes around the sides and back.
    const hillCount = detailed ? 6 : 3;
    const hillGeo = (r) => new THREE.SphereGeometry(r, detailed ? 10 : 20, detailed ? 6 : 12, 0, Math.PI * 2, 0, Math.PI / 2);
    for (let i = 0; i < hillCount; i++) {
      const r = 1.5 + deco.next() * 2;
      const ang = Math.PI * (0.95 + deco.next() * 1.1);
      const dist = 5.6 + deco.next() * 2.6;
      const tint = new THREE.Color(t.hill).offsetHSL((deco.next() - 0.5) * 0.03, 0, (deco.next() - 0.5) * 0.08);
      const hill = new THREE.Mesh(hillGeo(r), paperMat(tint, { flatShading: detailed }));
      hill.position.set(Math.cos(ang) * dist, -1.1, Math.sin(ang) * dist - 0.5);
      hill.scale.y = 0.75 + deco.next() * 0.35;
      casters.push(hill); receivers.push(hill);
      scene.add(hill);
    }

    // Paper-cut backdrop: layered hill silhouettes standing at the back like a pop-up page.
    if (detailed) {
      for (let layer = 0; layer < 3; layer++) {
        const shape = new THREE.Shape();
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
        const tint = new THREE.Color(t.hill).lerp(new THREE.Color(t.sky), 0.55 - layer * 0.2);
        const cut = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: false }), paperMat(tint, { roughness: 1 }));
        cut.position.set(0, -1.08, -8.2 + layer * 1.1);
        casters.push(cut); receivers.push(cut);
        scene.add(cut);
      }
    }

    // Trees: faceted cones (two tiers when detailed) on trunks.
    const trunkGeo = new THREE.CylinderGeometry(0.07, 0.1, 0.5, 6);
    const canopyGeo = new THREE.ConeGeometry(0.42, 1.1, detailed ? 7 : 8);
    const topGeo = new THREE.ConeGeometry(0.3, 0.8, 7);
    const trunkMat = mat(t.rock);
    const treeMat = mat(t.tree, { flatShading: detailed, roughness: 0.85 });
    const treeCount = detailed ? 18 : 8;
    for (let i = 0; i < treeCount; i++) {
      const ang = deco.next() * Math.PI * 2;
      const dist = 3.4 + deco.next() * 4.6;
      const x = Math.cos(ang) * dist;
      const z = Math.sin(ang) * dist - 2.5;
      if (Math.hypot(x - water.position.x, z - water.position.z) < 3.6) continue;
      if (z > 4.5 && Math.abs(x) < 3) continue; // keep the view to the lantern clear
      const s = 0.7 + deco.next() * 0.8;
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.set(x, -1.05 + 0.25 * s, z);
      trunk.scale.setScalar(s);
      const canopy = new THREE.Mesh(canopyGeo, treeMat);
      canopy.position.set(x, -1.05 + 1.05 * s, z);
      canopy.scale.setScalar(s);
      canopy.rotation.y = deco.next() * 3;
      casters.push(trunk, canopy);
      scene.add(trunk, canopy);
      if (detailed) {
        const top = new THREE.Mesh(topGeo, treeMat);
        top.position.set(x, -1.05 + 1.5 * s, z);
        top.scale.setScalar(s);
        casters.push(top);
        scene.add(top);
      }
    }

    const anim = { water, boats: [], lanternLight: null, lampMat: null, beacon: null, flies: null, time: 0 };

    if (detailed) {
      // Lighthouse on the far shore of the pond.
      const lh = new THREE.Group();
      const white = mat('#e6dfd2', { roughness: 0.7 });
      const band = mat(t.accent, { roughness: 0.55 });
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.38, 1.9, 12), white);
      tower.position.y = 0.95;
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.35, 0.28, 12), band);
      stripe.position.y = 0.7;
      const beaconMat = new THREE.MeshStandardMaterial({ color: 0xfff1c9, emissive: 0xffc46b, emissiveIntensity: 2.4 });
      const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.26, 10), beaconMat);
      beacon.position.y = 2.03;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.36, 12), band);
      roof.position.y = 2.34;
      lh.add(tower, stripe, beacon, roof);
      lh.position.set(water.position.x - 1.6, -1.05, water.position.z - 3.3);
      for (const m of [tower, stripe, roof]) casters.push(m);
      scene.add(lh);
      anim.beacon = beaconMat;

      // Cottages: paper boxes with pyramid roofs.
      for (let i = 0; i < 3; i++) {
        const house = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.55), paperMat(t.paper, { roughness: 0.8 }));
        body.position.y = 0.25;
        const roof = new THREE.Mesh(new THREE.ConeGeometry(0.56, 0.42, 4), mat(i % 2 ? t.accent : t.rock, { roughness: 0.7, flatShading: true }));
        roof.position.y = 0.71;
        roof.rotation.y = Math.PI / 4;
        const win = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.14), new THREE.MeshStandardMaterial({ color: 0xffe2a8, emissive: 0xffb45a, emissiveIntensity: 2.2 }));
        win.position.set(0, 0.28, 0.28);
        house.add(body, roof, win);
        house.position.set(1.2 + i * 1.05 + deco.next() * 0.3, -1.05, -3.2 + deco.next() * 0.8 - i * 0.35);
        house.rotation.y = (deco.next() - 0.5) * 0.7;
        casters.push(body, roof);
        scene.add(house);
      }

      // Paper boats bobbing on the pond.
      const hullGeo = new THREE.CylinderGeometry(0.3, 0.14, 0.16, 4, 1);
      hullGeo.rotateY(Math.PI / 4);
      hullGeo.scale(1.6, 1, 0.7);
      const sailShape = new THREE.Shape();
      sailShape.moveTo(0, 0); sailShape.lineTo(0.3, 0); sailShape.lineTo(0, 0.5); sailShape.lineTo(0, 0);
      const sailGeo = new THREE.ShapeGeometry(sailShape);
      const boatMat = paperMat('#fbf7ee', { roughness: 0.7, side: THREE.DoubleSide });
      for (let i = 0; i < 2; i++) {
        const boat = new THREE.Group();
        const hull = new THREE.Mesh(hullGeo, boatMat);
        const sail = new THREE.Mesh(sailGeo, i ? mat(t.accent, { side: THREE.DoubleSide, roughness: 0.7 }) : boatMat);
        sail.position.set(-0.08, 0.06, 0);
        boat.add(hull, sail);
        const a = deco.next() * Math.PI * 2;
        boat.position.set(water.position.x + Math.cos(a) * 1.4, -0.9, water.position.z + Math.sin(a) * 1.2);
        boat.rotation.y = deco.next() * Math.PI * 2;
        casters.push(hull, sail);
        scene.add(boat);
        anim.boats.push({ obj: boat, phase: deco.next() * 6, baseY: boat.position.y, baseRot: boat.rotation.y });
      }
    }

    // Lantern: brass post, glowing glass and a warm point light.
    const brass = mat('#b08a3e', { metalness: 0.85, roughness: 0.32, envMapIntensity: 1.2 });
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 1.5, 8), detailed ? brass : mat(t.ink));
    post.position.set(3.6, -0.55, 1.8);
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xffe2b0, emissive: 0xffb85c, emissiveIntensity: detailed ? 3 : 0.9 });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 12), lampMat);
    lamp.position.set(3.6, 0.28, 1.8);
    casters.push(post);
    scene.add(post, lamp);
    if (detailed) {
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.2, 8), brass);
      cap.position.set(3.6, 0.54, 1.8);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 8), brass);
      base.position.set(3.6, 0.07, 1.8);
      scene.add(cap, base);
    }
    const lanternLight = new THREE.PointLight(0xffc27a, detailed ? 2.5 : 1.2, 12, detailed ? 1.6 : 2);
    lanternLight.position.copy(lamp.position);
    scene.add(lanternLight);
    anim.lanternLight = lanternLight;
    anim.lampMat = lampMat;
    anim.lampBase = lampMat.emissiveIntensity;
    anim.lightBase = lanternLight.intensity;

    // Fireflies: soft additive sprites drifting around the lantern and meadow.
    const count = PARTICLE_COUNT[g.particles] || 0;
    if (count) {
      const pos = new Float32Array(count * 3);
      const seeds = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) {
        const nearLamp = i < count * 0.35;
        const a = deco.next() * Math.PI * 2;
        const r = nearLamp ? 0.4 + deco.next() * 1.4 : 1 + deco.next() * 7;
        seeds[i * 4] = (nearLamp ? 3.6 : 0) + Math.cos(a) * r;
        seeds[i * 4 + 1] = (nearLamp ? 0.2 : -0.6) + deco.next() * 1.6;
        seeds[i * 4 + 2] = (nearLamp ? 1.8 : -1.5) + Math.sin(a) * r * 0.8;
        seeds[i * 4 + 3] = deco.next() * 100;
        pos.set([seeds[i * 4], seeds[i * 4 + 1], seeds[i * 4 + 2]], i * 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const pm = new THREE.PointsMaterial({
        color: new THREE.Color(0xffd27a).multiplyScalar(2.2), size: 0.16, map: tex.dot,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false,
      });
      const flies = new THREE.Points(geo, pm);
      flies.frustumCulled = false;
      scene.add(flies);
      anim.flies = { geo, pos, seeds, count };
    }

    for (const m of casters) m.castShadow = true;
    for (const m of receivers) m.receiveShadow = true;
    scene.traverse((o) => {
      if (o.isMesh && o.material?.isMeshStandardMaterial && !env) o.material.envMapIntensity = 0;
    });
    scene.environment = env ? environment() : null;

    const camera = new THREE.PerspectiveCamera(46, d.size[1] ? d.size[0] / d.size[1] : 2, 0.1, 200);
    camera.position.set(0, 4.2, 12.5);
    camera.lookAt(0, -0.6, 0);
    d.scene = scene;
    d.camera = camera;
    d.anim = anim;
    d.postKey = null;
  }

  // ------------------------------------------------------------- settings
  function applyShadows() {
    const size = SHADOW_MAP[d.q.shadows];
    d.renderer.shadowMap.enabled = size > 0;
    if (d.key) {
      d.key.castShadow = size > 0;
      if (size > 0 && d.key.shadow.mapSize.x !== size) {
        d.key.shadow.mapSize.set(size, size);
        d.key.shadow.map?.dispose();
        d.key.shadow.map = null;
      }
    }
    // Materials pick up shadow-map changes on recompile.
    d.scene?.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  }

  function sceneKeyNow() {
    return [d.theme?.id, d.seed, d.q.detail, d.q.particles, d.q.reflections].join('|');
  }

  function refresh() {
    ensureCanvasAA();
    const key = sceneKeyNow();
    if (key !== d.sceneKey && d.theme) {
      d.sceneKey = key;
      build();
    }
    applyShadows();
  }

  d.setGraphics = (saved) => {
    d.saved = saved || {};
    d.q = resolve(d.saved, d.detected);
    d.adaptiveScale = 1;
    d.frames = [];
    d.postKey = null;
    d.postFailed = false;
    fpsVisible(d.q.showFps);
    refresh();
    return d.q;
  };

  d.setTheme = (theme) => { d.theme = theme; if (d.q) refresh(); };
  d.setSeed = (seed) => { d.seed = seed; if (d.q) refresh(); };

  d.info = () => ({
    gpu: d.gpu,
    detected: d.detected,
    resolved: d.q,
    pixels: [Math.round(d.size[0] * d.pixelRatio), Math.round(d.size[1] * d.pixelRatio)],
    fps: Math.round(d.fps || 0),
    postFailed: d.postFailed,
  });

  function fpsVisible(on) {
    let el = document.getElementById('fps-meter');
    if (on && !el) {
      el = document.createElement('div');
      el.id = 'fps-meter';
      el.className = 'fps-meter';
      el.setAttribute('aria-hidden', 'true');
      el.textContent = '— fps';
      document.body.append(el);
    }
    if (el) el.hidden = !on;
  }

  // ------------------------------------------------------------- post chain
  function postKey(w, h) {
    const g = d.q;
    return g.post && !d.postFailed ? [g.ao, g.bloom, g.grade, g.antialias, w, h, d.pixelRatio, d.sceneKey].join('|') : 'none';
  }

  function buildPost(w, h) {
    const g = d.q;
    d.composer?.dispose();
    d.composer = null;
    if (!g.post || d.postFailed) return;
    try {
      const pw = Math.max(1, Math.round(w * d.pixelRatio)), ph = Math.max(1, Math.round(h * d.pixelRatio));
      const target = new THREE.WebGLRenderTarget(pw, ph, { type: THREE.HalfFloatType, samples: g.antialias === 'msaa' ? 4 : 0 });
      const composer = new EffectComposer(d.renderer, target);
      composer.setPixelRatio(d.pixelRatio);
      composer.setSize(w, h);
      composer.addPass(new RenderPass(d.scene, d.camera));
      if (g.ao !== 'off') {
        const ao = new GTAOPass(d.scene, d.camera, pw, ph);
        ao.output = GTAOPass.OUTPUT.Default;
        ao.blendIntensity = 0.7;
        ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: g.ao === 'high' ? 16 : 8 });
        ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: g.ao === 'high' ? 6 : 4, rings: 2, samples: g.ao === 'high' ? 16 : 8 });
        composer.addPass(ao);
      }
      if (g.bloom === 'on') {
        // High threshold: only the lantern, beacon, windows and fireflies bloom.
        composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.7, 0.5, 0.92));
      }
      if (g.grade === 'on') composer.addPass(new ShaderPass(GradeShader));
      composer.addPass(new OutputPass());
      if (g.antialias === 'smaa') composer.addPass(new SMAAPass(pw, ph));
      if (g.antialias === 'fxaa') {
        const fxaa = new ShaderPass(FXAAShader);
        fxaa.material.uniforms.resolution.value.set(1 / pw, 1 / ph);
        composer.addPass(fxaa);
      }
      d.composer = composer;
    } catch {
      // Post-processing is an enhancement: render directly if the chain cannot be built.
      d.postFailed = true;
      d.composer = null;
      d.onChange?.();
    }
  }

  // Adaptive resolution: step the scale down when frames are slow, back up when fast.
  function adapt(dt) {
    d.fpsAcc = (d.fpsAcc || 0) + dt;
    d.fpsN = (d.fpsN || 0) + 1;
    if (d.fpsAcc >= 500) {
      d.fps = (1000 * d.fpsN) / d.fpsAcc;
      d.fpsAcc = 0; d.fpsN = 0;
      const el = document.getElementById('fps-meter');
      if (el && !el.hidden) el.textContent = `${Math.round(d.fps)} fps · ${Math.round(d.pixelRatio * 100) / 100}×`;
    }
    const f = d.frames;
    f.push(dt);
    if (f.length < 90) return false;
    const avg = f.reduce((a, b) => a + b, 0) / f.length;
    f.length = 0;
    if (!d.q.adaptive) return false;
    const before = d.adaptiveScale;
    if (avg > 26) d.adaptiveScale = Math.max(0.6, d.adaptiveScale - 0.1);
    else if (avg < 14 && d.adaptiveScale < 1) d.adaptiveScale = Math.min(1, d.adaptiveScale + 0.05);
    return before !== d.adaptiveScale;
  }

  // ------------------------------------------------------------- animation
  function animate(dt) {
    const a = d.anim;
    if (!a || isReducedMotion()) return;
    d.time += dt;
    const t = d.time;
    d.camera.position.x = Math.sin(t * 0.05) * 0.9;
    d.camera.lookAt(0, -0.6, 0);
    const flicker = Math.sin(t * 2.3) * 0.12 + Math.sin(t * 7.1) * 0.05;
    a.lanternLight.intensity = a.lightBase * (1 + flicker);
    a.lampMat.emissiveIntensity = a.lampBase * (1 + flicker * 0.8);
    if (a.beacon) a.beacon.emissiveIntensity = 2 + Math.max(0, Math.sin(t * 1.2)) * 1.6;
    a.water.position.y = -1.26 + Math.sin(t * 0.8) * 0.03;
    if (d.q.water === 'animated') {
      const n = a.water.material.normalMap;
      if (n) { n.offset.x = (t * 0.02) % 1; n.offset.y = (t * 0.013) % 1; }
      for (const b of a.boats) {
        b.obj.position.y = b.baseY + Math.sin(t * 1.3 + b.phase) * 0.035;
        b.obj.rotation.z = Math.sin(t * 1.1 + b.phase) * 0.07;
        b.obj.rotation.y = b.baseRot + Math.sin(t * 0.2 + b.phase) * 0.25;
      }
    }
    if (a.flies) {
      const { pos, seeds, count, geo } = a.flies;
      for (let i = 0; i < count; i++) {
        const s = seeds[i * 4 + 3];
        pos[i * 3] = seeds[i * 4] + Math.sin(t * 0.4 + s) * 0.35;
        pos[i * 3 + 1] = seeds[i * 4 + 1] + Math.sin(t * 0.7 + s * 1.7) * 0.22;
        pos[i * 3 + 2] = seeds[i * 4 + 2] + Math.cos(t * 0.33 + s * 0.9) * 0.35;
      }
      geo.attributes.position.needsUpdate = true;
    }
  }

  d.render = () => {
    if (!d.scene) return;
    const now = performance.now();
    const dt = d.last ? Math.min(250, now - d.last) : 16;
    d.last = now;
    animate(dt / 1000);
    const rescale = adapt(dt);
    const w = window.innerWidth, h = window.innerHeight;
    const ratio = Math.min(window.devicePixelRatio || 1, d.q.cap) * d.q.scale * d.adaptiveScale;
    if (w !== d.size[0] || h !== d.size[1] || ratio !== d.pixelRatio || rescale) {
      d.size = [w, h];
      d.pixelRatio = ratio;
      d.renderer.setPixelRatio(ratio);
      d.renderer.setSize(w, h, false);
      d.camera.aspect = w / h;
      d.camera.updateProjectionMatrix();
    }
    const key = postKey(w, h);
    if (key !== d.postKey) {
      d.postKey = key;
      buildPost(w, h);
    }
    if (d.scene.fog) d.scene.fog.color.copy(d.composer ? d.fogHdr : d.fogDisplay);
    if (d.composer) {
      try { d.composer.render(dt / 1000); return; } catch {
        d.postFailed = true;
        d.composer = null;
        d.onChange?.();
      }
    }
    d.renderer.render(d.scene, d.camera);
  };

  return d;
}
