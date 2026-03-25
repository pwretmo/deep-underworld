import * as THREE from 'three';
import { LOD_NEAR_DISTANCE, LOD_MEDIUM_DISTANCE, toStandardMaterial } from './lodUtils.js';
import { qualityManager } from '../QualityManager.js';

// ── Pre-allocated temporaries — zero per-frame allocations ──────────────────
const _v3A = new THREE.Vector3();

// ── LOD tier profiles ────────────────────────────────────────────────────────
const EEL_LOD = {
  near: {
    segmentCount: 18,
    bodySegs: [24, 16],
    headSegs: [28, 20],
    eyeSegs: [16, 12],
    jawSegs: 16,
    toothCount: 8,
    finSubdiv: [4, 4],
    tailFinSubdiv: [8, 6],
    hasVertFins: true,
    hasTailFin: true,
    hasTeeth: true,
    hasMicroDetail: true,
    hasFinDeform: true,
    hasCoiling: true,
    animInterval: 1,
  },
  medium: {
    segmentCount: 9,
    bodySegs: [12, 8],
    headSegs: [16, 10],
    eyeSegs: [8, 6],
    jawSegs: 8,
    toothCount: 5,
    finSubdiv: [2, 2],
    tailFinSubdiv: [4, 3],
    hasVertFins: true,
    hasTailFin: true,
    hasTeeth: false,
    hasMicroDetail: false,
    hasFinDeform: false,
    hasCoiling: false,
    animInterval: 1,
  },
  far: {
    segmentCount: 5,
    bodySegs: [8, 6],
    headSegs: [8, 6],
    eyeSegs: [6, 4],
    jawSegs: 6,
    toothCount: 0,
    finSubdiv: [1, 1],
    tailFinSubdiv: [2, 2],
    hasVertFins: false,
    hasTailFin: false,
    hasTeeth: false,
    hasMicroDetail: false,
    hasFinDeform: false,
    hasCoiling: false,
    animInterval: 1,
  },
};

// Ultra tier has many more creatures (up to 120) so far-LOD must be more aggressive
const FAR_LOD_SKIP_DEFAULT = 3; // update 1-in-3 frames at normal quality
const FAR_LOD_SKIP_ULTRA   = 4; // update 1-in-4 frames at ultra (more creatures, less budget)
const LOD_HYSTERESIS = 4;
const RESPAWN_DISTANCE = 200;
const SEGMENT_SPACING = 0.7;
const PHASE_STEP = 0.45;
const PLAYER_TRACKING_CHANCE = 0.2; // probability that a turn heads toward the player
const UNDULATION_SPEED = 3.0;
const ROT_AMPLITUDE_Y = 0.28;
const ROT_AMPLITUDE_Z = 0.12;
const POS_AMPLITUDE = 0.04;
const BREATHING_SPEED = 1.0;
const BREATHING_AMPLITUDE = 0.025;
const EMISSIVE_PULSE_SPEED = 4.0;
const JAW_OPEN_DISTANCE = 22;
const JAW_OPEN_SPEED = 4.0;
const JAW_MAX_ANGLE = 0.5;
const COIL_TRIGGER_DISTANCE = 20;
const COIL_SPEED = 1.8;
const TAIL_FIN_HALF_HEIGHT = 0.175; // matches PlaneGeometry height 0.35 / 2
const TAIL_POWER_RATIO = 0.72; // fraction of stroke that is fast power stroke

// ── Shared procedural textures (module-level singletons) ─────────────────────
let _spineNormalTex = null;
let _muscleNormalTex = null;
let _finNormalTex = null;

function _createSpineNormalTexture() {
  if (_spineNormalTex) return _spineNormalTex;
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  const sample = (u, v) =>
    Math.sin(u * 38 + v * 14) * 0.35 +
    Math.sin(v * 28 + u * 8) * 0.25 +
    Math.sin(u * 12 + v * 40) * 0.15;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const u = x / size, v = y / size, d = 1 / size;
      const dx = sample(u + d, v) - sample(u - d, v);
      const dy = sample(u, v + d) - sample(u, v - d);
      const nx = -dx * 2.2, ny = -dy * 2.2, nz = 1.0;
      const nl = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      data[idx]     = Math.floor((nx * nl * 0.5 + 0.5) * 255);
      data[idx + 1] = Math.floor((ny * nl * 0.5 + 0.5) * 255);
      data[idx + 2] = Math.floor((nz * nl * 0.5 + 0.5) * 255);
      data[idx + 3] = 255;
    }
  }
  _spineNormalTex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  _spineNormalTex.wrapS = _spineNormalTex.wrapT = THREE.RepeatWrapping;
  _spineNormalTex.needsUpdate = true;
  return _spineNormalTex;
}

