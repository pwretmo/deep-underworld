import * as THREE from 'three';
import { LOD_NEAR_DISTANCE, LOD_MEDIUM_DISTANCE, toStandardMaterial } from './lodUtils.js';

// Pre-allocated temps — zero per-frame allocations
const _tv0 = new THREE.Vector3();
const _tv1 = new THREE.Vector3();
const _tv2 = new THREE.Vector3();

// LOD geometry profile per tier
const MOC_LOD = {
  near:   { tentSegs: 8, radial: 6,  mantleW: 36, mantleH: 28, rivets: 24, details: true  },
  medium: { tentSegs: 4, radial: 5,  mantleW: 20, mantleH: 16, rivets: 12, details: false },
  far:    { tentSegs: 0, radial: 4,  mantleW: 10, mantleH: 8,  rivets: 0,  details: false },
};

// Biomechanical octopus with industrial tentacles, riveted dome, suction cups as mechanical clamps
export class MechOctopus {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time = Math.random() * 100;
    this.speed = 1.2 + Math.random() * 0.8;
    this.direction = new THREE.Vector3(Math.random() - 0.5, -0.1, Math.random() - 0.5).normalize();
    this.turnTimer = 0;
    this.turnInterval = 8 + Math.random() * 8;
    // Backward-compatible public array: contains root nodes of near-tier tentacle chains
    this.tentacles = [];

    // Per-tentacle randomised phase + frequency for independent curl
    this._tentPhase = Array.from({ length: 8 }, (_, i) => i * Math.PI / 4 + Math.random() * 0.5);
    this._tentFreq  = Array.from({ length: 8 }, () => 1.8 + Math.random() * 0.6);

    // Water-mass inertia state
    this._velocity = this.direction.clone().multiplyScalar(this.speed);

    // Chromatophore alarm state [0,1]
    this._alarmFlash = 0;

    // Cached player distance (updated each frame)
    this._playerDist = 999;

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  _buildModel() {
    this._lod = new THREE.LOD();
    this._tierGroups = {};
    this._tentaclesByTier = { near: [], medium: [], far: [] };

    // Build tiers: near wins at 0, medium at LOD_NEAR_DISTANCE, far at LOD_MEDIUM_DISTANCE
    for (const [name, dist] of [['near', 0], ['medium', LOD_NEAR_DISTANCE], ['far', LOD_MEDIUM_DISTANCE]]) {
      const g = this._buildTier(name);
      this._lod.addLevel(g, dist);
      this._tierGroups[name] = g;
    }

    this.group.add(this._lod);

    // Eye point-light lives on near tier only
    this.eyeLight = new THREE.PointLight(0xffaa00, 0.8, 10);
    this.eyeLight.position.set(0.5, 0, 0);
    this._tierGroups.near.add(this.eyeLight);

    this.group.scale.setScalar(2 + Math.random() * 1.5);
  }

