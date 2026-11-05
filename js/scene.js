import * as THREE from '../vendor/three.module.min.js';

const MAXR = 12;
const MAX_NODES = 600;
const FOV = 38;

/* ---------- deterministic randomness + noise ---------- */
function rngFrom(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function hash3(x, y, z) {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u), l(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u), v),
    l(l(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u), l(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u), v),
    w
  );
}
const fbm = (x, y, z) => vnoise(x, y, z) * 0.6 + vnoise(x * 2.1, y * 2.1, z * 2.1) * 0.3 + vnoise(x * 4.3, y * 4.3, z * 4.3) * 0.1;
const ridge = (x, y, z) => 1 - Math.abs(fbm(x, y, z) * 2 - 1);

function randDir(r) {
  const z = r() * 2 - 1, a = r() * Math.PI * 2, q = Math.sqrt(1 - z * z);
  return [q * Math.cos(a), z, q * Math.sin(a)];
}

/* ---------- procedural brain ---------- */
function genBrain() {
  const r = rngFrom(20261103);
  const pos = [], tone = [], kind = [];
  const emit = (x, y, z, t, k) => { pos.push(x, y, z); tone.push(t); kind.push(k); };

  for (const s of [-1, 1]) {
    for (let i = 0; i < 9800; i++) {
      const u = randDir(r);
      const zf = u[2];
      let px = u[0] * 0.66, py = u[1] * 0.86, pz = u[2] * 1.1;
      py *= 1 - 0.14 * Math.max(0, -zf);
      px *= 1 - 0.1 * Math.max(0, zf);
      const wx0 = s * 0.52 + px, wy0 = 0.1 + py, wz0 = pz;
      const warp = fbm(wx0 * 1.6 + 7, wy0 * 1.6, wz0 * 1.6) * 0.9;
      const g = ridge(wx0 * 3.4 + warp, wy0 * 3.4, wz0 * 3.4 - warp);
      const k = 1 + 0.1 * (g - 0.5);
      let wx = s * 0.52 + px * k, wy = 0.1 + py * k, wz = pz * k;
      if (s * wx < 0.05) wx = s * (0.05 + r() * 0.012);
      if (wy < -0.42) wy = -0.42 + (wy + 0.42) * 0.35;
      emit(wx, wy, wz, g, 0);
    }
    for (let i = 0; i < 2600; i++) {
      const u = randDir(r);
      const wx0 = s * 0.74 + u[0] * 0.3, wy0 = -0.4 + u[1] * 0.25, wz0 = 0.2 + u[2] * 0.55;
      const g = ridge(wx0 * 3.4 + 3, wy0 * 3.4, wz0 * 3.4);
      const k = 1 + 0.1 * (g - 0.5);
      emit(s * 0.74 + u[0] * 0.3 * k, -0.4 + u[1] * 0.25 * k, 0.2 + u[2] * 0.55 * k, g, 1);
    }
  }
  for (let i = 0; i < 5200; i++) {
    const u = randDir(r);
    const wy0 = -0.58 + u[1] * 0.3;
    const f = 0.5 + 0.5 * Math.sin(wy0 * 90 + fbm(u[0] * 2, u[1] * 2, u[2] * 2) * 5);
    const k = 1 + 0.055 * (f - 0.5) * 2;
    emit(u[0] * 0.6 * k, wy0 * 1 + (u[1] * 0.3 * (k - 1)), -0.86 + u[2] * 0.4 * k, f, 2);
  }
  for (let i = 0; i < 1500; i++) {
    const t = r(), a = r() * Math.PI * 2, rad = 0.15 * (1 - 0.35 * t);
    emit(Math.cos(a) * rad, -0.42 - t * 0.85 + Math.sin(a) * rad * 0.2, -0.22 - t * 0.3 + Math.sin(a) * rad, 0.4 + r() * 0.4, 3);
  }
  for (let i = 0; i < 3600; i++) {
    const u = randDir(r), s = Math.cbrt(r());
    emit(u[0] * 0.95 * s, 0.05 + u[1] * 0.62 * s - 0.05, u[2] * 1.0 * s, 0.1 + r() * 0.15, 4);
  }
  return { pos: new Float32Array(pos), tone: new Float32Array(tone), kind: Uint8Array.from(kind), n: kind.length };
}

const ANCHOR_DIRS = [
  [-0.5, 0.6, 0.9], [1, -0.2, 0.3], [0.6, 0.9, -0.2], [-1, -0.2, 0.3], [0, 0.2, -1],
  [0.5, 0.6, 0.9], [0, -0.6, -0.9], [-0.6, 0.9, -0.2], [0, 1, 0.3], [0, -1, -0.2],
];