function _createMuscleNormalTexture() {
  if (_muscleNormalTex) return _muscleNormalTex;
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  const sample = (u, v) =>
    Math.sin(u * 55 + v * 7) * 0.4 +
    Math.sin(v * 48 + u * 12) * 0.2 +
    Math.sin(u * 20 + v * 30) * 0.15;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const u = x / size, v = y / size, d = 1 / size;
      const dx = sample(u + d, v) - sample(u - d, v);
      const dy = sample(u, v + d) - sample(u, v - d);
      const nx = -dx * 2.0, ny = -dy * 2.0, nz = 1.0;
      const nl = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      data[idx]     = Math.floor((nx * nl * 0.5 + 0.5) * 255);
      data[idx + 1] = Math.floor((ny * nl * 0.5 + 0.5) * 255);
      data[idx + 2] = Math.floor((nz * nl * 0.5 + 0.5) * 255);
      data[idx + 3] = 255;
    }
  }
  _muscleNormalTex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  _muscleNormalTex.wrapS = _muscleNormalTex.wrapT = THREE.RepeatWrapping;
  _muscleNormalTex.needsUpdate = true;
  return _muscleNormalTex;
}

function _createFinNormalTexture() {
  if (_finNormalTex) return _finNormalTex;
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  const sample = (u, v) =>
    Math.sin(u * 60 + v * 4) * 0.5 +
    Math.sin(u * 30) * 0.2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const u = x / size, v = y / size, d = 1 / size;
      const dx = sample(u + d, v) - sample(u - d, v);
      const dy = sample(u, v + d) - sample(u, v - d);
      const nx = -dx * 1.5, ny = -dy * 1.5, nz = 1.0;
      const nl = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      data[idx]     = Math.floor((nx * nl * 0.5 + 0.5) * 255);
      data[idx + 1] = Math.floor((ny * nl * 0.5 + 0.5) * 255);
      data[idx + 2] = Math.floor((nz * nl * 0.5 + 0.5) * 255);
      data[idx + 3] = 255;
    }
  }
  _finNormalTex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  _finNormalTex.wrapS = _finNormalTex.wrapT = THREE.RepeatWrapping;
  _finNormalTex.needsUpdate = true;
  return _finNormalTex;
}

// ── Vertex shader: full-body undulation on GPU ────────────────────────────────
function _applyBodyWaveShader(material, uniformsRef, tierName) {
  const uniforms = {
    uTime:      { value: 0 },
    uWavePhase: { value: 0 },
    uAmplitude: { value: 0.08 },
    uFrequency: { value: UNDULATION_SPEED },
    uRotAmp:    { value: ROT_AMPLITUDE_Y },
  };
  uniformsRef.push({ uniforms, tierName });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uTime:      uniforms.uTime,
      uWavePhase: uniforms.uWavePhase,
      uAmplitude: uniforms.uAmplitude,
      uFrequency: uniforms.uFrequency,
      uRotAmp:    uniforms.uRotAmp,
    });
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
       uniform float uTime;
       uniform float uWavePhase;
       uniform float uAmplitude;
       uniform float uFrequency;
       uniform float uRotAmp;
      `
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       float wave = sin(uTime * uFrequency - uWavePhase);
       transformed.y += wave * uAmplitude;
       transformed.z += cos(uTime * uFrequency * 0.75 - uWavePhase) * uAmplitude * 0.45;
       float rot = wave * uRotAmp;
       float cr = cos(rot), sr = sin(rot);
       float ny2 = cr * transformed.y - sr * transformed.z;
       float nz2 = sr * transformed.y + cr * transformed.z;
       transformed.y = ny2;
       transformed.z = nz2;
      `
    );
  };
  return material;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SpinalEel — segmented deep-ocean predator with glowing spinal column
