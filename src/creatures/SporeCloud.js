import * as THREE from 'three/webgpu';
import { attribute, materialEmissive, sin, uniform, varying } from 'three/tsl';
import { LOD_NEAR_DISTANCE, LOD_MEDIUM_DISTANCE } from './lodUtils.js';

// Pre-allocated module-level temporaries — zero per-frame allocations
const _dummy = new THREE.Object3D();
const _vec3a = new THREE.Vector3();
const _vec3b = new THREE.Vector3();

const NEAR_COUNT = 40;
const MID_COUNT = 20;
const TENDRILS_PER_SPORE = 2;
const CASCADE_FALLOFF = 2.0;
const CASCADE_SPEED = 3.0;
const CASCADE_RADIUS_SQ = 4.0; // 2m propagation radius
const BOID_SEP_RADIUS = 0.8;
const BOID_SEP_FORCE = 2.0;
const BOID_COHESION_FORCE = 0.3;
const BOID_DRAG = 0.95;
const SCATTER_PROXIMITY = 8.0;
const SCATTER_FORCE = 3.0;
const RESPAWN_DISTANCE = 200;
const RESPAWN_RADIUS = 80;

// Patch a MeshPhysicalMaterial to animate bioluminescent emissive per-instance.
// Adds `instancePulsePhase` and `instanceCascade` InstancedBufferAttributes that
// must be set on the geometry before the first render.
function _patchBioMaterial(mat, coreMode) {
  mat.userData.shaderUniforms = {
    uTime:       uniform(0.0),
    uPulseSpeed: uniform(coreMode ? 2.2 : 1.8),
    uPulseAmt:   uniform(coreMode ? 1.0 : 0.5),
    uCascAmt:    uniform(coreMode ? 3.0 : 2.0),
  };
  const u = mat.userData.shaderUniforms;

  // TSL: pass instance attributes through varying to fragment
  const vPulsePhase = varying(attribute('instancePulsePhase', 'float'));
  const vCascade = varying(attribute('instanceCascade', 'float'));

  // TSL: emissive pulse per-instance
  const pulse = sin(u.uTime.mul(u.uPulseSpeed).add(vPulsePhase)).mul(0.5).add(0.5);
  mat.emissiveNode = materialEmissive.add(
    materialEmissive.mul(pulse.mul(u.uPulseAmt).add(vCascade.mul(u.uCascAmt)))
  );
}

// Radial glow texture used by the far-LOD billboard
function _createGlowTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0,   'rgba(0,255,100,1)');
  g.addColorStop(0.3, 'rgba(0,200,60,0.6)');
  g.addColorStop(0.7, 'rgba(0,100,30,0.15)');
  g.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

const _glowTexture = _createGlowTexture();

// Cloud of tiny biomechanical spores — InstancedMesh + bioluminescent cascade + flock cohesion
export class SporeCloud {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time = Math.random() * 100;
    this.speed = 0.5 + Math.random() * 0.3;
    this.direction = new THREE.Vector3(Math.random() - 0.5, -0.05, Math.random() - 0.5).normalize();
    this.turnTimer = 0;
    this.turnInterval = 12 + Math.random() * 10;

    // Per-spore state — pre-allocated flat Float32Arrays, no per-frame GC
    this._offsets    = new Float32Array(NEAR_COUNT * 3); // cloud-local base positions
    this._velocities = new Float32Array(NEAR_COUNT * 3); // boid velocities
    this._sizes      = new Float32Array(NEAR_COUNT);     // per-spore base radius
    this._phases     = new Float32Array(NEAR_COUNT);     // per-spore pulse phase offset
    this._cascade    = new Float32Array(NEAR_COUNT);     // cascade brightness [0..1]
    // Tendril local offsets (relative to each spore centre) and fixed Euler rotations
    this._tendrilRelPos = new Float32Array(NEAR_COUNT * TENDRILS_PER_SPORE * 3);
    this._tendrilRot    = new Float32Array(NEAR_COUNT * TENDRILS_PER_SPORE * 3);

    this._cascadeTimer = 0;
    this._breathAmp = 0.08 + Math.random() * 0.08;

    for (let i = 0; i < NEAR_COUNT; i++) {
      const r   = 1 + Math.random() * 2.5;
      const phi = Math.random() * Math.PI * 2;
      const tht = Math.random() * Math.PI;
      this._offsets[i * 3    ] = Math.sin(tht) * Math.cos(phi) * r;
      this._offsets[i * 3 + 1] = Math.sin(tht) * Math.sin(phi) * r;
      this._offsets[i * 3 + 2] = Math.cos(tht) * r;
      this._sizes[i]  = 0.04 + Math.random() * 0.06;
      this._phases[i] = Math.random() * Math.PI * 2;
    }

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  // ─── Build ───────────────────────────────────────────────────────────────

