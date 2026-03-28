import * as THREE from 'three';
import { toStandardMaterial } from './lodUtils.js';
import { qualityManager } from '../QualityManager.js';

// ── Pre-allocated temps — zero per-frame allocations ─────────────────────────
const _v3A    = new THREE.Vector3();
const _v3B    = new THREE.Vector3();
const _v3C    = new THREE.Vector3();
const _v3Root = new THREE.Vector3();
const _qA     = new THREE.Quaternion();
const _upY    = new THREE.Vector3(0, 1, 0);

// ── Constants ─────────────────────────────────────────────────────────────────
const TWO_PI          = Math.PI * 2;
const RESPAWN_DISTANCE = 200;
const TENDRIL_SEG_LEN  = 0.55;
const FABRIK_ITERS     = 6;
const STALK_DISTANCE   = 60;
const STRIKE_DISTANCE  = 30;
const STRIKE_DURATION  = 0.35;
const RETRACT_DURATION = 0.7;
const EYE_SCAN_STEP         = 0.8;   // radians added per scan event
const PISTON_RATTLE         = 0.015; // position noise during strike
const TENDRIL_SPREAD_FACTOR = 1.5;   // max spread radius of tendril tips when idle (not seeking)

// Strike state IDs
const S_IDLE    = 0;
const S_STALK   = 1;
const S_STRIKE  = 2;
const S_RETRACT = 3;

// ── Creature-specific LOD thresholds ────────────────────────────────────────
// TendrilHunter's depth zone (Dark/Abyss, 250m+) has a fog far-plane of ~55m.
// Using the shared lodUtils constants (42/86) would keep the medium tier alive
// up to 86m — entirely fog-occluded — wasting GPU. Use tighter distances.
const TH_LOD_NEAR_DIST   = 30; // near  ↔ medium transition
const TH_LOD_MEDIUM_DIST = 55; // medium ↔ far transition (equals fog far-plane)
const LOD_PROFILE = {
  near: {
    headSegs:     [48, 32],
    mandibleSegs:  12,
    eyeSegs:      [16, 12],
    eyeCount:      4,
    abdomenSegs:  [24, 16],
    tendrilCount:  6,
    tendrilSegs:   6,
    tendrilRadial: 12,
    pistonSegs:    8,
    jointSegs:     8,
    hookSegs:      8,
    dorsalPlates:  5,
    hasIK:           true,
    hasCompoundEyes: true,
    hasMicroDetail:  true,
    hasChitinBands:  true,
    hasRimLight:     true,
  },
  medium: {
    headSegs:     [16, 12],
    mandibleSegs:  8,
    eyeSegs:      [8, 6],
    eyeCount:      4,
    abdomenSegs:  [14, 10],
    tendrilCount:  3,
    tendrilSegs:   4,
    tendrilRadial: 8,
    pistonSegs:    4,
    jointSegs:     6,
    hookSegs:      5,
    dorsalPlates:  3,
    hasIK:           false,
    hasCompoundEyes: false,
    hasMicroDetail:  false,
    hasChitinBands:  false,
    hasRimLight:     false,
  },
  far: {
    headSegs:     [8, 6],
    mandibleSegs:  0,
    eyeSegs:      [4, 4],
    eyeCount:      0,
    abdomenSegs:  [6, 4],
    tendrilCount:  0,
    tendrilSegs:   2,
    tendrilRadial: 4,
    pistonSegs:    0,
    jointSegs:     0,
    hookSegs:      0,
    dorsalPlates:  0,
    hasIK:           false,
    hasCompoundEyes: false,
    hasMicroDetail:  false,
    hasChitinBands:  false,
    hasRimLight:     false,
  },
};

// Maps THREE.LOD insertion order to tier name
const TIER_NAMES = ['near', 'medium', 'far'];

// ── Shared canvas-based normal textures (module-level singletons) ─────────────
let _chitinNormalTex = null;
let _pistonNormalTex = null;
let _eyeFacetTex     = null;

function _makeChitinNormalTexture() {
  if (_chitinNormalTex) return _chitinNormalTex;
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  const h = (u, v) => {
    const plate = Math.sin(u * 18 + Math.floor(v * 10) * 1.1) * 0.4
                + Math.sin(v * 14 + Math.floor(u * 8) * 0.9) * 0.3;
    const seam  = Math.abs(Math.sin(u * 24)) < 0.08 ? -0.5 : 0;
    const micro = Math.sin(u * 80 + v * 64) * 0.05 + Math.cos(u * 56 - v * 72) * 0.04;
    return plate + seam + micro;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size, d = 1 / size;
      const dx = h(u + d, v) - h(u - d, v);
      const dy = h(u, v + d) - h(u, v - d);
      const nx = -dx * 3, ny = -dy * 3, nz = 1;
      const len = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      const i = (y * size + x) * 4;
      data[i]   = Math.round((nx * len * 0.5 + 0.5) * 255);
      data[i+1] = Math.round((ny * len * 0.5 + 0.5) * 255);
      data[i+2] = Math.round((nz * len * 0.5 + 0.5) * 255);
      data[i+3] = 255;
    }
  }
  _chitinNormalTex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  _chitinNormalTex.wrapS = _chitinNormalTex.wrapT = THREE.RepeatWrapping;
  _chitinNormalTex.needsUpdate = true;
  return _chitinNormalTex;
}

