import * as THREE from 'three';
import { LOD_NEAR_DISTANCE, LOD_MEDIUM_DISTANCE, toStandardMaterial } from './lodUtils.js';

// ── Pre-allocated temps (zero per-frame allocations) ────────────────────────
const _v3A = new THREE.Vector3();
const _v3B = new THREE.Vector3();

// ── LOD tier profiles ───────────────────────────────────────────────────────
const MAW_LOD = {
  near: {
    throatSegs: [48, 32],       // high detail for peristaltic shader
    lipRadialSegs: 16,
    lipTubularSegs: 48,
    toothRings: 4,
    teethPer: [18, 14, 10, 8],
    toothSegs: 12,
    tendrils: 10,
    tendrilRadialSegs: 10,
    lureCount: 4,
    lureSegs: [16, 12],
    gulletDepth: 3,
    gulletSegs: [32, 16],
    hasShader: true,
    hasBarbs: true,
    hasLureFilaments: true,
  },
  medium: {
    throatSegs: [24, 16],
    lipRadialSegs: 10,
    lipTubularSegs: 28,
    toothRings: 3,
    teethPer: [12, 8, 6],
    toothSegs: 8,
    tendrils: 6,
    tendrilRadialSegs: 6,
    lureCount: 2,
    lureSegs: [10, 8],
    gulletDepth: 2,
    gulletSegs: [16, 8],
    hasShader: false,
    hasBarbs: false,
    hasLureFilaments: false,
  },
  far: {
    throatSegs: [10, 6],
    lipRadialSegs: 6,
    lipTubularSegs: 14,
    toothRings: 2,
    teethPer: [8, 5],
    toothSegs: 4,
    tendrils: 0,
    tendrilRadialSegs: 4,
    lureCount: 0,
    lureSegs: [6, 4],
    gulletDepth: 0,
    gulletSegs: [8, 4],
    hasShader: false,
    hasBarbs: false,
    hasLureFilaments: false,
  },
};

// ── Animation constants ─────────────────────────────────────────────────────
const TOOTH_RING_SPEED = 0.35;
const BREATHING_SPEED = 1.5;
const BREATHING_AMPLITUDE = 0.05;
const LIP_DILATION_SPEED = 1.2;
const LIP_DILATION_AMPLITUDE = 0.06;
const TENDRIL_SWEEP_SPEED = 0.8;
const TENDRIL_AMPLITUDE = 0.15;
const LURE_PULSE_SPEED_BASE = 1.4;
const LURE_FILAMENT_SWING_SPEED = 1.6;
const LURE_FILAMENT_SWING_AMPLITUDE = 0.25;
const GULLET_DEEPEN_AMPLITUDE = 0.3;
const PERISTALTIC_SPEED = 2.5;
const PERISTALTIC_WAVE_NUMBER = 4.0;
const PERISTALTIC_AMPLITUDE = 0.08;
const RESPAWN_DISTANCE = 200;

// ── Module-level singleton textures ─────────────────────────────────────────
let _throatNormalTex = null;

function _createThroatNormalTexture() {
  if (_throatNormalTex) return _throatNormalTex;
  const size = 64;
  const data = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const u = x / size, v = y / size;
      const du = 1 / size;
      // Muscle ridges running along the throat direction
      const ridgeH = Math.sin(v * 26 + u * 3) * 0.4 + Math.sin(v * 14 + u * 8) * 0.25;
      const rightH = Math.sin(v * 26 + (u + du) * 3) * 0.4 + Math.sin(v * 14 + (u + du) * 8) * 0.25;
      const upH = Math.sin((v + du) * 26 + u * 3) * 0.4 + Math.sin((v + du) * 14 + u * 8) * 0.25;
      const sx = (rightH - ridgeH) * 0.5;
      const sy = (upH - ridgeH) * 0.5;
      data[idx] = Math.floor((sx * 0.5 + 0.5) * 255);
      data[idx + 1] = Math.floor((sy * 0.5 + 0.5) * 255);
      data[idx + 2] = 255;
      data[idx + 3] = 255;
    }
  }

  _throatNormalTex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  _throatNormalTex.wrapS = _throatNormalTex.wrapT = THREE.RepeatWrapping;
  _throatNormalTex.needsUpdate = true;
  return _throatNormalTex;
}