  _buildModel() {
    const lod = new THREE.LOD();
    this._lod = lod;

    const nearGroup = new THREE.Group();
    this._buildNearTier(nearGroup);
    lod.addLevel(nearGroup, 0);

    const midGroup = new THREE.Group();
    this._buildMidTier(midGroup);
    lod.addLevel(midGroup, LOD_NEAR_DISTANCE);

    const farGroup = new THREE.Group();
    this._buildFarTier(farGroup);
    lod.addLevel(farGroup, LOD_MEDIUM_DISTANCE);

    this.group.add(lod);
  }

  _buildNearTier(parent) {
    const sporeMat = new THREE.MeshPhysicalMaterial({
      color: 0x0a2010,
      roughness: 0.25,
      metalness: 0.05,
      clearcoat: 0.9,
      clearcoatRoughness: 0.2,
      transparent: true,
      opacity: 0.75,
      emissive: new THREE.Color(0x10a030),
      emissiveIntensity: 0.5,
      transmission: 0.3,
      thickness: 0.5,
    });
    _patchBioMaterial(sporeMat, false);

    // Separate unpatched material for tendrils — tendrils don't need
    // per-instance pulse/cascade animation (they ride their parent spore's glow).
    const tendrilMat = new THREE.MeshPhysicalMaterial({
      color: 0x0a2010,
      roughness: 0.25,
      metalness: 0.05,
      clearcoat: 0.9,
      clearcoatRoughness: 0.2,
      transparent: true,
      opacity: 0.75,
      emissive: new THREE.Color(0x10a030),
      emissiveIntensity: 0.5,
      transmission: 0.3,
      thickness: 0.5,
    });
    this._nearTendrilMat = tendrilMat;

    const coreMat = new THREE.MeshPhysicalMaterial({
      color: 0x00ff66,
      emissive: new THREE.Color(0x00dd44),
      emissiveIntensity: 2.5,
      roughness: 0.0,
      transparent: true,
      opacity: 0.9,
      transmission: 0.2,
    });
    _patchBioMaterial(coreMat, true);

    this._nearSporeMat = sporeMat;
    this._nearCoreMat  = coreMat;

    // Shared geometries (unit-scale; instances scale via matrix)
    const shellGeo   = new THREE.SphereGeometry(1, 16, 12);
    const coreGeo    = new THREE.SphereGeometry(0.5, 12, 8);
    const tendrilGeo = new THREE.CylinderGeometry(0.04, 0.02, 3, 4);

    // Per-instance custom attributes on each geometry
    const mkAttr = (n) => new THREE.InstancedBufferAttribute(new Float32Array(n), 1);

    const shellPulse   = mkAttr(NEAR_COUNT);
    const shellCascade = mkAttr(NEAR_COUNT);
    const corePulse    = mkAttr(NEAR_COUNT);
    const coreCascade  = mkAttr(NEAR_COUNT);

    shellGeo.setAttribute('instancePulsePhase', shellPulse);
    shellGeo.setAttribute('instanceCascade',    shellCascade);
    coreGeo.setAttribute('instancePulsePhase',  corePulse);
    coreGeo.setAttribute('instanceCascade',     coreCascade);

    this._nearShellPulse   = shellPulse;
    this._nearShellCascade = shellCascade;
    this._nearCorePulse    = corePulse;
    this._nearCoreCascade  = coreCascade;

    // InstancedMesh: single draw call for all 40 spore shells / cores
    const shellMesh = new THREE.InstancedMesh(shellGeo, sporeMat, NEAR_COUNT);
    const coreMesh  = new THREE.InstancedMesh(coreGeo,  coreMat,  NEAR_COUNT);
    shellMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    coreMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    this._nearShellMesh = shellMesh;
    this._nearCoreMesh  = coreMesh;

    // Tendrils: NEAR_COUNT * TENDRILS_PER_SPORE instances — one draw call
    const tendrilMesh = new THREE.InstancedMesh(tendrilGeo, tendrilMat, NEAR_COUNT * TENDRILS_PER_SPORE);
    tendrilMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this._nearTendrilMesh = tendrilMesh;

    // Initialise all instance matrices and pulse phases
    for (let i = 0; i < NEAR_COUNT; i++) {
      shellPulse.setX(i, this._phases[i]);
      corePulse.setX(i, this._phases[i]);
      const s = this._sizes[i];
      _dummy.position.set(this._offsets[i * 3], this._offsets[i * 3 + 1], this._offsets[i * 3 + 2]);
      _dummy.scale.setScalar(s);
      _dummy.rotation.set(0, 0, 0);
      _dummy.updateMatrix();
      shellMesh.setMatrixAt(i, _dummy.matrix);
      _dummy.scale.setScalar(s * 0.5);
      _dummy.updateMatrix();
      coreMesh.setMatrixAt(i, _dummy.matrix);

      // Two tendrils per spore, branching outward — store relative offsets for dynamic updates
      for (let f = 0; f < TENDRILS_PER_SPORE; f++) {
        const ti  = i * TENDRILS_PER_SPORE + f;
        const a   = (f / TENDRILS_PER_SPORE) * Math.PI * 2 + this._phases[i];
        const rx  = Math.cos(a) * s * 0.7;
        const rz  = Math.sin(a) * s * 0.7;
        this._tendrilRelPos[ti * 3]     = rx;
        this._tendrilRelPos[ti * 3 + 1] = 0;
        this._tendrilRelPos[ti * 3 + 2] = rz;
        this._tendrilRot[ti * 3]     = (Math.random() - 0.5) * 0.8;
        this._tendrilRot[ti * 3 + 1] = Math.random() * Math.PI * 2;
        this._tendrilRot[ti * 3 + 2] = (Math.random() - 0.5) * 0.8;
        _dummy.position.set(
          this._offsets[i * 3] + rx,
          this._offsets[i * 3 + 1],
          this._offsets[i * 3 + 2] + rz
        );
        _dummy.scale.set(s, s, s);
        _dummy.rotation.set(this._tendrilRot[ti * 3], this._tendrilRot[ti * 3 + 1], this._tendrilRot[ti * 3 + 2]);
        _dummy.updateMatrix();
        tendrilMesh.setMatrixAt(ti, _dummy.matrix);
      }
    }
    shellMesh.instanceMatrix.needsUpdate  = true;
    coreMesh.instanceMatrix.needsUpdate   = true;
    tendrilMesh.instanceMatrix.needsUpdate = true;
    shellPulse.needsUpdate  = true;
    corePulse.needsUpdate   = true;

    parent.add(shellMesh);
    parent.add(coreMesh);
    parent.add(tendrilMesh);
  }

