import * as THREE from 'three';
import { LOD_NEAR_DISTANCE, LOD_MEDIUM_DISTANCE, toStandardMaterial } from './lodUtils.js';

const TWO_PI = Math.PI * 2;

// ── Physics / animation tuning constants ─────────────────────────────────────
const TUBE_SWAY_STIFFNESS     = 2.2;   // spring stiffness for current-driven sway
const TUBE_SWAY_DAMPING       = 0.85;  // damping ratio for sway spring
const MAX_PHYSICS_DT          = 0.05;  // maximum physics timestep (s) to prevent large steps
const MIN_REEMERGENCE_DELAY   = 0.5;   // minimum per-worm re-emergence delay after player leaves (s)
const MAX_REEMERGENCE_DELAY   = 1.1;   // maximum additional random delay on top of minimum (s)

// ── Pre-allocated temporaries — zero per-frame allocations ───────────────────
const _mat4   = new THREE.Matrix4();
const _vec3A  = new THREE.Vector3();
const _quat   = new THREE.Quaternion();
const _scaleV = new THREE.Vector3();
const _euler  = new THREE.Euler();

// ── LOD tier profiles ─────────────────────────────────────────────────────────
// Near (0-42m): full detail — all tubes, worms, frills, barnacles, full animation
// Medium (42-86m): ~50% tubes, frills, simplified sway, no worms
// Far (86m+): minimal static silhouette, no animation
const LOD_PROFILES = {
  near: {
    tubeCountMin: 7, tubeCountMax: 10,
    tubeRadSegs: 18, tubeHtSegs: 12,
    baseRadSegs: 24, baseHtSegs: 8,
    worms: true, frills: true, barnacles: true, fringe: true,
    frillW: 12, frillH: 6,
    animInterval: 1,
  },
  medium: {
    tubeCountMin: 4, tubeCountMax: 6,
    tubeRadSegs: 10, tubeHtSegs: 6,
    baseRadSegs: 14, baseHtSegs: 4,
    worms: false, frills: true, barnacles: false, fringe: false,
    frillW: 6, frillH: 3,
    animInterval: 3,
  },
  far: {
    tubeCountMin: 3, tubeCountMax: 4,
    tubeRadSegs: 6, tubeHtSegs: 2,
    baseRadSegs: 8, baseHtSegs: 2,
    worms: false, frills: false, barnacles: false, fringe: false,
    frillW: 0, frillH: 0,
    animInterval: 9999,
  },
};

// ── Shared singleton canvas textures (created once, never disposed) ───────────

let _growthRingTex = null;
let _barnaclesTex  = null;
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
      // Horizontal growth rings + light nodule bumps
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

// ── LOD tier names map (matches addLevel insertion order) ─────────────────────
const TIER_NAMES = ['near', 'medium', 'far'];