  _buildTier(tierName) {
    const p = MOC_LOD[tierName];
    const g = new THREE.Group();
    const useFar = tierName === 'far';

    // --- Materials ---
    let bodyMat = new THREE.MeshPhysicalMaterial({
      color: 0x182028, roughness: 0.28, metalness: 0.05,
      clearcoat: 0.65, clearcoatRoughness: 0.36,
      emissive: 0x203858, emissiveIntensity: 0.45,
      iridescence: tierName === 'near' ? 0.4 : 0,
      iridescenceIOR: 1.6,
    });
    let metalMat = new THREE.MeshPhysicalMaterial({
      color: 0x141414, roughness: 0.26, metalness: 0.7,
      clearcoat: 0.5, clearcoatRoughness: 0.4,
      emissive: 0x204060, emissiveIntensity: 0.22,
    });
    let organicMat = new THREE.MeshPhysicalMaterial({
      color: 0x201828, roughness: 0.30, metalness: 0,
      clearcoat: 0.7, clearcoatRoughness: 0.35,
      emissive: 0x203858, emissiveIntensity: 0.5,
    });

    if (useFar) {
      const ob = bodyMat;   bodyMat   = toStandardMaterial(bodyMat);   ob.dispose();
      const om = metalMat;  metalMat  = toStandardMaterial(metalMat);  om.dispose();
      const oo = organicMat; organicMat = toStandardMaterial(organicMat); oo.dispose();
    }

    if (tierName === 'near') this._bodyMatNear = bodyMat;

    // --- Mantle ---
    const mantleGeo = new THREE.SphereGeometry(1.2, p.mantleW, p.mantleH);
    mantleGeo.scale(1, 1.3, 0.9);
    const mp = mantleGeo.attributes.position;

    // Organic displacement: panel seams + muscle ripples
    for (let i = 0; i < mp.count; i++) {
      const x = mp.getX(i), y = mp.getY(i), z = mp.getZ(i);
      mp.setX(i, x + Math.sin(y * 10) * 0.02 + Math.sin(z * 6 + y * 4) * 0.015);
      mp.setY(i, y + Math.sin(x * 5 + z * 3) * 0.01);
    }
    mantleGeo.computeVertexNormals();
    const mantleMesh = new THREE.Mesh(mantleGeo, bodyMat);
    g.add(mantleMesh);

    // Store original vertex positions + pre-computed inverse lengths for breathing animation (near only).
    // _mantleInvLen avoids a per-vertex sqrt every frame (~1008 verts at 36×28 resolution).
    if (tierName === 'near') {
      this._mantleOrigPos = new Float32Array(mp.array);
      this._mantlePosAttr = mp;
      this._mantleInvLen  = new Float32Array(mp.count);
      for (let i = 0; i < mp.count; i++) {
        const ox = mp.getX(i), oy = mp.getY(i), oz = mp.getZ(i);
        const len = Math.sqrt(ox * ox + oy * oy + oz * oz);
        this._mantleInvLen[i] = len > 0.001 ? 1 / len : 0;
      }
    }

    // --- Chromatophore spots on mantle surface (near) ---
    if (p.details) {
      this._chromaMats = [];
      for (let i = 0; i < 22; i++) {
        const phi   = Math.random() * Math.PI * 2;
        const theta = Math.random() * Math.PI * 0.7;
        const r     = 0.04 + Math.random() * 0.055;
        const chromaGeo = new THREE.CircleGeometry(r, 7);
        const chromaMat = new THREE.MeshPhysicalMaterial({
          color: 0x0070cc, emissive: 0x0055bb, emissiveIntensity: 0.9,
          roughness: 0.2, metalness: 0, transparent: true, opacity: 0.88,
        });
        const chroma = new THREE.Mesh(chromaGeo, chromaMat);
        const sr = 1.23;
        chroma.position.set(
          Math.sin(theta) * Math.cos(phi) * sr,
          Math.cos(theta) * 1.3 * sr * 0.78 + 0.1,
          Math.sin(theta) * Math.sin(phi) * sr * 0.92
        );
        // Face outward from mantle centre
        _tv0.copy(chroma.position).multiplyScalar(2);
        chroma.lookAt(_tv0);
        g.add(chroma);
        this._chromaMats.push(chromaMat);
      }
    }

    // --- Rivet bolt details ---
    for (let i = 0; i < p.rivets; i++) {
      const phi   = (i / p.rivets) * Math.PI * 2 + Math.random() * 0.3;
      const theta = 0.2 + Math.random() * Math.PI * 0.55;
      const rivetGeo = new THREE.CylinderGeometry(0.025, 0.035, 0.04, 6);
      const rivet = new THREE.Mesh(rivetGeo, metalMat);
      rivet.position.set(
        Math.sin(theta) * Math.cos(phi) * 1.18,
        Math.cos(theta) * 1.56 + 0.15,
        Math.sin(theta) * Math.sin(phi) * 1.06
      );
      _tv0.copy(rivet.position).multiplyScalar(2);
      rivet.lookAt(_tv0);
      g.add(rivet);
    }

    // --- Eyes with horizontal pupil slit ---
    for (const side of [-1, 1]) {
      const eyeGeo = new THREE.SphereGeometry(0.2, 12, 12);
      eyeGeo.scale(1.3, 1, 1);
      const eyeMat = new THREE.MeshPhysicalMaterial({
        color: 0xffaa00, emissive: 0xcc8800,
        emissiveIntensity: tierName === 'near' ? 2.0 : 1.2,
        roughness: 0.1, clearcoat: 1.0,
      });
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(0.5, 0, side * 0.9);
      g.add(eye);

      if (p.details) {
        // Horizontal slit pupil
        const pupilGeo = new THREE.BoxGeometry(0.3, 0.055, 0.012);
        const pupil = new THREE.Mesh(pupilGeo, new THREE.MeshPhysicalMaterial({
          color: 0x000000, roughness: 1, metalness: 0,
        }));
        pupil.position.set(0.76, 0, side * 0.9);
        g.add(pupil);
      }
    }

    // --- Web membrane between tentacle bases (near) ---
    if (p.details) {
      this._webMeshes = [];
      for (let i = 0; i < 8; i++) {
        const a0 = (i / 8) * Math.PI * 2;
        const a1 = ((i + 1) / 8) * Math.PI * 2;
        const webGeo = this._buildWebGeo(a0, a1);
        const webMat = new THREE.MeshPhysicalMaterial({
          color: 0x102030, roughness: 0.4, metalness: 0,
          transparent: true, opacity: 0.55, side: THREE.DoubleSide,
          emissive: 0x103040, emissiveIntensity: 0.25,
        });
        const webMesh = new THREE.Mesh(webGeo, webMat);
        webMesh.position.y = -0.8;
        g.add(webMesh);
        this._webMeshes.push(webMesh);
      }
    }

    // --- Tentacles ---
    if (tierName === 'far') {
      // Far LOD: lightweight single-cylinder tentacles, group-rotation only
      for (let t = 0; t < 8; t++) {
        const angle = (t / 8) * Math.PI * 2;
        const tg = new THREE.Group();
        const tGeo = new THREE.CylinderGeometry(0.06, 0.1, 2.5, 4);
        tg.add(new THREE.Mesh(tGeo, organicMat));
        tg.children[0].position.y = -1.25;
        tg.position.set(Math.cos(angle) * 0.6, -0.8, Math.sin(angle) * 0.5);
        tg.rotation.x = 0.3;
        this._tentaclesByTier.far.push(tg);
        g.add(tg);
      }
    } else {
      // Near / medium: hierarchical per-segment curl chains
      const chains = this._tentaclesByTier[tierName];
      for (let t = 0; t < 8; t++) {
        const angle = (t / 8) * Math.PI * 2;
        const chain = this._buildTentacleChain(p.tentSegs, metalMat, organicMat, p.details, p.radial);
        chain.root.position.set(Math.cos(angle) * 0.6, -0.8, Math.sin(angle) * 0.5);
        chains.push(chain);
        if (tierName === 'near') this.tentacles.push(chain.root);
        g.add(chain.root);
      }
    }

    // --- Siphon jet (open-ended cylinder) ---
    const siphonGeo = new THREE.CylinderGeometry(0.1, 0.18, 0.45, p.details ? 10 : 6, 1, true);
    const siphonMesh = new THREE.Mesh(siphonGeo, metalMat);
    siphonMesh.position.set(-0.8, -0.3, 0);
    siphonMesh.rotation.z = Math.PI / 4;
    g.add(siphonMesh);
    if (tierName === 'near') this._siphon = siphonMesh;

    // Siphon interior funnel (near only)
    if (p.details) {
      const funnelGeo = new THREE.ConeGeometry(0.1, 0.14, 8, 1, true);
      const funnel = new THREE.Mesh(funnelGeo, metalMat);
      funnel.position.set(-0.93, -0.45, 0);
      funnel.rotation.z = Math.PI / 4;
      g.add(funnel);
    }

    return g;
  }

