import * as THREE from 'three/webgpu';
import { attribute, clamp as tslClamp, cos, dot, float as tslFloat, materialEmissive, max as tslMax, mix as tslMix, normalView, pointUV, positionLocal, positionView, pow, sin, sub, uniform, vec2, vec3, vec4 } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LOD_NEAR_DISTANCE, LOD_MEDIUM_DISTANCE, toStandardMaterial } from './lodUtils.js';
import { qualityManager } from '../QualityManager.js';

const TWO_PI = Math.PI * 2;

// ── Physics / animation tuning constants ─────────────────────────────────────
const TUBE_SWAY_STIFFNESS    = 2.2;   // spring stiffness for current-driven sway
const TUBE_SWAY_DAMPING      = 0.85;  // damping ratio for sway spring
const MAX_PHYSICS_DT         = 0.05;  // maximum physics timestep (s) to prevent large steps
const MIN_REEMERGENCE_DELAY  = 0.5;   // minimum per-worm re-emergence delay after player leaves (s)
const MAX_REEMERGENCE_DELAY  = 1.1;   // maximum additional random delay on top of minimum (s)
const SYMBIOTIC_PROXIMITY_SQ = 0.04;  // squared distance (0.2 m) for worm tip interaction
const SYMBIOTIC_CHECK_EVERY  = 60;    // frames between symbiotic proximity checks

// ── Pre-allocated temporaries — zero per-frame allocations ───────────────────
const _mat4A  = new THREE.Matrix4();
const _mat4B  = new THREE.Matrix4();  // second matrix for opening ring update
const _vec3A  = new THREE.Vector3();
const _vec3B  = new THREE.Vector3();
const _vec3C  = new THREE.Vector3();
const _quatA  = new THREE.Quaternion();
const _quatB  = new THREE.Quaternion();  // second quaternion for opening ring
const _quatC  = new THREE.Quaternion();
const _scaleA = new THREE.Vector3();
const _scaleB = new THREE.Vector3();     // second scale for opening ring
const _euler  = new THREE.Euler();

// ── LOD tier names — defines addLevel insertion order; must not be reordered ─
const TIER_NAMES = ['near', 'medium', 'far'];

// ── LOD tier profiles ─────────────────────────────────────────────────────────
// Near (0-42m): full detail — all tubes, worms, frills, barnacles, full animation
// Medium (42-86m): ~50% tubes, frills, simplified sway, no worms
// Far (86m+): minimal static silhouette, no animation
const LOD_PROFILES = {
  near: {
    tubeCountMin: 7, tubeCountMax: 10,
    tubeRadSegs: 18, tubeHtSegs: 12,
    baseRadSegs: 24, baseHtSegs: 8,
    worms: true, frills: true, barnacles: true, fringe: true, particles: true,
    frillW: 12, frillH: 6,
    animInterval: 1,
    noOpenings: false,
  },
  medium: {
    tubeCountMin: 4, tubeCountMax: 6,
    tubeRadSegs: 10, tubeHtSegs: 6,
    baseRadSegs: 14, baseHtSegs: 4,
    worms: false, frills: true, barnacles: false, fringe: false, particles: false,
    frillW: 6, frillH: 3,
    animInterval: 3,
    noOpenings: false,
  },
  far: {
    tubeCountMin: 3, tubeCountMax: 4,
    tubeRadSegs: 6, tubeHtSegs: 2,
    baseRadSegs: 8, baseHtSegs: 2,
    worms: false, frills: false, barnacles: false, fringe: false, particles: false,
    frillW: 0, frillH: 0,
    animInterval: 9999,
    noOpenings: false,
  },
};

// Reduced far LOD for Ultra quality tier: <100 triangles, update every 4th frame
// 2 tubes × CylGeo(4,1)≈16 tri each + base CylGeo(4,1)≈16 tri = ~48 triangles total
const FAR_ULTRA_PROFILE = {
  tubeCountMin: 2, tubeCountMax: 2,
  tubeRadSegs: 4, tubeHtSegs: 1,
  baseRadSegs: 4, baseHtSegs: 1,
  worms: false, frills: false, barnacles: false, fringe: false, particles: false,
  frillW: 0, frillH: 0,
  animInterval: 4,   // update every 4th frame on Ultra
  noOpenings: true,  // skip torus rings to stay under 100 triangles
};

// ── Shared singleton canvas textures (created once, never disposed) ───────────

let _growthRingTex  = null;
let _barnaclesTex   = null;
let _wormBristleTex = null;
const _sharedTextures = new Set();