function _makePistonNormalTexture() {
  if (_pistonNormalTex) return _pistonNormalTex;
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  const h = (u, v) => {
    const ring    = Math.sin(v * 28) * 0.35;
    const groove  = Math.sin(u * TWO_PI * 3) * 0.1;
    const scratch = Math.sin(u * 200 + v * 50) * 0.05;
    return ring + groove + scratch;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size, d = 1 / size;
      const dx = h(u + d, v) - h(u - d, v);
      const dy = h(u, v + d) - h(u, v - d);
      const nx = -dx * 2, ny = -dy * 2, nz = 1;
      const len = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      const i = (y * size + x) * 4;
      data[i]   = Math.round((nx * len * 0.5 + 0.5) * 255);
      data[i+1] = Math.round((ny * len * 0.5 + 0.5) * 255);
      data[i+2] = Math.round((nz * len * 0.5 + 0.5) * 255);
      data[i+3] = 255;
    }
  }
  _pistonNormalTex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  _pistonNormalTex.wrapS = _pistonNormalTex.wrapT = THREE.RepeatWrapping;
  _pistonNormalTex.needsUpdate = true;
  return _pistonNormalTex;
}

function _makeEyeFacetTexture() {
  if (_eyeFacetTex) return _eyeFacetTex;
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  const h = (u, v) => {
    const hex  = Math.sin(u * 32 + v * 18) * 0.3;
    const hex2 = Math.cos(u * 28 - v * 22) * 0.25;
    return hex + hex2;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size, d = 1 / size;
      const dx = h(u + d, v) - h(u - d, v);
      const dy = h(u, v + d) - h(u, v - d);
      const nx = -dx * 1.5, ny = -dy * 1.5, nz = 1;
      const len = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      const i = (y * size + x) * 4;
      data[i]   = Math.round((nx * len * 0.5 + 0.5) * 255);
      data[i+1] = Math.round((ny * len * 0.5 + 0.5) * 255);
      data[i+2] = Math.round((nz * len * 0.5 + 0.5) * 255);
      data[i+3] = 255;
    }
  }
  _eyeFacetTex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  _eyeFacetTex.wrapS = _eyeFacetTex.wrapT = THREE.RepeatWrapping;
  _eyeFacetTex.needsUpdate = true;
  return _eyeFacetTex;
}

// ── FABRIK IK solver (one full forward+backward pass) ─────────────────────────
// joints: Vector3[] in tendril-group local space — modified in place
// target: desired tip position (tendril-group local)
// segLen: fixed segment length to maintain
function _solveFABRIK(joints, target, segLen) {
  const n = joints.length - 1;
  _v3Root.copy(joints[0]); // save root

  // Forward pass: drag tip to target
  joints[n].copy(target);
  for (let i = n - 1; i >= 0; i--) {
    _v3A.subVectors(joints[i], joints[i + 1]).normalize().multiplyScalar(segLen);
    joints[i].addVectors(joints[i + 1], _v3A);
  }

  // Backward pass: restore root constraint
  joints[0].copy(_v3Root);
  for (let i = 0; i < n; i++) {
    _v3A.subVectors(joints[i + 1], joints[i]).normalize().multiplyScalar(segLen);
    joints[i + 1].addVectors(joints[i], _v3A);
  }
}

