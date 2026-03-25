import * as THREE from 'three';
import { LOD_NEAR_DISTANCE, LOD_MEDIUM_DISTANCE, toStandardMaterial } from './lodUtils.js';

const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI * 0.5;

// Pre-allocated temporaries — zero per-frame allocations
const _tmpVec3A = new THREE.Vector3();
const _tmpVec3B = new THREE.Vector3();

// LOD tier profiles
const LOD_PROFILE = {
  near: {
    sacSegW: 48, sacSegH: 32,
    secSacSegW: 24, secSacSegH: 16,
    proboscisSegs: 14, proboscisRadial: 8,
    barbCount: 6, barbSpines: 4,
    tendrilCount: 8, tendrilSegs: 12, tendrilRadial: 8,
    veinCount: 8, veinSegs: 8, veinBranches: 3,
    anchorPad: true,
    animInterval: 1,
  },
  medium: {
    sacSegW: 24, sacSegH: 16,
    secSacSegW: 14, secSacSegH: 10,
    proboscisSegs: 8, proboscisRadial: 6,
    barbCount: 4, barbSpines: 2,
    tendrilCount: 4, tendrilSegs: 8, tendrilRadial: 5,
    veinCount: 4, veinSegs: 6, veinBranches: 1,
    anchorPad: false,
    animInterval: 3,
  },
  far: {
    sacSegW: 10, sacSegH: 8,
    secSacSegW: 8, secSacSegH: 6,
    proboscisSegs: 4, proboscisRadial: 4,
    barbCount: 0, barbSpines: 0,
    tendrilCount: 0, tendrilSegs: 0, tendrilRadial: 0,
    veinCount: 0, veinSegs: 0, veinBranches: 0,
    anchorPad: false,
    animInterval: 6,
  },
};

// ── Canvas texture generators (run once, shared across instances) ──

function createSacNormalTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const data = image.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1);
      const v = y / (size - 1);
      // Capillary vein network + organic bumps
      const veinU = Math.sin(u * 28 + Math.cos(v * 14) * 2) * 0.18;
      const veinV = Math.sin(v * 22 + Math.sin(u * 18) * 1.8) * 0.15;
      const bump = Math.sin(u * 44 + v * 38) * 0.06 + Math.cos(u * 62 - v * 51) * 0.04;
      const pore = Math.sin(u * 90 + v * 80) * 0.03;
      const nx = 0.5 + veinU + bump + pore;
      const ny = 0.5 + veinV + bump;
      const nz = Math.sqrt(Math.max(0, 1 - (nx * 2 - 1) ** 2 - (ny * 2 - 1) ** 2)) * 0.5 + 0.5;
      const i = (y * size + x) * 4;
      data[i] = Math.round(THREE.MathUtils.clamp(nx, 0, 1) * 255);
      data[i + 1] = Math.round(THREE.MathUtils.clamp(ny, 0, 1) * 255);
      data[i + 2] = Math.round(THREE.MathUtils.clamp(nz, 0, 1) * 255);
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.needsUpdate = true;
  return tex;
}

function createProboscisNormalTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const data = image.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1);
      const v = y / (size - 1);
      const ridge = Math.sin(v * 40) * 0.22;
      const ring = Math.sin(u * TWO_PI * 6) * 0.08;
      const nx = 0.5 + ring;
      const ny = 0.5 + ridge;
      const nz = Math.sqrt(Math.max(0, 1 - (nx * 2 - 1) ** 2 - (ny * 2 - 1) ** 2)) * 0.5 + 0.5;
      const i = (y * size + x) * 4;
      data[i] = Math.round(THREE.MathUtils.clamp(nx, 0, 1) * 255);
      data[i + 1] = Math.round(THREE.MathUtils.clamp(ny, 0, 1) * 255);
      data[i + 2] = Math.round(THREE.MathUtils.clamp(nz, 0, 1) * 255);
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 4);
  tex.needsUpdate = true;
  return tex;
}

function createVeinEmissiveTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * TWO_PI;
    ctx.beginPath();
    ctx.moveTo(size * 0.5, size * 0.5);
    let cx = size * 0.5, cy = size * 0.5;
    for (let s = 1; s <= 8; s++) {
      const r = (s / 8) * size * 0.45;
      const wobble = Math.sin(s * 2.1 + angle * 3) * size * 0.015;
      cx = size * 0.5 + Math.cos(angle + s * 0.08) * (r + wobble);
      cy = size * 0.5 + Math.sin(angle + s * 0.08) * (r + wobble);
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
    if (i % 2 === 0) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      const ba = angle + 0.4;
      ctx.lineTo(cx + Math.cos(ba) * size * 0.1, cy + Math.sin(ba) * size * 0.1);
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

// Shared textures (created once — never disposed by individual instances)
const sacNormalTex = createSacNormalTexture();
const proboscisNormalTex = createProboscisNormalTexture();
const veinEmissiveTex = createVeinEmissiveTexture();
const _sharedTextures = new Set([sacNormalTex, proboscisNormalTex, veinEmissiveTex]);

// Maps LOD level indices to tier names (matches addLevel insertion order: 0, 42, 86)
const TIER_NAMES = ['near', 'medium', 'far'];

// ── Sac vertex shader chunks for per-vertex inflation waves ──
const sacVertexPars = /* glsl */ `
  uniform float uTime;
  uniform float uHeartbeatPhase;
  uniform float uInflation;
  uniform float uProximityPulse;
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;
  varying vec2 vSacUv;
`;

const sacVertexMain = /* glsl */ `
  vSacUv = uv;
  float wave = sin(position.y * 6.0 + uTime * 2.5 + uHeartbeatPhase) * 0.06;
  wave += sin(position.x * 4.0 + position.z * 5.0 + uTime * 1.8) * 0.03;
  wave += uProximityPulse * sin(position.y * 3.0 + uTime * 4.0) * 0.04;
  float distension = sin(position.y * 2.0 + uTime * 0.7 + uHeartbeatPhase * 0.5) * 0.04 * uInflation;
  transformed += normal * (wave + distension);
`;

const sacFragmentPars = /* glsl */ `
  uniform float uTime;
  uniform float uHeartbeatPhase;
  uniform float uVeinPulse;
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;
  varying vec2 vSacUv;
`;

const sacFragmentMain = /* glsl */ `
  float fresnel = pow(1.0 - max(dot(vWorldNormal, vViewDir), 0.0), 3.0);
  gl_FragColor.rgb += vec3(0.18, 0.06, 0.12) * fresnel * 1.5;
  float veinGlow = sin(vSacUv.y * 12.0 + uTime * 3.0 + uHeartbeatPhase) * 0.5 + 0.5;
  gl_FragColor.rgb += vec3(0.25, 0.08, 0.15) * veinGlow * uVeinPulse * 0.4;
`;

// Parasitic creature — pulsing translucent sacs with barbed proboscis, grasping tendrils, vein network
export class Parasite {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time = Math.random() * 100;
    this.speed = 0.8 + Math.random() * 1;
    this.direction = new THREE.Vector3(Math.random() - 0.5, -0.05, Math.random() - 0.5).normalize();
    this.turnTimer = 0;
    this.turnInterval = 7 + Math.random() * 8;

    // Procedural variation
    this._heartbeatPhase = Math.random() * TWO_PI;
    this._heartbeatRate = 1.8 + Math.random() * 0.8;
    this._inflation = 0.8 + Math.random() * 0.4;
    this._wobblePhase = Math.random() * TWO_PI;
    this._secSacPhases = [
      Math.random() * TWO_PI,
      Math.random() * TWO_PI,
      Math.random() * TWO_PI,
    ];
    this._secSacSizes = [
      0.15 + Math.random() * 0.15,
      0.15 + Math.random() * 0.15,
      0.15 + Math.random() * 0.15,
    ];
    this._proximityPulse = 0;
    this._lastLodTier = 'near';
    this._frameCount = 0;
    this._proboscisTarget = new THREE.Vector3();

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  // ── LOD tier resolution — query THREE.LOD's actual visible level ──

  _getVisibleTierName() {
    const levels = this.lod.levels;
    for (let i = 0; i < levels.length; i++) {
      if (levels[i].object.visible) return TIER_NAMES[i];
    }
    return this._lastLodTier; // fallback before first render pass
  }

  // ── Materials ──

  _createSacMaterial(useFar) {
    if (useFar) {
      return new THREE.MeshStandardMaterial({
        color: 0x201018, roughness: 0.2, metalness: 0,
        transparent: true, opacity: 0.82,
        emissive: 0x502040, emissiveIntensity: 0.7,
        side: THREE.DoubleSide,
      });
    }

    const mat = new THREE.MeshPhysicalMaterial({
      color: 0x201018, roughness: 0.15, metalness: 0,
      clearcoat: 0.95, clearcoatRoughness: 0.05,
      transparent: true, opacity: 0.82,
      transmission: 0.35, thickness: 0.5,
      emissive: 0x502040, emissiveIntensity: 0.7,
      normalMap: sacNormalTex,
      normalScale: new THREE.Vector2(0.6, 0.6),
      side: THREE.DoubleSide,
    });

    const heartbeatPhase = this._heartbeatPhase;
    const inflation = this._inflation;

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      shader.uniforms.uHeartbeatPhase = { value: heartbeatPhase };
      shader.uniforms.uInflation = { value: inflation };
      shader.uniforms.uProximityPulse = { value: 0 };
      shader.uniforms.uVeinPulse = { value: 0 };

      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        '#include <common>\n' + sacVertexPars
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n' + sacVertexMain
      );
      // Compute vWorldNormal and vViewDir after model-view transform
      shader.vertexShader = shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\n  vWorldNormal = normalize(normalMatrix * objectNormal);\n  vViewDir = normalize(-mvPosition.xyz);\n'
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        '#include <common>\n' + sacFragmentPars
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        sacFragmentMain + '\n#include <dithering_fragment>'
      );

      mat.userData.shaderUniforms = shader.uniforms;
    };

    return mat;
  }

  _createProboscisMaterial(useFar) {
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0x181018, roughness: 0.1, metalness: 0.6,
      clearcoat: 1.0, clearcoatRoughness: 0.05,
      emissive: 0x203858, emissiveIntensity: 0.3,
      normalMap: proboscisNormalTex,
      normalScale: new THREE.Vector2(0.8, 0.8),
    });
    return useFar ? toStandardMaterial(mat) : mat;
  }

  _createVeinMaterial(useFar) {
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0x1a1018, roughness: 0.15, metalness: 0,
      clearcoat: 0.8,
      emissive: 0x802060, emissiveIntensity: 0.8,
      emissiveMap: veinEmissiveTex,
    });
    return useFar ? toStandardMaterial(mat) : mat;
  }

  _createTendrilMaterial(useFar) {
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0x1a1018, roughness: 0.2, metalness: 0,
      clearcoat: 0.8,
      emissive: 0x602040, emissiveIntensity: 0.5,
    });
    return useFar ? toStandardMaterial(mat) : mat;
  }

  // ── Build model ──

  _buildModel() {
    this.tiers = {};
    const lod = new THREE.LOD();

    for (const [tierName, profile] of Object.entries(LOD_PROFILE)) {
      const useFar = tierName === 'far';
      const tier = this._buildTier(profile, useFar, tierName);
      this.tiers[tierName] = tier;
      const dist = tierName === 'near' ? 0 : tierName === 'medium' ? LOD_NEAR_DISTANCE : LOD_MEDIUM_DISTANCE;
      lod.addLevel(tier.group, dist);
    }

    this.lod = lod;
    this.group.add(lod);

    const s = 1.5 + Math.random() * 1.5;
    this._baseScale = s;
    this.group.scale.setScalar(s);
  }

  _buildTier(profile, useFar, tierName) {
    const tierGroup = new THREE.Group();
    const sacMat = this._createSacMaterial(useFar);
    const probMat = this._createProboscisMaterial(useFar);
    const veinMat = this._createVeinMaterial(useFar);
    const tendrilMat = this._createTendrilMaterial(useFar);

    // ── Main body sac with organic lumpy displacement ──
    const bodyGeo = new THREE.SphereGeometry(0.4, profile.sacSegW, profile.sacSegH);
    const bp = bodyGeo.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i);
      const lump = Math.sin(y * 6 + z * 5) * 0.08
        + Math.sin(x * 8 + y * 4) * 0.05
        + Math.sin(z * 10 + x * 7) * 0.03;
      const r = Math.sqrt(x * x + y * y + z * z);
      if (r > 0.001) {
        const scale = 1 + lump;
        bp.setXYZ(i, x * scale, y * scale, z * scale);
      }
    }
    bodyGeo.computeVertexNormals();
    const body = new THREE.Mesh(bodyGeo, sacMat);
    tierGroup.add(body);

    // ── Visible internal fluid structures (inner sac) ──
    if (tierName !== 'far') {
      const innerGeo = new THREE.SphereGeometry(
        0.28,
        Math.floor(profile.sacSegW * 0.6),
        Math.floor(profile.sacSegH * 0.6)
      );
      const innerMat = new THREE.MeshPhysicalMaterial({
        color: 0x401828, roughness: 0.3, metalness: 0,
        transparent: true, opacity: 0.35,
        emissive: 0x501838, emissiveIntensity: 0.5,
      });
      tierGroup.add(new THREE.Mesh(innerGeo, innerMat));
    }

    // ── Secondary sacs with independent rhythm ──
    const secSacs = [];
    for (let i = 0; i < 3; i++) {
      const size = this._secSacSizes[i];
      const secGeo = new THREE.SphereGeometry(size, profile.secSacSegW, profile.secSacSegH);
      const sp = secGeo.attributes.position;
      for (let j = 0; j < sp.count; j++) {
        const x = sp.getX(j), y = sp.getY(j), z = sp.getZ(j);
        const lump = Math.sin(y * 8 + z * 7) * 0.06 + Math.sin(x * 10) * 0.04;
        const r = Math.sqrt(x * x + y * y + z * z);
        if (r > 0.001) {
          sp.setXYZ(j, x * (1 + lump), y * (1 + lump), z * (1 + lump));
        }
      }
      secGeo.computeVertexNormals();
      const sec = new THREE.Mesh(secGeo, sacMat);
      const angle = (i / 3) * TWO_PI + 0.3;
      sec.position.set(Math.cos(angle) * 0.32, (Math.random() - 0.5) * 0.2, Math.sin(angle) * 0.32);
      secSacs.push(sec);
      tierGroup.add(sec);
    }

    // ── Proboscis — multi-segment with hooked barb tip ──
    const proboscisGroup = new THREE.Group();
    const probeGeo = new THREE.CylinderGeometry(0.04, 0.018, 0.9, profile.proboscisRadial, profile.proboscisSegs);
    const pp = probeGeo.attributes.position;
    for (let i = 0; i < pp.count; i++) {
      const y = pp.getY(i);
      pp.setX(i, pp.getX(i) + Math.sin((y + 0.45) * 2.5) * 0.03);
    }
    probeGeo.computeVertexNormals();
    proboscisGroup.add(new THREE.Mesh(probeGeo, probMat));

    for (let i = 0; i < profile.barbCount; i++) {
      const barbAngle = (i / Math.max(1, profile.barbCount)) * TWO_PI;
      const barbGeo = new THREE.ConeGeometry(0.012, 0.12, profile.barbSpines > 0 ? 4 : 3);
      const barb = new THREE.Mesh(barbGeo, probMat);
      barb.position.set(Math.cos(barbAngle) * 0.03, -0.4 - (i % 3) * 0.06, Math.sin(barbAngle) * 0.03);
      barb.rotation.x = Math.sin(barbAngle) * 0.6;
      barb.rotation.z = Math.cos(barbAngle) * 0.6 + 0.3;
      proboscisGroup.add(barb);

      for (let s = 0; s < profile.barbSpines; s++) {
        const spineGeo = new THREE.ConeGeometry(0.004, 0.04, 3);
        const spine = new THREE.Mesh(spineGeo, probMat);
        spine.position.set(
          barb.position.x + Math.cos(barbAngle + s) * 0.01,
          barb.position.y + s * 0.02,
          barb.position.z + Math.sin(barbAngle + s) * 0.01
        );
        spine.rotation.z = 0.5;
        proboscisGroup.add(spine);
      }
    }

    if (profile.barbCount > 0) {
      const hookGeo = new THREE.TorusGeometry(0.025, 0.006, 6, 8, Math.PI);
      const hook = new THREE.Mesh(hookGeo, probMat);
      hook.position.y = -0.48;
      hook.rotation.x = HALF_PI;
      proboscisGroup.add(hook);
    }

    proboscisGroup.position.set(0.32, 0.05, 0);
    proboscisGroup.rotation.z = -Math.PI / 4;
    tierGroup.add(proboscisGroup);

    // ── Tendrils — TubeGeometry with organic curves ──
    const tendrils = [];
    for (let i = 0; i < profile.tendrilCount; i++) {
      const angle = (i / profile.tendrilCount) * TWO_PI;
      const tendrilLen = 0.4 + Math.random() * 0.25;
      const points = [];
      for (let s = 0; s <= profile.tendrilSegs; s++) {
        const t = s / profile.tendrilSegs;
        points.push(new THREE.Vector3(
          Math.cos(angle) * 0.3 + Math.sin(t * 4 + i) * 0.04,
          -0.25 - t * tendrilLen + Math.sin(t * 3 + i * 0.7) * 0.02,
          Math.sin(angle) * 0.3 + Math.cos(t * 3.5 + i * 1.2) * 0.04
        ));
      }
      const curve = new THREE.CatmullRomCurve3(points);
      const tubeGeo = new THREE.TubeGeometry(curve, profile.tendrilSegs, 0.012, profile.tendrilRadial, false);
      const tendril = new THREE.Mesh(tubeGeo, tendrilMat);
      tendril.userData.angle = angle;
      tendrils.push(tendril);
      tierGroup.add(tendril);
    }

    // ── Veins with branching network ──
    const veins = [];
    for (let i = 0; i < profile.veinCount; i++) {
      const angle = (i / profile.veinCount) * TWO_PI;
      const veinPoints = [];
      for (let s = 0; s <= profile.veinSegs; s++) {
        const t = s / profile.veinSegs;
        const r = 0.35 * t + 0.05;
        veinPoints.push(new THREE.Vector3(
          Math.cos(angle + t * 0.3) * r,
          Math.sin(t * 3 + angle) * 0.06,
          Math.sin(angle + t * 0.3) * r
        ));
      }
      const veinCurve = new THREE.CatmullRomCurve3(veinPoints);
      const veinGeo = new THREE.TubeGeometry(veinCurve, profile.veinSegs, 0.005, 6, false);
      const vein = new THREE.Mesh(veinGeo, veinMat);
      veins.push(vein);
      tierGroup.add(vein);

      for (let b = 0; b < profile.veinBranches; b++) {
        const branchT = 0.4 + b * 0.2;
        const parentPt = veinCurve.getPoint(branchT);
        const branchAngle = angle + (b % 2 === 0 ? 0.4 : -0.4);
        const branchPts = [];
        for (let s = 0; s <= 4; s++) {
          const bt = s / 4;
          branchPts.push(new THREE.Vector3(
            parentPt.x + Math.cos(branchAngle) * bt * 0.1,
            parentPt.y + Math.sin(bt * 2 + angle) * 0.02,
            parentPt.z + Math.sin(branchAngle) * bt * 0.1
          ));
        }
        const branchCurve = new THREE.CatmullRomCurve3(branchPts);
        const branchGeo = new THREE.TubeGeometry(branchCurve, 4, 0.003, 4, false);
        tierGroup.add(new THREE.Mesh(branchGeo, veinMat));
      }
    }

    // ── Anchor pad geometry (ventral surface) — near only ──
    if (profile.anchorPad) {
      const padMat = useFar ? new THREE.MeshStandardMaterial({
        color: 0x251520, roughness: 0.3, metalness: 0,
        emissive: 0x301828, emissiveIntensity: 0.3, side: THREE.DoubleSide,
      }) : new THREE.MeshPhysicalMaterial({
        color: 0x251520, roughness: 0.3, metalness: 0,
        clearcoat: 0.6, emissive: 0x301828, emissiveIntensity: 0.3,
        side: THREE.DoubleSide,
      });
      const padGeo = new THREE.CircleGeometry(0.2, 16);
      const anchorPad = new THREE.Mesh(padGeo, padMat);
      anchorPad.rotation.x = -HALF_PI;
      anchorPad.position.y = -0.38;
      tierGroup.add(anchorPad);

      for (let p = 0; p < 8; p++) {
        const pa = (p / 8) * TWO_PI;
        const poreGeo = new THREE.RingGeometry(0.008, 0.015, 8);
        const pore = new THREE.Mesh(poreGeo, padMat);
        pore.position.set(Math.cos(pa) * 0.12, -0.37, Math.sin(pa) * 0.12);
        pore.rotation.x = -HALF_PI;
        tierGroup.add(pore);
      }
    }

    return { group: tierGroup, body, sacMat, secSacs, proboscisGroup, tendrils, veins, profile };
  }

  // ── Update ──

  update(dt, playerPos) {
    this.time += dt;
    this._frameCount++;
    this.turnTimer += dt;

    if (this.turnTimer > this.turnInterval) {
      this.turnTimer = 0;
      this.turnInterval = 7 + Math.random() * 8;
      if (Math.random() < 0.4) {
        this.direction.subVectors(playerPos, this.group.position).normalize();
        this.direction.y *= 0.2;
      } else {
        this.direction.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.08, Math.random() - 0.5).normalize();
      }
    }

    _tmpVec3A.copy(this.direction).multiplyScalar(this.speed * dt);
    this.group.position.add(_tmpVec3A);

    const dx = playerPos.x - this.group.position.x;
    const dy = playerPos.y - this.group.position.y;
    const dz = playerPos.z - this.group.position.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    this._proximityPulse = THREE.MathUtils.clamp(1 - dist / 25, 0, 1);

    const tierName = this._getVisibleTierName();
    this._lastLodTier = tierName;

    const t = this.time;
    const heartbeatFast = Math.sin(t * (this._heartbeatRate + this._proximityPulse * 2) + this._heartbeatPhase);

    // Update shader uniforms on near/medium sac materials
    this._updateSacUniforms(this.tiers.near, t);
    this._updateSacUniforms(this.tiers.medium, t);

    // Near LOD: per-vertex deformation (shader), proboscis IK, tendrils, vein pulse
    if (tierName === 'near') {
      this._animateProboscisIK(this.tiers.near.proboscisGroup, playerPos, t);
      if (this._frameCount % this.tiers.near.profile.animInterval === 0) {
        this._animateTendrils(this.tiers.near.tendrils, t);
      }
      this._animateVeinPulse(this.tiers.near, t);
    }

    // Medium LOD: uniform sac scale pulse, simplified proboscis sway, 50% tendrils
    if (tierName === 'medium') {
      const pulse = 1 + heartbeatFast * 0.08;
      this.tiers.medium.body.scale.setScalar(pulse);
      this._animateProboscisSway(this.tiers.medium.proboscisGroup, t);
      if (this._frameCount % this.tiers.medium.profile.animInterval === 0) {
        this._animateTendrils(this.tiers.medium.tendrils, t);
      }
    }

    // Secondary sac independent heartbeat (near + medium)
    if (tierName !== 'far') {
      const activeTier = this.tiers[tierName];
      for (let i = 0; i < activeTier.secSacs.length; i++) {
        const phase = this._secSacPhases[i];
        const secPulse = 1 + Math.sin(t * (this._heartbeatRate + 0.3 * i) + phase) * 0.12;
        const wobbleX = 1 + Math.sin(t * 3.2 + phase + this._wobblePhase) * 0.04;
        const wobbleZ = 1 + Math.cos(t * 2.8 + phase) * 0.04;
        activeTier.secSacs[i].scale.set(secPulse * wobbleX, secPulse * (2 - wobbleX), secPulse * wobbleZ);
      }
    }

    // Slow feeding growth pulsation
    const feedScale = 1 + Math.sin(t * 0.3) * 0.02;
    if (tierName !== 'far') {
      this.tiers[tierName].body.scale.setScalar(
        tierName === 'near' ? feedScale : (1 + heartbeatFast * 0.08) * feedScale
      );
    }

    // Respawn
    if (dist > 200) {
      const a = Math.random() * TWO_PI;
      this.group.position.set(
        playerPos.x + Math.cos(a) * 60,
        playerPos.y - Math.random() * 8,
        playerPos.z + Math.sin(a) * 60
      );
    }
  }

  _updateSacUniforms(tier, t) {
    const mat = tier.sacMat;
    if (mat.userData && mat.userData.shaderUniforms) {
      const u = mat.userData.shaderUniforms;
      u.uTime.value = t;
      u.uProximityPulse.value = this._proximityPulse;
      u.uVeinPulse.value = Math.sin(t * 3 + this._heartbeatPhase) * 0.5 + 0.5;
    }
  }

  _animateProboscisIK(probGroup, playerPos, t) {
    _tmpVec3B.copy(playerPos).sub(this.group.position);
    const localDir = this.group.worldToLocal(_tmpVec3B.add(this.group.position));
    this._proboscisTarget.lerp(localDir.normalize(), 0.03);
    const target = this._proboscisTarget;

    const searchPhase = Math.sin(t * 1.2) * 0.3;
    const probeExtend = 0.8 + this._proximityPulse * 0.3;
    probGroup.rotation.z = Math.atan2(target.y, Math.sqrt(target.x * target.x + target.z * target.z)) - HALF_PI * 0.5 + searchPhase;
    probGroup.rotation.y = Math.atan2(target.x, target.z) * 0.5 + Math.sin(t * 0.8) * 0.2;
    probGroup.rotation.x = Math.sin(t * 1.5) * 0.15;
    probGroup.scale.y = probeExtend;
  }

  _animateProboscisSway(probGroup, t) {
    probGroup.rotation.z = -Math.PI / 4 + Math.sin(t * 1.5) * 0.2;
    probGroup.rotation.y = Math.sin(t * 0.8) * 0.3;
  }

  _animateTendrils(tendrils, t) {
    for (let i = 0; i < tendrils.length; i++) {
      const tendril = tendrils[i];
      const angle = tendril.userData.angle;
      tendril.rotation.x = Math.sin(t * 1.5 + angle * 2) * 0.12 + Math.sin(t * 0.8 + i * 0.9) * 0.08;
      tendril.rotation.z = Math.cos(t * 1.2 + angle) * 0.1;
      tendril.position.y = -0.25 + Math.sin(t * 2 + i * 1.3) * 0.03;
    }
  }

  _animateVeinPulse(tier, t) {
    for (let i = 0; i < tier.veins.length; i++) {
      const vein = tier.veins[i];
      if (vein.material.emissiveIntensity !== undefined) {
        const wave = Math.sin(t * 3 + i * 1.5 + this._heartbeatPhase) * 0.5 + 0.5;
        vein.material.emissiveIntensity = 0.4 + wave * 0.6;
      }
    }
  }

  getPosition() { return this.group.position; }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(c => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        // Skip shared module-level textures — they are reused across all instances
        if (c.material.map && !_sharedTextures.has(c.material.map)) c.material.map.dispose();
        if (c.material.normalMap && !_sharedTextures.has(c.material.normalMap)) c.material.normalMap.dispose();
        if (c.material.emissiveMap && !_sharedTextures.has(c.material.emissiveMap)) c.material.emissiveMap.dispose();
        c.material.dispose();
      }
    });
  }
}