  /** Quad-fan web membrane between two tentacle base angles. */
  _buildWebGeo(a0, a1) {
    const N = 6;
    const r0 = 0.22, r1 = 0.68;
    const positions = [], normals = [], uvs = [], indices = [];

    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const a = a0 + (a1 - a0) * t;
      for (let j = 0; j <= 1; j++) {
        const r = j === 0 ? r0 : r1;
        positions.push(Math.cos(a) * r, 0, Math.sin(a) * r * 0.82);
        normals.push(0, 1, 0);
        uvs.push(t, j);
      }
    }
    for (let i = 0; i < N; i++) {
      const b = i * 2;
      indices.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal',   new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    return geo;
  }

  /**
   * Build a hierarchical tentacle chain for per-segment curl.
   * Each segment Group is the child of the previous, so local rotation
   * compounds naturally to produce smooth curl.
   */
  _buildTentacleChain(segCount, metalMat, organicMat, addClamps, radial) {
    const root = new THREE.Group();
    const segments = [];
    let parent = root;

    for (let s = 0; s < segCount; s++) {
      const r = 0.09 * (1 - (s / segCount) * 0.6);
      const node = new THREE.Group();
      node.position.y = -0.32; // offset so each node is at bottom of parent cylinder

      // Alternating metal / organic cylinder segment
      const segGeo = new THREE.CylinderGeometry(r * 0.88, r, 0.32, radial);
      const segMesh = new THREE.Mesh(segGeo, s % 2 === 0 ? metalMat : organicMat);
      segMesh.position.y = -0.16; // centre of this segment's cylinder
      node.add(segMesh);

      if (addClamps && s % 2 === 0 && s > 0) {
        // Improved suction clamp ring
        const clampGeo = new THREE.TorusGeometry(r * 1.25, 0.012, 8, 12);
        const clamp = new THREE.Mesh(clampGeo, metalMat);
        clamp.position.y = -0.16;
        clamp.rotation.x = Math.PI / 2;
        node.add(clamp);

        // Cup interior — dark concave disc
        const cupGeo = new THREE.CircleGeometry(r * 0.9, 8);
        const cup = new THREE.Mesh(cupGeo, new THREE.MeshPhysicalMaterial({
          color: 0x050810, roughness: 0.5, metalness: 0.3,
          emissive: 0x001828, emissiveIntensity: 0.25,
        }));
        cup.position.y = -0.16;
        cup.rotation.x = -Math.PI / 2;
        node.add(cup);
      }

      parent.add(node);
      segments.push(node);
      parent = node;
    }

    return { root, segments };
  }

