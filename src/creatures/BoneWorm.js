import * as THREE from 'three/webgpu';
import { cos, positionLocal, sin, uniform, vec3 } from 'three/tsl';
import { LOD_NEAR_DISTANCE, LOD_MEDIUM_DISTANCE, toStandardMaterial } from './lodUtils.js';
import { qualityManager } from '../QualityManager.js';

// ── Pre-allocated temps (zero per-frame allocations) ────────────────────────
const _v3A = new THREE.Vector3();

// ── LOD tier profiles ───────────────────────────────────────────────────────
const BONEWORM_LOD = {
  near: {
    segmentCount: 22,
    vertebraRadial: 16,
    spineSegs: 8,
    fleshDetail: [24, 16],
    headDetail: [48, 32],
    toothSegs: 8,
    toothCount: 10,
    hasDiscs: true,
    hasMuscleStrands: true,
    hasMicroDetail: true,
    hasFleshDeform: true,
    hasSpineAnim: true,
  },
  medium: {
    segmentCount: 10,
    vertebraRadial: 10,
    spineSegs: 6,
    fleshDetail: [14, 10],
    headDetail: [24, 16],
    toothSegs: 6,
    toothCount: 8,
    hasDiscs: false,
    hasMuscleStrands: false,
    hasMicroDetail: false,
    hasFleshDeform: false,
    hasSpineAnim: false,
  },
  far: {
    segmentCount: 5,
    vertebraRadial: 6,
    spineSegs: 4,
    fleshDetail: [8, 6],
    headDetail: [10, 8],
    toothSegs: 4,
    toothCount: 5,
    hasDiscs: false,
    hasMuscleStrands: false,
    hasMicroDetail: false,
    hasFleshDeform: false,
    hasSpineAnim: false,
  },
};

const FAR_LOD_SKIP_DEFAULT = 3;
const FAR_LOD_SKIP_ULTRA = 4;
const LOD_HYSTERESIS = 4;
const RESPAWN_DISTANCE = 200;
const SEGMENT_SPACING = 0.9;
const PHASE_STEP = 0.5;
const UNDULATION_SPEED = 2.5;
const ROT_AMPLITUDE = 0.25;
const POS_AMPLITUDE_SCALE = 0.12;
const BREATHING_SPEED = 1.2;
const BREATHING_AMPLITUDE = 0.03;
const EMISSIVE_PULSE_SPEED = 1.8;
const JAW_OPEN_DISTANCE = 25;
const JAW_OPEN_SPEED = 3.0;
const JAW_MAX_ANGLE = 0.4;
const HEAD_SNAP_DISTANCE = 30;
const HEAD_SNAP_MAX_YAW = 0.9;
const HEAD_SNAP_MAX_PITCH = 0.5;

function _shortestAngle(a) {
  let angle = a;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

// ── Shared canvas-based normal textures (module-level singletons) ───────────
let _boneNormalTex = null;
let _fleshNormalTex = null;

function _createBoneNormalTexture() {
  if (_boneNormalTex) return _boneNormalTex;
  const size = 64;
  const data = new Uint8Array(size * size * 4);

  const sampleHeight = (u, v) => {
    const pore = Math.sin(u * 42 + v * 18) * 0.3 + Math.sin(u * 13 + v * 37) * 0.2;
    const ridge = Math.sin(v * 26 + u * 5) * 0.25;
    return pore + ridge;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const u = x / size, v = y / size;
      const du = 1 / size;
      const dv = 1 / size;
      const dx = sampleHeight(u + du, v) - sampleHeight(u - du, v);
      const dy = sampleHeight(u, v + dv) - sampleHeight(u, v - dv);
      const nx = -dx * 2.0;
      const ny = -dy * 2.0;
      const nz = 1.0;
      const nLen = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      data[idx] = Math.floor((nx * nLen * 0.5 + 0.5) * 255);
      data[idx + 1] = Math.floor((ny * nLen * 0.5 + 0.5) * 255);
      data[idx + 2] = Math.floor((nz * nLen * 0.5 + 0.5) * 255);
      data[idx + 3] = 255;
    }
  }
  _boneNormalTex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  _boneNormalTex.wrapS = _boneNormalTex.wrapT = THREE.RepeatWrapping;
  _boneNormalTex.needsUpdate = true;
  return _boneNormalTex;
}

