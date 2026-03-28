import * as THREE from 'three';
import { qualityManager } from '../QualityManager.js';

const TWO_PI = Math.PI * 2;

// BirthSac-specific LOD distances (fog-calibrated for dark/abyss zone)
const LOD_BS_NEAR = 30;
const LOD_BS_MID  = 55;

// Far LOD frame-skip: quality-responsive (ultra = every 4th frame, else every 3rd)
const FAR_LOD_SKIP_DEFAULT = 3;
const FAR_LOD_SKIP_ULTRA   = 4;

// Pre-allocated temporaries — zero per-frame allocations
const _tmpVec3A = new THREE.Vector3();
const _tmpVec3B = new THREE.Vector3();

// LOD tier geometry profiles (far handled separately as a silhouette — see _buildFarSilhouette)
const LOD_PROFILE = {
  near: {
    coreSegW: 32,  coreSegH: 24,
    sacSegW:  48,  sacSegH:  32,  // primary mesh — 48×32 minimum per spec
    embryoSegW: 16, embryoSegH: 12,
    stalkSegs: 10, stalkRadial: 8,
    veinRadial: 6,
    connCount: 4,
    poreCount: 8,
    animInterval: 1,
  },
  medium: {
    coreSegW: 16, coreSegH: 12,
    sacSegW:  16, sacSegH:  12,
    embryoSegW: 8, embryoSegH: 6,
    stalkSegs: 6, stalkRadial: 5,
    veinRadial: 4,
    connCount: 2,
    poreCount: 0,
    animInterval: 3,
  },
};

// ── Shared canvas texture generators (run once per session) ──

function _createSacNormalTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d   = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1), v = y / (size - 1);
      // Capillary branching network + membrane pores
      const cap1 = Math.sin(u * 32 + Math.cos(v * 16) * 2.5) * 0.20;
      const cap2 = Math.sin(v * 26 + Math.sin(u * 20) * 2.0) * 0.16;
      const bump = Math.sin(u * 48 + v * 42) * 0.05 + Math.cos(u * 65 - v * 54) * 0.04;
      const pore = Math.sin(u * 96 + v * 88) * 0.025;
      const nx = 0.5 + cap1 + bump + pore;
      const ny = 0.5 + cap2 + bump;
      const nz = Math.sqrt(Math.max(0, 1 - (nx * 2 - 1) ** 2 - (ny * 2 - 1) ** 2)) * 0.5 + 0.5;
      const i = (y * size + x) * 4;
      d[i]   = Math.round(THREE.MathUtils.clamp(nx, 0, 1) * 255);
      d[i+1] = Math.round(THREE.MathUtils.clamp(ny, 0, 1) * 255);
      d[i+2] = Math.round(THREE.MathUtils.clamp(nz, 0, 1) * 255);
      d[i+3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  tex.needsUpdate = true;
  return tex;
}

