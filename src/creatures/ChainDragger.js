import * as THREE from 'three/webgpu';
import { abs, cos, dot, materialEmissive, normalLocal, normalView, positionLocal, positionView, pow, sin, sub, uniform, vec3 } from 'three/tsl';
import { LOD_NEAR_DISTANCE, LOD_MEDIUM_DISTANCE, toStandardMaterial } from './lodUtils.js';

// ── Module-level pre-allocated temporaries — zero per-frame GC allocation ────
const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q0 = new THREE.Quaternion();
const _m0 = new THREE.Matrix4(); // world-inverse matrix (computed once per _updateInstances)
const _m1 = new THREE.Matrix4(); // per-link instance matrix
const _sc = new THREE.Vector3(1, 1, 1); // uniform scale for matrix compose
const _AY = new THREE.Vector3(0, 1, 0); // +Y axis constant

// ── Verlet physics constants ──────────────────────────────────────────────────
const GRAVITY_ACC        = 9.8;   // m/s² downward
const VERLET_DAMP        = 0.985; // per-step velocity damping (slight water resistance)
const SOLVE_ITERS        = 4;     // constraint solver iterations per step
const LINK_SPACING       = 0.14;  // rest distance between adjacent particles
const CONSTRAINT_RELAX   = 0.5;   // splits distance-constraint correction equally between both particles
const PARALLEL_THRESHOLD = 0.9;   // dot-product threshold for near-parallel cross-product fallback
const MIN_LINKS          = 8;     // minimum chain links per chain (near LOD)

// ── Proximity / interaction constants ────────────────────────────────────────
const PROXIMITY_DIST  = 18;   // player distance threshold (world units, pre-scale) for chain drag
const PROXIMITY_FORCE = 0.04; // per-step chain-particle impulse fraction toward player

// ── Collision flash constants ─────────────────────────────────────────────────
const COLLISION_FLASH_DURATION  = 0.4;  // seconds the chain emissive flash lasts
const COLLISION_FLASH_PEAK      = 0.9;  // peak emissiveIntensity added during flash
const COLLISION_DOT_THRESHOLD   = -0.2; // dot-product < this (~101.5°) triggers a collision flash on sharp turns

// ── Cowl animation constants ──────────────────────────────────────────────────
const COWL_BASE_ROTATION       = 0.04;  // base Z-rotation oscillation amplitude (radians)
const COWL_PROXIMITY_ROTATION  = 0.12;  // additional Z-rotation at full player proximity (radians)
const COWL_PROXIMITY_SCALE     = 0.15;  // max scale increase when player is at minimum proximity distance

// ── Eye animation constants ───────────────────────────────────────────────────
const EYE_BASE_INTENSITY  = 1.4; // base emissiveIntensity for near-tier eye material
const EYE_PULSE_FREQUENCY = 2.5; // sine-wave frequency (rad/s) for eye glow pulse
const EYE_PULSE_AMPLITUDE = 0.4; // emissiveIntensity variation amplitude around base

// ── LOD configuration ─────────────────────────────────────────────────────────
const LOD_CFG = {
  near: {
    // Issue #59: 48×32 minimum vertex density for near LOD body
    bodySegs: [48, 32], cowlSegs: [24, 16],
    linkTubeSegs: [12, 16], chainCount: 4, maxLinks: 14,
    barnacles: 5, useFar: false,
  },
  medium: {
    bodySegs: [16, 12], cowlSegs: [12, 8],
    linkTubeSegs: [8, 10], chainCount: 4, maxLinks: 8,
    barnacles: 2, useFar: false,
  },
  far: {
    // Ultra-lightweight: <100 triangles total; safe at 300 m Ultra cull distance
    bodySegs: [6, 4], cowlSegs: null,
    linkTubeSegs: null, chainCount: 2, maxLinks: 4,
    barnacles: 0, useFar: true,
  },
};

// ── Module-level singleton normal-map textures ────────────────────────────────
// Not disposed per-instance (module-level singletons — SporeCloud pattern).
let _chainNormalTex = null;
let _bodyNormalTex  = null;
let _cowlNormalTex  = null;