function _createFleshNormalTexture() {
  if (_fleshNormalTex) return _fleshNormalTex;
  const size = 64;
  const data = new Uint8Array(size * size * 4);

  const sampleHeight = (u, v) => {
    const fiber = Math.sin(u * 60 + v * 8) * 0.35 + Math.sin(u * 28 + v * 44) * 0.15;
    const cross = Math.sin(v * 50 + u * 3) * 0.2;
    return fiber + cross;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const u = x / size, v = y / size;
      const du = 1 / size;
      const dv = 1 / size;
      const dx = sampleHeight(u + du, v) - sampleHeight(u - du, v);
      const dy = sampleHeight(u, v + dv) - sampleHeight(u, v - dv);
      const nx = -dx * 2.2;
      const ny = -dy * 2.2;
      const nz = 1.0;
      const nLen = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      data[idx] = Math.floor((nx * nLen * 0.5 + 0.5) * 255);
      data[idx + 1] = Math.floor((ny * nLen * 0.5 + 0.5) * 255);
      data[idx + 2] = Math.floor((nz * nLen * 0.5 + 0.5) * 255);
      data[idx + 3] = 255;
    }
  }
  _fleshNormalTex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  _fleshNormalTex.wrapS = _fleshNormalTex.wrapT = THREE.RepeatWrapping;
  _fleshNormalTex.needsUpdate = true;
  return _fleshNormalTex;
}