// ── TubeCluster ───────────────────────────────────────────────────────────────
// Stationary deep-zone tube worm colony — organic worm cluster at 150m+ depth
export class TubeCluster {
  constructor(scene, position) {
    this.scene  = scene;
    this.group  = new THREE.Group();
    this.time   = Math.random() * 100;
    this.worms  = [];  // backward-compat: worm meshes from near tier

    this._instanceId  = Math.floor(Math.random() * 1e9);
    this._frameCount  = 0;
    this._lastLodTier = 'near';
    this._playerNear  = false;
    this._wormData    = [];   // per-worm state (near tier)
    this.tiers        = {};

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

  // ── Model construction ────────────────────────────────────────────────────

  _buildModel() {
    const lod = new THREE.LOD();
    for (const [tierName, profile] of Object.entries(LOD_PROFILES)) {
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

    // ── Materials ────────────────────────────────────────────────────────────
    const tubeMat = isFar
      ? toStandardMaterial(new THREE.MeshPhysicalMaterial({
          color: 0x151522, roughness: 0.55, metalness: 0,
          emissive: 0x1e2e40, emissiveIntensity: 0.2,
        }))
      : new THREE.MeshPhysicalMaterial({
          color: 0x181826, roughness: 0.3, metalness: 0.04,
          clearcoat: 0.6, clearcoatRoughness: 0.25,
          emissive: 0x1e3050, emissiveIntensity: 0.25,
          normalMap: getGrowthRingTex(),
          normalScale: new THREE.Vector2(0.8, 0.8),
        });

    const baseMat = isFar
      ? toStandardMaterial(new THREE.MeshPhysicalMaterial({
          color: 0x10101a, roughness: 0.8, metalness: 0,
          emissive: 0x101828, emissiveIntensity: 0.1,
        }))
      : new THREE.MeshPhysicalMaterial({
          color: 0x141420, roughness: 0.72, metalness: 0.04,
          emissive: 0x181832, emissiveIntensity: 0.14,
          normalMap: getBarnaclesTex(),
          normalScale: new THREE.Vector2(0.6, 0.6),
        });

    const openingMat = isFar ? baseMat : new THREE.MeshPhysicalMaterial({
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

    // ── Tubes (InstancedMesh — single draw call) ──────────────────────────────
    const tubeCount = profile.tubeCountMin
      + Math.floor(Math.random() * (profile.tubeCountMax - profile.tubeCountMin + 1));

    // Normalized cylinder (radius=1, height=1); instances scale per-tube
    const instGeo = new THREE.CylinderGeometry(1, 1.2, 1, profile.tubeRadSegs, profile.tubeHtSegs);

    // Growth ring displacement baked into geometry (near/medium)
    if (!isFar) {
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
    }

    const tubeMesh = new THREE.InstancedMesh(instGeo, tubeMat, tubeCount);
    tubeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    // Opening rings — InstancedMesh
    const openGeo  = new THREE.TorusGeometry(1.1, 0.15, 6, isFar ? 8 : 12);
    const openMesh = new THREE.InstancedMesh(openGeo, openingMat, tubeCount);

    const tubeData  = [];
    const frillMats = [];
    const wormData  = [];

    for (let i = 0; i < tubeCount; i++) {
      const height    = 1.5 + Math.random() * 3.5;
      const radius    = 0.08 + Math.random() * 0.1;
      const ang       = (i / tubeCount) * TWO_PI + Math.random() * 0.3;
      const clusterR  = 0.3 + Math.random() * 0.7;
      const posX      = Math.cos(ang) * clusterR;
      const posZ      = Math.sin(ang) * clusterR;
      const centerY   = height * 0.5;  // tube body centre

      // Set initial tube instance matrix
      _scaleV.set(radius, height, radius);
      _quat.identity();
      _vec3A.set(posX, centerY, posZ);
      _mat4.compose(_vec3A, _quat, _scaleV);
      tubeMesh.setMatrixAt(i, _mat4);

      // Opening ring matrix (at tube top, rotated flat)
      const openY = centerY + height * 0.5;
      _scaleV.set(radius, radius, radius);
      _euler.set(Math.PI * 0.5, 0, 0);
      _quat.setFromEuler(_euler);
      _vec3A.set(posX, openY, posZ);
      _mat4.compose(_vec3A, _quat, _scaleV);
      openMesh.setMatrixAt(i, _mat4);

      tubeData.push({
        posX, posZ, centerY, openY,
        radius, height,
        phase: Math.random() * TWO_PI,
        rx: 0, rz: 0,
        vx: 0, vz: 0,
      });

      // Crown frills (near + medium)
      if (profile.frills) {
        const frillMat = this._createFrillMaterial(tierName, i);
        frillMats.push(frillMat);

        // Two crossed planes for crown frill effect
        for (let crossIdx = 0; crossIdx < 2; crossIdx++) {
          const fg = new THREE.PlaneGeometry(radius * 3.5, 0.25, profile.frillW, profile.frillH);
          fg.rotateX(-Math.PI * 0.5);
          if (crossIdx === 1) fg.rotateY(Math.PI * 0.5);
          const fm = new THREE.Mesh(fg, frillMat);
          fm.position.set(posX, openY + 0.04, posZ);
          tierGroup.add(fm);
        }
      }

      // Tentacle fringe around tube opening (near only)
      if (profile.fringe) {
        for (let f = 0; f < 7; f++) {
          const fa = (f / 7) * TWO_PI + Math.random() * 0.2;
          const fg2 = new THREE.CylinderGeometry(
            radius * 0.11, radius * 0.055,
            0.14 + Math.random() * 0.1, 5
          );
          const fm2 = new THREE.Mesh(fg2, openingMat);
          const fr  = radius * 1.08;
          fm2.position.set(posX + Math.cos(fa) * fr, openY + 0.09, posZ + Math.sin(fa) * fr);
          fm2.rotation.z = Math.cos(fa) * 0.42;
          fm2.rotation.x = Math.sin(fa) * 0.42;
          tierGroup.add(fm2);
        }
      }

      // Worms emerging from tube openings (near only)
      if (profile.worms && Math.random() > 0.35) {
        const wd = this._buildWorm(radius, height, i,
          posX, openY, posZ, tierGroup);
        if (wd) {
          this.worms.push(wd.mesh);  // backward-compat
          wormData.push(wd);
        }
      }
    }

    tubeMesh.instanceMatrix.needsUpdate = true;
    openMesh.instanceMatrix.needsUpdate = true;
    tierGroup.add(tubeMesh);
    tierGroup.add(openMesh);

    // Store per-worm data on near tier
    if (tierName === 'near') this._wormData = wormData;

    return { group: tierGroup, tubeMesh, openMesh, tubeData, frillMats, base, profile };
  }

  // ── Crown frill material with radial wave vertex shader ───────────────────

  _createFrillMaterial(tierName, tubeIdx) {
    const uniforms = {
      uFrillTime:  { value: 0.0 },
      uFrillPhase: { value: tubeIdx * 1.7 },
    };

    const mat = new THREE.MeshPhysicalMaterial({
      color: 0x181030, roughness: 0.2, metalness: 0,
      transparent: true, opacity: 0.72,
      emissive: 0x50208a, emissiveIntensity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    mat.userData.shaderUniforms = uniforms;

    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
uniform float uFrillTime;
uniform float uFrillPhase;`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
float frillDist = length(position.xz);
float wave = sin(frillDist * 10.0 - uFrillTime * 4.2 + uFrillPhase) * 0.026 * frillDist;
transformed.y += wave;`
        );
      mat.userData.shader = shader;
    };

    mat.customProgramCacheKey = () => `tc-frill-${tierName}`;
    return mat;
  }

  // ── Worm construction: TubeGeometry + CatmullRomCurve3 + emergence shader ──

  _buildWorm(tubeRadius, tubeHeight, index, posX, openY, posZ, parent) {
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

    // Store extended positions (curve surface)
    const posAttr    = wormGeo.attributes.position;
    const extArr     = new Float32Array(posAttr.array);

    // Retracted positions: all vertices collapse to a single point inside the tube
    const retractDepth = 0.35;
    const retArr = new Float32Array(posAttr.count * 3);
    for (let v = 0; v < posAttr.count; v++) {
      retArr[v * 3]     = 0;
      retArr[v * 3 + 1] = -retractDepth;
      retArr[v * 3 + 2] = 0;
    }

    wormGeo.setAttribute('aExtPos', new THREE.BufferAttribute(extArr, 3));
    wormGeo.setAttribute('aRetPos', new THREE.BufferAttribute(retArr, 3));

    // Worm material — translucent with subsurface, fresnel rim, animated emissive
    const wormUniforms = {
      uWormPhase:     { value: 0.0 },
      uFeedingPhase:  { value: 0.0 },
      uWormLength:    { value: wormLen },
    };

    const wormMat = new THREE.MeshPhysicalMaterial({
      color: 0x20102c, roughness: 0.22, metalness: 0,
      clearcoat: 0.8, clearcoatRoughness: 0.1,
      transparent: true, opacity: 0.88,
      transmission: 0.25, thickness: 0.3,
      emissive: 0x401860, emissiveIntensity: 0.5,
    });

    wormMat.userData.shaderUniforms = wormUniforms;

    const instId = this._instanceId;
    wormMat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, wormUniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute vec3 aExtPos;
attribute vec3 aRetPos;
uniform float uWormPhase;
uniform float uFeedingPhase;
uniform float uWormLength;`
        )
        .replace(
          '#include <begin_vertex>',
          `// Blend from retracted (inside tube) to extended (emerged) position
vec3 transformed = mix(aRetPos, aExtPos, uWormPhase);
// Tip emerges first: apply larger phase to upper vertices
float tipFactor = clamp(transformed.y / max(uWormLength, 0.001), 0.0, 1.0);
transformed = mix(aRetPos, aExtPos,
  clamp(uWormPhase * (1.0 + tipFactor * 0.6), 0.0, 1.0));
// Figure-8 feeding sweep concentrated at extended tip
float sweep = tipFactor * tipFactor * uWormPhase;
transformed.x += sin(uFeedingPhase)          * 0.09 * sweep;
transformed.z += sin(uFeedingPhase * 2.0 + 1.0) * 0.06 * sweep;
// Fresnel rim via varying (reuse built-in vViewPosition)`
        );
      wormMat.userData.shader = shader;
    };
    wormMat.customProgramCacheKey = () => `tc-worm-${instId}-${index}`;

    const mesh = new THREE.Mesh(wormGeo, wormMat);
    mesh.position.set(posX, openY, posZ);
    parent.add(mesh);

    // Bioluminescent tip sphere
    const tipMat = new THREE.MeshStandardMaterial({
      color: 0x00ffcc, emissive: 0x00cc88, emissiveIntensity: 1.8,
      roughness: 0.4, metalness: 0,
    });
    const tipGeo  = new THREE.SphereGeometry(tubeRadius * 0.42, 7, 6);
    const tipMesh = new THREE.Mesh(tipGeo, tipMat);
    tipMesh.position.set(pts[5].x, pts[5].y, pts[5].z);
    mesh.add(tipMesh);

    return {
      mesh, tipMesh, tipMat, wormMat,
      emergencePhase: 0.0,
      extendRate:  0.28 + Math.random() * 0.18,
      retractRate: 1.4  + Math.random() * 0.6,
      schedule:    Math.random() * TWO_PI,
      reemergenceDelay: 0,
      state: 'extending',   // 'extending'|'extended'|'feeding'|'retracting'|'retracted'
      feedingPhase: Math.random() * TWO_PI,
    };
  }

  // ── Main update ───────────────────────────────────────────────────────────

  update(dt, playerPos) {
    this.time += dt;
    this._frameCount++;

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
    const profile = LOD_PROFILES[tierName];

    if (!tier || this._frameCount % profile.animInterval !== 0) return;

    const t = this.time;

    // Player proximity — trigger worm retraction/re-emergence
    const nearPlayer = dist < 9;
    if (nearPlayer && !this._playerNear) {
      this._playerNear = true;
      for (const wd of this._wormData) wd.state = 'retracting';
    } else if (!nearPlayer && this._playerNear) {
      this._playerNear = false;
      let delay = 0;
      for (const wd of this._wormData) {
        wd.reemergenceDelay = delay;
        wd.state = 'retracted';
        delay += MIN_REEMERGENCE_DELAY + Math.random() * MAX_REEMERGENCE_DELAY;
      }
    }

    // Tube sway — damped spring, InstancedMesh matrix updates
    this._updateTubeSway(dt, tier, t);

    // Worm emergence/feeding/retraction (near tier)
    if (tierName === 'near' && this._wormData.length > 0) {
      this._updateWorms(dt, t, nearPlayer);
    }

    // Crown frill wave — update uFrillTime for each frill material
    for (const fm of tier.frillMats) {
      if (fm.userData.shaderUniforms) fm.userData.shaderUniforms.uFrillTime.value = t;
    }

    // Breathing: subtle base scale pulse
    const breath = 1 + Math.sin(t * 0.38) * 0.012;
    tier.base.scale.set(breath, 1, breath);
  }

  // ── Tube sway: damped spring, InstancedMesh matrix update ────────────────

  _updateTubeSway(dt, tier, t) {
    const { tubeMesh, tubeData } = tier;
    const dtc = Math.min(dt, MAX_PHYSICS_DT);

    for (let i = 0; i < tubeData.length; i++) {
      const td = tubeData[i];

      // Simulated water current perturbation
      const cx = Math.sin(t * 0.68 + td.phase * 2.1) * 0.055;
      const cz = Math.cos(t * 0.52 + td.phase * 3.3) * 0.055;

      // Damped spring toward current target
      td.vx += (cx - td.rx) * TUBE_SWAY_STIFFNESS * dtc - td.vx * TUBE_SWAY_DAMPING * dtc;
      td.vz += (cz - td.rz) * TUBE_SWAY_STIFFNESS * dtc - td.vz * TUBE_SWAY_DAMPING * dtc;
      td.rx += td.vx * dtc;
      td.rz += td.vz * dtc;

      // Growth rhythm pulse
      const pulse = 1 + Math.sin(t * 0.41 + td.phase) * 0.014;

      _euler.set(td.rx, 0, td.rz);
      _quat.setFromEuler(_euler);
      _scaleV.set(td.radius * pulse, td.height, td.radius * pulse);
      _vec3A.set(td.posX, td.centerY, td.posZ);
      _mat4.compose(_vec3A, _quat, _scaleV);
      tubeMesh.setMatrixAt(i, _mat4);
    }
    tubeMesh.instanceMatrix.needsUpdate = true;
  }

  // ── Worm emergence state machine ──────────────────────────────────────────

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
          if (wd.emergencePhase <= 0) wd.state = 'retracted';
          break;
      }

      // Upload emergence/feeding uniforms
      if (wd.wormMat.userData.shaderUniforms) {
        const u = wd.wormMat.userData.shaderUniforms;
        u.uWormPhase.value    = wd.emergencePhase;
        u.uFeedingPhase.value = wd.feedingPhase;
      }

      // Animate bioluminescent tip emissive
      wd.tipMat.emissiveIntensity = 1.0 + wd.emergencePhase
        * (0.8 + Math.sin(t * 3.1 + i) * 0.5);

      // Hide tip when fully retracted to avoid z-fighting inside tube
      wd.tipMesh.visible = wd.emergencePhase > 0.05;
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  getPosition() { return this.group.position; }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(c => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        // Skip module-level shared singleton textures
        if (c.material.map        && !_sharedTextures.has(c.material.map))        c.material.map.dispose();
        if (c.material.normalMap  && !_sharedTextures.has(c.material.normalMap))  c.material.normalMap.dispose();
        if (c.material.emissiveMap&& !_sharedTextures.has(c.material.emissiveMap))c.material.emissiveMap.dispose();
        c.material.dispose();
      }
    });
  }
}