// ═══════════════════════════════════════════════════════════════════════════════
// Long eel with visible spinal column glowing through translucent biomechanical flesh
export class SpinalEel {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time = Math.random() * 100;
    this.speed = 5 + Math.random() * 3;
    this.direction = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    this.turnTimer = 0;
    this.turnInterval = 6 + Math.random() * 8;

    // LOD state
    this._lodTier = 'near';
    this._lastLodTier = 'near';
    this._frameCounter = 0;

    // Animation state
    this._jawAngle = 0;
    this._coilPhase = 0;
    this._coilWeight = 0;
    this._breathingPhase = Math.random() * Math.PI * 2;
    this._tailPhase = 0;
    this._agitation = 0;

    // Procedural variation
    this._ampVariation = 0.85 + Math.random() * 0.3;
    this._phaseVariation = 0.9 + Math.random() * 0.2;
    this._undulationSpeed = UNDULATION_SPEED + (Math.random() - 0.5) * 0.8;

    // Shader uniform references
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
    this.group.scale.setScalar(2 + Math.random() * 2);
  }

  _buildTier(tierName) {
    const profile = EEL_LOD[tierName];
    const isFar = tierName === 'far';
    const tierGroup = new THREE.Group();
    const segmentRefs = [];

    // ── Textures ────────────────────────────────────────────────────────────
    const spineNorm  = profile.hasMicroDetail ? _createSpineNormalTexture()  : null;
    const muscleNorm = profile.hasMicroDetail ? _createMuscleNormalTexture() : null;
    const finNorm    = profile.hasMicroDetail ? _createFinNormalTexture()     : null;

    // ── Materials ────────────────────────────────────────────────────────────
    let bodyMat = new THREE.MeshPhysicalMaterial({
      color: 0x181030, roughness: 0.2, metalness: 0,
      clearcoat: 1.0, clearcoatRoughness: 0.1,
      transparent: true, opacity: 0.65,
      emissive: 0x282050, emissiveIntensity: 0.6,
      transmission: tierName === 'near' ? 0.12 : 0,
      thickness: tierName === 'near' ? 0.4 : 0,
      ...(muscleNorm ? { normalMap: muscleNorm, normalScale: new THREE.Vector2(0.5, 0.5) } : {}),
    });

    let spineMat = new THREE.MeshPhysicalMaterial({
      color: 0x88ffaa, emissive: 0x44ff66, emissiveIntensity: 0.9,
      roughness: 0.1, metalness: 0.3, clearcoat: 1.0,
      ...(spineNorm ? { normalMap: spineNorm, normalScale: new THREE.Vector2(0.6, 0.6) } : {}),
    });

    let headMat = new THREE.MeshPhysicalMaterial({
      color: 0x181030, roughness: 0.15, metalness: 0,
      clearcoat: 1.0, clearcoatRoughness: 0.1,
      emissive: 0x281848, emissiveIntensity: 0.6,
      ...(muscleNorm ? { normalMap: muscleNorm, normalScale: new THREE.Vector2(0.4, 0.4) } : {}),
    });

    let eyeMat = new THREE.MeshPhysicalMaterial({
      color: 0x44ff88, emissive: 0x44ff88, emissiveIntensity: 2.0,
      roughness: 0.0, clearcoat: 1.0,
    });

    let toothMat = new THREE.MeshPhysicalMaterial({
      color: 0xc0c090, roughness: 0.15, metalness: 0.1,
      clearcoat: 0.8, emissive: 0x404030, emissiveIntensity: 0.2,
    });

    // Lateral-line bioluminescent stripe (emissive-only, no PointLight)
    let lateralLineMat = new THREE.MeshPhysicalMaterial({
      color: 0x001a00, emissive: 0x44ff66, emissiveIntensity: 1.8,
      roughness: 0.0, transparent: true, opacity: 0.7,
    });

    // Fin membrane — subsurface scattering on near tier
    let finMat = new THREE.MeshPhysicalMaterial({
      color: 0x0a0820, roughness: 0.1, metalness: 0,
      transparent: true, opacity: 0.55,
      emissive: 0x1a1040, emissiveIntensity: 0.7,
      transmission: tierName === 'near' ? 0.25 : 0,
      thickness: tierName === 'near' ? 0.15 : 0,
      side: THREE.DoubleSide,
      ...(finNorm ? { normalMap: finNorm, normalScale: new THREE.Vector2(0.4, 0.4) } : {}),
    });

    // Fresnel rim-light (near only)
    let rimMat = null;
    if (tierName === 'near') {
      rimMat = new THREE.MeshPhysicalMaterial({
        color: 0x000000, emissive: 0x1a0840, emissiveIntensity: 1.2,
        transparent: true, opacity: 0.25, roughness: 1.0,
        side: THREE.BackSide,
      });
    }

    // Downgrade to MeshStandardMaterial on far LOD
    if (isFar) {
      const orig = [bodyMat, spineMat, headMat, eyeMat, toothMat, lateralLineMat, finMat];
      [bodyMat, spineMat, headMat, eyeMat, toothMat, lateralLineMat, finMat] =
        orig.map(m => { const s = toStandardMaterial(m); m.dispose(); return s; });
    }

    // Far LOD: ultra-light single mesh + vertex shader animation only
    if (isFar) {
      const farGeo = new THREE.CylinderGeometry(0.4, 0.08, profile.segmentCount * SEGMENT_SPACING, 8, 3, true);
      farGeo.rotateZ(Math.PI / 2);
      _applyBodyWaveShader(bodyMat, this._shaderUniforms, 'far');
      const farMesh = new THREE.Mesh(farGeo, bodyMat);
      // Internal spine strip
      const spineGeo = new THREE.CylinderGeometry(0.05, 0.02, profile.segmentCount * SEGMENT_SPACING * 0.95, 6, 2);
      spineGeo.rotateZ(Math.PI / 2);
      const spineMesh = new THREE.Mesh(spineGeo, spineMat);
      tierGroup.add(farMesh, spineMesh);
      return { group: tierGroup, segments: [], jaw: null, head: null, bodyMat, spineMat, finMat, lateralLineMat, tailFin: null };
    }

    // ── Head ────────────────────────────────────────────────────────────────
    const headGeo = new THREE.SphereGeometry(0.5, profile.headSegs[0], profile.headSegs[1]);
    headGeo.scale(1.8, 0.8, 0.8);
    // Cranial ridge micro-displacement
    if (profile.hasMicroDetail) {
      const hPos = headGeo.attributes.position;
      for (let v = 0; v < hPos.count; v++) {
        const x = hPos.getX(v), y = hPos.getY(v), z = hPos.getZ(v);
        const ridge = Math.sin(x * 6 + z * 4) * 0.018 + Math.sin(y * 10 + x * 3) * 0.01;
        hPos.setY(v, y + ridge);
        if (y > 0.15) hPos.setY(v, hPos.getY(v) + Math.abs(Math.sin(z * 8)) * 0.025);
      }
      headGeo.computeVertexNormals();
    }
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.set(0.6, 0, 0);
    tierGroup.add(head);

    // Rim shell around head
    if (rimMat) {
      const rimGeo = new THREE.SphereGeometry(0.52, 12, 8);
      rimGeo.scale(1.82, 0.82, 0.82);
      const rim = new THREE.Mesh(rimGeo, rimMat);
      rim.position.set(0.6, 0, 0);
      tierGroup.add(rim);
    }

    // ── Jaw (upper/lower halves with skull tilt pivot) ───────────────────────
    const jawPivot = new THREE.Group();
    jawPivot.position.set(0.6, 0, 0);
    tierGroup.add(jawPivot);

    const jawGeo = new THREE.ConeGeometry(0.22, 0.45, profile.jawSegs, 1, true);
    const upperJaw = new THREE.Mesh(jawGeo, headMat);
    upperJaw.position.set(0.35, 0.12, 0);
    upperJaw.rotation.z = Math.PI / 2;
    jawPivot.add(upperJaw);

    const lowerJaw = new THREE.Mesh(jawGeo, headMat);
    lowerJaw.position.set(0.35, -0.12, 0);
    lowerJaw.rotation.z = Math.PI / 2;
    jawPivot.add(lowerJaw);

    // Teeth ring
    if (profile.hasTeeth) {
      const toothGeo = new THREE.ConeGeometry(0.025, 0.22, Math.max(4, profile.jawSegs >> 1));
      for (let i = 0; i < profile.toothCount; i++) {
        const a = (i / profile.toothCount) * Math.PI * 2;
        const tooth = new THREE.Mesh(toothGeo, toothMat);
        tooth.position.set(0.55, Math.sin(a) * 0.28, Math.cos(a) * 0.28);
        tooth.rotation.z = Math.PI / 2;
        tooth.scale.set(1 + Math.sin(i * 3.7) * 0.12, 0.85 + Math.random() * 0.4, 1 + Math.cos(i * 2.3) * 0.1);
        jawPivot.add(tooth);
      }
    }

    // ── Eyes ────────────────────────────────────────────────────────────────
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, profile.eyeSegs[0], profile.eyeSegs[1]), eyeMat);
      eye.position.set(0.9, 0.15, s * 0.3);
      tierGroup.add(eye);
    }

    // ── Body Segments ────────────────────────────────────────────────────────
    for (let i = 0; i < profile.segmentCount; i++) {
      const t = i / profile.segmentCount;
      const r = THREE.MathUtils.lerp(0.4, 0.08, Math.pow(t, 0.7));
      const segGroup = new THREE.Group();
      segGroup.position.set(-i * SEGMENT_SPACING, 0, 0);

      // Body segment sphere
      const bodyGeo = new THREE.SphereGeometry(r, profile.bodySegs[0], profile.bodySegs[1]);
      bodyGeo.scale(1.8, 1, 1);
      if (profile.hasMicroDetail) {
        // Muscle fiber striations
        const bPos = bodyGeo.attributes.position;
        for (let v = 0; v < bPos.count; v++) {
          const bx = bPos.getX(v), by = bPos.getY(v);
          bPos.setY(v, by + Math.sin(bx * 35 + by * 20) * 0.004);
        }
        bodyGeo.computeVertexNormals();
      }
      const bodySeg = new THREE.Mesh(bodyGeo, bodyMat);
      segGroup.add(bodySeg);

      // Exposed spinal process (vertebral bump)
      const spineGeo = new THREE.SphereGeometry(r * 0.28, Math.max(6, profile.bodySegs[0] >> 2), Math.max(4, profile.bodySegs[1] >> 2));
      const spineNode = new THREE.Mesh(spineGeo, spineMat);
      spineNode.position.set(0, r * 0.35, 0);
      segGroup.add(spineNode);

      // Lateral-line bioluminescent dot
      if (i % 2 === 0) {
        const dotGeo = new THREE.SphereGeometry(r * 0.1, 6, 4);
        const dot = new THREE.Mesh(dotGeo, lateralLineMat);
        dot.position.set(0, -r * 0.2, r * 0.7);
        segGroup.add(dot);
        const dot2 = new THREE.Mesh(dotGeo, lateralLineMat);
        dot2.position.set(0, -r * 0.2, -r * 0.7);
        segGroup.add(dot2);
      }

      // Vertebral fin (dorsal membrane)
      let fin = null;
      let finBaseY = null;
      if (profile.hasVertFins && i > 0 && i < profile.segmentCount - 2) {
        const finH = r * 1.8;
        const finGeo = new THREE.PlaneGeometry(SEGMENT_SPACING * 0.9, finH, profile.finSubdiv[0], profile.finSubdiv[1]);
        fin = new THREE.Mesh(finGeo, finMat);
        fin.position.set(0, r + finH * 0.5, 0);
        fin.rotation.y = Math.PI / 2;
        if (profile.hasFinDeform) {
          const fPos = finGeo.attributes.position;
          finBaseY = new Float32Array(fPos.count);
          for (let v = 0; v < fPos.count; v++) finBaseY[v] = fPos.getY(v);
        }
        segGroup.add(fin);
      }

      // Fresnel rim shell (near every 3rd segment)
      if (rimMat && i % 3 === 0) {
        const rimSGeo = new THREE.SphereGeometry(r * 1.06, 8, 6);
        rimSGeo.scale(1.82, 1.02, 1.02);
        const rimS = new THREE.Mesh(rimSGeo, rimMat);
        segGroup.add(rimS);
      }

      tierGroup.add(segGroup);
      segmentRefs.push({ group: segGroup, r, baseX: -i * SEGMENT_SPACING, fin, finBaseY });
    }

    // ── Tail fin ────────────────────────────────────────────────────────────
    let tailFin = null;
    if (profile.hasTailFin) {
      const tfGeo = new THREE.PlaneGeometry(0.4, 0.35, profile.tailFinSubdiv[0], profile.tailFinSubdiv[1]);
      tailFin = new THREE.Mesh(tfGeo, finMat);
      const lastSeg = segmentRefs[segmentRefs.length - 1];
      const tailX = lastSeg ? lastSeg.baseX - SEGMENT_SPACING : -(profile.segmentCount) * SEGMENT_SPACING;
      tailFin.position.set(tailX, 0, 0);
      tailFin.rotation.y = Math.PI / 2;
      // Store base positions for power-stroke deformation
      if (profile.hasFinDeform) {
        const tPos = tfGeo.attributes.position;
        tailFin.userData.basePos = new Float32Array(tPos.count * 2);
        for (let v = 0; v < tPos.count; v++) {
          tailFin.userData.basePos[v * 2]     = tPos.getX(v);
          tailFin.userData.basePos[v * 2 + 1] = tPos.getY(v);
        }
      }
      tierGroup.add(tailFin);
    }

    return { group: tierGroup, segments: segmentRefs, jaw: { pivot: jawPivot, upper: upperJaw, lower: lowerJaw }, head, bodyMat, spineMat, finMat, lateralLineMat, tailFin };
  }

  // ── LOD Resolution with hysteresis ────────────────────────────────────────
  _resolveLodTier(dist) {
    const prev = this._lastLodTier;
    if (prev === 'near'   && dist < LOD_NEAR_DISTANCE + LOD_HYSTERESIS)   return 'near';
    if (prev === 'medium' && dist > LOD_NEAR_DISTANCE - LOD_HYSTERESIS
                          && dist < LOD_MEDIUM_DISTANCE + LOD_HYSTERESIS) return 'medium';
    if (prev === 'far'    && dist > LOD_MEDIUM_DISTANCE - LOD_HYSTERESIS) return 'far';
    if (dist < LOD_NEAR_DISTANCE)   return 'near';
    if (dist < LOD_MEDIUM_DISTANCE) return 'medium';
    return 'far';
  }

  // ── Update ──────────────────────────────────────────────────────────────────
  update(dt, playerPos) {
    this.time += dt;
    this._frameCounter += 1;
    this.turnTimer += dt;

    // ── Movement AI ───────────────────────────────────────────────────────
    if (this.turnTimer > this.turnInterval) {
      this.turnTimer = 0;
      this.turnInterval = 6 + Math.random() * 8;
      if (Math.random() < PLAYER_TRACKING_CHANCE) {
        this.direction.subVectors(playerPos, this.group.position).normalize();
        this.direction.y *= 0.2;
      } else {
        this.direction.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.2, Math.random() - 0.5).normalize();
      }
    }

    _v3A.copy(this.direction).multiplyScalar(this.speed * dt);
    this.group.position.add(_v3A);

    const angle = Math.atan2(this.direction.x, this.direction.z);
    this.group.rotation.y = THREE.MathUtils.lerp(this.group.rotation.y, angle + Math.PI / 2, dt * 3);

    // ── LOD Switching ─────────────────────────────────────────────────────
    const distToPlayer = this.group.position.distanceTo(playerPos);
    this._lodTier = this._resolveLodTier(distToPlayer);
    this._lastLodTier = this._lodTier;

    this.tiers.near.group.visible   = this._lodTier === 'near';
    this.tiers.medium.group.visible = this._lodTier === 'medium';
    this.tiers.far.group.visible    = this._lodTier === 'far';

    // Far LOD: skip frames
    const farStep = qualityManager.tier === 'ultra' ? FAR_LOD_SKIP_ULTRA : FAR_LOD_SKIP_DEFAULT;
    if (this._lodTier === 'far' && (this._frameCounter % farStep) !== 0) return;

    // ── Proximity agitation ───────────────────────────────────────────────
    const proximity = THREE.MathUtils.clamp(1 - distToPlayer / COIL_TRIGGER_DISTANCE, 0, 1);
    this._agitation = THREE.MathUtils.lerp(this._agitation, proximity, dt * 2);

    // ── Update vertex shader uniforms ─────────────────────────────────────
    for (const ref of this._shaderUniforms) {
      if (ref.tierName !== this._lodTier) continue;
      ref.uniforms.uTime.value      = this.time;
      ref.uniforms.uAmplitude.value = 0.08 * this._ampVariation * (1 + this._agitation * 0.6);
      ref.uniforms.uFrequency.value = this._undulationSpeed * this._phaseVariation;
      ref.uniforms.uRotAmp.value    = ROT_AMPLITUDE_Y * (1 + this._agitation * 0.4);
    }

    // ── Animate active tier ───────────────────────────────────────────────
    const activeTier = this.tiers[this._lodTier];
    if (this._lodTier !== 'far') {
      this._animateSegments(activeTier, dt, this._lodTier);
      this._animateJaw(activeTier, dt, distToPlayer);
    }
    this._animateEmissive(activeTier);

    // ── Tail phase update ─────────────────────────────────────────────────
    // Asymmetric power stroke: fast forward, slow recovery
    const strokeSpeed = this._tailPhase < TAIL_POWER_RATIO * Math.PI * 2
      ? this._undulationSpeed * 1.4
      : this._undulationSpeed * 0.6;
    this._tailPhase += dt * strokeSpeed;
    if (this._tailPhase > Math.PI * 2) this._tailPhase -= Math.PI * 2;

    // ── Respawn ───────────────────────────────────────────────────────────
    if (distToPlayer > RESPAWN_DISTANCE) {
      const a = Math.random() * Math.PI * 2;
      this.group.position.set(
        playerPos.x + Math.cos(a) * 80,
        playerPos.y + (Math.random() - 0.5) * 20,
        playerPos.z + Math.sin(a) * 80
      );
    }
  }

  // ── Per-segment rotation chain ─────────────────────────────────────────────
  _animateSegments(tier, dt, tierName) {
    const segs = tier.segments;
    const t = this.time;
    const speed = this._undulationSpeed * this._phaseVariation;
    const ampVar = this._ampVariation;
    const agitation = this._agitation;
    const isNear = tierName === 'near';
    const profile = EEL_LOD[tierName];

    this._breathingPhase += dt * BREATHING_SPEED;

    // Coiling: smoothly transition to helical wrap when player is near
    const coilTarget = agitation > 0.35 && profile.hasCoiling ? agitation : 0;
    this._coilWeight = THREE.MathUtils.lerp(this._coilWeight, coilTarget, dt * COIL_SPEED);
    if (this._coilWeight > 0.01) this._coilPhase += dt * 1.2;

    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      const g = seg.group;
      const phase = t * speed - i * PHASE_STEP * this._phaseVariation;
      const inertia = 1 - (i / segs.length) * 0.45;

      if (this._coilWeight > 0.01) {
        // Coiling motion: segments wrap into a tightening helix
        const coilAngle = this._coilPhase - i * 0.38;
        const coilR = this._coilWeight * (0.8 + i * 0.08);
        const swimY = Math.sin(phase) * POS_AMPLITUDE * ampVar * (1 + agitation * 0.5) * (i + 1);
        const swimZ = Math.cos(phase * 0.7) * POS_AMPLITUDE * ampVar * (i + 1) * 0.5;
        const coilY = Math.sin(coilAngle) * coilR;
        const coilZ = Math.cos(coilAngle) * coilR;
        g.position.y = THREE.MathUtils.lerp(swimY, coilY, this._coilWeight);
        g.position.z = THREE.MathUtils.lerp(swimZ, coilZ, this._coilWeight);

        // Rotation: blend serpentine with spiral orientation
        const coilRotY = -i * 0.38;
        const swimRotY = Math.sin(phase) * ROT_AMPLITUDE_Y * inertia;
        g.rotation.y = THREE.MathUtils.lerp(swimRotY, coilRotY * this._coilWeight, this._coilWeight);
        g.rotation.z = Math.sin(phase) * ROT_AMPLITUDE_Z * inertia * (1 - this._coilWeight * 0.5);
        g.rotation.x = Math.cos(phase * 0.8) * ROT_AMPLITUDE_Z * 0.4 * inertia;
      } else {
        // Normal anguilliform swimming: S-curve with per-segment rotation
        g.position.y = Math.sin(phase) * POS_AMPLITUDE * ampVar * (1 + agitation * 0.5) * (i + 1);
        g.position.z = Math.cos(phase * 0.7) * POS_AMPLITUDE * ampVar * (i + 1) * 0.5;
        // Per-segment rotation.y creates proper serpentine S-curve
        g.rotation.y = Math.sin(phase) * ROT_AMPLITUDE_Y * inertia * (1 + agitation * 0.3);
        g.rotation.z = Math.cos(phase * 0.8) * ROT_AMPLITUDE_Z * inertia;
        g.rotation.x = Math.sin(phase * 0.6) * ROT_AMPLITUDE_Z * 0.3 * inertia;
      }

      // Near-only detail animations
      if (isNear) {
        // Vertebral fin flutter: per-vertex wave propagation — throttled to every 2 frames
        if (profile.hasFinDeform && seg.fin && seg.fin.geometry && (this._frameCounter % 2) === (i % 2)) {
          const posAttr = seg.fin.geometry.attributes.position;
          const baseY = seg.finBaseY;
          for (let v = 0; v < posAttr.count; v++) {
            const ox = posAttr.getX(v);
            const oy = baseY ? baseY[v] : posAttr.getY(v);
            const flutter = Math.sin(t * 5 - i * 0.6 + ox * 4) * 0.025 * (1 + agitation * 0.8);
            posAttr.setY(v, oy + flutter);
          }
          posAttr.needsUpdate = true;
        }

        // Breathing/idle cycle
        const breathe = Math.sin(this._breathingPhase - i * 0.3) * BREATHING_AMPLITUDE;
        g.scale.x = 1.0 + breathe * 0.3;
        g.scale.y = 1.0 - breathe * 0.15;
      }
    }

    // Tail fin power stroke deformation (near tier)
    if (isNear && tier.tailFin && tier.tailFin.userData.basePos) {
      this._animateTailFin(tier.tailFin, agitation);
    }
  }

  // ── Tail fin asymmetric power stroke ──────────────────────────────────────
  _animateTailFin(tailFin, agitation) {
    const posAttr = tailFin.geometry.attributes.position;
    const base = tailFin.userData.basePos;
    const phase = this._tailPhase;
    const isPower = phase < TAIL_POWER_RATIO * Math.PI * 2;
    const strokeAmp = isPower ? 0.12 * (1 + agitation * 0.6) : 0.04;
    const flex = Math.sin(phase) * strokeAmp;

    for (let v = 0; v < posAttr.count; v++) {
      const bx = base[v * 2];
      const by = base[v * 2 + 1];
      // Tip flexes more than base
      const tipWeight = Math.abs(by) / TAIL_FIN_HALF_HEIGHT + 0.1;
      posAttr.setX(v, bx + flex * tipWeight);
    }
    posAttr.needsUpdate = true;
  }

  // ── Jaw ratchet: skull tilts back as jaw opens ─────────────────────────────
  _animateJaw(tier, dt, distToPlayer) {
    if (!tier.jaw) return;
    const { pivot, upper, lower } = tier.jaw;
    const targetAngle = distToPlayer < JAW_OPEN_DISTANCE
      ? JAW_MAX_ANGLE * THREE.MathUtils.clamp(1 - distToPlayer / JAW_OPEN_DISTANCE, 0, 1)
      : Math.sin(this.time * 1.8) * 0.04;
    this._jawAngle = THREE.MathUtils.lerp(this._jawAngle, targetAngle, dt * JAW_OPEN_SPEED);
    upper.rotation.x = -this._jawAngle;
    lower.rotation.x =  this._jawAngle;
    // Skull tilts back proportionally as jaw opens wide
    pivot.rotation.z = -this._jawAngle * 0.35;
  }

  // ── Emissive pulse ─────────────────────────────────────────────────────────
  _animateEmissive(tier) {
    const pulse = Math.sin(this.time * EMISSIVE_PULSE_SPEED) * 0.3 + 0.8;
    if (tier.bodyMat && tier.bodyMat.emissiveIntensity !== undefined) {
      tier.bodyMat.emissiveIntensity = 0.45 + pulse * 0.35;
    }
    if (tier.lateralLineMat && tier.lateralLineMat.emissiveIntensity !== undefined) {
      tier.lateralLineMat.emissiveIntensity = 1.2 + pulse * 0.8;
    }
    if (tier.spineMat && tier.spineMat.emissiveIntensity !== undefined) {
      tier.spineMat.emissiveIntensity = 0.6 + pulse * 0.5;
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
    // Module-level singleton textures (_spineNormalTex, _muscleNormalTex, _finNormalTex)
    // are NOT disposed per-instance — they are shared across all SpinalEel instances.
  }
}