// ── TendrilHunter ─────────────────────────────────────────────────────────────
// Biomechanical predator with hydraulic tendrils that seek and grasp.
// Depth zone: Dark/Abyss (250m+). Fog far-plane ~55m.
export class TendrilHunter {
  constructor(scene, position) {
    this.scene     = scene;
    this.group     = new THREE.Group();
    this.time      = Math.random() * 100;
    this.speed     = 1.8 + Math.random() * 1.2;
    this.direction = new THREE.Vector3(
      Math.random() - 0.5, -0.1, Math.random() - 0.5
    ).normalize();
    this.turnTimer    = 0;
    this.turnInterval = 6 + Math.random() * 8;

    // Strike state machine
    this._state       = S_IDLE;
    this._stateTimer  = 0;
    this._strikePhase = 0; // 0→1 during STRIKE, 1→0 during RETRACT

    // Procedural variation
    this._abdomenPhase = Math.random() * TWO_PI;
    this._scanAngle    = Math.random() * TWO_PI;
    this._scanTimer    = 0;

    // Animation frame skip counter
    this._frameCount  = 0;
    this._lodTierName = 'near';

    // Near-tier animated refs (populated in _buildTier)
    this._tendrilIK         = []; // [{joints,segments,jointMeshes,hook,rootOffset,phase,segCount}]
    this._eyeGroups         = []; // [THREE.Group × 4]
    this._leftMandible      = null;
    this._rightMandible     = null;
    this._abdomenMesh       = null;
    this._nearEyeMat        = null; // shared eyeMat ref for animated emissive flicker

    // Medium-tier tendril refs for sinusoidal sway
    this._mediumTendrilData = []; // [{group, phase}]

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  // ── Resolve active LOD tier name from THREE.LOD visible level ────────────
  _getActiveTier() {
    const levels = this.lod.levels;
    for (let i = 0; i < levels.length; i++) {
      if (levels[i].object.visible) return TIER_NAMES[i];
    }
    return this._lodTierName; // fallback (before first render)
  }

  // ── Build full model ──────────────────────────────────────────────────────
  _buildModel() {
    this.tiers = {};
    const lod  = new THREE.LOD();
    this.lod   = lod;

    for (const [tierName, profile] of Object.entries(LOD_PROFILE)) {
      const tierGroup = this._buildTier(profile, tierName);
      this.tiers[tierName] = tierGroup;
      const dist = tierName === 'near'   ? 0
                 : tierName === 'medium' ? TH_LOD_NEAR_DIST
                 : TH_LOD_MEDIUM_DIST;
      lod.addLevel(tierGroup, dist);
    }

    this.group.add(lod);
    this.group.scale.setScalar(1.5 + Math.random() * 1.0);
  }

  // ── Build a single LOD tier, returns THREE.Group ──────────────────────────
  _buildTier(profile, tierName) {
    const isFar  = tierName === 'far';
    const isNear = tierName === 'near';
    const g      = new THREE.Group();

    // ── Materials ─────────────────────────────────────────────────────────────
    const chitinNorm = profile.hasMicroDetail  ? _makeChitinNormalTexture() : null;
    const pistonNorm = profile.hasMicroDetail  ? _makePistonNormalTexture() : null;
    const eyeNorm    = profile.hasCompoundEyes ? _makeEyeFacetTexture()     : null;

    let bodyMat = new THREE.MeshPhysicalMaterial({
      color: 0x1a1028, roughness: 0.2, metalness: 0,
      clearcoat: 1.0, clearcoatRoughness: 0.1,
      emissive: 0x502040, emissiveIntensity: 0.6,
      ...(isNear ? { iridescence: 0.6, iridescenceIOR: 1.5 } : {}),
      ...(chitinNorm ? { normalMap: chitinNorm, normalScale: new THREE.Vector2(0.7, 0.7) } : {}),
    });
    let metalMat = new THREE.MeshPhysicalMaterial({
      color: 0x141414, roughness: 0.1, metalness: 0.9,
      clearcoat: 1.0,
      emissive: 0x203858, emissiveIntensity: 0.3,
      ...(pistonNorm ? { normalMap: pistonNorm, normalScale: new THREE.Vector2(0.8, 0.8) } : {}),
    });
    let organicMat = new THREE.MeshPhysicalMaterial({
      color: 0x201020, roughness: 0.3, metalness: 0,
      clearcoat: 0.8,
      emissive: 0x602040, emissiveIntensity: 0.5,
    });
    let eyeMat = new THREE.MeshPhysicalMaterial({
      color: 0x88ff00, emissive: 0x44ff00, emissiveIntensity: 2.0,
      roughness: 0, clearcoat: 1.0,
      ...(eyeNorm ? { normalMap: eyeNorm, normalScale: new THREE.Vector2(0.5, 0.5) } : {}),
    });
    let abdomenMat = new THREE.MeshPhysicalMaterial({
      color: 0x18101e, roughness: 0.25, metalness: 0,
      clearcoat: 0.9,
      emissive: 0x601830, emissiveIntensity: 0.7,
      ...(isNear ? { iridescence: 0.5, iridescenceIOR: 1.4 } : {}),
      ...(chitinNorm ? { normalMap: chitinNorm, normalScale: new THREE.Vector2(0.6, 0.6) } : {}),
    });

    // Downgrade to MeshStandardMaterial on far tier for GPU savings
    if (isFar) {
      const o0 = bodyMat;    bodyMat    = toStandardMaterial(bodyMat);    o0.dispose();
      const o1 = metalMat;   metalMat   = toStandardMaterial(metalMat);   o1.dispose();
      const o2 = organicMat; organicMat = toStandardMaterial(organicMat); o2.dispose();
      const o3 = eyeMat;     eyeMat     = toStandardMaterial(eyeMat);     o3.dispose();
      const o4 = abdomenMat; abdomenMat = toStandardMaterial(abdomenMat); o4.dispose();
    }

    // ── Far LOD: minimal geometry (<100 triangles total) ──────────────────────
    if (isFar) {
      const fBody = new THREE.SphereGeometry(1, 8, 6);
      fBody.scale(1.6, 0.85, 0.75);
      g.add(new THREE.Mesh(fBody, bodyMat));
      const fAbd = new THREE.Mesh(new THREE.SphereGeometry(0.55, 6, 4), abdomenMat);
      fAbd.position.set(-1.5, 0, 0);
      g.add(fAbd);
      return g;
    }

    // ── Head — chitin-plated cephalic capsule ─────────────────────────────────
    const headGeo = new THREE.SphereGeometry(0.5, profile.headSegs[0], profile.headSegs[1]);
    if (profile.hasMicroDetail) {
      const hp = headGeo.attributes.position;
      for (let i = 0; i < hp.count; i++) {
        const x = hp.getX(i), y = hp.getY(i), z = hp.getZ(i);
        const bump = Math.sin(y * 10) * 0.04 + Math.sin(z * 8 + x * 6) * 0.03;
        const seam = Math.abs(Math.sin(x * 15)) < 0.15 ? -0.025 : 0;
        hp.setXYZ(i, x + bump * 0.5, y + bump, z + seam);
      }
      headGeo.computeVertexNormals();
    }
    const headMesh = new THREE.Mesh(headGeo, bodyMat);
    headMesh.position.set(0.9, 0, 0);
    g.add(headMesh);

    // ── Mandibles — serrated bilateral claws ──────────────────────────────────
    if (profile.mandibleSegs > 0) {
      for (const side of [-1, 1]) {
        const mg = new THREE.Group();
        mg.position.set(1.3, -0.12, side * 0.22);

        const mGeo = new THREE.ConeGeometry(0.06, 0.6, profile.mandibleSegs);
        if (profile.hasMicroDetail) {
          const mp = mGeo.attributes.position;
          for (let i = 0; i < mp.count; i++) {
            const serr = Math.sin(mp.getY(i) * 20) * 0.015;
            mp.setX(i, mp.getX(i) + (side > 0 ? -serr : serr));
          }
          mGeo.computeVertexNormals();
        }
        const mand = new THREE.Mesh(mGeo, metalMat);
        mand.rotation.z = side * 0.3;
        mg.add(mand);

        // Inner-edge serration spines
        for (let s = 0; s < 5; s++) {
          const sp = new THREE.Mesh(
            new THREE.ConeGeometry(0.007, 0.06, 4), metalMat
          );
          sp.position.set(side * 0.05, -0.28 + s * 0.12, 0);
          sp.rotation.z = side * (Math.PI * 0.5 + s * 0.08);
          mg.add(sp);
        }

        g.add(mg);
        if (isNear) {
          if (side < 0) this._leftMandible  = mg;
          else           this._rightMandible = mg;
        }
      }
    }

    // ── Compound eyes — multi-lens cluster ────────────────────────────────────
    // Hoist lensMat outside loop so all 4 eyes share one material instance.
    const lensMat = profile.hasCompoundEyes ? new THREE.MeshPhysicalMaterial({
      color: 0x88ff88, roughness: 0, metalness: 0, clearcoat: 1.0,
      transparent: true, opacity: 0.35, depthWrite: false,
      emissive: 0x22aa00, emissiveIntensity: 1.0,
    }) : null;

    const eyePos = [
      [1.28,  0.22,  0.22],
      [1.28,  0.22, -0.22],
      [1.22, -0.18,  0.15],
      [1.22, -0.18, -0.15],
    ];
    for (let e = 0; e < profile.eyeCount; e++) {
      const eg = new THREE.Group();
      eg.position.set(...eyePos[e]);
      eg.add(new THREE.Mesh(
        new THREE.SphereGeometry(0.08, profile.eyeSegs[0], profile.eyeSegs[1]),
        eyeMat
      ));
      if (lensMat) {
        eg.add(new THREE.Mesh(new THREE.SphereGeometry(0.086, 12, 10), lensMat));
      }
      g.add(eg);
      if (isNear) this._eyeGroups.push(eg);
    }

    // Save eyeMat ref for near tier so update() can animate its emissiveIntensity.
    if (isNear) this._nearEyeMat = eyeMat;

    // ── Central body — mechanical ridged hull ─────────────────────────────────
    const bodyGeo = new THREE.SphereGeometry(1, 18, 14);
    bodyGeo.scale(1.8, 0.9, 0.8);
    const bp = bodyGeo.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i);
      bp.setX(i, x + Math.sin(y * 8) * 0.05);
      bp.setZ(i, z + Math.cos(x * 6) * 0.04);
    }
    bodyGeo.computeVertexNormals();
    g.add(new THREE.Mesh(bodyGeo, bodyMat));