function getGrowthRingTex() {
  if (_growthRingTex) return _growthRingTex;
  const sz = 128;
  const canvas = document.createElement('canvas');
  canvas.width = sz; canvas.height = sz;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(sz, sz);
  const d = img.data;
  for (let y = 0; y < sz; y++) {
    for (let x = 0; x < sz; x++) {
      const u = x / (sz - 1), v = y / (sz - 1);
      const ring = Math.sin(v * 32 * Math.PI) * 0.28;
      const nod  = Math.sin(u * TWO_PI * 10 + v * 5) * 0.05;
      const nx = THREE.MathUtils.clamp(0.5 + nod, 0, 1);
      const ny = THREE.MathUtils.clamp(0.5 + ring, 0, 1);
      const nz = Math.sqrt(Math.max(0, 1 - (nx * 2 - 1) ** 2 - (ny * 2 - 1) ** 2)) * 0.5 + 0.5;
      const i = (y * sz + x) * 4;
      d[i]   = Math.round(nx * 255);
      d[i+1] = Math.round(ny * 255);
      d[i+2] = Math.round(nz * 255);
      d[i+3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 4);
  tex.needsUpdate = true;
  _growthRingTex = tex;
  _sharedTextures.add(tex);
  return tex;
}

function getBarnaclesTex() {
  if (_barnaclesTex) return _barnaclesTex;
  const sz = 128;
  const canvas = document.createElement('canvas');
  canvas.width = sz; canvas.height = sz;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(sz, sz);
  const d = img.data;
  for (let y = 0; y < sz; y++) {
    for (let x = 0; x < sz; x++) {
      const u = x / (sz - 1), v = y / (sz - 1);
      const b1 = Math.sin(u * 22 + v * 17) * Math.cos(u * 13 - v * 28) * 0.25;
      const b2 = Math.sin(u * 45 + v * 39) * 0.1;
      const rough = Math.sin(u * 80 + v * 75) * 0.03;
      const nx = THREE.MathUtils.clamp(0.5 + b1 * 0.5 + rough, 0, 1);
      const ny = THREE.MathUtils.clamp(0.5 + b2 + rough, 0, 1);
      const nz = Math.sqrt(Math.max(0, 1 - (nx * 2 - 1) ** 2 - (ny * 2 - 1) ** 2)) * 0.5 + 0.5;
      const i = (y * sz + x) * 4;
      d[i]   = Math.round(nx * 255);
      d[i+1] = Math.round(ny * 255);
      d[i+2] = Math.round(nz * 255);
      d[i+3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  tex.needsUpdate = true;
  _barnaclesTex = tex;
  _sharedTextures.add(tex);
  return tex;
}

// Worm bristle normal map — fine diagonal setae (bristle-like detail)
function getWormBristleTex() {
  if (_wormBristleTex) return _wormBristleTex;
  const sz = 64;
  const canvas = document.createElement('canvas');
  canvas.width = sz; canvas.height = sz;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(sz, sz);
  const d = img.data;
  for (let y = 0; y < sz; y++) {
    for (let x = 0; x < sz; x++) {
      const u = x / (sz - 1), v = y / (sz - 1);
      // Fine diagonal bristle stripes (setae pattern)
      const bristle = Math.sin((u - v) * 40 * Math.PI) * 0.18;
      const spine   = Math.sin(v * 32 * Math.PI) * 0.07;
      const micro   = Math.sin(u * 90 + v * 70) * 0.03;
      const nx = THREE.MathUtils.clamp(0.5 + bristle + micro, 0, 1);
      const ny = THREE.MathUtils.clamp(0.5 + spine + micro, 0, 1);
      const nz = Math.sqrt(Math.max(0, 1 - (nx * 2 - 1) ** 2 - (ny * 2 - 1) ** 2)) * 0.5 + 0.5;
      const i = (y * sz + x) * 4;
      d[i]   = Math.round(nx * 255);
      d[i+1] = Math.round(ny * 255);
      d[i+2] = Math.round(nz * 255);
      d[i+3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 6);
  tex.needsUpdate = true;
  _wormBristleTex = tex;
  _sharedTextures.add(tex);
  return tex;
}

// ── TubeCluster ───────────────────────────────────────────────────────────────
// Stationary deep-zone tube worm colony — organic worm cluster at 150m+ depth
export class TubeCluster {
  constructor(scene, position) {
    this.scene  = scene;
    this.group  = new THREE.Group();
    this.time   = Math.random() * 100;
    this.worms  = [];  // backward-compat: worm meshes from near tier

    this._frameCount  = 0;
    this._lastLodTier = 'near';
    this._playerNear  = false;
    this._wormData    = [];   // per-worm state (near tier)
    this.tiers        = {};
    this._isUltra     = qualityManager.tier === 'ultra';

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  // ── LOD tier resolution — query THREE.LOD's visible level ────────────────

  _getVisibleTierName() {
    const levels = this.lod.levels;
    for (let i = 0; i < levels.length; i++) {
      if (levels[i].object.visible) return TIER_NAMES[i];
    }
    return this._lastLodTier;
  }

  _getFarProfile() {
    return qualityManager.tier === 'ultra' ? FAR_ULTRA_PROFILE : LOD_PROFILES.far;
  }

  _disposeObjectTree(root) {
    root.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) {
          if (material.map && !_sharedTextures.has(material.map)) material.map.dispose();
          if (material.normalMap && !_sharedTextures.has(material.normalMap)) material.normalMap.dispose();
          if (material.emissiveMap && !_sharedTextures.has(material.emissiveMap)) material.emissiveMap.dispose();
          material.dispose();
        }
      }
    });
  }

  _refreshFarTierIfNeeded() {
    const isUltra = qualityManager.tier === 'ultra';
    if (isUltra === this._isUltra) return;

    this._isUltra = isUltra;
    const oldFarTier = this.tiers.far;
    const oldLevelIndex = this.lod.levels.findIndex((level) => level.object === oldFarTier.group);
    if (oldLevelIndex !== -1) {
      this.lod.remove(oldFarTier.group);
      this.lod.levels.splice(oldLevelIndex, 1);
    }
    this._disposeObjectTree(oldFarTier.group);

    const newFarTier = this._buildTier(this._getFarProfile(), 'far');
    this.tiers.far = newFarTier;
    this.lod.addLevel(newFarTier.group, LOD_MEDIUM_DISTANCE);
  }

  // ── Model construction ────────────────────────────────────────────────────

  _buildModel() {
    const lod = new THREE.LOD();
    // Iterate in explicit tier order so lod.levels[i] matches TIER_NAMES[i]
    for (const tierName of TIER_NAMES) {
      const profile = tierName === 'far' ? this._getFarProfile() : LOD_PROFILES[tierName];
      const tier = this._buildTier(profile, tierName);
      this.tiers[tierName] = tier;
      const dist = tierName === 'near'   ? 0
                 : tierName === 'medium' ? LOD_NEAR_DISTANCE
                 : LOD_MEDIUM_DISTANCE;
      lod.addLevel(tier.group, dist);
    }
    this.lod = lod;
    this.group.add(lod);

    const s = 1.5 + Math.random() * 1.5;
    this._baseScale = s;
    this.group.scale.setScalar(s);
  }

  _buildTier(profile, tierName) {
    const tierGroup = new THREE.Group();
    const isFar = tierName === 'far';

    if (isFar) {
      return this._buildFarTier(profile, tierGroup);
    }

    // ── Materials ─────────────────────────────────────────────────────────────
    const tubeMat = new THREE.MeshPhysicalMaterial({
      color: 0x181826, roughness: 0.3, metalness: 0.04,
      clearcoat: 0.6, clearcoatRoughness: 0.25,
      emissive: 0x1e3050, emissiveIntensity: 0.25,
      normalMap: getGrowthRingTex(),
      normalScale: new THREE.Vector2(0.8, 0.8),
    });

    const baseMat = new THREE.MeshPhysicalMaterial({
      color: 0x141420, roughness: 0.72, metalness: 0.04,
      emissive: 0x181832, emissiveIntensity: 0.14,
      normalMap: getBarnaclesTex(),
      normalScale: new THREE.Vector2(0.6, 0.6),
    });

    const openingMat = new THREE.MeshPhysicalMaterial({
      color: 0x201828, roughness: 0.18, metalness: 0,
      clearcoat: 1.0, clearcoatRoughness: 0.08,
      emissive: 0x401858, emissiveIntensity: 0.45,
    });

    // ── Base mound ────────────────────────────────────────────────────────────
    const baseGeo = new THREE.CylinderGeometry(1.5, 2, 0.8, profile.baseRadSegs, profile.baseHtSegs);
    const bp = baseGeo.attributes.position;
    for (let v = 0; v < bp.count; v++) {
      const y  = bp.getY(v);
      const ax = Math.atan2(bp.getZ(v), bp.getX(v));
      if (y > -0.38) {
        const bump = Math.sin(ax * 8 + y * 4) * 0.07 + Math.cos(ax * 5 - y * 6) * 0.04;
        bp.setX(v, bp.getX(v) * (1 + bump * 0.3));
        bp.setZ(v, bp.getZ(v) * (1 + bump * 0.3));
      }
    }
    baseGeo.computeVertexNormals();
    const base = new THREE.Mesh(baseGeo, baseMat);
    tierGroup.add(base);

    // ── Barnacle clusters on base (near only) ─────────────────────────────────
    if (profile.barnacles) {
      const barnGeo = new THREE.SphereGeometry(0.06, 6, 4);
      const barnMat = new THREE.MeshPhysicalMaterial({
        color: 0x161820, roughness: 0.82, metalness: 0.1,
        emissive: 0x101828, emissiveIntensity: 0.1,
      });
      for (let b = 0; b < 14; b++) {
        const ang = (b / 14) * TWO_PI + Math.random() * 0.35;
        const cr  = 0.7 + Math.random() * 1.0;
        const bm  = new THREE.Mesh(barnGeo, barnMat);
        bm.position.set(Math.cos(ang) * cr, 0.18 + Math.random() * 0.22, Math.sin(ang) * cr);
        bm.scale.set(1 + Math.random() * 0.6, 0.45 + Math.random() * 0.55, 1 + Math.random() * 0.6);
        tierGroup.add(bm);
      }
    }

    // ── Substrate particles (near only) — vertex-shader driven drift ──────────
    let particles = null;
    if (profile.particles) {
      particles = this._buildParticles();
      tierGroup.add(particles.mesh);
    }

    // ── Tubes (InstancedMesh — single draw call) ──────────────────────────────
    const tubeCount = profile.tubeCountMin
      + Math.floor(Math.random() * (profile.tubeCountMax - profile.tubeCountMin + 1));

    const instGeo = new THREE.CylinderGeometry(1, 1.2, 1, profile.tubeRadSegs, profile.tubeHtSegs);

    // Growth ring displacement baked into geometry
    const tp = instGeo.attributes.position;
    for (let v = 0; v < tp.count; v++) {
      const y  = tp.getY(v);
      const ax = Math.atan2(tp.getZ(v), tp.getX(v));
      const r  = Math.sqrt(tp.getX(v) ** 2 + tp.getZ(v) ** 2);
      if (r > 0.05) {
        const scale = 1 + Math.sin(y * 10 + ax * 0.5) * 0.022;
        tp.setX(v, tp.getX(v) * scale);
        tp.setZ(v, tp.getZ(v) * scale);
      }
    }
    instGeo.computeVertexNormals();

    const tubeMesh = new THREE.InstancedMesh(instGeo, tubeMat, tubeCount);
    tubeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    // Opening rings (always present for near/medium tiers)
    const openGeo = new THREE.TorusGeometry(1.1, 0.15, 6, 12);
    const openMesh = new THREE.InstancedMesh(openGeo, openingMat, tubeCount);
    openMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const tubeData    = [];
    const frillMats   = [];
    const frillGlow   = new Float32Array(tubeCount);
    const fringeMeshes = [];  // for fringe flutter animation
    const wormData    = [];

    for (let i = 0; i < tubeCount; i++) {
      const height   = 1.5 + Math.random() * 3.5;
      const radius   = 0.08 + Math.random() * 0.1;
      const ang      = (i / tubeCount) * TWO_PI + Math.random() * 0.3;
      const clusterR = 0.3 + Math.random() * 0.7;
      const posX     = Math.cos(ang) * clusterR;
      const posZ     = Math.sin(ang) * clusterR;
      const centerY  = height * 0.5;

      // Initial tube instance matrix
      _scaleA.set(radius, height, radius);
      _quatA.identity();
      _vec3A.set(posX, centerY, posZ);
      _mat4A.compose(_vec3A, _quatA, _scaleA);
      tubeMesh.setMatrixAt(i, _mat4A);

      // Opening ring matrix
      const openY = centerY + height * 0.5;
      _scaleA.set(radius, radius, radius);
      _euler.set(Math.PI * 0.5, 0, 0);
      _quatA.setFromEuler(_euler);
      _vec3A.set(posX, openY, posZ);
      _mat4A.compose(_vec3A, _quatA, _scaleA);
      openMesh.setMatrixAt(i, _mat4A);

      const currentTube = {
        posX, posZ, centerY, openY,
        radius, height,
        phase: Math.random() * TWO_PI,
        rx: 0, rz: 0,
        vx: 0, vz: 0,
        frills: [],
        fringe: [],
        worms: [],
      };
      tubeData.push(currentTube);

      // Crown frills (near + medium)
      if (profile.frills) {
        const frillMat = this._createFrillMaterial(tierName, i);
        frillMats.push(frillMat);
        for (let crossIdx = 0; crossIdx < 2; crossIdx++) {
          const fg = new THREE.PlaneGeometry(radius * 3.5, 0.25, profile.frillW, profile.frillH);
          fg.rotateX(-Math.PI * 0.5);
          if (crossIdx === 1) fg.rotateY(Math.PI * 0.5);
          const fm = new THREE.Mesh(fg, frillMat);
          fm.position.set(posX, openY + 0.04, posZ);
          tierGroup.add(fm);
          currentTube.frills.push(fm);
        }
      }

      // Tentacle fringe around tube opening (near only) — stored for flutter animation
      if (profile.fringe) {
        for (let f = 0; f < 7; f++) {
          const fa  = (f / 7) * TWO_PI + Math.random() * 0.2;
          const fg2 = new THREE.CylinderGeometry(
            radius * 0.11, radius * 0.055,
            0.14 + Math.random() * 0.1, 5
          );
          const fm2 = new THREE.Mesh(fg2, openingMat);
          const fr  = radius * 1.08;
          const brX = Math.sin(fa) * 0.42;
          const brZ = Math.cos(fa) * 0.42;
          fm2.position.set(posX + Math.cos(fa) * fr, openY + 0.09, posZ + Math.sin(fa) * fr);
          fm2.rotation.z = brZ;
          fm2.rotation.x = brX;
          tierGroup.add(fm2);
          const fringeData = {
            mesh: fm2,
            baseRotX: brX,
            baseRotZ: brZ,
            angle: fa,
            offsetX: Math.cos(fa) * fr,
            offsetY: 0.09,
            offsetZ: Math.sin(fa) * fr,
            phase: Math.random() * TWO_PI,
          };
          fringeMeshes.push(fringeData);
          currentTube.fringe.push(fringeData);
        }
      }

      // Worms emerging from tube openings (near only)
      if (profile.worms && Math.random() > 0.35) {
        const wd = this._buildWorm(radius, i, posX, openY, posZ, tierGroup);
        if (wd) {
          this.worms.push(wd.mesh);  // backward-compat
          wormData.push(wd);
          currentTube.worms.push(wd);
        }
      }
    }

    tubeMesh.instanceMatrix.needsUpdate = true;
    openMesh.instanceMatrix.needsUpdate = true;
    tierGroup.add(tubeMesh);
    tierGroup.add(openMesh);

    if (tierName === 'near') this._wormData = wormData;

    return { group: tierGroup, tubeMesh, openMesh, tubeData, frillMats, fringeMeshes,
             frillGlow, particles, base, profile };
  }

  _buildFarTier(profile, tierGroup) {
    const tubeMatSource = new THREE.MeshPhysicalMaterial({
      color: 0x151522, roughness: 0.55, metalness: 0,
      emissive: 0x1e2e40, emissiveIntensity: 0.2,
    });
    const farMat = toStandardMaterial(tubeMatSource);
    tubeMatSource.dispose();

    const geometries = [];

    const baseGeo = new THREE.CylinderGeometry(1.5, 2, 0.8, profile.baseRadSegs, profile.baseHtSegs);
    const basePos = baseGeo.attributes.position;
    for (let v = 0; v < basePos.count; v++) {
      const y = basePos.getY(v);
      const angle = Math.atan2(basePos.getZ(v), basePos.getX(v));
      const bump = Math.sin(angle * 5 + y * 3) * 0.05;
      basePos.setX(v, basePos.getX(v) * (1 + bump * 0.25));
      basePos.setZ(v, basePos.getZ(v) * (1 + bump * 0.25));
    }
    baseGeo.computeVertexNormals();
    geometries.push(baseGeo);

    const tubeCount = profile.tubeCountMin
      + Math.floor(Math.random() * (profile.tubeCountMax - profile.tubeCountMin + 1));

    for (let i = 0; i < tubeCount; i++) {
      const height = 1.5 + Math.random() * 3.5;
      const radius = 0.08 + Math.random() * 0.1;
      const angle = (i / tubeCount) * TWO_PI + Math.random() * 0.3;
      const clusterR = 0.3 + Math.random() * 0.7;
      const posX = Math.cos(angle) * clusterR;
      const posZ = Math.sin(angle) * clusterR;

      const tubeGeo = new THREE.CylinderGeometry(
        radius,
        radius * 1.2,
        height,
        profile.tubeRadSegs,
        profile.tubeHtSegs
      );
      tubeGeo.translate(posX, height * 0.5, posZ);
      geometries.push(tubeGeo);
    }

    const mergedGeo = mergeGeometries(geometries, false);
    mergedGeo.computeVertexNormals();
    mergedGeo.computeBoundingSphere();

    let farUniforms = null;
    if (profile.animInterval < 9999) {
      farUniforms = { uFarTime: uniform(0) };
      farMat.userData.shaderUniforms = farUniforms;

      const tcHeight = tslMax(positionLocal.y, 0.0);
      const tcPulse = sin(farUniforms.uFarTime.mul(0.55)).mul(0.012).add(1.0);
      const swayX = sin(farUniforms.uFarTime.mul(0.7)
        .add(positionLocal.y.mul(1.8)).add(positionLocal.z.mul(0.6)))
        .mul(0.018).mul(tcHeight);
      const swayZ = cos(farUniforms.uFarTime.mul(0.5)
        .add(positionLocal.y.mul(1.6)).add(positionLocal.x.mul(0.6)))
        .mul(0.018).mul(tcHeight);

      farMat.positionNode = vec3(
        positionLocal.x.mul(tcPulse).add(swayX),
        positionLocal.y,
        positionLocal.z.mul(tcPulse).add(swayZ)
      );
      farMat.needsUpdate = true;
    }

    const farMesh = new THREE.Mesh(mergedGeo, farMat);
    tierGroup.add(farMesh);

    return {
      group: tierGroup,
      tubeMesh: null,
      openMesh: null,
      tubeData: [],
      frillMats: [],
      frillGlow: null,
      fringeMeshes: [],
      particles: null,
      base: farMesh,
      farUniforms,
      profile,
    };
  }

  // ── Substrate particles — vertex-shader driven, no CPU buffer updates ─────

  _buildParticles() {
    const count = 28;
    const positions = new Float32Array(count * 3);
    const phases    = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TWO_PI;
      const r = 0.4 + Math.random() * 1.6;
      positions[i * 3]     = Math.cos(a) * r;
      positions[i * 3 + 1] = -0.35 + Math.random() * 0.5;
      positions[i * 3 + 2] = Math.sin(a) * r;
      phases[i] = Math.random() * TWO_PI;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aPhase',   new THREE.BufferAttribute(phases, 1));

    const uniforms = { uTime: uniform(0) };
    const aPhaseAttr = attribute('aPhase');

    const mat = new THREE.PointsMaterial({
      size: 2.5,
      sizeAttenuation: true,
      transparent: true,
      depthWrite: false,
      alphaTest: 0.01,
    });

    // Vertex: bob animation
    mat.positionNode = positionLocal.add(vec3(
      cos(uniforms.uTime.mul(0.3).add(aPhaseAttr.mul(1.3))).mul(0.03),
      sin(uniforms.uTime.mul(0.4).add(aPhaseAttr)).mul(0.04),
      sin(uniforms.uTime.mul(0.25).add(aPhaseAttr.mul(0.7))).mul(0.03)
    ));

    // Fragment: soft disc with linearized color
    mat.colorNode = pow(vec3(0.4, 0.5, 0.6), vec3(2.2));
    mat.opacityNode = tslFloat(0.5).sub(pointUV.sub(0.5).length());

    return { mesh: new THREE.Points(geo, mat), uniforms };
  }

  // ── Crown frill material with radial wave vertex shader ───────────────────

  _createFrillMaterial(tierName, tubeIdx) {
    const uniforms = {
      uFrillTime:  uniform(0.0),
      uFrillPhase: uniform(tubeIdx * 1.7),
    };
    const baseEmissiveIntensity = 0.55;

    const mat = new THREE.MeshPhysicalMaterial({
      color: 0x181030, roughness: 0.2, metalness: 0,
      transparent: true, opacity: 0.72,
      emissive: 0x50208a, emissiveIntensity: baseEmissiveIntensity,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    mat.userData.shaderUniforms = uniforms;
    mat.userData.baseEmissiveIntensity = baseEmissiveIntensity;

    // TSL vertex: radial wave displacement on Y
    const frillDist = vec2(positionLocal.x, positionLocal.z).length();
    const wave = sin(frillDist.mul(10.0).sub(uniforms.uFrillTime.mul(4.2)).add(uniforms.uFrillPhase))
      .mul(0.026).mul(frillDist);
    mat.positionNode = vec3(positionLocal.x, positionLocal.y.add(wave), positionLocal.z);
    mat.needsUpdate = true;

    return mat;
  }

  // ── Worm construction: TubeGeometry + CatmullRomCurve3 + emergence shader ──

  _buildWorm(tubeRadius, index, posX, openY, posZ, parent) {
    const wormLen    = 0.55 + Math.random() * 0.35;
    const bendAmp    = 0.04 + Math.random() * 0.05;
    const wormSegs   = 14;
    const wormRadial = 8;
    const phase      = index * 2.1;

    // Organic CatmullRomCurve3 from tube opening upward
    const pts = [];
    for (let k = 0; k <= 5; k++) {
      const t = k / 5;
      pts.push(new THREE.Vector3(
        Math.sin(phase + t * 1.4) * bendAmp * t,
        t * wormLen,
        Math.cos(phase + t * 0.9) * bendAmp * t
      ));
    }
    const curve   = new THREE.CatmullRomCurve3(pts);
    const wormGeo = new THREE.TubeGeometry(curve, wormSegs, tubeRadius * 0.58, wormRadial, false);

    const posAttr = wormGeo.attributes.position;
    const extArr  = new Float32Array(posAttr.array);

    // Retracted positions: all vertices collapse inside the tube
    const retractDepth = 0.35;
    const retArr = new Float32Array(posAttr.count * 3);
    for (let v = 0; v < posAttr.count; v++) {
      retArr[v * 3]     = 0;
      retArr[v * 3 + 1] = -retractDepth;
      retArr[v * 3 + 2] = 0;
    }

    wormGeo.setAttribute('aExtPos', new THREE.BufferAttribute(extArr, 3));
    wormGeo.setAttribute('aRetPos', new THREE.BufferAttribute(retArr, 3));

    const wormUniforms = {
      uWormPhase:    uniform(0.0),
      uFeedingPhase: uniform(0.0),
      uWormLength:   uniform(wormLen),
    };

    const wormMat = new THREE.MeshPhysicalMaterial({
      color: 0x20102c, roughness: 0.22, metalness: 0,
      clearcoat: 0.8, clearcoatRoughness: 0.1,
      transparent: true, opacity: 0.88,
      transmission: 0.25, thickness: 0.3,
      emissive: 0x401860, emissiveIntensity: 0.5,
      normalMap: getWormBristleTex(),
      normalScale: new THREE.Vector2(0.4, 0.4),
    });

    wormMat.userData.shaderUniforms = wormUniforms;

    // TSL vertex: emergence blending + figure-8 feeding sweep
    const aExtPos = attribute('aExtPos');
    const aRetPos = attribute('aRetPos');

    // First blend to compute tip factor
    const blend1 = tslMix(aRetPos, aExtPos, wormUniforms.uWormPhase);
    const tipFactor = tslClamp(
      blend1.y.div(tslMax(wormUniforms.uWormLength, 0.001)), 0.0, 1.0
    );

    // Second blend with tip-adjusted phase (tip emerges first)
    const adjustedPhase = tslClamp(
      wormUniforms.uWormPhase.mul(tslFloat(1.0).add(tipFactor.mul(0.6))), 0.0, 1.0
    );
    const blended = tslMix(aRetPos, aExtPos, adjustedPhase);

    // Figure-8 feeding sweep concentrated at extended tip
    const sweep = tipFactor.mul(tipFactor).mul(wormUniforms.uWormPhase);
    const feedX = sin(wormUniforms.uFeedingPhase).mul(0.09).mul(sweep);
    const feedZ = sin(wormUniforms.uFeedingPhase.mul(2.0).add(1.0)).mul(0.06).mul(sweep);

    wormMat.positionNode = blended.add(vec3(feedX, 0.0, feedZ));

    // TSL fragment: Fresnel rim-light (blue-teal silhouette in dark zone)
    const viewDir = positionView.negate().normalize();
    const tcFresnel = pow(sub(1.0, tslMax(dot(normalView, viewDir), 0.0)), 3.0);
    wormMat.emissiveNode = materialEmissive.add(vec3(0.2, 0.6, 1.0).mul(tcFresnel).mul(0.55));
    wormMat.needsUpdate = true;

    const mesh = new THREE.Mesh(wormGeo, wormMat);
    mesh.position.set(posX, openY, posZ);
    parent.add(mesh);

    // Bioluminescent tip sphere — position tracks emergencePhase in _updateWorms
    const tipMat = new THREE.MeshStandardMaterial({
      color: 0x00ffcc, emissive: 0x00cc88, emissiveIntensity: 1.8,
      roughness: 0.4, metalness: 0,
    });
    const tipGeo  = new THREE.SphereGeometry(tubeRadius * 0.42, 7, 6);
    const tipMesh = new THREE.Mesh(tipGeo, tipMat);
    tipMesh.position.copy(pts[0]);  // start at worm base; position updated each frame
    mesh.add(tipMesh);

    // extTip: fully-extended tip offset in worm-local space (used for tip tracking
    // and symbiotic interaction proximity tests)
    const extTip = pts[5].clone();

    return {
      tubeIndex: index,
      mesh, tipMesh, tipMat, wormMat, pts, extTip,
      emergencePhase: 0.0,
      extendRate:   0.28 + Math.random() * 0.18,
      retractRate:  1.4  + Math.random() * 0.6,
      schedule:     Math.random() * TWO_PI,
      reemergenceDelay:  0,
      pendingRecoilDelay: 0,  // set before retracting; applied when retraction finishes
      state: 'extending',     // 'extending'|'feeding'|'retracting'|'retracted'
      feedingPhase: Math.random() * TWO_PI,
    };
  }

  // ── Main update ───────────────────────────────────────────────────────────

  update(dt, playerPos) {
    this.time += dt;
    this._frameCount++;
    this._refreshFarTierIfNeeded();

    const dist = this.group.position.distanceTo(playerPos);

    // Respawn when too far away
    if (dist > 200) {
      const a = Math.random() * TWO_PI;
      this.group.position.set(
        playerPos.x + Math.cos(a) * 80,
        playerPos.y,
        playerPos.z + Math.sin(a) * 80
      );
      return;
    }

    const tierName = this._getVisibleTierName();
    this._lastLodTier = tierName;
    const tier    = this.tiers[tierName];
    // Use the actual profile stored in the tier (may be FAR_ULTRA_PROFILE)
    const profile = tier.profile;

    const t = this.time;

    // Player proximity — trigger worm retraction; re-emergence uses staged delays
    const nearPlayer = dist < 9;
    if (nearPlayer && !this._playerNear) {
      this._playerNear = true;
      for (const wd of this._wormData) wd.state = 'retracting';
    } else if (!nearPlayer && this._playerNear) {
      this._playerNear = false;
      let delay = 0;
      for (const wd of this._wormData) {
        // Let the worm retract smoothly; apply delay once retraction finishes
        wd.pendingRecoilDelay = delay;
        wd.state = 'retracting';
        delay += MIN_REEMERGENCE_DELAY + Math.random() * MAX_REEMERGENCE_DELAY;
      }
    }

    if (this._wormData.length > 0) {
      this._updateWorms(dt, t, nearPlayer);
    }

    if (!tier || this._frameCount % profile.animInterval !== 0) return;

    // Far LOD stays merged and static except for Ultra, where the silhouette uses
    // vertex-shader-only motion and the CPU only refreshes the time uniform.
    if (tier.farUniforms) {
      tier.farUniforms.uFarTime.value = t;
    } else if (tier.tubeMesh && tier.tubeData.length > 0) {
      // Tube sway — damped spring + opening ring co-update
      this._updateTubeSway(dt, tier, t);
    }

    if (tierName === 'near') {
      this._syncWormVisuals(t);
      this._updateFrillFeedingGlow(tier, t);
      // Symbiotic interaction — occasional check
      if (this._frameCount % SYMBIOTIC_CHECK_EVERY === 0) {
        this._checkSymbioticInteraction();
      }
      // Substrate particle time
      if (tier.particles) tier.particles.uniforms.uTime.value = t;
    }

    // Crown frill wave — update uFrillTime for each frill material
    for (const fm of tier.frillMats) {
      if (fm.userData.shaderUniforms) fm.userData.shaderUniforms.uFrillTime.value = t;
    }

    // Breathing: subtle base scale pulse
    if (!tier.farUniforms) {
      const breath = 1 + Math.sin(t * 0.38) * 0.012;
      tier.base.scale.set(breath, 1, breath);
    }
  }

  // ── Tube sway: damped spring, co-updates openMesh to track tube tops ──────

  _updateTubeSway(dt, tier, t) {
    const { tubeMesh, openMesh, tubeData } = tier;
    const dtc = Math.min(dt, MAX_PHYSICS_DT);

    for (let i = 0; i < tubeData.length; i++) {
      const td = tubeData[i];

      const cx = Math.sin(t * 0.68 + td.phase * 2.1) * 0.055;
      const cz = Math.cos(t * 0.52 + td.phase * 3.3) * 0.055;

      td.vx += (cx - td.rx) * TUBE_SWAY_STIFFNESS * dtc - td.vx * TUBE_SWAY_DAMPING * dtc;
      td.vz += (cz - td.rz) * TUBE_SWAY_STIFFNESS * dtc - td.vz * TUBE_SWAY_DAMPING * dtc;
      td.rx += td.vx * dtc;
      td.rz += td.vz * dtc;

      const pulse = 1 + Math.sin(t * 0.41 + td.phase) * 0.014;

      // Tube body matrix
      _euler.set(td.rx, 0, td.rz);
      _quatA.setFromEuler(_euler);
      _scaleA.set(td.radius * pulse, td.height, td.radius * pulse);
      _vec3A.set(td.posX, td.centerY, td.posZ);
      _mat4A.compose(_vec3A, _quatA, _scaleA);
      tubeMesh.setMatrixAt(i, _mat4A);

      // Opening ring matrix — track the tilted tube top so rings stay attached
      if (openMesh) {
        _vec3B.set(0, td.height * 0.5, 0).applyQuaternion(_quatA).add(_vec3A);
        _euler.set(Math.PI * 0.5, 0, 0);
        _quatB.setFromEuler(_euler);
        _quatB.premultiply(_quatA);
        _scaleB.set(td.radius * pulse, td.radius * pulse, td.radius * pulse);
        _mat4B.compose(_vec3B, _quatB, _scaleB);
        openMesh.setMatrixAt(i, _mat4B);
      }

      for (const frill of td.frills) {
        frill.position.copy(_vec3B);
        frill.quaternion.copy(_quatA);
        frill.scale.set(pulse, 1, pulse);
      }

      for (const fringeData of td.fringe) {
        const flutter = Math.sin(t * 2.1 + fringeData.phase) * 0.15;
        const localRotX = fringeData.baseRotX + flutter * Math.sin(fringeData.angle);
        const localRotZ = fringeData.baseRotZ + flutter * Math.cos(fringeData.angle);

        _vec3C.set(
          fringeData.offsetX * pulse,
          fringeData.offsetY,
          fringeData.offsetZ * pulse
        ).applyQuaternion(_quatA).add(_vec3B);

        _euler.set(localRotX, 0, localRotZ);
        _quatC.setFromEuler(_euler);
        _quatC.premultiply(_quatA);

        fringeData.mesh.position.copy(_vec3C);
        fringeData.mesh.quaternion.copy(_quatC);
      }

      for (const wormData of td.worms) {
        wormData.mesh.position.copy(_vec3B);
        wormData.mesh.quaternion.copy(_quatA);
        wormData.mesh.scale.set(pulse, 1, pulse);
      }
    }

    tubeMesh.instanceMatrix.needsUpdate = true;
    openMesh.instanceMatrix.needsUpdate = true;
  }

  _updateFrillFeedingGlow(tier, t) {
    if (!tier.frillMats.length || !tier.frillGlow) return;

    const glowByTube = tier.frillGlow;
    glowByTube.fill(0);

    for (const wd of this._wormData) {
      // tubeIndex may exceed frillMats if fewer frills than tubes (unlikely, but defensive)
      if (wd.tubeIndex >= glowByTube.length || wd.state !== 'feeding') continue;

      const glowPulse = 0.5 + 0.5 * Math.sin(wd.feedingPhase * 1.15 + t * 2.0);
      const glow = wd.emergencePhase * (0.35 + glowPulse * 0.55);
      glowByTube[wd.tubeIndex] = Math.max(glowByTube[wd.tubeIndex], glow);
    }

    for (let i = 0; i < tier.frillMats.length; i++) {
      const frillMat = tier.frillMats[i];
      const baseIntensity = frillMat.userData.baseEmissiveIntensity ?? 0.55;
      frillMat.emissiveIntensity = baseIntensity + glowByTube[i];
    }
  }

  // ── Symbiotic interaction: worm-tip proximity causes recoil ──────────────

  _getWormTipLocalPosition(wormData, target) {
    target.lerpVectors(wormData.pts[0], wormData.extTip, wormData.emergencePhase);
    const sweep = wormData.emergencePhase;
    target.x += Math.sin(wormData.feedingPhase) * 0.09 * sweep;
    target.z += Math.sin(wormData.feedingPhase * 2.0 + 1.0) * 0.06 * sweep;
    return target;
  }

  _getWormTipWorldPosition(wormData, target) {
    this._getWormTipLocalPosition(wormData, target);
    wormData.mesh.updateMatrixWorld(true);
    return wormData.mesh.localToWorld(target);
  }

  _checkSymbioticInteraction() {
    const worms = this._wormData;
    for (let i = 0; i < worms.length; i++) {
      const wa = worms[i];
      if (wa.state !== 'feeding') continue;
      this._getWormTipWorldPosition(wa, _vec3A);
      for (let j = i + 1; j < worms.length; j++) {
        const wb = worms[j];
        if (wb.state !== 'feeding') continue;
        this._getWormTipWorldPosition(wb, _vec3B);
        const d2 = _vec3A.distanceToSquared(_vec3B);
        if (d2 < SYMBIOTIC_PROXIMITY_SQ) {
          // Recoil: the contacted worm retracts, then re-emerges after a short delay
          wb.pendingRecoilDelay = MIN_REEMERGENCE_DELAY + Math.random() * 0.8;
          wb.state = 'retracting';
          break;
        }
      }
    }
  }

  // ── Worm emergence state machine ──────────────────────────────────────────

  _syncWormVisuals(t) {
    for (let i = 0; i < this._wormData.length; i++) {
      const wd = this._wormData[i];

      if (wd.wormMat.userData.shaderUniforms) {
        const u = wd.wormMat.userData.shaderUniforms;
        u.uWormPhase.value = wd.emergencePhase;
        u.uFeedingPhase.value = wd.feedingPhase;
      }

      wd.tipMesh.visible = wd.emergencePhase > 0.05;
      if (wd.tipMesh.visible) {
        this._getWormTipLocalPosition(wd, wd.tipMesh.position);
        const s = wd.emergencePhase;
        wd.tipMesh.scale.set(s, s, s);
        wd.tipMat.emissiveIntensity = 1.0 + wd.emergencePhase
          * (0.8 + Math.sin(t * 3.1 + i) * 0.5);
      }
    }
  }

  _updateWorms(dt, t, nearPlayer) {
    for (let i = 0; i < this._wormData.length; i++) {
      const wd = this._wormData[i];

      switch (wd.state) {
        case 'retracted':
          if (!nearPlayer) {
            if (wd.reemergenceDelay > 0) {
              wd.reemergenceDelay -= dt;
            } else {
              wd.state = 'extending';
            }
          }
          break;

        case 'extending':
          wd.emergencePhase = Math.min(1, wd.emergencePhase + dt * wd.extendRate);
          if (wd.emergencePhase >= 1) wd.state = 'feeding';
          break;

        case 'feeding':
          wd.feedingPhase += dt * (1.1 + Math.sin(t * 0.3 + wd.schedule) * 0.25);
          if (nearPlayer) wd.state = 'retracting';
          break;

        case 'retracting':
          wd.emergencePhase = Math.max(0, wd.emergencePhase - dt * wd.retractRate);
          if (wd.emergencePhase <= 0) {
            wd.state = 'retracted';
            // Apply any pending delay (from player proximity or symbiotic recoil)
            wd.reemergenceDelay = wd.pendingRecoilDelay;
            wd.pendingRecoilDelay = 0;
          }
          break;
      }
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  getPosition() { return this.group.position; }

  dispose() {
    this.scene.remove(this.group);
    this._disposeObjectTree(this.group);
  }
}