function _createVeinEmissiveTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(255,120,180,0.9)';
  for (let i = 0; i < 20; i++) {
    const angle = (i / 20) * TWO_PI;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(size * 0.5, size * 0.5);
    let cx = size * 0.5, cy = size * 0.5;
    for (let s = 1; s <= 10; s++) {
      const r = (s / 10) * size * 0.44;
      const wobble = Math.sin(s * 1.8 + angle * 4) * size * 0.012;
      cx = size * 0.5 + Math.cos(angle + s * 0.06) * (r + wobble);
      cy = size * 0.5 + Math.sin(angle + s * 0.06) * (r + wobble);
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
    // Capillary branch
    if (i % 3 === 0) {
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      const ba = angle + 0.5;
      ctx.lineTo(cx + Math.cos(ba) * size * 0.08, cy + Math.sin(ba) * size * 0.08);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

// Shared textures — never disposed by individual instances
const sacNormalTex    = _createSacNormalTexture();
const veinEmissiveTex = _createVeinEmissiveTexture();
const _sharedTextures = new Set([sacNormalTex, veinEmissiveTex]);

// LOD addLevel insertion order → tier name
const TIER_NAMES = ['near', 'medium', 'far'];

// ── Vertex shader — radial pulsation wave + fluid slosh ──
const _sacVertPars = /* glsl */ `
  uniform float uTime;
  uniform float uPulsePhase;
  uniform float uPulseWaveSpeed;
  uniform float uInflation;
  uniform float uProximityPulse;
  uniform vec3  uSloshOffset;
  varying vec3  vBsWorldNormal;
  varying vec3  vBsViewDir;
  varying vec2  vBirthUv;
`;
const _sacVertMain = /* glsl */ `
  vBirthUv = uv;
  // Radial pulsation wave traveling across sac surface
  float wave  = sin(position.y * 7.0 + uTime * uPulseWaveSpeed + uPulsePhase) * 0.07;
  wave       += sin(position.x * 5.0 + position.z * 6.0 + uTime * 2.2)        * 0.04;
  // Fluid distension — asymmetric bulge with breathing rhythm
  float dist2  = sin(position.y * 2.5 + uTime * 0.8 + uPulsePhase * 0.5) * 0.045 * uInflation;
  // Proximity: heartbeat acceleration
  wave += uProximityPulse * sin(position.y * 4.0 + uTime * 5.0 + uPulsePhase) * 0.05;
  // Fluid slosh — inertia-driven vertex shift
  float slosh = dot(normal, uSloshOffset) * 0.10;
  transformed += normal * (wave + dist2 + slosh);
`;
const _sacFragPars = /* glsl */ `
  uniform float uTime;
  uniform float uPulsePhase;
  uniform float uVeinPulse;
  varying vec3  vBsWorldNormal;
  varying vec3  vBsViewDir;
  varying vec2  vBirthUv;
`;
const _sacFragMain = /* glsl */ `
  // Fresnel rim-light — sac silhouette visible in dark abyss water
  float bsFres = pow(1.0 - max(dot(vBsWorldNormal, vBsViewDir), 0.0), 3.0);
  gl_FragColor.rgb += vec3(0.22, 0.07, 0.14) * bsFres * 1.8;
  // Heartbeat capillary glow through membrane
  float bsVein = sin(vBirthUv.y * 14.0 + uTime * 3.5 + uPulsePhase) * 0.5 + 0.5;
  gl_FragColor.rgb += vec3(0.30, 0.08, 0.18) * bsVein * uVeinPulse * 0.5;
  // Opacity pulses with heartbeat
  float bsOpPulse = sin(uTime * 1.0 + uPulsePhase) * 0.06;
  gl_FragColor.a = clamp(gl_FragColor.a + bsOpPulse, 0.45, 0.95);
`;

// Pulsating biomechanical egg sac cluster — per-vertex membrane deformation + fluid dynamics
export class BirthSac {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time  = Math.random() * 100;
    this.speed = 0.2 + Math.random() * 0.15;
    this.direction = new THREE.Vector3(Math.random() - 0.5, -0.02, Math.random() - 0.5).normalize();

    // Procedural variation per instance
    this._heartbeatPhase = Math.random() * TWO_PI;
    this._heartbeatRate  = 1.2 + Math.random() * 0.6;
    this._inflation      = 0.8 + Math.random() * 0.4;
    this._proximityPulse = 0;
    this._lastLodTier    = 'near';
    this._frameCount     = 0;

    // Per-sac data — stable across all LOD tiers
    this._sacCount  = 5 + Math.floor(Math.random() * 4); // 5–8 sacs
    this._sacPhases = Array.from({ length: this._sacCount }, () => Math.random() * TWO_PI);
    this._sacSizes  = Array.from({ length: this._sacCount }, () => 0.3 + Math.random() * 0.4);
    this._sacPos    = Array.from({ length: this._sacCount }, () => {
      const phi   = Math.random() * TWO_PI;
      const theta = (Math.random() * 0.7 + 0.15) * Math.PI;
      const r     = 0.5 + Math.random() * 0.6;
      return new THREE.Vector3(
        Math.sin(theta) * Math.cos(phi) * r,
        Math.sin(theta) * Math.sin(phi) * r,
        Math.cos(theta) * r
      );
    });

    // Fluid inertia — pre-allocated, no per-frame allocation
    this._prevPos  = new THREE.Vector3();
    this._velocity = new THREE.Vector3();
    this._sloshVec = new THREE.Vector3();

    this._buildModel();
    this.group.position.copy(position);
    this._prevPos.copy(position);
    scene.add(this.group);
  }

  // ── LOD tier resolution ──

  _getVisibleTierName() {
    const levels = this.lod.levels;
    for (let i = 0; i < levels.length; i++) {
      if (levels[i].object.visible) return TIER_NAMES[i];
    }
    return this._lastLodTier;
  }

  // ── Materials ──

  _createSacMaterial(tierName) {
    // Medium: standard material — no shader injection, no per-vertex deformation cost
    if (tierName === 'medium') {
      return new THREE.MeshStandardMaterial({
        color: 0x201018, roughness: 0.2, metalness: 0,
        transparent: true, opacity: 0.75,
        emissive: 0x502040, emissiveIntensity: 0.65,
        side: THREE.DoubleSide,
      });
    }

    // Near: full MeshPhysicalMaterial with per-vertex pulsation + slosh shader
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0x201018, roughness: 0.15, metalness: 0,
      clearcoat: 0.95, clearcoatRoughness: 0.05,
      transparent: true, opacity: 0.75,
      transmission: 0.35, thickness: 0.6,
      emissive: 0x502040, emissiveIntensity: 0.65,
      normalMap: sacNormalTex,
      normalScale: new THREE.Vector2(0.55, 0.55),
      side: THREE.DoubleSide,
    });

    const pulsePhase = this._heartbeatPhase;
    const inflation  = this._inflation;

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime           = { value: 0 };
      shader.uniforms.uPulsePhase     = { value: pulsePhase };
      shader.uniforms.uPulseWaveSpeed = { value: 2.5 };
      shader.uniforms.uInflation      = { value: inflation };
      shader.uniforms.uProximityPulse = { value: 0 };
      shader.uniforms.uVeinPulse      = { value: 0 };
      shader.uniforms.uSloshOffset    = { value: new THREE.Vector3() };

      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        '#include <common>\n' + _sacVertPars
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n' + _sacVertMain
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\n  vBsWorldNormal = normalize(normalMatrix * objectNormal);\n  vBsViewDir = normalize(-mvPosition.xyz);\n'
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        '#include <common>\n' + _sacFragPars
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        _sacFragMain + '\n#include <dithering_fragment>'
      );

      mat.userData.shaderUniforms = shader.uniforms;
    };

    return mat;
  }

  _createVeinMaterial() {
    return new THREE.MeshPhysicalMaterial({
      color: 0x1a1018, roughness: 0.15, metalness: 0,
      clearcoat: 0.8,
      emissive: 0x802060, emissiveIntensity: 0.8,
      emissiveMap: veinEmissiveTex,
    });
  }

  // ── Build model ──

  _buildModel() {
    this.tiers = {};
    const lod = new THREE.LOD();

    for (const [tierName, profile] of Object.entries(LOD_PROFILE)) {
      const tier = this._buildTier(profile, tierName);
      this.tiers[tierName] = tier;
      const dist = tierName === 'near' ? 0 : LOD_BS_NEAR;
      lod.addLevel(tier.group, dist);
    }

    // Far tier: single silhouette proxy — aggressively lightweight (<100 triangles)
    const farTier = this._buildFarSilhouette();
    this.tiers.far = farTier;
    lod.addLevel(farTier.group, LOD_BS_MID);

    this.lod = lod;
    this.group.add(lod);

    const s = 2 + Math.random() * 2;
    this._baseScale = s;
    this.group.scale.setScalar(s);
  }

  /** Far tier: single blob silhouette representing the entire cluster (<100 triangles). */
  _buildFarSilhouette() {
    const g = new THREE.Group();

    // Single elongated blob — represents the sac cluster; ~60 triangles total
    const silMat = new THREE.MeshStandardMaterial({
      color: 0x1a0c14, roughness: 0.3, metalness: 0,
      transparent: true, opacity: 0.80,
      emissive: 0x3a1030, emissiveIntensity: 0.55,
      side: THREE.DoubleSide,
    });
    const silGeo = new THREE.SphereGeometry(0.95, 6, 4);
    silGeo.scale(1.2, 1.0, 1.0);
    g.add(new THREE.Mesh(silGeo, silMat));

    const glow = new THREE.PointLight(0x660022, 0.6, 8);
    g.add(glow);

    return { group: g, sacMat: silMat, sacs: [], glow, connTissues: [] };
  }

  _buildTier(profile, tierName) {
    const tierGroup = new THREE.Group();
    const sacMat    = this._createSacMaterial(tierName);
    const veinMat   = this._createVeinMaterial();

    // ── Central organic mass ──
    const coreGeo = new THREE.SphereGeometry(0.6, profile.coreSegW, profile.coreSegH);
    const cp = coreGeo.attributes.position;
    for (let i = 0; i < cp.count; i++) {
      const x = cp.getX(i), y = cp.getY(i), z = cp.getZ(i);
      const lump = Math.sin(y * 5 + z * 4) * 0.12
                 + Math.sin(x * 6)          * 0.10
                 + Math.sin(x * 7 + y * 3)  * 0.08;
      const r = Math.sqrt(x * x + y * y + z * z);
      if (r > 0.001) cp.setXYZ(i, x * (1 + lump), y * (1 + lump), z * (1 + lump));
    }
    coreGeo.computeVertexNormals();
    const core = new THREE.Mesh(coreGeo, veinMat);
    tierGroup.add(core);

    // ── Egg sacs around core ──
    const sacs = [];
    for (let i = 0; i < this._sacCount; i++) {
      const sacGroup = new THREE.Group();
      const size  = this._sacSizes[i];
      const phase = this._sacPhases[i];

      // Outer membrane — organic lump displacement
      const outerGeo = new THREE.SphereGeometry(size, profile.sacSegW, profile.sacSegH);
      const op = outerGeo.attributes.position;
      for (let v = 0; v < op.count; v++) {
        const x = op.getX(v), y = op.getY(v), z = op.getZ(v);
        const lump = Math.sin(y * 8 + z * 6) * 0.06
                   + Math.sin(x * 10 + y * 4) * 0.04
                   + Math.sin(z * 12 + x * 7)  * 0.03;
        const r = Math.sqrt(x * x + y * y + z * z);
        if (r > 0.001) op.setXYZ(v, x * (1 + lump), y * (1 + lump), z * (1 + lump));
      }
      outerGeo.computeVertexNormals();
      const outer = new THREE.Mesh(outerGeo, sacMat);
      sacGroup.add(outer);

      // Inner fluid sac — visible through translucent membrane
      if (tierName !== 'far') {
        const innerGeo = new THREE.SphereGeometry(
          size * 0.65,
          Math.max(8, Math.floor(profile.sacSegW * 0.5)),
          Math.max(6, Math.floor(profile.sacSegH * 0.5))
        );
        sacGroup.add(new THREE.Mesh(innerGeo, new THREE.MeshPhysicalMaterial({
          color: 0x3a1020, roughness: 0.3, metalness: 0,
          transparent: true, opacity: 0.35,
          emissive: 0x501828, emissiveIntensity: 0.5,
        })));
      }

      // Embryo — curled fetal form with limb-bud displacement
      let embryo = null;
      if (profile.embryoSegW > 0) {
        const embryoGeo = new THREE.SphereGeometry(size * 0.4, profile.embryoSegW, profile.embryoSegH);
        embryoGeo.scale(1.3, 0.8, 0.7);
        const ep = embryoGeo.attributes.position;
        for (let v = 0; v < ep.count; v++) {
          const x = ep.getX(v), y = ep.getY(v), z = ep.getZ(v);
          const bud = Math.sin(x * 15 + y * 12) * 0.04;
          ep.setXYZ(v, x + bud, y + bud * 0.5, z);
        }
        embryoGeo.computeVertexNormals();
        embryo = new THREE.Mesh(embryoGeo, new THREE.MeshPhysicalMaterial({
          color: 0x1a0810, emissive: 0x3a0e1c, emissiveIntensity: 1.1,
          roughness: 0.6, metalness: 0.05,
        }));
        embryo.position.set(size * 0.1, -size * 0.1, 0);
        embryo.rotation.z = 0.3;
        sacGroup.add(embryo);
      }

      // Attachment stalk — TubeGeometry with organic curve
      const stalkLen  = size * 0.8;
      const stalkPts  = [];
      for (let s = 0; s <= profile.stalkSegs; s++) {
        const t2 = s / profile.stalkSegs;
        stalkPts.push(new THREE.Vector3(
          Math.sin(t2 * 2.5 + i) * 0.025,
          -stalkLen * t2,
          Math.cos(t2 * 2.1 + i * 0.7) * 0.025
        ));
      }
      const stalkCurve = new THREE.CatmullRomCurve3(stalkPts);
      const stalkGeo   = new THREE.TubeGeometry(stalkCurve, profile.stalkSegs, 0.02 + size * 0.025, profile.stalkRadial, false);
      const stalk      = new THREE.Mesh(stalkGeo, veinMat);
      sacGroup.add(stalk);

      // Stalk junction torus — micro-detail at base where stalk meets sac (near only)
      if (profile.poreCount > 0) {
        const juncGeo = new THREE.TorusGeometry(0.02 + size * 0.03, 0.008, 6, 12);
        sacGroup.add(new THREE.Mesh(juncGeo, veinMat));
      }

      // Membrane pores — distributed on upper hemisphere (near only)
      if (profile.poreCount > 0) {
        const poreMat = new THREE.MeshPhysicalMaterial({
          color: 0x1a0810, emissive: 0x400e20, emissiveIntensity: 0.8,
          roughness: 0.4, metalness: 0, side: THREE.DoubleSide,
        });
        for (let p = 0; p < profile.poreCount; p++) {
          const pa     = (p / profile.poreCount) * TWO_PI;
          const pTheta = 0.4 + (p / profile.poreCount) * 0.5;
          const pr     = size * 0.95;
          const poreGeo = new THREE.RingGeometry(size * 0.025, size * 0.04, 6);
          const pore    = new THREE.Mesh(poreGeo, poreMat);
          pore.position.set(
            Math.sin(pTheta) * Math.cos(pa) * pr,
            Math.cos(pTheta) * pr,
            Math.sin(pTheta) * Math.sin(pa) * pr
          );
          pore.lookAt(0, 0, 0);
          sacGroup.add(pore);
        }
      }

      sacGroup.position.copy(this._sacPos[i]);
      tierGroup.add(sacGroup);
      sacs.push({ group: sacGroup, outer, embryo, stalk, phase, size });
    }

    // ── Connective tissue web between sacs (TubeGeometry curves) ──
    const connTissues = [];
    for (let c = 0; c < profile.connCount; c++) {
      const i1 = c % this._sacCount;
      const i2 = (c + 2) % this._sacCount;
      const p1 = this._sacPos[i1];
      const p2 = this._sacPos[i2];
      const mid = new THREE.Vector3().lerpVectors(p1, p2, 0.5);
      mid.y += (c % 2 === 0 ? 1 : -1) * 0.2;
      const connCurve = new THREE.CatmullRomCurve3([p1.clone(), mid, p2.clone()]);
      const connGeo   = new THREE.TubeGeometry(connCurve, Math.max(3, profile.stalkSegs - 2), 0.008, profile.veinRadial, false);
      // Clone veinMat so each connective strand can animate its emissiveIntensity independently
      const connMesh  = new THREE.Mesh(connGeo, veinMat.clone());
      connTissues.push(connMesh);
      tierGroup.add(connMesh);
    }

    // Single point light per tier — emissive glow (no per-sac lights)
    const glow = new THREE.PointLight(0x660022, 0.8, 8);
    tierGroup.add(glow);

    return { group: tierGroup, core, sacMat, sacs, glow, connTissues, profile };
  }

  // ── Update ──

  update(dt, playerPos) {
    this.time += dt;
    this._frameCount++;

    // Very slow drift
    _tmpVec3A.copy(this.direction).multiplyScalar(this.speed * dt);
    this.group.position.add(_tmpVec3A);
    this.group.position.y += Math.sin(this.time * 0.3) * 0.1 * dt;

    // Fluid inertia — velocity for slosh simulation
    _tmpVec3B.subVectors(this.group.position, this._prevPos);
    _tmpVec3B.divideScalar(Math.max(dt, 0.001));
    this._velocity.lerp(_tmpVec3B, 0.1);
    this._sloshVec.copy(this._velocity).negate();
    this._prevPos.copy(this.group.position);

    // Player distance — use pre-allocated temp (reuse after drift/velocity calcs above)
    const dist = _tmpVec3A.subVectors(playerPos, this.group.position).length();

    // Proximity: heartbeat accelerates, embryo activity increases, membrane more opaque
    this._proximityPulse = THREE.MathUtils.clamp(1 - dist / 25, 0, 1);

    const tierName = this._getVisibleTierName();
    this._lastLodTier = tierName;

    const t = this.time;
    const effectiveRate = this._heartbeatRate + this._proximityPulse * 1.5;
    const heartbeat     = Math.sin(t * effectiveRate + this._heartbeatPhase);

    // Update sac shader uniforms (near + medium share the same sacMat per tier)
    this._updateSacUniforms(this.tiers.near, t);
    this._updateSacUniforms(this.tiers.medium, t);

    // Near LOD: per-vertex deformation (GPU shader), embryo twitching, stalk tension, vein pulse
    if (tierName === 'near') {
      const tier = this.tiers.near;
      if (this._frameCount % tier.profile.animInterval === 0) {
        this._animateSacsNear(tier.sacs, t, effectiveRate);
        this._animateConnTissue(tier.connTissues, t);
      }
      tier.glow.intensity = 0.5 + heartbeat * 0.35 + this._proximityPulse * 0.3;
    }

    // Medium LOD: uniform sac scale pulse, no fluid slosh, static embryos
    if (tierName === 'medium') {
      const tier = this.tiers.medium;
      if (this._frameCount % tier.profile.animInterval === 0) {
        this._animateSacsMedium(tier.sacs, t, effectiveRate);
      }
      tier.glow.intensity = 0.4 + heartbeat * 0.25;
    }

    // Far LOD: static silhouette, minimal glow only — skip frames based on quality tier
    if (tierName === 'far') {
      const farStep = qualityManager.tier === 'ultra' ? FAR_LOD_SKIP_ULTRA : FAR_LOD_SKIP_DEFAULT;
      if (this._frameCount % farStep === 0) {
        this.tiers.far.glow.intensity = 0.3 + Math.abs(heartbeat) * 0.15;
      }
    }

    // Slow rotation
    this.group.rotation.y += dt * 0.03;
    this.group.rotation.x = Math.sin(t * 0.15) * 0.05;

    // Respawn when too far from player
    if (dist > 200) {
      const a = Math.random() * TWO_PI;
      this.group.position.set(
        playerPos.x + Math.cos(a) * 80,
        playerPos.y - Math.random() * 10,
        playerPos.z + Math.sin(a) * 80
      );
      this._prevPos.copy(this.group.position);
      this._velocity.set(0, 0, 0);
    }
  }

  _updateSacUniforms(tier, t) {
    const mat = tier.sacMat;
    if (mat.userData && mat.userData.shaderUniforms) {
      const u = mat.userData.shaderUniforms;
      u.uTime.value           = t;
      u.uProximityPulse.value = this._proximityPulse;
      u.uVeinPulse.value      = Math.sin(t * 3 + this._heartbeatPhase) * 0.5 + 0.5;
      u.uSloshOffset.value.copy(this._sloshVec);
    }
  }

  _animateSacsNear(sacs, t, effectiveRate) {
    for (let i = 0; i < sacs.length; i++) {
      const { outer, embryo, stalk, phase, size } = sacs[i];
      const sacBeat = Math.sin(t * effectiveRate + phase);
      // Breathing scale on outer membrane — vertex shader adds per-vertex wave on top
      const pulse = 1 + sacBeat * 0.08;
      const wobX  = 1 + Math.sin(t * 2.8 + phase) * 0.04;
      const wobZ  = 1 + Math.cos(t * 3.1 + phase + 0.5) * 0.04;
      outer.scale.set(pulse * wobX, pulse, pulse * wobZ);

      // Stalk tension — stretches as sac inflates (secondary motion)
      stalk.scale.y = 1 + sacBeat * 0.12;

      // Embryo micro-movement — twitching increases near player
      if (embryo) {
        const act = 0.012 + this._proximityPulse * 0.022;
        embryo.rotation.x = Math.sin(t * 4.5 + phase * 2) * act;
        embryo.rotation.z = Math.cos(t * 3.8 + phase) * act;
        embryo.position.y = -size * 0.1 + Math.sin(t * 2.2 + phase) * size * 0.025;
      }
    }
  }

  _animateSacsMedium(sacs, t, effectiveRate) {
    for (let i = 0; i < sacs.length; i++) {
      const { outer, phase } = sacs[i];
      outer.scale.setScalar(1 + Math.sin(t * effectiveRate + phase) * 0.1);
    }
  }

  _animateConnTissue(connTissues, t) {
    for (let i = 0; i < connTissues.length; i++) {
      const ct = connTissues[i];
      if (ct.material && ct.material.emissiveIntensity !== undefined) {
        ct.material.emissiveIntensity = 0.4 + (Math.sin(t * 2.5 + i * 1.8 + this._heartbeatPhase) * 0.5 + 0.5) * 0.5;
      }
    }
  }

  getPosition() { return this.group.position; }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(c => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        if (c.material.map        && !_sharedTextures.has(c.material.map))        c.material.map.dispose();
        if (c.material.normalMap  && !_sharedTextures.has(c.material.normalMap))  c.material.normalMap.dispose();
        if (c.material.emissiveMap && !_sharedTextures.has(c.material.emissiveMap)) c.material.emissiveMap.dispose();
        c.material.dispose();
      }
    });
  }
}