    // ── Dorsal exoskeleton plates ─────────────────────────────────────────────
    for (let i = 0; i < profile.dorsalPlates; i++) {
      const plateGeo = new THREE.BoxGeometry(0.5, 0.08, 0.6, 3, 1, 2);
      if (profile.hasMicroDetail) {
        const pp = plateGeo.attributes.position;
        for (let v = 0; v < pp.count; v++) {
          pp.setY(v, pp.getY(v) + Math.sin(pp.getX(v) * 12) * 0.008);
        }
        plateGeo.computeVertexNormals();
      }
      const plate = new THREE.Mesh(plateGeo, metalMat);
      plate.position.set(i * 0.45 - 0.9, 0.75, 0);
      plate.rotation.z = Math.sin(i) * 0.1;
      g.add(plate);
    }

    // ── Abdomen — segmented chitin with breathing bands ───────────────────────
    const abdomenGeo = new THREE.SphereGeometry(0.55, profile.abdomenSegs[0], profile.abdomenSegs[1]);
    if (profile.hasChitinBands) {
      const ap = abdomenGeo.attributes.position;
      for (let i = 0; i < ap.count; i++) {
        const x = ap.getX(i), y = ap.getY(i), z = ap.getZ(i);
        const band  = Math.sin(y * 10) * 0.04;
        const ridge = Math.sin(z * 14 + x * 10) * 0.02;
        ap.setXYZ(i, x + ridge, y + band * 0.2, z + ridge * 0.5);
      }
      abdomenGeo.computeVertexNormals();
    }
    const abdomenMesh = new THREE.Mesh(abdomenGeo, abdomenMat);
    abdomenMesh.position.set(-1.5, 0, 0);
    g.add(abdomenMesh);
    if (isNear) this._abdomenMesh = abdomenMesh;