/* ---------- shaders ---------- */
const COMMON_UNIFORMS = `
uniform float uTime; uniform float uActive; uniform float uHover; uniform float uScan; uniform float uScale;
uniform float uVigor[${MAXR}]; uniform vec3 uCol[${MAXR}];
uniform vec3 uMouse; uniform float uMouseR; uniform vec4 uWave;
`;
const DISPLACE = `
vec3 displace(vec3 p){
  vec3 d = p - uMouse; float dist = length(d);
  float f = uMouseR > 0.0 ? smoothstep(uMouseR, 0.0, dist) : 0.0;
  p += normalize(d + vec3(1e-4)) * f * 0.11;
  float wt = uTime - uWave.w;
  if (wt > 0.0 && wt < 3.0) {
    float wd = distance(p, uWave.xyz);
    float ring = exp(-pow((wd - wt * 1.5) * 5.0, 2.0)) * (1.0 - wt / 3.0);
    p += normalize(p + vec3(1e-4)) * ring * 0.06;
  }
  return p;
}
float waveGlow(vec3 p){
  float wt = uTime - uWave.w;
  if (wt <= 0.0 || wt >= 3.0) return 0.0;
  float wd = distance(p, uWave.xyz);
  return exp(-pow((wd - wt * 1.5) * 5.0, 2.0)) * (1.0 - wt / 3.0);
}
`;

const PALETTE = `
const vec3 NAVY = vec3(0.22, 0.30, 0.80);
const vec3 PLUM = vec3(0.68, 0.26, 0.68);
const vec3 BURG = vec3(0.80, 0.15, 0.32);
const vec3 BEIGE = vec3(0.95, 0.87, 0.74);
const vec3 TERRA = vec3(0.82, 0.40, 0.24);
const vec3 BLUE = vec3(0.26, 0.52, 0.88);
`;

const POINT_VERT = COMMON_UNIFORMS + PALETTE + DISPLACE + `
attribute float aReg; attribute float aSeed; attribute float aTone;
uniform float uGlyph;
varying vec3 vCol; varying float vA; varying float vG; varying float vShade;
void main(){
  vec3 p0 = position;
  vec3 p = p0 + normalize(p0 + vec3(1e-4)) * sin(uTime * 0.7 + p0.y * 3.0 + aSeed * 6.0) * 0.006;
  p = displace(p);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  int r = int(aReg + 0.5);
  float vig = uVigor[r]; vec3 rc = uCol[r];
  float hot = (uActive > -0.5) ? ((abs(aReg - uActive) < 0.5) ? 1.0 : -1.0) : 0.0;
  float hov = (uHover > -0.5 && abs(aReg - uHover) < 0.5) ? 1.0 : 0.0;
  float m1 = 0.5 + 0.5 * sin(p0.y * 2.4 + p0.x * 1.3 + p0.z * 0.8 + uTime * 0.05);
  float m2 = 0.5 + 0.5 * sin(p0.z * 1.7 - p0.x * 1.1 + 1.0);
  vec3 irid = mix(mix(NAVY, BLUE, m1), mix(TERRA, mix(BURG, BEIGE, m1), m1), m2);
  irid = mix(irid, PLUM, 0.12 * m1);
  vec3 base = mix(BEIGE * 0.9, irid, 0.6);
  vCol = mix(base, rc, 0.5 + 0.25 * hot);
  float f = (uMouseR > 0.0) ? smoothstep(uMouseR, 0.0, distance(p0, uMouse)) : 0.0;
  vec3 nrm = normalize(p0 + vec3(1e-4) - vec3(sign(p0.x) * 0.3, 0.0, 0.0));
  float facing = dot(nrm, normalize(cameraPosition - p0));
  float fa = smoothstep(-0.3, 0.3, facing);
  float tone = 0.12 + 1.25 * aTone * aTone;
  float b = (0.3 + 0.7 * vig) * tone * mix(0.14, 1.0, fa);
  if (hot > 0.5) b *= 2.1; else if (hot < -0.5) b *= 0.22;
  b += hov * 0.28 + f * 1.1 + waveGlow(p0) * 1.4;
  b += exp(-pow((p0.y - uScan) * 12.0, 2.0)) * 1.4;
  float depth = clamp(1.25 - (-mv.z - 2.6) * 0.22, 0.25, 1.0);
  vA = b * depth;
  float show = (uGlyph > 0.5) ? step(aSeed, 0.4) : 1.0;
  float sz = mix(0.0085 + 0.007 * aSeed, 0.027, uGlyph) * (1.0 + f * 0.8) * show;
  gl_PointSize = sz * uScale / -mv.z;
  vG = clamp(b * 0.55 + (aSeed - 0.5) * 0.5, 0.0, 0.999);
  vShade = aSeed;
}`;
const POINT_FRAG = `
uniform sampler2D uAtlas; uniform float uGlyph;
varying vec3 vCol; varying float vA; varying float vG; varying float vShade;
void main(){
  vec2 uv = gl_PointCoord;
  float d = length(uv - 0.5);
  float dotA = smoothstep(0.5, 0.05, d);
  float cell = floor(vG * 8.0);
  float gl = texture2D(uAtlas, vec2((cell + uv.x) / 8.0, uv.y)).r;
  float a = mix(dotA, gl, uGlyph);
  gl_FragColor = vec4(vCol, a * vA * 0.9);
}`;