// ── Vertex shader: peristaltic throat animation + fresnel rim ───────────────
function _applyThroatShader(material, uniforms) {
  material.userData.shaderUniforms = uniforms;

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uMawTime;
uniform float uPeristalticPhase;
uniform float uBreathScale;
uniform float uPlayerProximity;
varying float vThroatDepth;
varying vec2 vMawUv;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vMawUv = uv;
float throatAxis = (position.y + 2.0) / 4.0;
vThroatDepth = throatAxis;
float wave = sin(throatAxis * ${PERISTALTIC_WAVE_NUMBER.toFixed(1)} - uPeristalticPhase) * ${PERISTALTIC_AMPLITUDE.toFixed(3)};
wave *= smoothstep(0.0, 0.6, throatAxis);
float breath = sin(uMawTime * ${BREATHING_SPEED.toFixed(1)}) * ${BREATHING_AMPLITUDE.toFixed(3)};
float proximityPulse = uPlayerProximity * sin(uMawTime * 4.2 + throatAxis * 8.0) * 0.03;
float radial = length(position.xz);
vec2 radDir = radial > 0.001 ? normalize(position.xz) : vec2(0.0, 1.0);
transformed.xz += radDir * (wave + breath + proximityPulse) * uBreathScale;
float fiberDetail = sin(position.y * 34.0 + atan(position.z, position.x) * 12.0 + uMawTime * 1.8) * 0.008;
transformed += normal * fiberDetail;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uMawTime;
uniform float uPlayerProximity;
varying float vThroatDepth;
varying vec2 vMawUv;`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
float rim = pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 2.6);
totalEmissiveRadiance += vec3(0.18, 0.04, 0.12) * rim * 0.8;
float depthGlow = smoothstep(0.2, 0.9, vThroatDepth);
float glowPulse = 0.5 + 0.5 * sin(uMawTime * 2.0 + vThroatDepth * 6.0);
totalEmissiveRadiance += vec3(0.5, 0.02, 0.08) * depthGlow * glowPulse * (0.6 + uPlayerProximity * 0.4);`
      );

    material.userData.shader = shader;
  };

  material.needsUpdate = true;
}

// ── Vertex shader: lip dilation ─────────────────────────────────────────────
function _applyLipShader(material, uniforms) {
  material.userData.shaderUniforms = uniforms;

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uMawTime;
uniform float uLipDilation;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
float angle = atan(position.z, position.x);
float radialWave = sin(angle * 5.0 + uMawTime * ${LIP_DILATION_SPEED.toFixed(1)}) * ${LIP_DILATION_AMPLITUDE.toFixed(3)};
float dilation = uLipDilation * (1.0 + radialWave);
vec2 radDir = length(position.xz) > 0.001 ? normalize(position.xz) : vec2(1.0, 0.0);
transformed.xz += radDir * dilation;
transformed += normal * sin(angle * 18.0 + position.y * 12.0) * 0.005;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uMawTime;`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
float rim = pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 3.0);
totalEmissiveRadiance += vec3(0.25, 0.03, 0.05) * rim * 0.6;`
      );

    material.userData.shader = shader;
  };

  material.needsUpdate = true;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  AbyssalMaw — Giant floating mouth/throat with concentric rings of teeth
//  Biomechanical abyss gulper with peristaltic animation, LOD 3-tier system,
//  InstancedMesh teeth, and vertex shader animations.
// ═══════════════════════════════════════════════════════════════════════════════
export class AbyssalMaw {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time = Math.random() * 100;
    this.speed = 0.6 + Math.random() * 0.4;
    this.direction = new THREE.Vector3(
      Math.random() - 0.5, -0.15, Math.random() - 0.5
    ).normalize();
    this.turnTimer = 0;
    this.turnInterval = 20 + Math.random() * 20;

    // Animation state (pre-allocated, zero GC)
    this._breathPhase = Math.random() * Math.PI * 2;
    this._lipDilation = 0;
    this._lipDilationTarget = 0;
    this._playerProximity = 0;