    // ── Tendrils — hydraulic multi-segment arms ───────────────────────────────
    for (let i = 0; i < profile.tendrilCount; i++) {
      const tendrilGroup = new THREE.Group();
      const angle = (i / profile.tendrilCount) * TWO_PI;
      const rx = Math.cos(angle) * 0.8;
      const rz = Math.sin(angle) * 0.6;
      tendrilGroup.position.set(rx, -0.3, rz);
      g.add(tendrilGroup);

      const segCount = profile.tendrilSegs;

      // Cylinder segments
      const segments = [];
      for (let s = 0; s < segCount; s++) {
        const t  = s / Math.max(segCount - 1, 1);
        const r0 = 0.055 - t * 0.012;
        const r1 = 0.045 - t * 0.010;
        const seg = new THREE.Mesh(
          new THREE.CylinderGeometry(r0, r1, TENDRIL_SEG_LEN, profile.tendrilRadial),
          metalMat
        );
        seg.position.set(0, -(s + 0.5) * TENDRIL_SEG_LEN, 0);
        tendrilGroup.add(seg);
        segments.push(seg);
      }

      // Articulation ball-joints
      const jointMeshes = [];
      for (let s = 0; s < segCount - 1; s++) {
        const jr = 0.06 - (s / segCount) * 0.012;
        const jm = new THREE.Mesh(
          new THREE.SphereGeometry(jr, profile.jointSegs, profile.jointSegs),
          organicMat
        );
        jm.position.set(0, -(s + 1) * TENDRIL_SEG_LEN, 0);
        tendrilGroup.add(jm);
        jointMeshes.push(jm);
      }

      // Hydraulic piston lines alongside first 3 segments (near only)
      if (isNear && profile.pistonSegs > 0) {
        for (let s = 0; s < Math.min(segCount - 1, 3); s++) {
          const piston = new THREE.Mesh(
            new THREE.CylinderGeometry(0.012, 0.012, TENDRIL_SEG_LEN * 0.8, profile.pistonSegs),
            metalMat
          );
          piston.position.set(0.07, 0, 0);
          segments[s].add(piston);
        }
      }

      // Hook tip
      const hook = new THREE.Mesh(
        new THREE.ConeGeometry(0.025, 0.2, profile.hookSegs),
        metalMat
      );
      hook.position.set(0, -segCount * TENDRIL_SEG_LEN, 0);
      tendrilGroup.add(hook);

      // IK joint positions array — initialized hanging straight down (tendril-local)
      const joints = [];
      for (let j = 0; j <= segCount; j++) {
        joints.push(new THREE.Vector3(0, -j * TENDRIL_SEG_LEN, 0));
      }

      const ikEntry = {
        group:       tendrilGroup,
        rootOffset:  new THREE.Vector3(rx, -0.3, rz),
        joints,
        segments,
        jointMeshes,
        hook,
        phase:       (i / profile.tendrilCount) * TWO_PI,
        segCount,
      };

      if (isNear) {
        this._tendrilIK.push(ikEntry);
      } else if (tierName === 'medium') {
        this._mediumTendrilData.push({ group: tendrilGroup, phase: ikEntry.phase });
      }
    }