// ── TSL vertex shader undulation ────────────────────────────────────────────
function _applyBodyWaveShader(material, uniformsRef, tierName) {
  const uniforms = {
    uTime: uniform(0.0),
    uWavePhase: uniform(0.0),
    uAmplitude: uniform(0.12),
    uFrequency: uniform(2.5),
  };
  uniformsRef.push({ uniforms, tierName });

  const waveOffset = sin(uniforms.uTime.mul(uniforms.uFrequency).sub(uniforms.uWavePhase)).mul(uniforms.uAmplitude);
  const xOffset = cos(uniforms.uTime.mul(uniforms.uFrequency).mul(0.7).sub(uniforms.uWavePhase)).mul(uniforms.uAmplitude).mul(0.3);
  material.positionNode = positionLocal.add(vec3(xOffset, waveOffset, 0));
  return material;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  BoneWorm — Segmented biomechanical worm with exposed vertebral spine
// ═══════════════════════════════════════════════════════════════════════════════
export class BoneWorm {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time = Math.random() * 100;
    this.speed = 2 + Math.random() * 2;
    this.direction = new THREE.Vector3(
      Math.random() - 0.5,
      (Math.random() - 0.5) * 0.3,
      Math.random() - 0.5
    ).normalize();
    this.turnTimer = 0;
    this.turnInterval = 8 + Math.random() * 12;

    // LOD state
    this._lodTier = 'near';
    this._lastLodTier = 'near';
    this._frameCounter = 0;

    // Animation state
    this._agitation = 0;
    this._jawAngle = 0;
    this._undulationSpeed = UNDULATION_SPEED;
    this._breathingPhase = Math.random() * Math.PI * 2;

    // Procedural variation
    this._ampVariation = 0.8 + Math.random() * 0.4;
    this._phaseVariation = 0.9 + Math.random() * 0.2;

    // Shader uniform references for per-frame updates
    this._shaderUniforms = [];

    this.tiers = {};
    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  // ── Model Construction ──────────────────────────────────────────────────────
  _buildModel() {
    for (const tierName of ['near', 'medium', 'far']) {
      this.tiers[tierName] = this._buildTier(tierName);
    }
    this.tiers.near.group.visible = true;
    this.tiers.medium.group.visible = false;
    this.tiers.far.group.visible = false;

    for (const tier of Object.values(this.tiers)) {
      this.group.add(tier.group);
    }

    const scale = 1.5 + Math.random() * 2;
    this.group.scale.setScalar(scale);
  }

  _buildTier(tierName) {
    const profile = BONEWORM_LOD[tierName];
    const isFar = tierName === 'far';
    const tierGroup = new THREE.Group();
    const segmentRefs = [];
    let jaw;

    // ── Materials ──────────────────────────────────────────────────────────
    const boneNormal = profile.hasMicroDetail ? _createBoneNormalTexture() : null;
    const fleshNormal = profile.hasMicroDetail ? _createFleshNormalTexture() : null;

    let boneMat = new THREE.MeshPhysicalMaterial({
      color: 0x3a3228,
      roughness: 0.3,
      metalness: 0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.15,
      emissive: 0x504030,
      emissiveIntensity: 0.5,
      ...(boneNormal ? { normalMap: boneNormal, normalScale: new THREE.Vector2(0.6, 0.6) } : {}),
    });

    let fleshMat = new THREE.MeshPhysicalMaterial({
      color: 0x1a1020,
      roughness: 0.2,
      metalness: 0,
      clearcoat: 0.9,
      clearcoatRoughness: 0.1,
      transparent: true,
      opacity: 0.7,
      emissive: 0x502040,
      emissiveIntensity: 0.8,
      transmission: tierName === 'near' ? 0.15 : 0,
      thickness: tierName === 'near' ? 0.5 : 0,
      ...(fleshNormal ? { normalMap: fleshNormal, normalScale: new THREE.Vector2(0.5, 0.5) } : {}),
    });

    let headMat = new THREE.MeshPhysicalMaterial({
      color: 0x1a1020,
      roughness: 0.2,
      metalness: 0,
      clearcoat: 1.0,
      clearcoatRoughness: 0.1,
      emissive: 0x504030,
      emissiveIntensity: 0.5,
      ...(fleshNormal ? { normalMap: fleshNormal, normalScale: new THREE.Vector2(0.4, 0.4) } : {}),
    });

    let toothMat = new THREE.MeshPhysicalMaterial({
      color: 0xaa9970,
      roughness: 0.15,
      metalness: 0.1,
      clearcoat: 0.8,
      emissive: 0x504030,
      emissiveIntensity: 0.3,
    });

    // Emissive glow material (replaces PointLight)
    let glowMat = new THREE.MeshPhysicalMaterial({
      color: 0x2a0830,
      emissive: 0x6a1860,
      emissiveIntensity: 2.0,
      transparent: true,
      opacity: 0.6,
      roughness: 0.0,
      clearcoat: 1.0,
    });

    // Fresnel rim-light material for body silhouette (near only)
    let rimMat = null;
    if (tierName === 'near') {
      rimMat = new THREE.MeshPhysicalMaterial({
        color: 0x000000,
        emissive: 0x301050,
        emissiveIntensity: 1.5,
        transparent: true,
        opacity: 0.3,
        roughness: 1.0,
        side: THREE.BackSide,
      });
    }

    // Downgrade materials for far LOD
    if (isFar) {
      const origBone = boneMat; boneMat = toStandardMaterial(boneMat); origBone.dispose();
      const origFlesh = fleshMat; fleshMat = toStandardMaterial(fleshMat); origFlesh.dispose();
      const origHead = headMat; headMat = toStandardMaterial(headMat); origHead.dispose();
      const origTooth = toothMat; toothMat = toStandardMaterial(toothMat); origTooth.dispose();
      const origGlow = glowMat; glowMat = toStandardMaterial(glowMat); origGlow.dispose();
    }

    // Apply vertex shader body wave to flesh materials on near tier
    if (tierName === 'near') {
      _applyBodyWaveShader(fleshMat, this._shaderUniforms, 'near');
    }

    // Far tier is a single ultra-light mesh (<100 triangles) with shader-only animation.
    if (isFar) {
      const farBodyGeo = new THREE.CylinderGeometry(0.48, 0.12, 4.8, 8, 1, true);
      farBodyGeo.rotateZ(Math.PI / 2);
      const farBody = new THREE.Mesh(farBodyGeo, boneMat);
      _applyBodyWaveShader(farBody.material, this._shaderUniforms, 'far');
      tierGroup.add(farBody);

      return { group: tierGroup, segments: [], jaw: null, head: null, fleshMat, glowMat };
    }

    // ── Head ──────────────────────────────────────────────────────────────
    const headGeo = new THREE.SphereGeometry(0.7, profile.headDetail[0], profile.headDetail[1]);
    headGeo.scale(1.4, 0.9, 0.9);
    const hPos = headGeo.attributes.position;
    for (let i = 0; i < hPos.count; i++) {
      const x = hPos.getX(i), y = hPos.getY(i), z = hPos.getZ(i);
      const jawRidge = y < -0.1 ? Math.sin(x * 5 + z * 3) * 0.04 : 0;
      const noise = Math.sin(x * 8 + y * 6) * 0.015 + Math.sin(z * 10 + x * 4) * 0.01;
      hPos.setY(i, y + jawRidge + noise);
      if (y > 0.2) hPos.setY(i, hPos.getY(i) + Math.abs(Math.sin(z * 6)) * 0.03);
    }
    headGeo.computeVertexNormals();
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.set(0.5, 0, 0);
    tierGroup.add(head);

    // Mandibles (jaw halves that open near player)
    const mandibleGeo = new THREE.ConeGeometry(0.25, 0.6, Math.max(6, profile.toothSegs), 1, true);
    const upperJaw = new THREE.Mesh(mandibleGeo, headMat);
    upperJaw.position.set(1.0, 0.15, 0);
    upperJaw.rotation.z = Math.PI / 2;
    tierGroup.add(upperJaw);
    const lowerJaw = new THREE.Mesh(mandibleGeo, headMat);
    lowerJaw.position.set(1.0, -0.15, 0);
    lowerJaw.rotation.z = Math.PI / 2;
    tierGroup.add(lowerJaw);
    jaw = { upper: upperJaw, lower: lowerJaw };

    // Teeth ring
    const teethGeo = new THREE.ConeGeometry(0.03, 0.3, profile.toothSegs);
    for (let i = 0; i < profile.toothCount; i++) {
      const a = (i / profile.toothCount) * Math.PI * 2;
      const tooth = new THREE.Mesh(teethGeo, toothMat);
      tooth.position.set(1.1, Math.sin(a) * 0.35, Math.cos(a) * 0.35);
      tooth.rotation.z = Math.PI / 2;
      if (profile.hasMicroDetail) {
        tooth.scale.set(
          1 + Math.sin(i * 3.7) * 0.15,
          0.8 + Math.random() * 0.5,
          1 + Math.cos(i * 2.3) * 0.1
        );
      }
      tierGroup.add(tooth);
    }

    // ── Body Segments ─────────────────────────────────────────────────────
    for (let i = 0; i < profile.segmentCount; i++) {
      const t = i / profile.segmentCount;
      const r = THREE.MathUtils.lerp(0.6, 0.12, t);
      const segGroup = new THREE.Group();
      const baseX = -i * SEGMENT_SPACING;
      segGroup.position.set(baseX, 0, 0);

      // Vertebra cylinder with bone texture displacement
      const vertGeo = new THREE.CylinderGeometry(r * 0.5, r * 0.5, 0.25, profile.vertebraRadial);
      if (profile.hasMicroDetail) {
        const vPos = vertGeo.attributes.position;
        for (let v = 0; v < vPos.count; v++) {
          const px = vPos.getX(v), py = vPos.getY(v), pz = vPos.getZ(v);
          const disp = Math.sin(px * 30 + pz * 20) * 0.005 + Math.sin(py * 25 + px * 15) * 0.003;
          const len = Math.sqrt(px * px + pz * pz);
          if (len > 0.001) {
            vPos.setX(v, px + (px / len) * disp);
            vPos.setZ(v, pz + (pz / len) * disp);
          }
        }
        vertGeo.computeVertexNormals();
      }
      const vert = new THREE.Mesh(vertGeo, boneMat);
      vert.rotation.z = Math.PI / 2;
      segGroup.add(vert);

      // Dorsal spine process
      const spines = [];
      const spineGeo = new THREE.ConeGeometry(0.04, r * 0.8, profile.spineSegs);
      const spine = new THREE.Mesh(spineGeo, boneMat);
      spine.position.set(0, r * 0.5, 0);
      segGroup.add(spine);
      spines.push(spine);

      // Lateral spines on near tier
      if (profile.hasMicroDetail && i % 2 === 0) {
        for (const side of [-1, 1]) {
          const latSpine = new THREE.Mesh(spineGeo, boneMat);
          latSpine.position.set(0, r * 0.2, side * r * 0.45);
          latSpine.rotation.x = side * 0.5;
          segGroup.add(latSpine);
          spines.push(latSpine);
        }
      }

      // Flesh between segments
      let flesh = null;
      let fleshBaseY = null;
      if (i < profile.segmentCount - 1) {
        const fleshGeo = new THREE.SphereGeometry(r * 0.85, profile.fleshDetail[0], profile.fleshDetail[1]);
        fleshGeo.scale(1.2, 1, 1);
        if (profile.hasMicroDetail) {
          const fPos = fleshGeo.attributes.position;
          for (let v = 0; v < fPos.count; v++) {
            const fy = fPos.getY(v);
            const fx = fPos.getX(v);
            fPos.setY(v, fy + Math.sin(fx * 40 + fy * 20) * 0.003);
          }
          fleshGeo.computeVertexNormals();
        }
        flesh = new THREE.Mesh(fleshGeo, fleshMat);
        flesh.position.set(-SEGMENT_SPACING * 0.5, 0, 0);
        const basePos = fleshGeo.attributes.position;
        fleshBaseY = new Float32Array(basePos.count);
        for (let v = 0; v < basePos.count; v++) fleshBaseY[v] = basePos.getY(v);
        segGroup.add(flesh);
      }

      // Inter-vertebral disc geometry (near only)
      if (profile.hasDiscs && i < profile.segmentCount - 1) {
        const discGeo = new THREE.CylinderGeometry(r * 0.42, r * 0.42, 0.08, profile.vertebraRadial);
        const disc = new THREE.Mesh(discGeo, fleshMat);
        disc.position.set(-SEGMENT_SPACING * 0.5, 0, 0);
        disc.rotation.z = Math.PI / 2;
        segGroup.add(disc);
      }

      // Muscle strand geometry (near only)
      if (profile.hasMuscleStrands && i < profile.segmentCount - 1 && i % 2 === 0) {
        for (const side of [-1, 1]) {
          const strandGeo = new THREE.CylinderGeometry(0.015, 0.015, SEGMENT_SPACING * 0.7, 4);
          strandGeo.rotateZ(Math.PI / 2);
          const strand = new THREE.Mesh(strandGeo, fleshMat);
          strand.position.set(-SEGMENT_SPACING * 0.5, side * r * 0.35, 0);
          segGroup.add(strand);
        }
        for (const yOffset of [r * 0.4, -r * 0.35]) {
          const strandGeo = new THREE.CylinderGeometry(0.012, 0.012, SEGMENT_SPACING * 0.7, 4);
          strandGeo.rotateZ(Math.PI / 2);
          const strand = new THREE.Mesh(strandGeo, fleshMat);
          strand.position.set(-SEGMENT_SPACING * 0.5, yOffset, 0);
          segGroup.add(strand);
        }
      }

      // Bioluminescent glow spots (replaces PointLight)
      if (i % 4 === 0 && i < profile.segmentCount - 1) {
        const glowGeo = new THREE.SphereGeometry(r * 0.2, 6, 4);
        const glow = new THREE.Mesh(glowGeo, glowMat);
        glow.position.set(-SEGMENT_SPACING * 0.25, -r * 0.3, 0);
        segGroup.add(glow);
      }

      // Fresnel rim shell (near only)
      if (rimMat && i % 3 === 0) {
        const rimGeo = new THREE.SphereGeometry(r * 1.05, 8, 6);
        const rim = new THREE.Mesh(rimGeo, rimMat);
        segGroup.add(rim);
      }

      tierGroup.add(segGroup);
      segmentRefs.push({
        group: segGroup,
        vertebra: vert,
        flesh,
        spines,
        r,
        baseX,
        baseY: 0,
        baseZ: 0,
        fleshBaseY,
      });
    }

    return { group: tierGroup, segments: segmentRefs, jaw, head, fleshMat, glowMat };
  }

  // ── LOD Resolution with hysteresis ────────────────────────────────────────
  _resolveLodTier(distToPlayer) {
    const prev = this._lastLodTier;
    if (prev === 'near' && distToPlayer < LOD_NEAR_DISTANCE + LOD_HYSTERESIS) return 'near';
    if (prev === 'medium' && distToPlayer > LOD_NEAR_DISTANCE - LOD_HYSTERESIS && distToPlayer < LOD_MEDIUM_DISTANCE + LOD_HYSTERESIS) return 'medium';
    if (prev === 'far' && distToPlayer > LOD_MEDIUM_DISTANCE - LOD_HYSTERESIS) return 'far';
    if (distToPlayer < LOD_NEAR_DISTANCE) return 'near';
    if (distToPlayer < LOD_MEDIUM_DISTANCE) return 'medium';
    return 'far';
  }

  // ── Update ──────────────────────────────────────────────────────────────────
  update(dt, playerPos, distSq) {
    this.time += dt;
    this._frameCounter += 1;
    this.turnTimer += dt;

    // ── Movement AI (preserved from original) ─────────────────────────────
    if (this.turnTimer > this.turnInterval) {
      this.turnTimer = 0;
      this.turnInterval = 8 + Math.random() * 12;
      if (Math.random() < 0.25) {
        this.direction.subVectors(playerPos, this.group.position).normalize();
        this.direction.y *= 0.3;
      } else {
        this.direction.set(
          Math.random() - 0.5,
          (Math.random() - 0.5) * 0.2,
          Math.random() - 0.5
        ).normalize();
      }
    }

    _v3A.copy(this.direction).multiplyScalar(this.speed * dt);
    this.group.position.add(_v3A);

    // Face movement direction
    const angle = Math.atan2(this.direction.x, this.direction.z);
    this.group.rotation.y = THREE.MathUtils.lerp(this.group.rotation.y, angle + Math.PI / 2, dt * 2);

    // ── LOD Switching ─────────────────────────────────────────────────────
    const distToPlayer = Math.sqrt(distSq);
    this._lodTier = this._resolveLodTier(distToPlayer);
    this._lastLodTier = this._lodTier;

    this.tiers.near.group.visible = this._lodTier === 'near';
    this.tiers.medium.group.visible = this._lodTier === 'medium';
    this.tiers.far.group.visible = this._lodTier === 'far';

    // Far LOD: skip frames for GPU optimization
    const farStep = qualityManager.tier === 'ultra' ? FAR_LOD_SKIP_ULTRA : FAR_LOD_SKIP_DEFAULT;
    if (this._lodTier === 'far' && (this._frameCounter % farStep) !== 0) return;

    // ── Agitation / proximity reactions ───────────────────────────────────
    const proximity = THREE.MathUtils.clamp(1 - distToPlayer / HEAD_SNAP_DISTANCE, 0, 1);
    this._agitation = THREE.MathUtils.lerp(this._agitation, proximity, dt * 2);
    this._undulationSpeed = UNDULATION_SPEED + this._agitation * 2.0;

    // ── Animate active tier ───────────────────────────────────────────────
    const activeTier = this.tiers[this._lodTier];
    if (this._lodTier !== 'far') {
      this._animateSegments(activeTier, dt, this._lodTier);
      this._animateJaw(activeTier, dt, distToPlayer);
      this._animateHeadSnap(activeTier, dt, playerPos, distToPlayer);
    }
    this._animateEmissive(activeTier);

    // Update vertex shader uniforms
    for (const shaderRef of this._shaderUniforms) {
      if (shaderRef.tierName !== this._lodTier) continue;
      const uniforms = shaderRef.uniforms;
      uniforms.uTime.value = this.time;
      if (this._lodTier === 'near') {
        uniforms.uAmplitude.value = POS_AMPLITUDE_SCALE * this._ampVariation * (1 + this._agitation * 0.5);
        uniforms.uFrequency.value = this._undulationSpeed;
      } else {
        uniforms.uAmplitude.value = 0.06;
        uniforms.uFrequency.value = 1.7;
      }
    }

    // ── Respawn if too far ────────────────────────────────────────────────
    if (distToPlayer > RESPAWN_DISTANCE) {
      const a = Math.random() * Math.PI * 2;
      this.group.position.set(
        playerPos.x + Math.cos(a) * 80,
        playerPos.y + (Math.random() - 0.5) * 20,
        playerPos.z + Math.sin(a) * 80
      );
    }
  }

  // ── Per-segment sinusoidal chain deformation ──────────────────────────────
  _animateSegments(tier, dt, tierName) {
    const segs = tier.segments;
    const time = this.time;
    const ampVar = this._ampVariation;
    const phaseVar = this._phaseVariation;
    const isNear = tierName === 'near';
    const speed = this._undulationSpeed;
    const agitation = this._agitation;
    const profile = BONEWORM_LOD[tierName];

    this._breathingPhase += dt * BREATHING_SPEED;

    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      const g = seg.group;
      const phase = time * speed - i * PHASE_STEP * phaseVar;

      // Per-segment position offset — classic worm undulation wave
      const posAmp = POS_AMPLITUDE_SCALE * ampVar * (1 + agitation * 0.5);
      g.position.y = seg.baseY + Math.sin(phase) * posAmp * (i + 1);
      g.position.z = seg.baseZ + Math.cos(phase * 0.7) * posAmp * (i + 1) * 0.4;

      // Per-segment rotation — body curvature
      g.rotation.z = Math.sin(phase) * ROT_AMPLITUDE * (1 + agitation * 0.3);
      g.rotation.x = Math.cos(phase * 0.8) * ROT_AMPLITUDE * 0.3;

      // Weight and inertia: tail lags behind head
      const inertiaFactor = 1 - (i / segs.length) * 0.4;
      g.rotation.z *= inertiaFactor;

      // ── Near-only detail animations ───────────────────────────────────
      if (isNear) {
        // Breathing/idle cycle
        const breathe = Math.sin(this._breathingPhase - i * 0.3) * BREATHING_AMPLITUDE;
        if (seg.flesh) {
          seg.flesh.scale.x = 1.2 + breathe;
          seg.flesh.scale.y = 1.0 - breathe * 0.5;
        }

        // Spine erection based on agitation
        if (profile.hasSpineAnim) {
          for (const spine of seg.spines) {
            const spinePhase = Math.sin(time * 3 - i * 0.8) * 0.1;
            spine.scale.y = 1.0 + agitation * 0.6 + spinePhase;
            spine.rotation.z = Math.sin(time * 4 - i * 1.2) * 0.08 * (1 + agitation);
          }
        }

        // Flesh bulging: per-vertex wobble synced to contraction
        if (profile.hasFleshDeform && seg.flesh && seg.flesh.geometry) {
          const posAttr = seg.flesh.geometry.attributes.position;
          const bulgePhase = Math.sin(time * 2.5 - i * 0.6);
          const bulgeAmt = 0.008 * (1 + agitation);
          const baseY = seg.fleshBaseY;
          for (let v = 0; v < posAttr.count; v++) {
            const oy = baseY ? baseY[v] : posAttr.getY(v);
            const wobble = Math.sin(v * 1.7 + time * 3) * bulgeAmt * bulgePhase;
            posAttr.setY(v, oy + wobble);
          }
          posAttr.needsUpdate = true;
        }
      }
    }
  }

  // ── Jaw animation ─────────────────────────────────────────────────────────
  _animateJaw(tier, dt, distToPlayer) {
    if (!tier.jaw) return;
    const targetAngle = distToPlayer < JAW_OPEN_DISTANCE
      ? JAW_MAX_ANGLE * THREE.MathUtils.clamp(1 - distToPlayer / JAW_OPEN_DISTANCE, 0, 1)
      : Math.sin(this.time * 1.5) * 0.05;
    this._jawAngle = THREE.MathUtils.lerp(this._jawAngle, targetAngle, dt * JAW_OPEN_SPEED);
    tier.jaw.upper.rotation.x = -this._jawAngle;
    tier.jaw.lower.rotation.x = this._jawAngle;
  }

  _animateHeadSnap(tier, dt, playerPos, distToPlayer) {
    if (!tier.head) return;
    const snapWeight = THREE.MathUtils.clamp(1 - distToPlayer / HEAD_SNAP_DISTANCE, 0, 1);
    const toPlayerX = playerPos.x - this.group.position.x;
    const toPlayerY = playerPos.y - this.group.position.y;
    const toPlayerZ = playerPos.z - this.group.position.z;
    const targetWorldYaw = Math.atan2(toPlayerX, toPlayerZ) + Math.PI / 2;
    const yawDelta = _shortestAngle(targetWorldYaw - this.group.rotation.y);
    const targetLocalYaw = THREE.MathUtils.clamp(yawDelta, -HEAD_SNAP_MAX_YAW, HEAD_SNAP_MAX_YAW) * snapWeight;

    const horizontalDist = Math.sqrt(toPlayerX * toPlayerX + toPlayerZ * toPlayerZ);
    const targetPitch = THREE.MathUtils.clamp(
      Math.atan2(toPlayerY, Math.max(0.001, horizontalDist)),
      -HEAD_SNAP_MAX_PITCH,
      HEAD_SNAP_MAX_PITCH
    ) * snapWeight;

    tier.head.rotation.y = THREE.MathUtils.lerp(tier.head.rotation.y, targetLocalYaw, dt * 7);
    tier.head.rotation.z = THREE.MathUtils.lerp(tier.head.rotation.z, -targetPitch, dt * 5);
  }

  // ── Emissive pulse animation ──────────────────────────────────────────────
  _animateEmissive(tier) {
    if (!tier.fleshMat) return;
    const pulse = Math.sin(this.time * EMISSIVE_PULSE_SPEED) * 0.3 + 0.8;
    if (tier.fleshMat.emissiveIntensity !== undefined) {
      tier.fleshMat.emissiveIntensity = 0.5 + pulse * 0.5;
    }
    if (tier.glowMat && tier.glowMat.emissiveIntensity !== undefined) {
      tier.glowMat.emissiveIntensity = 1.5 + pulse;
    }
  }

  getPosition() { return this.group.position; }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(c => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        if (Array.isArray(c.material)) {
          for (const m of c.material) m.dispose();
        } else {
          c.material.dispose();
        }
      }
    });
    // Module-level singleton textures (_boneNormalTex, _fleshNormalTex) are NOT
    // disposed per instance — they are shared across all BoneWorm instances.
  }
}