const FIBRE_VERT = COMMON_UNIFORMS + PALETTE + DISPLACE + `
attribute vec3 aDir; attribute float aT; attribute vec2 aReg; attribute float aSeed; attribute float aBundle;
uniform float uFibre;
varying vec3 vCol; varying float vA;
void main(){
  vec3 p0 = position;
  vec3 p = displace(p0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  int ra = int(aReg.x + 0.5), rb = int(aReg.y + 0.5);
  vec3 rc = mix(uCol[ra], uCol[rb], aT);
  vec3 dcol = mix(mix(NAVY, BLUE, aDir.y), mix(TERRA, mix(BURG, BEIGE, aDir.x * 0.7), aDir.y), aDir.z);
  vCol = mix(dcol * 1.2, rc, 0.36);
  float vig = 0.5 * (uVigor[ra] + uVigor[rb]);
  float prog = fract(uTime * (0.05 + 0.09 * aSeed) + aSeed * 13.0);
  float pulse = exp(-pow((aT - prog) * 7.0, 2.0)) + exp(-pow((aT - prog + 1.0) * 7.0, 2.0));
  float hot = (uActive > -0.5 && (abs(aReg.x - uActive) < 0.5 || abs(aReg.y - uActive) < 0.5)) ? 1.0 : 0.0;
  float hov = (uHover > -0.5 && (abs(aReg.x - uHover) < 0.5 || abs(aReg.y - uHover) < 0.5)) ? 1.0 : 0.0;
  float base = 0.07 + 0.2 * vig + aBundle * 0.14;
  float b = base;
  if (uActive > -0.5) b = mix(0.02, base + 0.5, hot);
  b += hov * 0.3 + pulse * (0.3 + 0.9 * max(hot, hov));
  float f = (uMouseR > 0.0) ? smoothstep(uMouseR, 0.0, distance(p0, uMouse)) : 0.0;
  b += f * 0.6 + waveGlow(p0) * 0.9;
  b += exp(-pow((p0.y - uScan) * 12.0, 2.0)) * 0.9;
  vA = b * uFibre;
}`;
const FIBRE_FRAG = `
varying vec3 vCol; varying float vA;
void main(){ gl_FragColor = vec4(vCol, vA * 0.5); }`;

const ORB_VERT = COMMON_UNIFORMS + `
attribute float aReg;
varying vec3 vCol; varying float vA; varying float vRing; varying float vCore;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  int r = int(aReg + 0.5);
  float vig = uVigor[r];
  float act = (uActive > -0.5 && abs(aReg - uActive) < 0.5) ? 1.0 : 0.0;
  float hov = (uHover > -0.5 && abs(aReg - uHover) < 0.5) ? 1.0 : 0.0;
  float pulse = 0.5 + 0.5 * sin(uTime * (1.2 + vig * 1.6) + aReg * 2.0);
  float dim = (uActive > -0.5 && act < 0.5) ? 0.35 : 1.0;
  vCol = mix(uCol[r], vec3(1.0), 0.35 + 0.3 * act);
  vA = (0.45 + 0.55 * vig) * dim * (0.8 + 0.3 * pulse);
  vRing = max(act, hov);
  vCore = 1.0;
  float sz = (0.17 + 0.07 * vig + 0.05 * pulse + 0.06 * hov + 0.08 * act);
  gl_PointSize = sz * uScale / -mv.z;
}`;
const ORB_FRAG = `
varying vec3 vCol; varying float vA; varying float vRing;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float core = smoothstep(0.2, 0.0, d);
  float halo = exp(-d * d * 7.0) * 0.55;
  float ring = smoothstep(0.035, 0.0, abs(d - 0.62)) * vRing;
  float a = (core + halo + ring) * (1.0 - smoothstep(0.92, 1.0, d));
  gl_FragColor = vec4(vCol, a * vA);
}`;

const NODE_VERT = COMMON_UNIFORMS + `
attribute float aReg; attribute float aType; attribute float aBirth; attribute float aSeed;
varying vec3 vCol; varying float vA; varying float vType;
void main(){
  vec3 p = position;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  int r = int(aReg + 0.5);
  float age = uTime - aBirth;
  float grow = smoothstep(0.0, 0.7, age);
  float burst = (1.0 - smoothstep(0.0, 1.6, age)) * step(0.0, age) * 2.2;
  float act = (uActive > -0.5 && abs(aReg - uActive) < 0.5) ? 1.0 : 0.0;
  float dim = (uActive > -0.5 && act < 0.5) ? 0.25 : 1.0;
  float twinkle = 0.8 + 0.2 * sin(uTime * 2.0 + aSeed * 30.0);
  vCol = mix(uCol[r], vec3(1.0), 0.55);
  vType = aType;
  vA = grow * dim * twinkle * (0.9 + burst);
  float sz = (0.05 + 0.02 * aType * 0.0 + 0.05 * act + burst * 0.06) * grow;
  if (age < 0.0) sz = 0.0;
  gl_PointSize = sz * uScale / -mv.z;
}`;
const NODE_FRAG = `
varying vec3 vCol; varying float vA; varying float vType;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float core = smoothstep(0.5, 0.0, d);
  float ringL = smoothstep(0.1, 0.0, abs(d - 0.6));
  float a = (vType < 0.5) ? core + 0.35 * exp(-d * d * 4.0)
          : (vType < 1.5) ? ringL * 1.2 + 0.12 * core
          : core * 0.6;
  a *= (1.0 - smoothstep(0.9, 1.0, d));
  gl_FragColor = vec4(vCol, a * vA);
}`;