    // ── Fresnel rim-light silhouette shell (near only) ────────────────────────
    if (profile.hasRimLight) {
      const rimGeo = new THREE.SphereGeometry(1.05, 14, 10);
      rimGeo.scale(1.8, 0.9, 0.8);
      g.add(new THREE.Mesh(rimGeo, new THREE.MeshPhysicalMaterial({
        color: 0x000000,
        emissive: 0x180830, emissiveIntensity: 1.2,
        transparent: true, opacity: 0.25, roughness: 1.0,
        side: THREE.BackSide, depthWrite: false,
      })));
    }

    return g;
  }

  // ── Per-frame update ──────────────────────────────────────────────────────
  update(dt, playerPos) {
    this.time += dt;
    this._frameCount++;

    // ── Locomotion ────────────────────────────────────────────────────────────
    this.turnTimer += dt;
    if (this.turnTimer > this.turnInterval) {
      this.turnTimer    = 0;
      this.turnInterval = 6 + Math.random() * 8;
      if (Math.random() < 0.5) {
        this.direction.subVectors(playerPos, this.group.position).normalize();
        this.direction.y *= 0.3;
      } else {
        this.direction.set(
          Math.random() - 0.5, (Math.random() - 0.5) * 0.1, Math.random() - 0.5
        ).normalize();
      }
    }

    _v3A.copy(this.direction).multiplyScalar(this.speed * dt);
    this.group.position.add(_v3A);

    const yaw = Math.atan2(this.direction.x, this.direction.z);
    this.group.rotation.y = THREE.MathUtils.lerp(this.group.rotation.y, yaw, dt * 3);

    // Respawn when too far from player; recompute distance after reposition
    // so the rest of this frame's state/animation reflects actual position.
    let distToPlayer = this.group.position.distanceTo(playerPos);
    if (distToPlayer > RESPAWN_DISTANCE) {
      const a = Math.random() * TWO_PI;
      this.group.position.set(
        playerPos.x + Math.cos(a) * 70,
        playerPos.y - Math.random() * 10,
        playerPos.z + Math.sin(a) * 70
      );
      distToPlayer = this.group.position.distanceTo(playerPos);
    }

    // ── Resolve active LOD tier ───────────────────────────────────────────────
    this._lodTierName = this._getActiveTier();

    // ── Animation frame-skip ─────────────────────────────────────────────────
    // Ultra tier has 120+ creatures and 300m cull distance; far-LOD creatures
    // are far more numerous, so we skip more aggressively (every 4th frame) to
    // keep CPU load manageable. This matches the spec requirement: "vertex
    // shader only, update every 4th frame minimum" for far LOD at Ultra.
    const isUltra = qualityManager.tier === 'ultra';
    let skipFrames = 1;
    if (this._lodTierName === 'far') {
      skipFrames = isUltra ? 4 : 3;
    } else if (this._lodTierName === 'medium') {
      skipFrames = 3;
    }
    if (this._frameCount % skipFrames !== 0) return;

    const adt = dt * skipFrames; // adjusted dt for the skipped frames

    // ── Strike state machine ──────────────────────────────────────────────────
    this._updateStrikeState(adt, distToPlayer);

    // ── Tier animation ────────────────────────────────────────────────────────
    if (this._lodTierName === 'near') {
      this._animateNear(adt, playerPos, distToPlayer);
    } else if (this._lodTierName === 'medium') {
      this._animateMedium();
    }
    // far tier: static pose — no per-frame work beyond movement
  }

  // ── Strike / stalking state machine ──────────────────────────────────────
  _updateStrikeState(dt, distToPlayer) {
    switch (this._state) {
      case S_IDLE:
        if (distToPlayer < STALK_DISTANCE) {
          this._state = S_STALK;
          this._stateTimer = 0;
        }
        break;

      case S_STALK:
        if (distToPlayer > STALK_DISTANCE + 10) {
          this._state = S_IDLE;
        } else if (distToPlayer < STRIKE_DISTANCE) {
          this._state = S_STRIKE;
          this._stateTimer = 0;
          this._strikePhase = 0;
        }
        this._stateTimer += dt;
        break;

      case S_STRIKE:
        this._stateTimer += dt;
        this._strikePhase = Math.min(1, this._stateTimer / STRIKE_DURATION);
        if (this._stateTimer >= STRIKE_DURATION) {
          this._state = S_RETRACT;
          this._stateTimer = 0;
        }
        break;

      case S_RETRACT:
        this._stateTimer += dt;
        this._strikePhase = 1 - Math.min(1, this._stateTimer / RETRACT_DURATION);
        if (this._stateTimer >= RETRACT_DURATION) {
          this._state = distToPlayer < STALK_DISTANCE ? S_STALK : S_IDLE;
          this._stateTimer = 0;
        }
        break;
    }
  }

  // ── Near-tier animation: FABRIK IK, eyes, mandibles, abdomen ─────────────
  _animateNear(dt, playerPos, distToPlayer) {
    const t = this.time;

    // Player position in this.group's local space
    // (tierGroup / LOD have no transform, so group-local == tier-local)
    // updateMatrixWorld ensures this frame's position/rotation changes are
    // reflected before converting coordinates (avoids one-frame-stale IK targets).
    this.group.updateMatrixWorld(true);
    _v3B.copy(playerPos);
    this.group.worldToLocal(_v3B);

    // ── Independent mandible articulation ─────────────────────────────────────
    if (this._leftMandible && this._rightMandible) {
      let spread = Math.sin(t * 1.5) * 0.05;
      if (this._state === S_STALK || this._state === S_STRIKE) {
        const urgency = distToPlayer < STRIKE_DISTANCE ? 1.0 : 0.4;
        spread = THREE.MathUtils.lerp(spread, 0.6, urgency);
      }
      this._leftMandible.rotation.z  = -0.25 - spread;
      this._rightMandible.rotation.z =  0.25 + spread;
    }

    // ── Compound eye independent tracking ─────────────────────────────────────
    // THREE.Object3D.lookAt() always takes world-space coordinates, so we
    // pass playerPos/world-space points directly — no local-space conversion
    // needed here (unlike tendril IK which solves in tendril-group local space).
    if (this._eyeGroups.length === 4) {
      // Eye 0: lock onto player (world-space lookAt)
      this._eyeGroups[0].lookAt(playerPos);

      // Eye 1: environmental horizontal scan
      this._scanTimer += dt;
      if (this._scanTimer > 2.5) {
        this._scanTimer -= 2.5;
        this._scanAngle += EYE_SCAN_STEP + (Math.random() - 0.5) * 0.6;
      }
      _v3C.set(
        this.group.position.x + Math.cos(this._scanAngle) * 20,
        this.group.position.y + Math.sin(this._scanAngle * 0.4) * 6,
        this.group.position.z + Math.sin(this._scanAngle) * 20
      );
      this._eyeGroups[1].lookAt(_v3C);

      // Eye 2: threat detection above player
      _v3C.copy(playerPos);
      _v3C.y += 8 + Math.sin(t * 0.6) * 3;
      this._eyeGroups[2].lookAt(_v3C);

      // Eye 3: rearward vigilance — orbits behind creature
      _v3C.set(
        this.group.position.x - Math.cos(this.group.rotation.y) * 10 + Math.sin(t * 0.4) * 3,
        this.group.position.y + Math.cos(t * 0.3) * 2,
        this.group.position.z - Math.sin(this.group.rotation.y) * 10 + Math.cos(t * 0.5) * 3
      );
      this._eyeGroups[3].lookAt(_v3C);
    }

    // ── Compound eye emissive glow — state-aware (Issue #80: no PointLights) ────
    // STALK/STRIKE: fast flickering hunting glow per spec.
    // IDLE/RETRACT:  slow ambient pulse.
    if (this._nearEyeMat) {
      const hunting = (this._state === S_STALK || this._state === S_STRIKE);
      this._nearEyeMat.emissiveIntensity = hunting
        ? 0.8 + Math.sin(t * 4.0) * 0.3
        : 0.3 + Math.sin(t * 0.8) * 0.15;
    }

    // ── Abdomen breathing pulse + secondary sway ──────────────────────────────
    if (this._abdomenMesh) {
      const breathe = 1 + Math.sin(t * 1.4 + this._abdomenPhase) * 0.04;
      this._abdomenMesh.scale.setScalar(breathe);
      this._abdomenMesh.rotation.y = -this.group.rotation.y * 0.06;
    }

    // ── Per-tendril FABRIK IK ──────────────────────────────────────────────────
    const stalking = (this._state === S_STALK);
    const striking = (this._state === S_STRIKE || this._state === S_RETRACT);

    for (let i = 0; i < this._tendrilIK.length; i++) {
      const td = this._tendrilIK[i];
      const phase = t * 2 + td.phase;

      // IK target weight: 0 = full idle sway, 1 = full player-seek
      let targetWeight = 0;
      if (stalking) targetWeight = 0.25 + Math.sin(t * 0.5 + td.phase) * 0.15;
      if (striking) targetWeight = this._strikePhase;

      // Idle target in tendril-group local space (hanging, sinusoidal sway)
      const idleX = Math.sin(phase * 0.7) * 0.35;
      const idleY = -(td.segCount * TENDRIL_SEG_LEN) + Math.sin(phase) * 0.45;
      const idleZ = Math.cos(phase * 0.9) * 0.35;

      // Player target in tendril-group local space
      // _v3B is player in group-local space; subtract rootOffset (tendrilGroup.position)
      const ptx = _v3B.x - td.rootOffset.x;
      const pty = _v3B.y - td.rootOffset.y;
      const ptz = _v3B.z - td.rootOffset.z;

      // Per-tendril spread to avoid all tips converging on one point
      const spread = TENDRIL_SPREAD_FACTOR * (1 - targetWeight);
      const ptxS   = ptx + Math.cos(td.phase + t * 0.2) * spread;
      const ptzS   = ptz + Math.sin(td.phase + t * 0.2) * spread;

      // Final IK target: lerp idle ↔ player-seek
      _v3C.set(
        idleX + (ptxS - idleX) * targetWeight,
        idleY + (pty  - idleY) * targetWeight,
        idleZ + (ptzS - idleZ) * targetWeight
      );

      // Run FABRIK
      for (let iter = 0; iter < FABRIK_ITERS; iter++) {
        _solveFABRIK(td.joints, _v3C, TENDRIL_SEG_LEN);
      }

      // ── Apply solved joint positions to segment meshes ────────────────────
      const doRattle = (this._state === S_STRIKE);
      for (let s = 0; s < td.segments.length; s++) {
        const pa  = td.joints[s];
        const pb  = td.joints[s + 1];
        const seg = td.segments[s];

        seg.position.set(
          (pa.x + pb.x) * 0.5,
          (pa.y + pb.y) * 0.5,
          (pa.z + pb.z) * 0.5
        );

        _v3A.subVectors(pb, pa);
        const len = _v3A.length();
        if (len > 0.001) {
          _v3A.divideScalar(len);
          _qA.setFromUnitVectors(_upY, _v3A);
          seg.quaternion.copy(_qA);
        }
      }

      // ── Update articulation joint balls ───────────────────────────────────
      for (let s = 0; s < td.jointMeshes.length; s++) {
        td.jointMeshes[s].position.copy(td.joints[s + 1]);
        if (doRattle) {
          td.jointMeshes[s].position.x += (Math.random() - 0.5) * PISTON_RATTLE;
          td.jointMeshes[s].position.z += (Math.random() - 0.5) * PISTON_RATTLE;
        }
      }

      // ── Hook tip orientation ───────────────────────────────────────────────
      td.hook.position.copy(td.joints[td.segCount]);
      if (td.segCount >= 1) {
        _v3A.subVectors(td.joints[td.segCount], td.joints[td.segCount - 1]);
        if (_v3A.lengthSq() > 0.001) {
          _v3A.normalize();
          _qA.setFromUnitVectors(_upY, _v3A);
          td.hook.quaternion.copy(_qA);
        }
      }
    }
  }

  // ── Medium-tier animation: sinusoidal group rotation per tendril ──────────
  _animateMedium() {
    for (let i = 0; i < this._mediumTendrilData.length; i++) {
      const td    = this._mediumTendrilData[i];
      const phase = this.time * 2 + td.phase;
      td.group.rotation.x = Math.sin(phase) * 0.3;
      td.group.rotation.z = Math.cos(phase * 0.7) * 0.2;
    }
  }

  getPosition() { return this.group.position; }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(c => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
        else c.material.dispose();
      }
    });
    // Texture disposal notes:
    // - _chitinNormalTex, _pistonNormalTex, _eyeFacetTex: module-level singletons
    //   shared across all TendrilHunter instances — must not be disposed here.
    // - Compound-lens shell materials have no texture maps (emissive color only),
    //   so no per-material texture disposal is required beyond material.dispose().
  }
}