  // ─── Update ──────────────────────────────────────────────────────────────────

  update(dt, playerPos) {
    this.time += dt;
    this.turnTimer += dt;

    this._playerDist = this.group.position.distanceTo(playerPos);

    // --- Direction / steering ---
    if (this.turnTimer > this.turnInterval) {
      this.turnTimer = 0;
      this.turnInterval = 8 + Math.random() * 8;
      if (Math.random() < 0.35) {
        _tv0.subVectors(playerPos, this.group.position).normalize();
        _tv0.y *= 0.2;
        this.direction.copy(_tv0);
      } else {
        this.direction.set(
          Math.random() - 0.5,
          (Math.random() - 0.5) * 0.1,
          Math.random() - 0.5
        ).normalize();
      }
    }

    // Player proximity reaction: lunge + alarm flash
    if (this._playerDist < 25) {
      _tv0.subVectors(playerPos, this.group.position).normalize();
      this.direction.lerp(_tv0, dt * 3);
      this._alarmFlash = Math.min(1, this._alarmFlash + dt * 2);
    } else {
      this._alarmFlash = Math.max(0, this._alarmFlash - dt);
    }

    // --- Water-mass inertia: smooth velocity changes ---
    _tv0.copy(this.direction).multiplyScalar(this.speed);
    this._velocity.lerp(_tv0, dt * 1.5);

    // --- Jet-pulse movement ---
    const pulse = Math.max(0, Math.sin(this.time * 2));
    _tv1.copy(this._velocity).multiplyScalar(dt);
    _tv2.copy(this.direction).multiplyScalar(pulse * 2 * dt);
    this.group.position.add(_tv1).add(_tv2);

    // --- Face direction ---
    const facingAngle = Math.atan2(this.direction.x, this.direction.z);
    this.group.rotation.y = THREE.MathUtils.lerp(
      this.group.rotation.y, facingAngle + Math.PI / 2, dt * 2
    );

    // --- LOD-gated animation ---
    const isNear = this._playerDist < LOD_NEAR_DISTANCE;
    const isMed  = this._playerDist < LOD_MEDIUM_DISTANCE;

    if (isNear) {
      this._animateTentaclesNear();
      this._animateMantleBreathing(pulse);
      this._animateChromatophore();
      if (this.eyeLight) {
        this.eyeLight.intensity = 0.6 + Math.sin(this.time * 3) * 0.3 + this._alarmFlash * 0.8;
      }
      if (this._siphon) {
        const tRot = Math.atan2(-this.direction.y, -1) + Math.PI / 4;
        this._siphon.rotation.z = THREE.MathUtils.lerp(this._siphon.rotation.z, tRot, dt * 2);
      }
    } else if (isMed) {
      this._animateTentaclesMed();
    } else {
      this._animateTentaclesFar();
    }

    // Respawn when very far from player
    if (this._playerDist > 200) {
      const a = Math.random() * Math.PI * 2;
      this.group.position.set(
        playerPos.x + Math.cos(a) * 70,
        playerPos.y - Math.random() * 15,
        playerPos.z + Math.sin(a) * 70
      );
    }
  }