const SPARK_VERT = `
attribute float aFade; uniform float uScale; varying float vF;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vF = aFade;
  gl_PointSize = (0.02 + 0.07 * aFade) * uScale / -mv.z;
}`;
const SPARK_FRAG = `
uniform vec3 uColor; varying float vF;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = exp(-d * d * 5.0) * (1.0 - smoothstep(0.9, 1.0, d));
  gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.5), a * vF);
}`;

/* ---------- glyph atlas ---------- */
function makeAtlas() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 256, 32);
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 26px Menlo, "SF Mono", ui-monospace, Consolas, monospace';
  const chars = ['.', ':', '+', '1', '0', '*', '#', '@'];
  chars.forEach((ch, i) => g.fillText(ch, i * 32 + 16, 17));
  const t = new THREE.CanvasTexture(c);
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
  return t;
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

/* ---------- main factory ---------- */
export function createBrain(canvas, hooks = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 50);
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const U = {
    uTime: { value: 0 }, uActive: { value: -1 }, uHover: { value: -1 }, uScan: { value: -9 }, uScale: { value: 1000 },
    uVigor: { value: new Float32Array(MAXR).fill(0.6) },
    uCol: { value: Array.from({ length: MAXR }, () => new THREE.Vector3(0.7, 0.8, 1)) },
    uMouse: { value: new THREE.Vector3() }, uMouseR: { value: 0 }, uWave: { value: new THREE.Vector4(0, 0, 0, -99) },
    uGlyph: { value: 0 }, uFibre: { value: 1 }, uAtlas: { value: makeAtlas() },
  };

  const brain = genBrain();
  const surf = [];
  for (let i = 0; i < brain.n; i++) if (brain.kind[i] < 4) surf.push(i);

  const anchors = [];
  for (const d of ANCHOR_DIRS) {
    const dv = new THREE.Vector3(...d).normalize();
    let best = -1, bs = -1e9;
    for (const i of surf) {
      const s = brain.pos[i * 3] * dv.x + brain.pos[i * 3 + 1] * dv.y + brain.pos[i * 3 + 2] * dv.z;
      if (s > bs) { bs = s; best = i; }
    }
    anchors.push(new THREE.Vector3(brain.pos[best * 3], brain.pos[best * 3 + 1], brain.pos[best * 3 + 2]).multiplyScalar(1.02));
  }

  /* points */
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(brain.pos, 3));
  const aReg = new Float32Array(brain.n);
  const aSeed = new Float32Array(brain.n);
  const sr = rngFrom(99);
  for (let i = 0; i < brain.n; i++) aSeed[i] = sr();
  pGeo.setAttribute('aReg', new THREE.BufferAttribute(aReg, 1));
  pGeo.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 1));
  pGeo.setAttribute('aTone', new THREE.BufferAttribute(brain.tone, 1));
  const pMat = new THREE.ShaderMaterial({
    uniforms: U, vertexShader: POINT_VERT, fragmentShader: POINT_FRAG,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(pGeo, pMat);
  points.frustumCulled = false;
  scene.add(points);

  /* fibres (built when interests are known) */
  let fibres = null;
  const regionPts = [];
  let nReg = 0;

  function nearestRegion(x, y, z) {
    let bi = 0, bd = 1e9;
    for (let a = 0; a < nReg; a++) {
      const v = anchorOrder[a];
      const dx = x - v.x, dy = y - v.y, dz = z - v.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bd) { bd = d; bi = a; }
    }
    return bi;
  }
  const ORDER = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  let anchorOrder = [];

  function buildFibres(connects) {
    if (fibres) { scene.remove(fibres); fibres.geometry.dispose(); }
    const r = rngFrom(4242);
    const SEG = 34;
    const curves = [];
    const pick = () => surf[Math.floor(r() * surf.length)];
    const P = (i) => new THREE.Vector3(brain.pos[i * 3], brain.pos[i * 3 + 1], brain.pos[i * 3 + 2]);
    const cerebral = surf.filter((i) => brain.kind[i] < 2);
    const pickC = () => cerebral[Math.floor(r() * cerebral.length)];

    for (let c = 0; c < 1500; c++) {
      const roll = r();
      const a = P(pickC());
      let b, ctrl;
      if (roll < 0.5) {
        let tries = 0;
        do { b = P(pickC()); tries++; } while ((a.distanceTo(b) < 0.35 || a.distanceTo(b) > 1.1 || Math.sign(a.x) !== Math.sign(b.x)) && tries < 14);
        ctrl = a.clone().add(b).multiplyScalar(0.5).multiplyScalar(0.62 + r() * 0.2);
      } else if (roll < 0.78) {
        b = new THREE.Vector3(-a.x * (0.9 + r() * 0.15), a.y + (r() - 0.5) * 0.15, a.z + (r() - 0.5) * 0.2);
        ctrl = new THREE.Vector3(0, Math.max(a.y, b.y) * 0.55 + 0.12, (a.z + b.z) * 0.5);
      } else {
        b = new THREE.Vector3((r() - 0.5) * 0.14, -0.55 - r() * 0.65, -0.3 - r() * 0.25);
        ctrl = new THREE.Vector3(a.x * 0.25, (a.y + b.y) * 0.35, (a.z + b.z) * 0.4);
      }
      curves.push({ a, b, ctrl, bundle: 0, seed: r() });
    }
    // dedicated bundles between connected interests
    const bundleCurves = [];
    const seen = new Set();
    for (const [ia, ib] of connects) {
      const key = ia < ib ? ia + '-' + ib : ib + '-' + ia;
      if (seen.has(key)) continue; seen.add(key);
      for (let k = 0; k < 90; k++) {
        const la = regionPts[ia], lb = regionPts[ib];
        if (!la || !lb || !la.length || !lb.length) break;
        const a = P(la[Math.floor(r() * la.length)]), b = P(lb[Math.floor(r() * lb.length)]);
        const mid = a.clone().add(b).multiplyScalar(0.5);
        const ctrl = mid.multiplyScalar(0.45 + r() * 0.25);
        bundleCurves.push({ a, b, ctrl, bundle: 1, seed: r() });
      }
    }
    const all = curves.concat(bundleCurves);
    const nv = all.length * SEG * 2;
    const pos = new Float32Array(nv * 3), dir = new Float32Array(nv * 3), t = new Float32Array(nv);
    const reg = new Float32Array(nv * 2), seed = new Float32Array(nv), bun = new Float32Array(nv);
    let o = 0;
    const q = new THREE.Vector3();
    const pts = new Array(SEG + 1);
    for (const cv of all) {
      const ra = nearestRegion(cv.a.x, cv.a.y, cv.a.z), rb = nearestRegion(cv.b.x, cv.b.y, cv.b.z);
      const perp = new THREE.Vector3().subVectors(cv.b, cv.a).cross(new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(0.025);
      for (let k = 0; k <= SEG; k++) {
        const s = k / SEG, is = 1 - s;
        q.set(0, 0, 0)
          .addScaledVector(cv.a, is * is).addScaledVector(cv.ctrl, 2 * is * s).addScaledVector(cv.b, s * s)
          .addScaledVector(perp, Math.sin(s * Math.PI * 3 + cv.seed * 9) * Math.sin(s * Math.PI));
        pts[k] = q.clone();
      }
      for (let k = 0; k < SEG; k++) {
        const p0 = pts[k], p1 = pts[k + 1];
        const d = new THREE.Vector3().subVectors(p1, p0).normalize();
        for (let e = 0; e < 2; e++) {
          const pp = e ? p1 : p0;
          pos[o * 3] = pp.x; pos[o * 3 + 1] = pp.y; pos[o * 3 + 2] = pp.z;
          dir[o * 3] = Math.abs(d.x); dir[o * 3 + 1] = Math.abs(d.y); dir[o * 3 + 2] = Math.abs(d.z);
          t[o] = (k + e) / SEG;
          reg[o * 2] = ra; reg[o * 2 + 1] = rb;
          seed[o] = cv.seed; bun[o] = cv.bundle;
          o++;
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aDir', new THREE.BufferAttribute(dir, 3));
    g.setAttribute('aT', new THREE.BufferAttribute(t, 1));
    g.setAttribute('aReg', new THREE.BufferAttribute(reg, 2));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.setAttribute('aBundle', new THREE.BufferAttribute(bun, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: U, vertexShader: FIBRE_VERT, fragmentShader: FIBRE_FRAG,
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    });
    fibres = new THREE.LineSegments(g, m);
    fibres.frustumCulled = false;
    scene.add(fibres);
  }

  /* orbs */
  const oGeo = new THREE.BufferGeometry();
  const oPos = new Float32Array(MAXR * 3), oReg = new Float32Array(MAXR);
  oGeo.setAttribute('position', new THREE.BufferAttribute(oPos, 3));
  oGeo.setAttribute('aReg', new THREE.BufferAttribute(oReg, 1));
  const orbs = new THREE.Points(oGeo, new THREE.ShaderMaterial({
    uniforms: U, vertexShader: ORB_VERT, fragmentShader: ORB_FRAG,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  }));
  orbs.frustumCulled = false;
  scene.add(orbs);

  /* nodes (log entries) */
  const nGeo = new THREE.BufferGeometry();
  const nPos = new Float32Array(MAX_NODES * 3), nodeReg = new Float32Array(MAX_NODES);
  const nType = new Float32Array(MAX_NODES), nBirth = new Float32Array(MAX_NODES).fill(1e9), nSeed = new Float32Array(MAX_NODES);
  nGeo.setAttribute('position', new THREE.BufferAttribute(nPos, 3));
  nGeo.setAttribute('aReg', new THREE.BufferAttribute(nodeReg, 1));
  nGeo.setAttribute('aType', new THREE.BufferAttribute(nType, 1));
  nGeo.setAttribute('aBirth', new THREE.BufferAttribute(nBirth, 1));
  nGeo.setAttribute('aSeed', new THREE.BufferAttribute(nSeed, 1));
  nGeo.setDrawRange(0, 0);
  const nodesMesh = new THREE.Points(nGeo, new THREE.ShaderMaterial({
    uniforms: U, vertexShader: NODE_VERT, fragmentShader: NODE_FRAG,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  }));
  nodesMesh.frustumCulled = false;
  scene.add(nodesMesh);
  const nodeList = []; // {id, region, type, world:Vector3}

  /* spark */
  const SP = 26;
  const spGeo = new THREE.BufferGeometry();
  const spPos = new Float32Array(SP * 3), spFade = new Float32Array(SP);
  for (let i = 0; i < SP; i++) spFade[i] = Math.pow(1 - i / SP, 1.6);
  spGeo.setAttribute('position', new THREE.BufferAttribute(spPos, 3));
  spGeo.setAttribute('aFade', new THREE.BufferAttribute(spFade, 1));
  const spUni = { uScale: U.uScale, uColor: { value: new THREE.Color(1, 1, 1) } };
  const sparkMesh = new THREE.Points(spGeo, new THREE.ShaderMaterial({
    uniforms: spUni, vertexShader: SPARK_VERT, fragmentShader: SPARK_FRAG,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  }));
  sparkMesh.frustumCulled = false; sparkMesh.visible = false;
  scene.add(sparkMesh);
  let spark = null;

  /* camera state */
  const cam = { theta: 1.25, phi: 1.38, radius: 5.5, tTheta: 1.25, tPhi: 1.38, tRadius: 5.5, base: 5.5, vTheta: 0, vPhi: 0, offX: 0, tOffX: 0, offY: 0, tOffY: 0 };
  const opts = { rotate: !reduce, glyph: false, fibres: true };
  let size = { w: 1, h: 1 };
  let interacting = false, lastInput = 0;
  const bounds = new THREE.Sphere(new THREE.Vector3(), 1.05);
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2(9, 9);
  const hit = new THREE.Vector3();
  let mouseOn = false;

  function resize() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    size = { w: Math.max(1, r.width), h: Math.max(1, r.height) };
    renderer.setPixelRatio(dpr);
    renderer.setSize(size.w, size.h, false);
    camera.aspect = size.w / size.h;
    U.uScale.value = (size.h * dpr) / (2 * Math.tan((FOV * Math.PI) / 360));
    camera.updateProjectionMatrix();
    const nb = 5.5 * Math.max(1, 0.79 / camera.aspect);
    if (Math.abs(nb - cam.base) > 0.01) { cam.tRadius = clamp(cam.tRadius * (nb / cam.base), 2.4, 13); cam.base = nb; }
  }
  new ResizeObserver(resize).observe(canvas);
  resize();
  cam.radius = cam.tRadius;

  /* input */
  const pointers = new Map();
  let pinchD = 0, downAt = null;
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    interacting = true; lastInput = performance.now();
    if (pointers.size === 1) downAt = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 };
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchD = Math.hypot(a.x - b.x, a.y - b.y); }
  });
  canvas.addEventListener('pointermove', (e) => {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    mouseOn = true;
    hooks.onMove && hooks.onMove(e.clientX - rect.left, e.clientY - rect.top, pointers.size > 0);
    const p = pointers.get(e.pointerId);
    if (!p) return;
    lastInput = performance.now();
    if (pointers.size === 2) {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      cam.tRadius = clamp(cam.tRadius * (pinchD / d), 2.4, 13);
      pinchD = d;
      return;
    }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (downAt) downAt.moved += Math.abs(dx) + Math.abs(dy);
    cam.tTheta -= dx * 0.006; cam.tPhi = clamp(cam.tPhi - dy * 0.005, 0.25, Math.PI - 0.25);
    cam.vTheta = -dx * 0.006; cam.vPhi = -dy * 0.005;
  });
  const up = (e) => {
    const was = pointers.has(e.pointerId);
    pointers.delete(e.pointerId);
    if (pointers.size === 0) interacting = false;
    if (was && downAt && downAt.moved < 6 && performance.now() - downAt.t < 450) {
      const rect = canvas.getBoundingClientRect();
      hooks.onTap && hooks.onTap(e.clientX - rect.left, e.clientY - rect.top);
    }
    if (pointers.size === 0) downAt = null;
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', () => { mouseOn = false; hooks.onMove && hooks.onMove(-1, -1, false); });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    cam.tRadius = clamp(cam.tRadius * Math.exp(e.deltaY * 0.0012), 2.4, 13);
    lastInput = performance.now();
  }, { passive: false });


  /* api pieces */
  const screen = { anchors: [], nodes: [], w: 1, h: 1 };
  const tmp = new THREE.Vector3();
  function proj(v, out) {
    tmp.copy(v).project(camera);
    out.x = (tmp.x * 0.5 + 0.5) * size.w;
    out.y = (-tmp.y * 0.5 + 0.5) * size.h;
    out.z = tmp.z;
    const toCam = new THREE.Vector3().subVectors(camera.position, v);
    out.front = v.dot(toCam) > -0.05;
    return out;
  }

  function setInterests(list) {
    nReg = Math.min(list.length, MAXR, ORDER.length);
    anchorOrder = [];
    for (let i = 0; i < nReg; i++) anchorOrder.push(anchors[ORDER[i]]);
    for (let i = 0; i < MAXR; i++) {
      const it = list[i];
      const c = it ? hslToRgb(it.color) : [0.6, 0.6, 0.6];
      U.uCol.value[i].set(c[0], c[1], c[2]);
      if (anchorOrder[i]) { oPos.set([anchorOrder[i].x, anchorOrder[i].y, anchorOrder[i].z], i * 3); oReg[i] = i; }
    }
    oGeo.setDrawRange(0, nReg);
    oGeo.attributes.position.needsUpdate = true; oGeo.attributes.aReg.needsUpdate = true;
    regionPts.length = 0;
    for (let i = 0; i < nReg; i++) regionPts.push([]);
    for (let i = 0; i < brain.n; i++) {
      const rg = nearestRegion(brain.pos[i * 3], brain.pos[i * 3 + 1], brain.pos[i * 3 + 2]);
      aReg[i] = rg;
      if (brain.kind[i] < 4) regionPts[rg].push(i);
    }
    pGeo.attributes.aReg.needsUpdate = true;
    const idx = new Map(list.map((it, i) => [it.id, i]));
    const conn = [];
    list.forEach((it, i) => (it.connects || []).forEach((cid) => { if (idx.has(cid)) conn.push([i, idx.get(cid)]); }));
    buildFibres(conn);
  }

  function hslToRgb(c) {
    const col = new THREE.Color().setHSL(c.h / 360, c.s / 100, c.l / 100);
    return [col.r, col.g, col.b];
  }

  function setNodes(items) {
    nodeList.length = 0;
    items.forEach((n) => addNodeInternal(n, -99));
    flushNodes();
  }
  function nodePosition(n) {
    const pts = regionPts[n.region];
    const r = rngFrom(hashStr(n.id));
    const i = pts && pts.length ? pts[Math.floor(r() * pts.length)] : 0;
    return new THREE.Vector3(brain.pos[i * 3], brain.pos[i * 3 + 1], brain.pos[i * 3 + 2]).multiplyScalar(1.015);
  }
  function addNodeInternal(n, birth) {
    if (nodeList.length >= MAX_NODES) return null;
    const w = nodePosition(n);
    const i = nodeList.length;
    nPos.set([w.x, w.y, w.z], i * 3);
    nodeReg[i] = n.region; nType[i] = n.type === 'learning' ? 0 : n.type === 'question' ? 1 : 2;
    nBirth[i] = birth; nSeed[i] = rngFrom(hashStr(n.id + 's'))();
    const rec = { id: n.id, region: n.region, type: n.type, world: w };
    nodeList.push(rec);
    return rec;
  }
  function flushNodes() {
    nGeo.setDrawRange(0, nodeList.length);
    for (const k of ['position', 'aReg', 'aType', 'aBirth', 'aSeed']) nGeo.attributes[k].needsUpdate = true;
  }

  function addNodeAnimated(n, cb) {
    const rec = addNodeInternal(n, 1e9);
    if (!rec) { cb && cb(); return; }
    flushNodes();
    const start = camera.position.clone().add(new THREE.Vector3(0.6, -0.9, -2.4).applyQuaternion(camera.quaternion));
    const end = rec.world.clone();
    const mid = start.clone().add(end).multiplyScalar(0.5).add(new THREE.Vector3(0, 0.9, 0));
    spark = { t: 0, dur: 1.3, start, mid, end, rec, cb, trail: [] };
    spUni.uColor.value.copy(new THREE.Color(U.uCol.value[n.region].x, U.uCol.value[n.region].y, U.uCol.value[n.region].z));
    sparkMesh.visible = true;
  }

  function flyTo(i) {
    if (i == null || i < 0 || !anchorOrder[i]) {
      cam.tRadius = cam.base; cam.tPhi = 1.38; return;
    }
    const n = anchorOrder[i].clone().normalize();
    const th = Math.atan2(n.x, n.z);
    cam.tPhi = clamp(Math.acos(clamp(n.y, -1, 1)), 0.45, Math.PI - 0.45);
    let d = th - cam.theta; d = Math.atan2(Math.sin(d), Math.cos(d));
    cam.tTheta = cam.theta + d;
    cam.tRadius = cam.base * 0.78;
  }

  function wave(world) {
    U.uWave.value.set(world.x, world.y, world.z, U.uTime.value);
  }

  /* loop */
  const clock = new THREE.Clock();
  let glyphMix = 0, fibreMix = 1, scanT = -1, frames = 0;
  const onFrame = [];
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = (U.uTime.value += dt);
    frames++;

    // camera
    const idle = !interacting && performance.now() - lastInput > 2500;
    if (opts.rotate && idle && U.uActive.value < -0.5) cam.tTheta += dt * 0.06;
    if (!interacting) { cam.tTheta += cam.vTheta; cam.tPhi = clamp(cam.tPhi + cam.vPhi, 0.25, Math.PI - 0.25); cam.vTheta *= 0.93; cam.vPhi *= 0.93; }
    const k = 1 - Math.exp(-dt * 5);
    cam.theta += (cam.tTheta - cam.theta) * k;
    cam.phi += (cam.tPhi - cam.phi) * k;
    cam.radius += (cam.tRadius - cam.radius) * k;
    cam.offX += (cam.tOffX - cam.offX) * (1 - Math.exp(-dt * 4));
    cam.offY += (cam.tOffY - cam.offY) * (1 - Math.exp(-dt * 4));
    const sp = Math.sin(cam.phi);
    camera.position.set(cam.radius * sp * Math.sin(cam.theta), cam.radius * Math.cos(cam.phi), cam.radius * sp * Math.cos(cam.theta));
    camera.lookAt(0, -0.05, 0);
    camera.setViewOffset(size.w, size.h, cam.offX, cam.offY, size.w, size.h);
    camera.updateMatrixWorld();

    // mouse on brain
    let want = 0;
    if (mouseOn) {
      ray.setFromCamera(ndc, camera);
      if (ray.ray.intersectSphere(bounds, hit)) { U.uMouse.value.copy(hit); want = 0.46; }
    }
    U.uMouseR.value += (want - U.uMouseR.value) * (1 - Math.exp(-dt * 10));
    if (U.uMouseR.value < 0.01 && want === 0) U.uMouseR.value = 0;

    // toggles
    glyphMix += ((opts.glyph ? 1 : 0) - glyphMix) * (1 - Math.exp(-dt * 6));
    fibreMix += ((opts.fibres ? 1 : 0) - fibreMix) * (1 - Math.exp(-dt * 6));
    U.uGlyph.value = glyphMix; U.uFibre.value = fibreMix;
    if (fibres) fibres.visible = fibreMix > 0.01;

    // scan
    if (scanT >= 0) {
      scanT += dt;
      U.uScan.value = -1.45 + (scanT / 2.4) * 2.9;
      if (scanT > 2.4) { scanT = -1; U.uScan.value = -9; }
    }

    // spark
    if (spark) {
      spark.t += dt;
      const s = clamp(spark.t / spark.dur, 0, 1), e = s * s * (3 - 2 * s), is = 1 - e;
      const head = new THREE.Vector3()
        .addScaledVector(spark.start, is * is).addScaledVector(spark.mid, 2 * is * e).addScaledVector(spark.end, e * e);
      spark.trail.unshift(head);
      if (spark.trail.length > SP) spark.trail.pop();
      for (let i = 0; i < SP; i++) {
        const p = spark.trail[Math.min(i, spark.trail.length - 1)];
        spPos[i * 3] = p.x; spPos[i * 3 + 1] = p.y; spPos[i * 3 + 2] = p.z;
      }
      spGeo.attributes.position.needsUpdate = true;
      if (s >= 1) {
        const rec = spark.rec;
        const idx = nodeList.indexOf(rec);
        if (idx >= 0) { nBirth[idx] = t; nGeo.attributes.aBirth.needsUpdate = true; }
        wave(rec.world);
        const cb = spark.cb; spark = null; sparkMesh.visible = false;
        cb && cb();
      }
    }

    // screen positions for HTML overlay
    screen.w = size.w; screen.h = size.h;
    for (let i = 0; i < nReg; i++) screen.anchors[i] = proj(anchorOrder[i], screen.anchors[i] || {});
    screen.anchors.length = nReg;
    for (let i = 0; i < nodeList.length; i++) screen.nodes[i] = proj(nodeList[i].world, screen.nodes[i] || {});
    screen.nodes.length = nodeList.length;

    renderer.render(scene, camera);
    for (const f of onFrame) f(dt, t);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    setInterests, setNodes, addNodeAnimated, flyTo, wave,
    nodeList, screen, onFrame, opts,
    setVigor(arr) { for (let i = 0; i < MAXR; i++) U.uVigor.value[i] = arr[i] == null ? 0.5 : arr[i]; },
    setActive(i) { U.uActive.value = i == null ? -1 : i; },
    setHover(i) { U.uHover.value = i == null ? -1 : i; },
    setPanelOffset(px, py = 0) { cam.tOffX = px; cam.tOffY = py; },
    pulseAtMouse() { wave(U.uMouse.value); },
    scan() { scanT = 0; },
    anchorWorld(i) { return anchorOrder[i]; },
    resetView() { cam.tRadius = cam.base; },
    colorOf(i) { const c = U.uCol.value[i]; return [c.x, c.y, c.z]; },
    get regionCount() { return nReg; },
  };
}