    // Shader uniform references
    this._shaderUniforms = [];

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  _buildModel() {
    this.tiers = {};
    const lod = new THREE.LOD();
    for (const [tierName, profile] of Object.entries(MAW_LOD)) {
      const tier = this._buildTier(profile, tierName, tierName === 'far');
      this.tiers[tierName] = tier;
      const dist = tierName === 'near' ? 0
        : tierName === 'medium' ? LOD_NEAR_DISTANCE
        : LOD_MEDIUM_DISTANCE;
      lod.addLevel(tier.group, dist);
    }
    this.lod = lod;
    this.group.add(lod);

    // PointLight only on near tier (budget single light for inner glow)
    this.innerLight = new THREE.PointLight(0xff0033, 2, 15);
    this.innerLight.userData.duwCategory = 'creature_bio';
    this.innerLight.position.z = -2;
    this.tiers.near.group.add(this.innerLight);

    const s = 1.5 + Math.random() * 2;
    this._baseScale = s;
    this.group.scale.setScalar(s);
  }

  _buildTier(profile, tierName, useFarMat) {
    const tierGroup = new THREE.Group();
    const rings = [];

    // ── Materials ──────────────────────────────────────────────────────────
    const normalTex = profile.hasShader ? _createThroatNormalTexture() : null;

    let bodyMat = new THREE.MeshPhysicalMaterial({
      color: 0x1a1028, roughness: 0.2, metalness: 0,
      clearcoat: 1.0, clearcoatRoughness: 0.1,
      emissive: 0x502040, emissiveIntensity: 0.6,
    });

    let fleshMat = new THREE.MeshPhysicalMaterial({
      color: 0x2a1020, roughness: 0.3, metalness: 0,
      clearcoat: 0.8,
      emissive: 0x602040, emissiveIntensity: 0.7,
      ...(normalTex ? { normalMap: normalTex, normalScale: new THREE.Vector2(0.6, 0.6) } : {}),
    });

    // Lip material with transmission for subsurface scattering approximation
    let lipMat = new THREE.MeshPhysicalMaterial({
      color: 0x351828, roughness: 0.15, metalness: 0,
      clearcoat: 1.0, clearcoatRoughness: 0.05,
      emissive: 0x451030, emissiveIntensity: 0.5,
      transmission: tierName === 'near' ? 0.15 : 0,
      thickness: tierName === 'near' ? 0.8 : 0,
    });

    let toothMat = new THREE.MeshPhysicalMaterial({
      color: 0x504038, roughness: 0.15, metalness: 0.1,
      clearcoat: 1.0, clearcoatRoughness: 0.05,
      emissive: 0x504030, emissiveIntensity: 0.4,
    });

    let lureMat = new THREE.MeshPhysicalMaterial({
      color: 0x88ffcc, roughness: 0.1, metalness: 0,
      emissive: 0x44ff88, emissiveIntensity: 2.0,
      transparent: true, opacity: 0.85,
    });

    let glowMat = new THREE.MeshPhysicalMaterial({
      color: 0xff0044, emissive: 0x880022, emissiveIntensity: 2.5,
      transparent: true, opacity: 0.5, roughness: 0,
    });

    if (useFarMat) {
      bodyMat = toStandardMaterial(bodyMat);
      fleshMat = toStandardMaterial(fleshMat);
      lipMat = toStandardMaterial(lipMat);
      toothMat = toStandardMaterial(toothMat);
      lureMat = toStandardMaterial(lureMat);
      glowMat = toStandardMaterial(glowMat);
    }

    // ── Shared shader uniforms for throat + lip ──────────────────────────
    const sharedUniforms = {
      uMawTime: { value: 0 },
      uPeristalticPhase: { value: 0 },
      uBreathScale: { value: 1.0 },
      uLipDilation: { value: 0 },
      uPlayerProximity: { value: 0 },
    };

    if (profile.hasShader) {
      _applyThroatShader(fleshMat, sharedUniforms);
      _applyLipShader(lipMat, sharedUniforms);
      this._shaderUniforms.push({ uniforms: sharedUniforms, tierName });
    }

    // ── Throat (CylinderGeometry 1.5→0.8, h=4, 48×32 near) ─────────────
    const throatGeo = new THREE.CylinderGeometry(
      1.5, 0.8, 4, profile.throatSegs[0], profile.throatSegs[1], true
    );
    const tp = throatGeo.attributes.position;
    for (let i = 0; i < tp.count; i++) {
      const y = tp.getY(i), x = tp.getX(i), z = tp.getZ(i);
      const ribFactor = 1 + Math.sin(y * 8) * 0.06 + Math.sin(y * 16 + Math.atan2(z, x) * 4) * 0.02;
      tp.setX(i, x * ribFactor);
      tp.setZ(i, z * ribFactor);
    }
    throatGeo.computeVertexNormals();
    const throat = new THREE.Mesh(throatGeo, fleshMat);
    throat.rotation.x = Math.PI / 2;
    tierGroup.add(throat);

    // ── Gullet interior (visible depth into throat with ribbed detail) ───
    if (profile.gulletDepth > 0) {
      const gulletGeo = new THREE.CylinderGeometry(
        0.8, 0.35, profile.gulletDepth, profile.gulletSegs[0], profile.gulletSegs[1], true
      );
      const gp = gulletGeo.attributes.position;
      for (let i = 0; i < gp.count; i++) {
        const y = gp.getY(i), x = gp.getX(i), z = gp.getZ(i);
        const ribScale = 1 + Math.sin(y * 12 + Math.atan2(z, x) * 6) * 0.05;
        gp.setX(i, x * ribScale);
        gp.setZ(i, z * ribScale);
      }
      gulletGeo.computeVertexNormals();

      let gulletMat = new THREE.MeshPhysicalMaterial({
        color: 0x180810, roughness: 0.4, metalness: 0,
        emissive: 0x400818, emissiveIntensity: 0.9,
        side: THREE.BackSide,
      });
      if (useFarMat) gulletMat = toStandardMaterial(gulletMat);

      const gullet = new THREE.Mesh(gulletGeo, gulletMat);
      gullet.rotation.x = Math.PI / 2;
      gullet.position.z = -(2 + profile.gulletDepth * 0.5);
      gullet.userData.baseZ = gullet.position.z;
      gullet.userData.baseScaleY = 1;
      tierGroup.add(gullet);
      tierGroup.userData.gullet = gullet;
    }

    // ── Concentric tooth rings (InstancedMesh on near LOD) ──────────────
    for (let ring = 0; ring < profile.toothRings; ring++) {
      const radius = 1.3 - ring * 0.25;
      const teethCount = profile.teethPer[ring] || 4;
      const toothLen = 0.5 + ring * 0.2;
      const toothRad = 0.06 + ring * 0.01;

      // Tooth geometry with root/gum socket detail
      const toothGeo = new THREE.ConeGeometry(toothRad, toothLen, profile.toothSegs);
      const tPos = toothGeo.attributes.position;
      for (let i = 0; i < tPos.count; i++) {
        const y = tPos.getY(i);
        if (y < -toothLen * 0.3) {
          const factor = 1 + (1 - (y + toothLen * 0.5) / (toothLen * 0.2)) * 0.3;
          tPos.setX(i, tPos.getX(i) * Math.min(factor, 1.5));
          tPos.setZ(i, tPos.getZ(i) * Math.min(factor, 1.5));
        }
      }
      toothGeo.computeVertexNormals();
      toothGeo.rotateX(-Math.PI / 2);

      let ringGroup;

      if (tierName === 'near' && teethCount >= 6) {
        // InstancedMesh for GPU efficiency
        const instancedTeeth = new THREE.InstancedMesh(toothGeo, toothMat, teethCount);
        const dummy = new THREE.Object3D();
        for (let t = 0; t < teethCount; t++) {
          const angle = (t / teethCount) * Math.PI * 2;
          dummy.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
          dummy.rotation.set(0, 0, 0);
          dummy.lookAt(0, 0, 0.4);
          dummy.updateMatrix();
          instancedTeeth.setMatrixAt(t, dummy.matrix);
        }
        instancedTeeth.instanceMatrix.needsUpdate = true;

        ringGroup = new THREE.Group();
        ringGroup.add(instancedTeeth);
        ringGroup.userData.instancedTeeth = instancedTeeth;
        ringGroup.userData.teethCount = teethCount;
        ringGroup.userData.radius = radius;
      } else {
        // Standard mesh per tooth for medium/far
        ringGroup = new THREE.Group();
        for (let t = 0; t < teethCount; t++) {
          const angle = (t / teethCount) * Math.PI * 2;
          const tooth = new THREE.Mesh(toothGeo, toothMat);
          tooth.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
          tooth.lookAt(0, 0, 0.4);
          ringGroup.add(tooth);
        }
      }

      ringGroup.position.z = -ring * 1.2;
      rings.push(ringGroup);
      tierGroup.add(ringGroup);
    }

    // ── Outer lip ring (fleshy torus 1.5, 0.15, 16, 48) ────────────────
    const lipGeo = new THREE.TorusGeometry(
      1.5, 0.15, profile.lipRadialSegs, profile.lipTubularSegs
    );
    const lip = new THREE.Mesh(lipGeo, lipMat);
    lip.rotation.x = Math.PI / 2;
    tierGroup.add(lip);

    // ── Tendrils with barb/spine detail ──────────────────────────────────
    const tendrilMeshes = [];
    for (let i = 0; i < profile.tendrils; i++) {
      const angle = (i / profile.tendrils) * Math.PI * 2;
      const tendrilLen = 2.5 + Math.random() * 2;
      const tendrilGeo = new THREE.CylinderGeometry(
        0.05, 0.02, tendrilLen, profile.tendrilRadialSegs, 8
      );

      if (profile.hasBarbs) {
        const tpArr = tendrilGeo.attributes.position;
        for (let vi = 0; vi < tpArr.count; vi++) {
          const y = tpArr.getY(vi);
          const normalizedY = (y + tendrilLen * 0.5) / tendrilLen;
          const spine = Math.max(0, Math.sin(normalizedY * 20) - 0.7) * 0.03;
          tpArr.setX(vi, tpArr.getX(vi) + spine * Math.sign(tpArr.getX(vi) || 1));
          tpArr.setZ(vi, tpArr.getZ(vi) + spine * Math.sign(tpArr.getZ(vi) || 1));
        }
        tendrilGeo.computeVertexNormals();
      }

      const tendril = new THREE.Mesh(tendrilGeo, bodyMat);
      tendril.position.set(Math.cos(angle) * 1.6, Math.sin(angle) * 1.6, 0.3);
      tendril.rotation.x = Math.PI / 2 + (Math.random() - 0.5) * 0.3;
      tendril.userData.baseRotX = tendril.rotation.x;
      tendril.userData.baseRotZ = tendril.rotation.z;
      tendril.userData.sweepPhase = Math.random() * Math.PI * 2;
      tendrilMeshes.push(tendril);
      tierGroup.add(tendril);
    }

    // ── Lures with bioluminescence + dangling filament ──────────────────
    const lureMeshes = [];
    for (let i = 0; i < profile.lureCount; i++) {
      const angle = (i / profile.lureCount) * Math.PI * 2 + Math.PI / Math.max(profile.lureCount, 1);
      const lureGeo = new THREE.SphereGeometry(0.08, profile.lureSegs[0], profile.lureSegs[1]);
      const lMat = lureMat.clone();
      const lure = new THREE.Mesh(lureGeo, lMat);
      lure.position.set(Math.cos(angle) * 1.8, Math.sin(angle) * 1.8, 0.8);
      lure.userData.baseEmissiveIntensity = 2.0;
      lure.userData.pulsePhase = Math.random() * Math.PI * 2;
      lureMeshes.push(lure);
      tierGroup.add(lure);

      // Dangling filament geometry
      if (profile.hasLureFilaments) {
        const filLen = 0.4 + Math.random() * 0.3;
        const filGeo = new THREE.CylinderGeometry(0.008, 0.003, filLen, 4, 4);
        const filMat = lureMat.clone();
        filMat.emissiveIntensity = 1.0;
        const filament = new THREE.Mesh(filGeo, filMat);
        filament.position.set(
          Math.cos(angle) * 1.8,
          Math.sin(angle) * 1.8 - 0.05,
          0.8 + 0.08 + filLen * 0.5
        );
        filament.rotation.x = Math.PI * 0.5 + (Math.random() - 0.5) * 0.2;
        filament.userData.baseRotX = filament.rotation.x;
        filament.userData.baseRotZ = filament.rotation.z || 0;
        filament.userData.swingPhase = Math.random() * Math.PI * 2;
        lure.userData.filament = filament;
        tierGroup.add(filament);
      }
    }

    // ── Inner glow sphere ────────────────────────────────────────────────
    const glowSegs = useFarMat ? 6 : 12;
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.4, glowSegs, glowSegs),
      glowMat
    );
    glow.position.z = -4;
    tierGroup.add(glow);

    return {
      group: tierGroup,
      rings,
      tendrilMeshes,
      lureMeshes,
      glow,
      gullet: tierGroup.userData.gullet || null,
    };
  }

  _getVisibleTierName() {
    if (!this.lod || !this.lod.levels) return 'far';
    for (let i = this.lod.levels.length - 1; i >= 0; i--) {
      if (this.lod.levels[i].object.visible) {
        return ['near', 'medium', 'far'][i] || 'far';
      }
    }
    return 'far';
  }

  update(dt, playerPos) {
    this.time += dt;
    this.turnTimer += dt;

    // ── Movement ────────────────────────────────────────────────────────
    if (this.turnTimer > this.turnInterval) {
      this.turnTimer = 0;
      this.turnInterval = 20 + Math.random() * 20;
      if (Math.random() < 0.3) {
        _v3A.subVectors(playerPos, this.group.position).normalize();
        _v3A.y *= 0.15;
        this.direction.copy(_v3A);
      } else {
        this.direction.set(
          Math.random() - 0.5,
          (Math.random() - 0.5) * 0.08,
          Math.random() - 0.5
        ).normalize();
      }
    }

    _v3A.copy(this.direction).multiplyScalar(this.speed * dt);
    this.group.position.add(_v3A);

    // Face direction of travel (using pre-allocated vector)
    _v3B.copy(this.group.position).add(this.direction);
    this.group.lookAt(_v3B);

    // Determine visible LOD tier
    const currentTier = this._getVisibleTierName();

    // ── Breathing pulse (all tiers, cheap uniform scale) ────────────────
    this._breathPhase += dt * BREATHING_SPEED;
    const pulse = 1 + Math.sin(this._breathPhase) * BREATHING_AMPLITUDE;
    this.group.scale.setScalar(this._baseScale * pulse);

    // ── Tooth ring counter-rotation (near + medium only) ────────────────
    if (currentTier !== 'far') {
      const activeTierRings = this.tiers[currentTier];
      if (activeTierRings) {
        for (let i = 0; i < activeTierRings.rings.length; i++) {
          const dir = (i % 2 === 0 ? 1 : -1);
          activeTierRings.rings[i].rotation.z += dir * dt * TOOTH_RING_SPEED * (1 + i * 0.15);
        }
      }
    }

    // ── Player proximity ────────────────────────────────────────────────
    const distToPlayer = this.group.position.distanceTo(playerPos);
    const targetProximity = THREE.MathUtils.clamp(1 - distToPlayer / 40, 0, 1);
    this._playerProximity += (targetProximity - this._playerProximity) * Math.min(dt * 2, 1);

    // ── Inner light pulsing (near only) ─────────────────────────────────
    if (currentTier === 'near' && this.innerLight) {
      this.innerLight.intensity = 1.5 + Math.sin(this.time * 2) * 1 + this._playerProximity * 0.8;
    }

    // ── Lip dilation ────────────────────────────────────────────────────
    this._lipDilationTarget = Math.sin(this.time * LIP_DILATION_SPEED) * LIP_DILATION_AMPLITUDE
      + this._playerProximity * 0.04;
    this._lipDilation += (this._lipDilationTarget - this._lipDilation) * Math.min(dt * 3, 1);

    // ── Shader uniforms (near tier only) ────────────────────────────────
    for (const entry of this._shaderUniforms) {
      entry.uniforms.uMawTime.value = this.time;
      entry.uniforms.uPeristalticPhase.value = this.time * PERISTALTIC_SPEED;
      entry.uniforms.uBreathScale.value = pulse;
      entry.uniforms.uLipDilation.value = this._lipDilation;
      entry.uniforms.uPlayerProximity.value = this._playerProximity;
    }

    // ── Tendril luring animation (near only) ────────────────────────────
    if (currentTier === 'near') {
      const activeTier = this.tiers[currentTier];
      if (activeTier && activeTier.tendrilMeshes) {
        for (let i = 0; i < activeTier.tendrilMeshes.length; i++) {
          const tendril = activeTier.tendrilMeshes[i];
          const phase = tendril.userData.sweepPhase + this.time * TENDRIL_SWEEP_SPEED;
          tendril.rotation.x = tendril.userData.baseRotX
            + Math.sin(phase) * TENDRIL_AMPLITUDE;
          tendril.rotation.z = (tendril.userData.baseRotZ || 0)
            + Math.cos(phase * 0.7 + i) * TENDRIL_AMPLITUDE * 0.6;
        }
      }
    }

    // ── Gullet depth animation (throat visibly deepens during suction) ──
    if (currentTier !== 'far') {
      const activeTierGullet = this.tiers[currentTier];
      if (activeTierGullet && activeTierGullet.gullet) {
        const g = activeTierGullet.gullet;
        const deepenFactor = Math.sin(this._breathPhase * 0.8) * GULLET_DEEPEN_AMPLITUDE
          + this._playerProximity * GULLET_DEEPEN_AMPLITUDE * 0.5;
        g.position.z = g.userData.baseZ - deepenFactor;
        g.scale.y = g.userData.baseScaleY + deepenFactor * 0.15;
      }
    }

    // ── Lure bioluminescence pulse (near only) ──────────────────────────
    if (currentTier === 'near') {
      const activeTier = this.tiers[currentTier];
      if (activeTier && activeTier.lureMeshes) {
        for (let i = 0; i < activeTier.lureMeshes.length; i++) {
          const lure = activeTier.lureMeshes[i];
          const phase = lure.userData.pulsePhase + this.time * (LURE_PULSE_SPEED_BASE + i * 0.3);
          const base = lure.userData.baseEmissiveIntensity;
          const intensity = base * (0.75 + Math.sin(phase) * 0.5 + Math.sin(phase * 2.3) * 0.2);
          if (lure.material.emissiveIntensity !== undefined) {
            lure.material.emissiveIntensity = intensity;
          }
          if (lure.userData.filament) {
            const fil = lure.userData.filament;
            if (fil.material) {
              fil.material.emissiveIntensity = intensity * 0.5;
            }
            // Secondary motion: filament swings with delayed momentum
            const filPhase = (fil.userData.swingPhase || 0) + this.time * LURE_FILAMENT_SWING_SPEED;
            fil.rotation.x = (fil.userData.baseRotX || 0)
              + Math.sin(filPhase) * LURE_FILAMENT_SWING_AMPLITUDE;
            fil.rotation.z = (fil.userData.baseRotZ || 0)
              + Math.sin(filPhase * 0.7 + i * 1.3) * LURE_FILAMENT_SWING_AMPLITUDE * 0.6;
          }
        }
      }
    }

    // ── Respawn if too far ──────────────────────────────────────────────
    if (distToPlayer > RESPAWN_DISTANCE) {
      const a = Math.random() * Math.PI * 2;
      this.group.position.set(
        playerPos.x + Math.cos(a) * 80,
        playerPos.y - Math.random() * 20,
        playerPos.z + Math.sin(a) * 80
      );
    }
  }

  getPosition() { return this.group.position; }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((c) => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        // Don't dispose module-level singleton textures
        if (c.material.normalMap && c.material.normalMap !== _throatNormalTex) {
          c.material.normalMap.dispose();
        }
        c.material.dispose();
      }
    });
  }
}