  // ─── Per-tier tentacle animation ─────────────────────────────────────────────

  _animateTentaclesNear() {
    const chains = this._tentaclesByTier.near;
    for (let i = 0; i < chains.length; i++) {
      const { root, segments } = chains[i];
      const phase = this.time * this._tentFreq[i] + this._tentPhase[i];

      // Root orientation: spread wave
      root.rotation.x = Math.sin(phase) * 0.35;
      root.rotation.z = Math.cos(phase * 0.6) * 0.25;

      // Proximity reach: lean toward player
      if (this._playerDist < 30) {
        const reach = 1 - this._playerDist / 30;
        root.rotation.x += reach * 0.4 * Math.cos(i * Math.PI / 4);
        root.rotation.z += reach * 0.4 * Math.sin(i * Math.PI / 4);
      }

      // Per-segment curl: progressive rotation compounds down the chain
      for (let s = 0; s < segments.length; s++) {
        const sp = phase + s * 0.4;
        const amt = 0.10 + (s / segments.length) * 0.18;
        segments[s].rotation.x = Math.sin(sp) * amt;
        segments[s].rotation.z = Math.cos(sp * 0.7) * amt * 0.6;
      }
    }
  }

  _animateTentaclesMed() {
    const chains = this._tentaclesByTier.medium;
    for (let i = 0; i < chains.length; i++) {
      const { root, segments } = chains[i];
      const phase = this.time * 2 + this._tentPhase[i];
      root.rotation.x = Math.sin(phase) * 0.3;
      root.rotation.z = Math.cos(phase * 0.6) * 0.2;
      // Simplified tip curl
      if (segments.length > 1) {
        const tip = segments[segments.length - 1];
        tip.rotation.x = Math.sin(phase * 1.3) * 0.2;
      }
    }
  }

  _animateTentaclesFar() {
    const groups = this._tentaclesByTier.far;
    for (let i = 0; i < groups.length; i++) {
      const phase = this.time * 2 + i * Math.PI / 4;
      groups[i].rotation.x = Math.sin(phase) * 0.3;
      groups[i].rotation.z = Math.cos(phase * 0.6) * 0.2;
    }
  }

  // ─── Mantle jet-pulse breathing ───────────────────────────────────────────────

  _animateMantleBreathing(pulse) {
    const orig   = this._mantleOrigPos;
    const attr   = this._mantlePosAttr;
    const invLen = this._mantleInvLen;
    if (!orig || !attr || !invLen) return;

    // Inflate each vertex outward proportional to jet pulse + alarm.
    // Uses pre-computed inverse lengths to avoid per-frame sqrt.
    const inflation = 0.04 * pulse + this._alarmFlash * 0.05;
    for (let i = 0; i < attr.count; i++) {
      const ox = orig[i * 3], oy = orig[i * 3 + 1], oz = orig[i * 3 + 2];
      const s = 1 + inflation * invLen[i];
      attr.setXYZ(i, ox * s, oy * s, oz * s);
    }
    attr.needsUpdate = true;
  }

  // ─── Chromatophore emissive wave ──────────────────────────────────────────────

  _animateChromatophore() {
    if (!this._bodyMatNear) return;

    const wave  = Math.sin(this.time * 1.5) * 0.5 + 0.5;
    const alarm = this._alarmFlash;

    // Bioluminescent teal base, orange-red alarm flash
    const r  = 0.10 + wave * 0.06 + alarm * 0.42;
    const gn = 0.20 + wave * 0.10 + alarm * 0.02;
    const b  = 0.34 + wave * 0.20;

    this._bodyMatNear.emissive.setRGB(r, gn, b);
    this._bodyMatNear.emissiveIntensity = 0.40 + wave * 0.20 + alarm * 0.60;

    // Individual chromatophore cells: travelling wave across spots
    if (this._chromaMats) {
      for (let i = 0; i < this._chromaMats.length; i++) {
        const cw = Math.sin(this.time * 2.2 + i * 0.75) * 0.5 + 0.5;
        this._chromaMats[i].emissiveIntensity = (0.3 + cw * 1.3) * (1 + alarm * 0.8);
      }
    }
  }

  // ─── Public API ───────────────────────────────────────────────────────────────

  getPosition() { return this.group.position; }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(c => {
      if (c.isMesh) {
        c.geometry.dispose();
        if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
        else c.material.dispose();
      }
    });
  }
}