  _buildMidTier(parent) {
    const sporeMat = new THREE.MeshStandardMaterial({
      color: 0x0a2010,
      roughness: 0.3,
      metalness: 0.05,
      transparent: true,
      opacity: 0.7,
      emissive: new THREE.Color(0x10a030),
      emissiveIntensity: 0.4,
    });
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0x00ff66,
      emissive: new THREE.Color(0x00cc44),
      emissiveIntensity: 2.0,
      roughness: 0.0,
      transparent: true,
      opacity: 0.9,
    });

    this._midSporeMat = sporeMat;
    this._midCoreMat  = coreMat;

    const shellGeo = new THREE.SphereGeometry(1, 8, 6);
    const coreGeo  = new THREE.SphereGeometry(0.5, 6, 5);

    const shellMesh = new THREE.InstancedMesh(shellGeo, sporeMat, MID_COUNT);
    const coreMesh  = new THREE.InstancedMesh(coreGeo,  coreMat,  MID_COUNT);

    for (let i = 0; i < MID_COUNT; i++) {
      const s = this._sizes[i];
      _dummy.position.set(this._offsets[i * 3], this._offsets[i * 3 + 1], this._offsets[i * 3 + 2]);
      _dummy.scale.setScalar(s);
      _dummy.rotation.set(0, 0, 0);
      _dummy.updateMatrix();
      shellMesh.setMatrixAt(i, _dummy.matrix);
      _dummy.scale.setScalar(s * 0.5);
      _dummy.updateMatrix();
      coreMesh.setMatrixAt(i, _dummy.matrix);
    }
    shellMesh.instanceMatrix.needsUpdate = true;
    coreMesh.instanceMatrix.needsUpdate  = true;

    parent.add(shellMesh);
    parent.add(coreMesh);
  }

  _buildFarTier(parent) {
    const mat = new THREE.MeshBasicMaterial({
      map: _glowTexture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this._farMat = mat;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), mat);
    this._billboard = mesh;
    parent.add(mesh);
  }

  // ─── Update ──────────────────────────────────────────────────────────────

  update(dt, playerPos, distSq) {
    this.time += dt;
    this.turnTimer += dt;

    if (this.turnTimer > this.turnInterval) {
      this.turnTimer = 0;
      this.turnInterval = 12 + Math.random() * 10;
      this.direction.set(
        Math.random() - 0.5,
        (Math.random() - 0.5) * 0.05,
        Math.random() - 0.5
      ).normalize();
    }

    // Cloud-level drift (no allocation: scale into pre-alloc vec)
    _vec3a.copy(this.direction).multiplyScalar(this.speed * dt);
    this.group.position.add(_vec3a);

    // Respawn when too far from player
    if (distSq > RESPAWN_DISTANCE * RESPAWN_DISTANCE) {
      const a = Math.random() * Math.PI * 2;
      this.group.position.set(
        playerPos.x + Math.cos(a) * RESPAWN_RADIUS,
        playerPos.y - Math.random() * 10,
        playerPos.z + Math.sin(a) * RESPAWN_RADIUS
      );
    }

    // Far billboard always faces camera
    if (this._billboard) {
      _vec3b.copy(playerPos).sub(this.group.position);
      _vec3b.y = 0;
      if (_vec3b.lengthSq() > 0.001) {
        this._billboard.rotation.y = Math.atan2(_vec3b.x, _vec3b.z);
      }
      this._farMat.opacity = 0.5 + 0.3 * Math.sin(this.time * 1.5);
    }

    // Far LOD — no per-spore work
    if (distSq > LOD_MEDIUM_DISTANCE * LOD_MEDIUM_DISTANCE) return;

    // Medium LOD — simple whole-cloud emissive throb, no matrix updates
    if (distSq > LOD_NEAR_DISTANCE * LOD_NEAR_DISTANCE) {
      this._midSporeMat.emissiveIntensity = 0.3 + 0.15 * Math.sin(this.time * 1.2);
      this._midCoreMat.emissiveIntensity  = 1.8 + 0.5  * Math.sin(this.time * 1.5);
      return;
    }

    // Near LOD — full per-spore simulation
    if (this._nearSporeMat.userData.shader) {
      this._nearSporeMat.userData.shader.uniforms.uTime.value = this.time;
    }
    if (this._nearCoreMat.userData.shader) {
      this._nearCoreMat.userData.shader.uniforms.uTime.value = this.time;
    }

    this._updateCascade(dt);
    this._updateBoids(dt);
    this._updatePlayerProximity(playerPos, dt);
    this._updateInstanceMatrices();
  }

  _updateCascade(dt) {
    // Decay
    for (let i = 0; i < NEAR_COUNT; i++) {
      if (this._cascade[i] > 0) {
        this._cascade[i] = Math.max(0, this._cascade[i] - dt * CASCADE_FALLOFF);
      }
    }

    // Trigger new cascade wave
    this._cascadeTimer -= dt;
    if (this._cascadeTimer <= 0) {
      this._cascadeTimer = 3 + Math.random() * 5;
      this._cascade[Math.floor(Math.random() * NEAR_COUNT)] = 1.0;
    }

    // Propagate to neighbours
    for (let i = 0; i < NEAR_COUNT; i++) {
      if (this._cascade[i] < 0.05) continue;
      for (let j = 0; j < NEAR_COUNT; j++) {
        if (i === j) continue;
        const dx = this._offsets[i * 3]     - this._offsets[j * 3];
        const dy = this._offsets[i * 3 + 1] - this._offsets[j * 3 + 1];
        const dz = this._offsets[i * 3 + 2] - this._offsets[j * 3 + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < CASCADE_RADIUS_SQ) {
          const t = this._cascade[i] * dt * CASCADE_SPEED * (1 - d2 / CASCADE_RADIUS_SQ);
          this._cascade[j] = Math.min(1, this._cascade[j] + t);
        }
      }
    }

    // Upload to GPU attributes
    for (let i = 0; i < NEAR_COUNT; i++) {
      const v = this._cascade[i];
      this._nearShellCascade.setX(i, v);
      this._nearCoreCascade.setX(i, v);
    }
    this._nearShellCascade.needsUpdate = true;
    this._nearCoreCascade.needsUpdate  = true;
  }

  _updateBoids(dt) {
    for (let i = 0; i < NEAR_COUNT; i++) {
      const ix = this._offsets[i * 3];
      const iy = this._offsets[i * 3 + 1];
      const iz = this._offsets[i * 3 + 2];
      let sx = 0, sy = 0, sz = 0;

      for (let j = 0; j < NEAR_COUNT; j++) {
        if (i === j) continue;
        const dx = ix - this._offsets[j * 3];
        const dy = iy - this._offsets[j * 3 + 1];
        const dz = iz - this._offsets[j * 3 + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < BOID_SEP_RADIUS * BOID_SEP_RADIUS && d2 > 1e-4) {
          const d = Math.sqrt(d2);
          const f = (BOID_SEP_RADIUS - d) / BOID_SEP_RADIUS;
          sx += (dx / d) * f;
          sy += (dy / d) * f;
          sz += (dz / d) * f;
        }
      }

      // Cohesion: pull toward cloud centre (origin of local space)
      this._velocities[i * 3]     = this._velocities[i * 3]     * BOID_DRAG + (sx * BOID_SEP_FORCE - ix * BOID_COHESION_FORCE) * dt;
      this._velocities[i * 3 + 1] = this._velocities[i * 3 + 1] * BOID_DRAG + (sy * BOID_SEP_FORCE - iy * BOID_COHESION_FORCE) * dt;
      this._velocities[i * 3 + 2] = this._velocities[i * 3 + 2] * BOID_DRAG + (sz * BOID_SEP_FORCE - iz * BOID_COHESION_FORCE) * dt;
    }
    for (let i = 0; i < NEAR_COUNT; i++) {
      this._offsets[i * 3]     += this._velocities[i * 3]     * dt;
      this._offsets[i * 3 + 1] += this._velocities[i * 3 + 1] * dt;
      this._offsets[i * 3 + 2] += this._velocities[i * 3 + 2] * dt;
    }
  }

  _updatePlayerProximity(playerPos, dt) {
    // Player position relative to this cloud's centre
    _vec3a.copy(playerPos).sub(this.group.position);

    for (let i = 0; i < NEAR_COUNT; i++) {
      const rx = this._offsets[i * 3]     - _vec3a.x;
      const ry = this._offsets[i * 3 + 1] - _vec3a.y;
      const rz = this._offsets[i * 3 + 2] - _vec3a.z;
      const d2 = rx * rx + ry * ry + rz * rz;
      if (d2 < SCATTER_PROXIMITY * SCATTER_PROXIMITY && d2 > 1e-4) {
        const d = Math.sqrt(d2);
        const f = ((SCATTER_PROXIMITY - d) / SCATTER_PROXIMITY) * SCATTER_FORCE * dt;
        // Push spore away from player (rx/d points away from player toward spore)
        this._velocities[i * 3]     += (rx / d) * f;
        this._velocities[i * 3 + 1] += (ry / d) * f;
        this._velocities[i * 3 + 2] += (rz / d) * f;
      }
    }
  }

  _updateInstanceMatrices() {
    const breathScale = 1.0 + Math.sin(this.time * 0.4) * this._breathAmp;

    for (let i = 0; i < NEAR_COUNT; i++) {
      const s = this._sizes[i] * breathScale;
      const t = this.time * (0.5 + this._phases[i] * 0.3) + this._phases[i];

      const px = this._offsets[i * 3]     + Math.sin(t)       * 0.04;
      const py = this._offsets[i * 3 + 1] + Math.cos(t * 1.3) * 0.04;
      const pz = this._offsets[i * 3 + 2] + Math.sin(t * 0.7) * 0.04;

      _dummy.position.set(px, py, pz);
      _dummy.scale.setScalar(s);
      _dummy.rotation.set(0, 0, 0);
      _dummy.updateMatrix();
      this._nearShellMesh.setMatrixAt(i, _dummy.matrix);
      _dummy.scale.setScalar(s * 0.5);
      _dummy.updateMatrix();
      this._nearCoreMesh.setMatrixAt(i, _dummy.matrix);

      // Update tendrils to follow spore position
      for (let f = 0; f < TENDRILS_PER_SPORE; f++) {
        const ti = i * TENDRILS_PER_SPORE + f;
        _dummy.position.set(
          px + this._tendrilRelPos[ti * 3],
          py + this._tendrilRelPos[ti * 3 + 1],
          pz + this._tendrilRelPos[ti * 3 + 2]
        );
        _dummy.scale.set(s, s, s);
        _dummy.rotation.set(
          this._tendrilRot[ti * 3],
          this._tendrilRot[ti * 3 + 1],
          this._tendrilRot[ti * 3 + 2]
        );
        _dummy.updateMatrix();
        this._nearTendrilMesh.setMatrixAt(ti, _dummy.matrix);
      }
    }

    this._nearShellMesh.instanceMatrix.needsUpdate  = true;
    this._nearCoreMesh.instanceMatrix.needsUpdate   = true;
    this._nearTendrilMesh.instanceMatrix.needsUpdate = true;
  }

  // ─── Public API ──────────────────────────────────────────────────────────

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
    // Note: _glowTexture is a module-level singleton; not disposed here
  }
}
