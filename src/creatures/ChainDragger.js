import * as THREE from 'three';
import { LOD_NEAR_DISTANCE, LOD_MEDIUM_DISTANCE, toStandardMaterial } from './lodUtils.js';

// Module-level pre-allocated temporaries — zero per-frame GC allocation
const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q0 = new THREE.Quaternion();
const _m0 = new THREE.Matrix4(); // world-inverse matrix (computed once per _updateInstances)
const _m1 = new THREE.Matrix4(); // per-link instance matrix
const _sc = new THREE.Vector3(1, 1, 1); // uniform scale for matrix compose
const _AY = new THREE.Vector3(0, 1, 0); // +Y axis constant

// Verlet physics constants
const GRAVITY_ACC = 9.8;        // m/s² downward
const VERLET_DAMP = 0.985;      // per-step velocity damping (slight water resistance)
const SOLVE_ITERS = 4;          // constraint solver iterations per step
const LINK_SPACING = 0.14;      // rest distance between adjacent particles
const CONSTRAINT_RELAX = 0.5;   // splits distance-constraint correction equally between both particles
const PARALLEL_THRESHOLD = 0.9; // dot-product threshold for near-parallel vector detection in cross-product fallback
const MIN_LINKS = 8;            // minimum chain links per chain (near LOD)

// LOD configuration
const LOD_CFG = {
  near: {
    bodySegs: [32, 24], cowlSegs: [24, 16],
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
    // Each entry: { pos, prev, linkCount, ax, ay, az, inst, weightObj }
    this._verletChains = [];

    // Mid-LOD pendulum chain groups (simple Group-based, sinusoidal sway)
    this._midChains = [];

    // Near-LOD mesh refs for secondary idle animation
    this._bodyNear = null;
    this._cowlNear = null;

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
    });
    let chainMat = new THREE.MeshPhysicalMaterial({
      // Rusted wet metal — moderate metalness with clearcoat gloss
      color: 0x2a2030, roughness: 0.45, metalness: 0.6,
      clearcoat: 0.5, clearcoatRoughness: 0.55,
      emissive: 0x102030, emissiveIntensity: 0.3,
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
        // Scarring ridges + armor-plate surface displacement
        bp.setX(i, x + Math.sin(y * 7) * 0.04 + Math.sin(z * 5) * 0.025);
        bp.setY(i, y + Math.cos(x * 4 + z * 3) * 0.03);
      } else {
        bp.setX(i, x + Math.sin(y * 7) * 0.04);
      }
    }
    bodyGeo.computeVertexNormals();
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    g.add(bodyMesh);
    if (tierName === 'near') this._bodyNear = bodyMesh;

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
      const cowlMesh = new THREE.Mesh(cowlGeo, bodyMat);
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
    // Shared TorusGeometry across all InstancedMesh instances (same geometry)
    const linkGeo = new THREE.TorusGeometry(
      0.06, 0.015, cfg.linkTubeSegs[0], cfg.linkTubeSegs[1],
    );

    for (let c = 0; c < cfg.chainCount; c++) {
      const linkCount = MIN_LINKS + Math.floor(Math.random() * (cfg.maxLinks - MIN_LINKS + 1));
      const N = linkCount + 1; // N+1 particles for N link segments

      // InstancedMesh: single draw call for all links in this chain
      const inst = new THREE.InstancedMesh(linkGeo, chainMat, linkCount);
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      inst.frustumCulled = false; // particles move in world space; skip per-instance cull
      parentGroup.add(inst);

      // Attachment point in group-local space
      const ax = c * 0.4 - 0.6;
      const ay = -0.6;
      const az = (c % 2 === 0 ? -1 : 1) * 0.2;

      // Particle buffers — world-space positions
      // Root particle (index 0) is pinned to body attachment each step.
      const pos  = new Float32Array(3 * N);
      const prev = new Float32Array(3 * N);

      // Weight with barnacle accumulation detail
      const wGroup = new THREE.Group();
      wGroup.add(new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), weightMat));
      for (let b = 0; b < cfg.barnacles; b++) {
        const ang = Math.random() * Math.PI * 2;
        const bGeo = new THREE.CylinderGeometry(
          0.012, 0.02, 0.04 + Math.random() * 0.04, 5,
        );
        const barn = new THREE.Mesh(bGeo, weightMat);
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
          const i0 = 0, i1 = 3;
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

  update(dt, playerPos) {
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
    }

    // Translate — reuse _v0 to avoid direction.clone() allocation
    _v0.copy(this.direction).multiplyScalar(this.speed * dt);
    this.group.position.add(_v0);

    // Face direction
    const angle = Math.atan2(this.direction.x, this.direction.z);
    this.group.rotation.y = THREE.MathUtils.lerp(this.group.rotation.y, angle, dt * 2);

    const dist = this.group.position.distanceTo(playerPos);

    // Near LOD: Verlet physics + instance matrix update + idle secondary motion
    if (dist <= LOD_NEAR_DISTANCE) {
      this._stepVerlet(dt);
      this._updateInstances();

      // Breathing/idle: subtle body swell
      if (this._bodyNear) {
        const breathe = 1 + Math.sin(this.time * 0.7) * 0.015;
        this._bodyNear.scale.setScalar(breathe);
      }
      // Cowl billowing: oscillates opposite to movement
      if (this._cowlNear) {
        this._cowlNear.rotation.z = Math.sin(this.time * 1.2) * 0.04;
        this._cowlNear.rotation.x = -Math.min(this.speed * 0.025, 0.1);
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

    // Respawn when too far from player
    if (dist > 200) {
      const a = Math.random() * Math.PI * 2;
      this.group.position.set(
        playerPos.x + Math.cos(a) * 70,
        playerPos.y - Math.random() * 10,
        playerPos.z + Math.sin(a) * 70,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------------

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
    this._verletChains.length = 0;
    this._midChains.length = 0;
  }
}