// Shared barnacle geometries (two sizes, scaled at the Mesh level to vary appearance).
// Avoids per-barnacle CylinderGeometry allocation.
let _barnGeoSmall = null;
let _barnGeoLarge = null;

function _getBarnGeos() {
  if (!_barnGeoSmall) {
    _barnGeoSmall = new THREE.CylinderGeometry(0.012, 0.02, 0.04, 5);
    _barnGeoLarge = new THREE.CylinderGeometry(0.012, 0.02, 0.07, 5);
  }
  return [_barnGeoSmall, _barnGeoLarge];
}

/**
 * Build a procedural normal-map DataTexture from a height function via
 * central differences.  Returns a DataTexture with RepeatWrapping.
 */
function _buildNormalTex(size, heightFn, normalScale = 2.0) {
  const data = new Uint8Array(size * size * 4);
  const d = 1 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const u = x / size, v = y / size;
      const dx = heightFn(u + d, v) - heightFn(u - d, v);
      const dy = heightFn(u, v + d) - heightFn(u, v - d);
      const nx = -dx * normalScale, ny = -dy * normalScale, nz = 1.0;
      const nLen = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      data[idx]     = Math.floor((nx * nLen * 0.5 + 0.5) * 255);
      data[idx + 1] = Math.floor((ny * nLen * 0.5 + 0.5) * 255);
      data[idx + 2] = Math.floor((nz * nLen * 0.5 + 0.5) * 255);
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

function _getChainNormalTex() {
  if (_chainNormalTex) return _chainNormalTex;
  // Rust pitting + cross-hatched wear pattern
  _chainNormalTex = _buildNormalTex(64, (u, v) =>
    Math.sin(u * 52) * 0.25 + Math.sin(v * 48 + u * 3) * 0.2 +
    Math.cos(u * 34 + v * 29) * 0.15 + Math.sin(u * 18 + v * 17) * 0.1,
  2.5);
  return _chainNormalTex;
}

function _getBodyNormalTex() {
  if (_bodyNormalTex) return _bodyNormalTex;
  // Scarring ridges + armor-plate relief
  _bodyNormalTex = _buildNormalTex(128, (u, v) =>
    Math.sin(u * 22 + v * 7) * 0.3 + Math.cos(v * 18 + u * 4) * 0.2 +
    Math.sin(u * 40 + v * 35) * 0.1,
  3.0);
  return _bodyNormalTex;
}

function _getCowlNormalTex() {
  if (_cowlNormalTex) return _cowlNormalTex;
  // Fabric weave pattern
  _cowlNormalTex = _buildNormalTex(64, (u, v) =>
    Math.sin(u * 60) * 0.25 + Math.sin(v * 60) * 0.25 +
    Math.cos(u * 30 + v * 30) * 0.1,
  2.0);
  return _cowlNormalTex;
}

/**
 * Injects body creep (slow surface displacement waves) and Fresnel rim-light
 * into a MeshPhysicalMaterial via TSL positionNode / emissiveNode.
 * Returns the uniforms object so callers can update uCreepTime each frame.
 */
function _applyBodyShader(material) {
  const uniforms = { uCreepTime: uniform(0.0) };

  // TSL: vertex surface displacement waves — body creep animation
  const creep = sin(positionLocal.x.mul(4.0).add(positionLocal.z.mul(3.0)).add(uniforms.uCreepTime.mul(0.45))).mul(0.022)
    .add(cos(positionLocal.y.mul(6.0).add(positionLocal.z.mul(2.5)).add(uniforms.uCreepTime.mul(0.30))).mul(0.016));
  material.positionNode = positionLocal.add(normalLocal.mul(creep));

  // TSL: Fresnel rim-light for dark cowled silhouette in deep water
  const viewDir = positionView.negate().normalize();
  const rim = pow(sub(1.0, abs(dot(normalView, viewDir))), 2.5);
  material.emissiveNode = materialEmissive.add(vec3(0.04, 0.12, 0.22).mul(rim).mul(0.7));

  return uniforms;
}

// ── Creature ─────────────────────────────────────────────────────────────────
// Creature trailing chain-like segmented appendages that drag through the water
export class ChainDragger {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time = Math.random() * 100;
    this.speed = 1.0 + Math.random() * 0.8;
    this.direction = new THREE.Vector3(Math.random() - 0.5, -0.08, Math.random() - 0.5).normalize();
    this.turnTimer = 0;
    this.turnInterval = 10 + Math.random() * 10;

    // Verlet chain physics data (near LOD only).
    // Particles stored in WORLD space; instance matrices converted to group-local.
    this._verletChains = [];

    // Mid-LOD pendulum chain groups (simple Group-based, sinusoidal sway)
    this._midChains = [];

    // Near-LOD mesh refs for secondary idle animation
    this._bodyNear = null;
    this._cowlNear = null;

    // Near-LOD material refs for animated effects
    this._bodyCreepUniforms = null; // { uCreepTime: { value: 0 } } returned by _applyBodyShader
    this._eyeMatNear        = null; // eye MeshStandardMaterial for animated emissive pulse
    this._chainMatNear      = null; // near-tier chain MeshPhysicalMaterial for collision flash

    // Chain collision flash state
    this._chainCollisionTimer = 0;  // seconds remaining for the emissive flash
    // Track direction XZ for collision detection on sharp turns
    this._prevDirX = this.direction.x;
    this._prevDirZ = this.direction.z;

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  // ---------------------------------------------------------------------------
  // Material factory
  // ---------------------------------------------------------------------------

  _makeMats(useFar) {
    let bodyMat = new THREE.MeshPhysicalMaterial({
      color: 0x1e1a28, roughness: 0.6, metalness: 0.05,
      clearcoat: 0.7, clearcoatRoughness: 0.35,
      emissive: 0x1a2840, emissiveIntensity: 0.5,
      normalMap: useFar ? null : _getBodyNormalTex(),
      normalScale: new THREE.Vector2(0.4, 0.4),
    });
    let chainMat = new THREE.MeshPhysicalMaterial({
      // Rusted wet metal — moderate metalness with clearcoat gloss + iridescence (oil-film sheen)
      color: 0x2a2030, roughness: 0.45, metalness: 0.6,
      clearcoat: 0.5, clearcoatRoughness: 0.55,
      emissive: 0x102030, emissiveIntensity: 0.3,
      iridescence: useFar ? 0 : 0.2, iridescenceIOR: 1.45,
      normalMap: useFar ? null : _getChainNormalTex(),
      normalScale: new THREE.Vector2(0.35, 0.35),
    });
    let weightMat = new THREE.MeshPhysicalMaterial({
      color: 0x282030, roughness: 0.55, metalness: 0.45,
      clearcoat: 0.3,
      emissive: 0x0e1822, emissiveIntensity: 0.25,
    });
    if (useFar) {
      const ob = bodyMat; bodyMat = toStandardMaterial(bodyMat); ob.dispose();
      const oc = chainMat; chainMat = toStandardMaterial(chainMat); oc.dispose();
      const ow = weightMat; weightMat = toStandardMaterial(weightMat); ow.dispose();
    }
    return { bodyMat, chainMat, weightMat };
  }

  // ---------------------------------------------------------------------------
  // Model construction
  // ---------------------------------------------------------------------------

  _buildModel() {
    const lod = new THREE.LOD();
    this.lod = lod;

    lod.addLevel(this._buildTier('near'),   0);
    lod.addLevel(this._buildTier('medium'), LOD_NEAR_DISTANCE);
    lod.addLevel(this._buildTier('far'),    LOD_MEDIUM_DISTANCE);

    this.group.add(lod);
    this.group.scale.setScalar(2 + Math.random() * 1.5);
  }

  _buildTier(tierName) {
    const cfg = LOD_CFG[tierName];
    const { bodyMat, chainMat, weightMat } = this._makeMats(cfg.useFar);
    const g = new THREE.Group();

    // --- Body ---
    const bodyGeo = new THREE.SphereGeometry(0.8, cfg.bodySegs[0], cfg.bodySegs[1]);
    bodyGeo.scale(1.4, 0.9, 0.8);
    const bp = bodyGeo.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i);
      if (!cfg.useFar) {
        // Scarring ridges + armor-plate surface displacement (baked into geometry)
        bp.setX(i, x + Math.sin(y * 7) * 0.04 + Math.sin(z * 5) * 0.025);
        bp.setY(i, y + Math.cos(x * 4 + z * 3) * 0.03);
      } else {
        bp.setX(i, x + Math.sin(y * 7) * 0.04);
      }
    }
    bodyGeo.computeVertexNormals();
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    g.add(bodyMesh);
    if (tierName === 'near') {
      this._bodyNear = bodyMesh;
      // Inject body creep wave + Fresnel rim shader into near-tier body material
      this._bodyCreepUniforms = _applyBodyShader(bodyMat);
    }

    // --- Cowl (omitted on far tier to save triangles) ---
    if (cfg.cowlSegs) {
      const cowlGeo = new THREE.SphereGeometry(
        0.5, cfg.cowlSegs[0], cfg.cowlSegs[1],
        0, Math.PI * 2, 0, Math.PI * 0.55,
      );
      cowlGeo.scale(1.2, 0.7, 0.9);
      if (tierName === 'near') {
        // Hood-draping displacement on near tier
        const cp = cowlGeo.attributes.position;
        for (let i = 0; i < cp.count; i++) {
          const x = cp.getX(i), y = cp.getY(i), z = cp.getZ(i);
          cp.setY(i, y + Math.sin(x * 3 + z * 4) * 0.03 + Math.cos(z * 6) * 0.015);
        }
        cowlGeo.computeVertexNormals();
      }
      // Near tier uses a dedicated cowl material with fabric-weave normal map
      let cowlMat = bodyMat;
      if (tierName === 'near') {
        cowlMat = bodyMat.clone();
        cowlMat.normalMap = _getCowlNormalTex();
        cowlMat.normalScale.set(0.3, 0.3);
      }
      const cowlMesh = new THREE.Mesh(cowlGeo, cowlMat);
      cowlMesh.position.set(0.6, 0.4, 0);
      g.add(cowlMesh);
      if (tierName === 'near') this._cowlNear = cowlMesh;
    }

    // --- Eyes (emissive glow, no point light) ---
    if (!cfg.useFar) {
      const eyeSegs = tierName === 'near' ? 12 : 8;
      const eyeMat = new THREE.MeshStandardMaterial({
        color: 0xdd8800,
        emissive: 0xaa6600,
        emissiveIntensity: tierName === 'near' ? 1.8 : 1.4,
        roughness: 0,
      });
      // Store near-tier eye material for animated emissive pulse
      if (tierName === 'near') this._eyeMatNear = eyeMat;
      for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, eyeSegs, eyeSegs), eyeMat);
        eye.position.set(1.0, 0.3, side * 0.3);
        g.add(eye);
      }
    }

    // --- Chains ---
    if (tierName === 'near') {
      this._buildNearChains(g, chainMat, weightMat, cfg);
    } else if (tierName === 'medium') {
      this._buildMidChains(g, chainMat, weightMat, cfg);
    } else {
      this._buildFarChains(g, chainMat, cfg);
    }

    return g;
  }

  _buildNearChains(parentGroup, chainMat, weightMat, cfg) {
    // Store chain material ref for per-frame collision flash
    this._chainMatNear = chainMat;

    // Shared TorusGeometry across all InstancedMesh instances (single geometry)
    const linkGeo = new THREE.TorusGeometry(
      0.06, 0.015, cfg.linkTubeSegs[0], cfg.linkTubeSegs[1],
    );

    // Conservative bounding sphere covering the maximum chain reach in group-local space.
    // Replaces `inst.frustumCulled = false` so frustum culling still functions correctly.
    const maxChainReach = cfg.maxLinks * LINK_SPACING + 1.5;
    linkGeo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(0, -maxChainReach * 0.5, 0),
      maxChainReach,
    );

    const barnGeos = _getBarnGeos();

    for (let c = 0; c < cfg.chainCount; c++) {
      const linkCount = MIN_LINKS + Math.floor(Math.random() * (cfg.maxLinks - MIN_LINKS + 1));
      const N = linkCount + 1; // N+1 particles for N link segments

      // InstancedMesh: single draw call for all links in this chain
      const inst = new THREE.InstancedMesh(linkGeo, chainMat, linkCount);
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      parentGroup.add(inst);

      // Attachment point in group-local space
      const ax = c * 0.4 - 0.6;
      const ay = -0.6;
      const az = (c % 2 === 0 ? -1 : 1) * 0.2;

      // Particle buffers — world-space positions
      // Root particle (index 0) is pinned to body attachment each step.
      const pos  = new Float32Array(3 * N);
      const prev = new Float32Array(3 * N);

      // Weight with barnacle/growth accumulation detail
      const wGroup = new THREE.Group();
      wGroup.add(new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), weightMat));
      for (let b = 0; b < cfg.barnacles; b++) {
        const ang = Math.random() * Math.PI * 2;
        // Reuse shared barnacle geometries; vary appearance via random scale
        const barn = new THREE.Mesh(barnGeos[b % 2], weightMat);
        barn.scale.setScalar(0.7 + Math.random() * 0.6);
        barn.position.set(
          Math.cos(ang) * 0.07,
          Math.random() * 0.06 - 0.02,
          Math.sin(ang) * 0.07,
        );
        barn.rotation.x = (Math.random() - 0.5) * 0.5;
        wGroup.add(barn);
      }
      parentGroup.add(wGroup);

      this._verletChains.push({ pos, prev, linkCount, ax, ay, az, inst, weightObj: wGroup, initialized: false });
    }
  }

  _buildMidChains(parentGroup, chainMat, weightMat, cfg) {
    const linkGeo = new THREE.TorusGeometry(
      0.06, 0.015, cfg.linkTubeSegs[0], cfg.linkTubeSegs[1],
    );
    for (let c = 0; c < cfg.chainCount; c++) {
      const cg = new THREE.Group();
      const linkCount = 5 + Math.floor(Math.random() * 4);
      for (let l = 0; l < linkCount; l++) {
        const link = new THREE.Mesh(linkGeo, chainMat);
        link.position.y = -l * LINK_SPACING;
        // Interlocked: alternate perpendicular orientations
        link.rotation.x = l % 2 === 0 ? 0 : Math.PI / 2;
        cg.add(link);
      }
      const weight = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 8, 6), weightMat,
      );
      weight.position.y = -linkCount * LINK_SPACING - 0.1;
      cg.add(weight);
      cg.position.set(c * 0.4 - 0.6, -0.6, (c % 2 === 0 ? -1 : 1) * 0.2);
      this._midChains.push(cg);
      parentGroup.add(cg);
    }
  }

  _buildFarChains(parentGroup, chainMat, cfg) {
    // Ultra-lightweight: 2 simple 4-sided cylinders — well under 100 triangles total
    for (let c = 0; c < cfg.chainCount; c++) {
      const len = cfg.maxLinks * LINK_SPACING;
      const rod = new THREE.Mesh(
        new THREE.CylinderGeometry(0.015, 0.02, len, 4, 1),
        chainMat,
      );
      rod.position.set(
        c * 0.7 - 0.35,
        -0.6 - len * 0.5,
        (c % 2 === 0 ? -1 : 1) * 0.2,
      );
      parentGroup.add(rod);
    }
  }

  // ---------------------------------------------------------------------------
  // Verlet physics
  // ---------------------------------------------------------------------------

  /**
   * Integrate all near-LOD Verlet chains one step.
   * Particles are stored in world space so body rotation is handled correctly
   * (chains don't snap when the creature turns).
   */
  _stepVerlet(dt) {
    const gravY = -GRAVITY_ACC * dt * dt;
    const scale  = this.group.scale.x; // uniform scale
    const cosY   = Math.cos(this.group.rotation.y);
    const sinY   = Math.sin(this.group.rotation.y);
    const px     = this.group.position.x;
    const py     = this.group.position.y;
    const pz     = this.group.position.z;

    for (const chain of this._verletChains) {
      const { pos, prev, linkCount, ax, ay, az } = chain;
      const N = linkCount + 1;

      // Root particle world position: body-local attach → world
      const rx = (ax * cosY - az * sinY) * scale + px;
      const ry = ay * scale + py;
      const rz = (ax * sinY + az * cosY) * scale + pz;

      // Initialize particles on first use using an explicit flag
      if (!chain.initialized) {
        chain.initialized = true;
        for (let p = 0; p < N; p++) {
          pos[p*3]   = rx;
          pos[p*3+1] = ry - p * LINK_SPACING * scale;
          pos[p*3+2] = rz;
          prev[p*3]   = pos[p*3];
          prev[p*3+1] = pos[p*3+1];
          prev[p*3+2] = pos[p*3+2];
        }
      }

      // Verlet integrate free particles (skip root at index 0)
      for (let p = 1; p < N; p++) {
        const i = p * 3;
        const vx = (pos[i]   - prev[i])   * VERLET_DAMP;
        const vy = (pos[i+1] - prev[i+1]) * VERLET_DAMP;
        const vz = (pos[i+2] - prev[i+2]) * VERLET_DAMP;
        prev[i]   = pos[i];
        prev[i+1] = pos[i+1];
        prev[i+2] = pos[i+2];
        pos[i]   += vx;
        pos[i+1] += vy + gravY;
        pos[i+2] += vz;
      }

      // Pin root to world attachment point
      prev[0] = pos[0]; prev[1] = pos[1]; prev[2] = pos[2];
      pos[0] = rx; pos[1] = ry; pos[2] = rz;

      // Distance constraint solver — enforce LINK_SPACING * scale rest length
      const restLen = LINK_SPACING * scale;
      for (let iter = 0; iter < SOLVE_ITERS; iter++) {
        // Root–first free particle: only move the free end (root is pinned)
        {
          const i1 = 3; // particle index 1 in world-space pos array (1 particle × 3 floats)
          const dx = pos[i1] - rx, dy = pos[i1+1] - ry, dz = pos[i1+2] - rz;
          const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
          if (dist > 1e-6) {
            const corr = (dist - restLen) / dist;
            pos[i1]   -= dx * corr;
            pos[i1+1] -= dy * corr;
            pos[i1+2] -= dz * corr;
          }
        }
        // Interior pairs: split correction equally between both particles (CONSTRAINT_RELAX = 0.5)
        for (let p = 1; p < N - 1; p++) {
          const i0 = p * 3, i1 = i0 + 3;
          const dx = pos[i1]   - pos[i0];
          const dy = pos[i1+1] - pos[i0+1];
          const dz = pos[i1+2] - pos[i0+2];
          const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
          if (dist < 1e-6) continue;
          const corr = (dist - restLen) / dist * CONSTRAINT_RELAX;
          pos[i0]   += dx * corr;
          pos[i0+1] += dy * corr;
          pos[i0+2] += dz * corr;
          pos[i1]   -= dx * corr;
          pos[i1+1] -= dy * corr;
          pos[i1+2] -= dz * corr;
        }
      }
    }
  }

  /**
   * Applies a small impulse toward playerPos to each free Verlet particle
   * when the player is within PROXIMITY_DIST (scaled).
   * Called only at near LOD after _stepVerlet.
   */
  _applyProximityBias(playerPos) {
    const scale = this.group.scale.x;
    const gdx = playerPos.x - this.group.position.x;
    const gdz = playerPos.z - this.group.position.z;
    const toDist = Math.sqrt(gdx * gdx + gdz * gdz);
    const threshold = PROXIMITY_DIST * scale;
    if (toDist >= threshold) return;

    const strength = PROXIMITY_FORCE * (1 - toDist / threshold);
    for (const chain of this._verletChains) {
      const { pos, linkCount } = chain;
      const N = linkCount + 1;
      for (let p = 1; p < N; p++) {
        const i = p * 3;
        pos[i]   += (playerPos.x - pos[i])   * strength;
        pos[i+1] += (playerPos.y - pos[i+1]) * strength * 0.3; // weaker Y pull
        pos[i+2] += (playerPos.z - pos[i+2]) * strength;
      }
    }
  }

  /**
   * Update InstancedMesh matrices from Verlet particle world positions.
   * Transforms world-space midpoints/rotations into group-local space
   * using a single matrix inverse computed once per call.
   */
  _updateInstances() {
    // Compute world-inverse once for this frame
    this.group.updateWorldMatrix(true, false);
    _m0.copy(this.group.matrixWorld).invert();

    for (const chain of this._verletChains) {
      const { pos, linkCount, inst, weightObj } = chain;

      for (let l = 0; l < linkCount; l++) {
        const i0 = l * 3, i1 = i0 + 3;

        // Link midpoint in world space
        _v0.set(
          (pos[i0] + pos[i1]) * 0.5,
          (pos[i0+1] + pos[i1+1]) * 0.5,
          (pos[i0+2] + pos[i1+2]) * 0.5,
        );

        // Segment direction (world)
        _v1.set(
          pos[i1]   - pos[i0],
          pos[i1+1] - pos[i0+1],
          pos[i1+2] - pos[i0+2],
        ).normalize();

        // Alternate link orientation: each link is perpendicular to its neighbors
        // giving the realistic interlocked look of actual chain
        if (l % 2 === 0) {
          // Even links: ring plane contains segment direction
          _q0.setFromUnitVectors(_AY, _v1);
        } else {
          // Odd links: ring plane is perpendicular — rotate 90° around segment
          _v2.set(1, 0, 0);
          if (Math.abs(_v1.dot(_v2)) > PARALLEL_THRESHOLD) _v2.set(0, 0, 1);
          _v2.crossVectors(_v1, _v2).normalize();
          _q0.setFromUnitVectors(_AY, _v2);
        }

        // Compose world-space matrix then transform to group-local
        _m1.compose(_v0, _q0, _sc);
        _m1.premultiply(_m0);
        inst.setMatrixAt(l, _m1);
      }
      inst.instanceMatrix.needsUpdate = true;

      // Weight position: last particle world → group-local
      const lp = linkCount * 3;
      _v0.set(pos[lp], pos[lp+1], pos[lp+2]).applyMatrix4(_m0);
      weightObj.position.copy(_v0);
    }
  }

  // ---------------------------------------------------------------------------
  // Per-frame update
  // ---------------------------------------------------------------------------

  update(dt, playerPos, distSq) {
    this.time += dt;
    this.turnTimer += dt;

    if (this.turnTimer > this.turnInterval) {
      this.turnTimer = 0;
      this.turnInterval = 10 + Math.random() * 10;
      if (Math.random() < 0.3) {
        this.direction.subVectors(playerPos, this.group.position).normalize();
        this.direction.y *= 0.15;
      } else {
        this.direction.set(
          Math.random() - 0.5,
          (Math.random() - 0.5) * 0.05,
          Math.random() - 0.5,
        ).normalize();
      }

      // Detect sharp turn (dot < COLLISION_DOT_THRESHOLD ≈ >101.5°) → chain collision flash
      if (this._chainMatNear) {
        const dot = this._prevDirX * this.direction.x + this._prevDirZ * this.direction.z;
        if (dot < COLLISION_DOT_THRESHOLD) this._chainCollisionTimer = COLLISION_FLASH_DURATION;
      }
      this._prevDirX = this.direction.x;
      this._prevDirZ = this.direction.z;
    }

    // Translate — reuse _v0 to avoid direction.clone() allocation
    _v0.copy(this.direction).multiplyScalar(this.speed * dt);
    this.group.position.add(_v0);

    // Face direction
    const angle = Math.atan2(this.direction.x, this.direction.z);
    this.group.rotation.y = THREE.MathUtils.lerp(this.group.rotation.y, angle, dt * 2);

    const dist = Math.sqrt(distSq);

    // Near LOD: Verlet physics + instance matrix update + all secondary motion
    if (dist <= LOD_NEAR_DISTANCE) {
      this._stepVerlet(dt);
      this._applyProximityBias(playerPos);
      this._updateInstances();

      // Body creep shader: update time uniform so displacement waves animate
      if (this._bodyCreepUniforms) {
        this._bodyCreepUniforms.uCreepTime.value = this.time;
      }

      // Breathing/idle: subtle body swell (scale-based)
      if (this._bodyNear) {
        const breathe = 1 + Math.sin(this.time * 0.7) * 0.015;
        this._bodyNear.scale.setScalar(breathe);
      }

      // Cowl billowing + player-proximity flare
      if (this._cowlNear) {
        const proxFraction = Math.max(0, 1 - dist / (PROXIMITY_DIST * this.group.scale.x));
        this._cowlNear.rotation.z = Math.sin(this.time * 1.2) * COWL_BASE_ROTATION + proxFraction * COWL_PROXIMITY_ROTATION;
        this._cowlNear.rotation.x = -Math.min(this.speed * 0.025, 0.1);
        // Cowl flares outward when player is close
        this._cowlNear.scale.setScalar(1.0 + proxFraction * COWL_PROXIMITY_SCALE);
      }

      // Animated eye emissive pulse
      if (this._eyeMatNear) {
        this._eyeMatNear.emissiveIntensity = EYE_BASE_INTENSITY + Math.sin(this.time * EYE_PULSE_FREQUENCY) * EYE_PULSE_AMPLITUDE;
      }

      // Chain collision flash: brief emissive surge on sharp turns
      if (this._chainMatNear) {
        if (this._chainCollisionTimer > 0) {
          this._chainCollisionTimer = Math.max(0, this._chainCollisionTimer - dt);
          const t = 1 - this._chainCollisionTimer / COLLISION_FLASH_DURATION;
          this._chainMatNear.emissiveIntensity = 0.3 + COLLISION_FLASH_PEAK * Math.sin(t * Math.PI);
        } else {
          this._chainMatNear.emissiveIntensity = 0.3; // base emissive
        }
      }
    }
    // Mid LOD: simplified single-pivot pendulum sway
    else if (dist <= LOD_MEDIUM_DISTANCE) {
      for (let i = 0; i < this._midChains.length; i++) {
        const phase = this.time * 1.5 + i * 1.2;
        this._midChains[i].rotation.x = Math.sin(phase) * 0.2;
        this._midChains[i].rotation.z = Math.cos(phase * 0.6) * 0.15;
      }
    }
    // Far LOD: static chains — no animation overhead

    // Respawn when too far from player; reset Verlet state so chains re-seed
    // from the new body attachment point and don't "explode" on next near LOD entry
    if (dist > 200) {
      const a = Math.random() * Math.PI * 2;
      this.group.position.set(
        playerPos.x + Math.cos(a) * 70,
        playerPos.y - Math.random() * 10,
        playerPos.z + Math.sin(a) * 70,
      );
      for (const chain of this._verletChains) chain.initialized = false;
    }
  }

  // ---------------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------------

  getPosition() { return this.group.position; }

  dispose() {
    this.scene.remove(this.group);
    // Use a Set to deduplicate geometry/material disposal —
    // shared resources (linkGeo, chainMat, etc.) are referenced by multiple
    // scene nodes and must only be disposed once.
    const disposedGeos = new Set();
    const disposedMats = new Set();
    this.group.traverse(c => {
      if (c.geometry && !disposedGeos.has(c.geometry)) {
        disposedGeos.add(c.geometry);
        c.geometry.dispose();
      }
      if (c.material) {
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        for (const m of mats) {
          if (!disposedMats.has(m)) {
            disposedMats.add(m);
            m.dispose();
          }
        }
      }
    });
    this._verletChains.length = 0;
    this._midChains.length = 0;
  }
}
