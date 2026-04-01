import * as THREE from 'three/webgpu';
import { abs, cos, dot, float as tslFloat, materialEmissive, max as tslMax, mix as tslMix, normalView, positionLocal, positionView, pow, sin, smoothstep as tslSmoothstep, sub, texture as tslTexture, uniform, uv, varying, vec2, vec3 } from 'three/tsl';

// ─── Dark jellyfish that absorbs light — inverse bioluminescence with void tendrils ───
// Photorealistic 3-tier LOD creature with per-vertex bell contraction,
// tentacle trail physics, subsurface-scattering materials, and Fresnel rim glow.

const LOD_NEAR = 30;
const LOD_MEDIUM = 80;
const RESPAWN_DISTANCE = 200;
const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI * 0.5;

function smoothstep(edge0, edge1, x) {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function lerp(a, b, t) { return a + (b - a) * t; }

// ─── Module-level singleton textures (not disposed per-instance) ───────────────

function createGlowTexture() {
  const s = 64, c = document.createElement('canvas');
  c.width = s; c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(60,20,120,1)');
  g.addColorStop(0.3, 'rgba(40,10,80,0.6)');
  g.addColorStop(0.7, 'rgba(20,5,60,0.1)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

function createBellNormalTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const data = image.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1);
      const v = y / (size - 1);
      const angle = u * TWO_PI;
      // Radial muscle fiber pattern
      const radialFiber = Math.sin(angle * 16 + v * 12) * 0.18;
      const circumFiber = Math.cos(v * 48 + Math.sin(angle * 4) * 2.8) * 0.14;
      const microDetail = Math.sin(angle * 32 + v * 64) * 0.04;
      const nx = THREE.MathUtils.clamp(0.5 + radialFiber + microDetail, 0, 1);
      const ny = THREE.MathUtils.clamp(0.5 + circumFiber, 0, 1);
      const nz = Math.sqrt(Math.max(0, 1 - (nx * 2 - 1) ** 2 - (ny * 2 - 1) ** 2)) * 0.5 + 0.5;
      const i = (y * size + x) * 4;
      data[i] = Math.round(nx * 255);
      data[i + 1] = Math.round(ny * 255);
      data[i + 2] = Math.round(nz * 255);
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 3);
  tex.needsUpdate = true;
  return tex;
}

function createVeinTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(120,40,200,0.85)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 18; i++) {
    const angle = (i / 18) * TWO_PI;
    ctx.beginPath();
    ctx.moveTo(size * 0.5, size * 0.15);
    for (let s = 1; s <= 7; s++) {
      const r = (s / 7) * size * 0.44;
      const wobble = Math.sin(s * 1.9 + angle * 2.4) * size * 0.025;
      ctx.lineTo(
        size * 0.5 + Math.cos(angle + s * 0.09) * (r + wobble),
        size * 0.18 + Math.sin(angle) * 0.06 * size + r * 0.88
      );
    }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

const _glowTexture = createGlowTexture();
const _bellNormalTexture = createBellNormalTexture();
const _veinTexture = createVeinTexture();

// ─── LOD Profiles ──────────────────────────────────────────────────────────────

// ─── TSL bell shader — per-vertex contraction wave + void glow emissive ────────

function _applyBellShader(mat, uniforms) {
  mat.userData.shaderUniforms = uniforms;

  // TSL vertex: per-vertex bell contraction with wave propagation from apex to margin
  const bellUv = varying(uv(), 'vVoidUv');
  const xz = vec2(positionLocal.x, positionLocal.z);
  const radial = xz.length();
  const edge = tslSmoothstep(0.3, 1.0, radial);
  const crown = sub(1.0, tslSmoothstep(0.0, 0.4, radial));
  const contraction = tslMax(uniforms.uContractionPhase, 0.0);
  const relax = tslMax(uniforms.uContractionPhase.negate(), 0.0);
  const muscleStrain = sin(positionLocal.y.mul(28.0).add(radial.mul(14.0)).add(uniforms.uVoidTime.mul(1.8)))
    .mul(contraction).mul(0.025);
  const waveDelay = radial.mul(0.6);
  const wavePh = sin(uniforms.uVoidTime.mul(3.0).sub(waveDelay.mul(6.28))).mul(0.5).add(0.5);
  const localContraction = contraction.mul(tslMix(tslFloat(0.3), tslFloat(1.0), wavePh));
  const radialContract = localContraction.mul(edge).mul(
    tslFloat(0.18).add(sin(radial.mul(16.0).add(uniforms.uVoidTime.mul(2.6))).mul(0.015))
  );
  const factor = sub(1.0, radialContract).add(relax.mul(edge).mul(0.05));
  const newX = positionLocal.x.mul(factor);
  const newZ = positionLocal.z.mul(factor);
  const newY = positionLocal.y
    .add(crown.mul(localContraction).mul(0.035))
    .sub(edge.mul(localContraction).mul(0.14))
    .add(edge.mul(relax).mul(0.04))
    .add(muscleStrain);

  // Pass varying data for fragment
  const vBellEdge = varying(edge, 'vBellEdge');
  const vBellTravel = varying(radial, 'vBellTravel');

  mat.positionNode = vec3(newX, newY, newZ);

  // TSL fragment: void bioluminescent pulse wave + Fresnel rim + contraction flash
  const pulseHead = tslSmoothstep(uniforms.uPulseTravel.sub(0.22), uniforms.uPulseTravel.add(0.06), vBellTravel)
    .mul(sub(1.0, tslSmoothstep(uniforms.uPulseTravel.add(0.06), uniforms.uPulseTravel.add(0.22), vBellTravel)));
  const veins = tslTexture(_veinTexture, vec2(bellUv.x, bellUv.y.mul(1.2))).r;
  const viewDir = positionView.negate().normalize();
  const fresnel = pow(sub(1.0, abs(dot(viewDir, normalView))), 2.8);
  const contractionGlow = tslMax(uniforms.uContractionPhase, 0.0).mul(0.5);
  const flash = uniforms.uFlashWave.mul(tslSmoothstep(0.0, 0.5, vBellEdge)).mul(0.8);
  const voidGlow = vec3(0.08, 0.02, 0.16);
  mat.emissiveNode = materialEmissive.add(
    voidGlow.mul(
      pulseHead.mul(1.4)
        .add(veins.mul(0.25))
        .add(fresnel.mul(0.45))
        .add(contractionGlow.mul(vBellEdge).mul(0.4))
        .add(flash)
    )
  );

  mat.needsUpdate = true;
}

// ─── LOD Profiles ──────────────────────────────────────────────────────────────

const LOD_PROFILE = {
  near: {
    bellWidth: 48, bellHeight: 32,
    innerWidth: 32, innerHeight: 24,
    oralArmCount: 4, oralArmSegments: 14, oralArmRadial: 8,
    tentacleCount: 12, tentacleSegments: 20, tentacleRadial: 6,
    marginalCount: 24,
    gonadCount: 4,
    animInterval: 1,
    motionScale: 1,
  },
  medium: {
    bellWidth: 24, bellHeight: 16,
    innerWidth: 16, innerHeight: 12,
    oralArmCount: 2, oralArmSegments: 8, oralArmRadial: 5,
    tentacleCount: 6, tentacleSegments: 12, tentacleRadial: 4,
    marginalCount: 12,
    gonadCount: 2,
    animInterval: 3,
    motionScale: 0.55,
  },
  far: {
    bellWidth: 8, bellHeight: 6,
    animInterval: 6,
    motionScale: 0.2,
  },
};

// ─── VoidJelly class ───────────────────────────────────────────────────────────

export class VoidJelly {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();

    // Timing & per-instance randomisation
    this.time = Math.random() * 100;
    this._frameCount = 0;
    this.speed = 0.6 + Math.random() * 0.4;
    this.direction = new THREE.Vector3(
      Math.random() - 0.5, -0.08, Math.random() - 0.5
    ).normalize();
    this.turnTimer = 0;
    this.turnInterval = 15 + Math.random() * 15;

    // Procedural variation
    this._contractionRhythm = 0.9 + Math.random() * 0.4;
    this._baseScale = 1.5 + Math.random() * 2;

    // Inertia / physics state
    this._velocityX = 0;
    this._velocityY = 0;
    this._velocityZ = 0;
    this._swimPhase = Math.random() * TWO_PI;
    this._idlePhase = Math.random() * TWO_PI;
    this._playerDirX = 0;
    this._playerDirZ = 0;
    this._proximityInfluence = 0;
    this._lastTierName = null;

    this._buildModel();
    this.group.position.copy(position);
    this.group.scale.setScalar(this._baseScale);
    scene.add(this.group);
  }

  // ─── Model construction ────────────────────────────────────────────────────

  _buildModel() {
    const nearTier = this._createTier(LOD_PROFILE.near);
    const medTier = this._createTier(LOD_PROFILE.medium);
    const farTier = this._createFarTier();

    this._lod = new THREE.LOD();
    this._lod.addLevel(nearTier.group, 0);
    this._lod.addLevel(medTier.group, LOD_NEAR);
    this._lod.addLevel(farTier.group, LOD_MEDIUM);
    this.group.add(this._lod);

    this._tiers = { near: nearTier, medium: medTier, far: farTier };

    // Ambient glow sprite (emissive-only — no point lights for GPU optimisation)
    const spriteMat = new THREE.SpriteMaterial({
      map: _glowTexture,
      color: 0x2a1155,
      transparent: true,
      opacity: 0.25,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this._sprite = new THREE.Sprite(spriteMat);
    this._sprite.scale.setScalar(3);
    this._sprite.position.y = -0.1;
    this.group.add(this._sprite);
  }

  // ─── Bell material with shader patches ─────────────────────────────────────

  _createBellMaterial(detailScale) {
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0x080616,
      emissive: 0x1a0a30,
      emissiveIntensity: 0.35,
      transparent: true,
      opacity: 0.55,
      roughness: 0.08,
      metalness: 0.04,
      transmission: 0.65,
      thickness: 0.5,
      iridescence: 0.6,
      iridescenceIOR: 1.22,
      clearcoat: 0.85,
      clearcoatRoughness: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false,
      normalMap: _bellNormalTexture,
      normalScale: new THREE.Vector2(0.32 * detailScale, 0.48 * detailScale),
    });

    const bellUniforms = {
      uContractionPhase: uniform(0),
      uVoidTime: uniform(0),
      uPulseTravel: uniform(0),
      uFlashWave: uniform(0),
    };
    _applyBellShader(mat, bellUniforms);

    return mat;
  }

  // ─── Bell geometry with ribbing displacement ───────────────────────────────

  _createBellGeometry(wSeg, hSeg) {
    const bellGeo = new THREE.SphereGeometry(1, wSeg, hSeg, 0, TWO_PI, 0, Math.PI * 0.6);
    const pos = bellGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const radial = Math.sqrt(x * x + z * z);
      const angle = Math.atan2(z, x);
      const rimBand = smoothstep(0.6, 1.0, radial);
      const crownBand = 1 - smoothstep(0.0, 0.35, radial);
      // Bell ribbing — higher frequency for finer structural detail
      const ribbing = Math.sin(angle * 10) * 0.028 * rimBand;
      const crownUndulate = Math.sin(angle * 3) * 0.01 * crownBand;
      // Membrane vein-like displacement (micro-detail)
      const veinDisp = Math.sin(angle * 18 + y * 12) * 0.008;
      const radialScale = 1 + ribbing + crownUndulate + veinDisp;
      const subUmbrellaDip = -smoothstep(0.4, 0.95, radial) * 0.1;
      pos.setX(i, x * radialScale);
      pos.setY(i, y + subUmbrellaDip + crownBand * 0.025);
      pos.setZ(i, z * radialScale);
    }
    bellGeo.computeVertexNormals();
    return bellGeo;
  }

  // ─── Appendage descriptor (per-vertex deformation bookkeeping) ─────────────

  _createAppendageDescriptor(mesh, opts) {
    mesh.frustumCulled = true;
    const geom = mesh.geometry;
    const posAttr = geom.attributes.position;
    posAttr.setUsage(THREE.DynamicDrawUsage);

    const rest = Float32Array.from(posAttr.array);
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < rest.length; i += 3) {
      const y = rest[i + 1];
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    const rootBand = maxY - Math.max((maxY - minY) * 0.08, 0.001);
    let rootX = 0, rootZ = 0, rootCount = 0;
    for (let i = 0; i < rest.length; i += 3) {
      if (rest[i + 1] < rootBand) continue;
      rootX += rest[i]; rootZ += rest[i + 2]; rootCount++;
    }

    return {
      mesh, geometry: geom, restPositions: rest,
      rootCenter: {
        x: rootCount > 0 ? rootX / rootCount : 0,
        z: rootCount > 0 ? rootZ / rootCount : 0,
      },
      minY, maxY,
      length: Math.max(maxY - minY, 0.001),
      ...opts,
    };
  }

  // ─── Per-vertex appendage deformation (tentacle trail physics + wave) ──────

  _deformAppendage(app, pulse, t, motionScale) {
    const positions = app.geometry.attributes.position;
    const arr = positions.array;
    const rest = app.restPositions;
    const contraction = Math.max(0, pulse);
    const relaxed = Math.max(0, -pulse);
    const flowFactor = (0.3 + relaxed * 0.8) * motionScale;
    const pulseSqueeze = 1 - contraction * (app.radialPulse || 0.03);
    // Trail physics: per-vertex position offset based on velocity history
    const driftX = this._velocityX * (app.trailFactor || 0.3) * 0.35;
    const driftZ = this._velocityZ * (app.trailFactor || 0.3) * 0.35;
    const proxWeight = this._proximityInfluence * (app.proximityResponse || 0.7);

    for (let i = 0; i < rest.length; i += 3) {
      const bx = rest[i], by = rest[i + 1], bz = rest[i + 2];
      const along = THREE.MathUtils.clamp((app.maxY - by) / app.length, 0, 1);
      const tip = along * along * (3 - 2 * along);
      const tipSq = tip * tip;

      // Wave propagation along arm/tentacle length
      const waveA = Math.sin(t * (app.swaySpeed || 0.5) + (app.phaseOffset || 0) + along * (app.waveFreq || 3.5));
      const waveB = Math.sin(t * (app.secSpeed || 0.3) + (app.phaseOffset || 0) * 0.7 + along * (app.secFreq || 6));
      const lateral = (waveA * (app.swayAmt || 0.035) + waveB * (app.secSwayAmt || 0.018)) * flowFactor * tip;
      const axial = Math.cos(t * (app.twistSpeed || 0.38) + (app.phaseOffset || 0) + along * (app.waveFreq || 3.5) * 0.5)
        * (app.twistAmt || 0.025) * tip;
      const curl = (relaxed * (app.relaxCurl || 0.04) - contraction * (app.pulseCurl || 0.02)) * tipSq;
      const vertical = contraction * (app.liftAmt || 0.04) * tip
        - relaxed * (app.dropAmt || 0.016) * along * 0.4
        + waveB * (app.heaveAmt || 0.012) * tipSq;

      const radX = bx - app.rootCenter.x;
      const radZ = bz - app.rootCenter.z;
      const rScale = THREE.MathUtils.lerp(1, pulseSqueeze, tip);

      const pX = app.perpX || 0, pZ = app.perpZ || 0;
      const dX = app.dirX || 0, dZ = app.dirZ || 0;

      // Tentacles drift toward player on proximity
      arr[i] = app.rootCenter.x + radX * rScale
        + pX * (lateral + this._playerDirX * proxWeight * 0.05 * tip)
        + dX * (axial + driftX * tip) + radX * curl;
      arr[i + 1] = by + vertical;
      arr[i + 2] = app.rootCenter.z + radZ * rScale
        + pZ * (lateral + this._playerDirZ * proxWeight * 0.05 * tip)
        + dZ * (axial + driftZ * tip) + radZ * curl;
    }

    positions.needsUpdate = true;
    app.geometry.computeVertexNormals();
    app.geometry.attributes.normal.needsUpdate = true;
    app.geometry.computeBoundingSphere();
  }

  // ─── Oral arms — TubeGeometry with ruffled edges (CatmullRomCurve3) ────────

  _createOralArms(group, profile) {
    const arms = [];
    const count = profile.oralArmCount;
    for (let a = 0; a < count; a++) {
      const angle = (a / count) * TWO_PI;
      const armLen = 2.0 + Math.random() * 1.6;
      const rootR = 0.12 + Math.random() * 0.08;
      const pts = [];
      for (let s = 0; s <= profile.oralArmSegments; s++) {
        const frac = s / profile.oralArmSegments;
        const curl = Math.sin(frac * Math.PI * 1.5 + angle) * (0.04 + 0.06 * frac);
        pts.push(new THREE.Vector3(
          Math.cos(angle) * rootR * (1 - frac * 0.5) + Math.cos(angle + HALF_PI) * curl,
          -0.2 - frac * armLen,
          Math.sin(angle) * rootR * (1 - frac * 0.5) + Math.sin(angle + HALF_PI) * curl
        ));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const armGeo = new THREE.TubeGeometry(curve, profile.oralArmSegments, 0.04, profile.oralArmRadial, false);

      // Ruffled edges — displace peripheral vertices for frill detail
      const ap = armGeo.attributes.position;
      for (let i = 0; i < ap.count; i++) {
        const x = ap.getX(i), y = ap.getY(i), z = ap.getZ(i);
        const localAngle = Math.atan2(z, x);
        const ruffle = Math.sin(localAngle * 7 + y * 9) * 0.012;
        ap.setX(i, x + Math.cos(localAngle) * ruffle);
        ap.setZ(i, z + Math.sin(localAngle) * ruffle);
      }
      armGeo.computeVertexNormals();

      const armMat = new THREE.MeshPhysicalMaterial({
        color: 0x0c0820,
        emissive: 0x1a0a30,
        emissiveIntensity: 0.3,
        transparent: true, opacity: 0.45,
        roughness: 0.25,
        transmission: 0.35,
        thickness: 0.25,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(armGeo, armMat);
      group.add(mesh);

      // Oral arm frill/ruffle overlay
      const frillGeo = new THREE.TubeGeometry(curve, profile.oralArmSegments, 0.055, 3, false);
      const fp = frillGeo.attributes.position;
      for (let i = 0; i < fp.count; i++) {
        const x = fp.getX(i), y = fp.getY(i), z = fp.getZ(i);
        const la = Math.atan2(z, x);
        const ripple = Math.sin(la * 8 + y * 10) * 0.015;
        fp.setX(i, x + Math.cos(la) * ripple);
        fp.setZ(i, z + Math.sin(la) * ripple);
      }
      frillGeo.computeVertexNormals();
      const frillMat = new THREE.MeshPhysicalMaterial({
        color: 0x100820,
        emissive: 0x180830,
        emissiveIntensity: 0.2,
        transparent: true, opacity: 0.22,
        roughness: 0.4,
        transmission: 0.18,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const frill = new THREE.Mesh(frillGeo, frillMat);
      group.add(frill);

      const baseOpts = {
        type: 'oral', angle,
        dirX: Math.cos(angle), dirZ: Math.sin(angle),
        perpX: Math.cos(angle + HALF_PI), perpZ: Math.sin(angle + HALF_PI),
        phaseOffset: Math.random() * TWO_PI,
        swaySpeed: 0.55 + Math.random() * 0.25,
        secSpeed: 0.32 + Math.random() * 0.18,
        swayAmt: 0.028 + Math.random() * 0.03,
        secSwayAmt: 0.016 + Math.random() * 0.018,
        waveFreq: 2.6 + Math.random() * 0.8,
        secFreq: 5.0 + Math.random() * 1.2,
        twistSpeed: 0.34 + Math.random() * 0.12,
        twistAmt: 0.022 + Math.random() * 0.025,
        liftAmt: 0.028 + Math.random() * 0.025,
        heaveAmt: 0.01 + Math.random() * 0.01,
        pulseCurl: 0.018 + Math.random() * 0.015,
        relaxCurl: 0.04 + Math.random() * 0.02,
        dropAmt: 0.013 + Math.random() * 0.015,
        radialPulse: 0.028 + Math.random() * 0.018,
        trailFactor: 0.28 + Math.random() * 0.22,
        proximityResponse: 0.55 + Math.random() * 0.4,
      };

      arms.push(this._createAppendageDescriptor(mesh, baseOpts));
      arms.push(this._createAppendageDescriptor(frill, {
        ...baseOpts,
        swayAmt: baseOpts.swayAmt * 1.15,
        secSwayAmt: baseOpts.secSwayAmt * 1.1,
      }));
    }
    return arms;
  }

  // ─── Tentacles — TubeGeometry with many axial segments for per-vertex deformation

  _createTentacles(group, profile) {
    const tentacles = [];
    const count = profile.tentacleCount;
    for (let t = 0; t < count; t++) {
      const angle = (t / count) * TWO_PI + (Math.random() - 0.5) * 0.4;
      const radius = 0.55 + Math.random() * 0.2;
      // Procedural length variation per tentacle
      const tentLen = 3.0 + Math.random() * 4.0 + (Math.random() - 0.5);
      const rootY = -(0.16 + Math.random() * 0.08);
      const pts = [];
      for (let s = 0; s <= profile.tentacleSegments; s++) {
        const frac = s / profile.tentacleSegments;
        const latCurl = Math.sin(frac * TWO_PI + angle * 1.5) * 0.04 * frac;
        pts.push(new THREE.Vector3(
          Math.cos(angle) * radius * (1 - frac * 0.45) + Math.cos(angle + HALF_PI) * latCurl,
          rootY - frac * tentLen,
          Math.sin(angle) * radius * (1 - frac * 0.45) + Math.sin(angle + HALF_PI) * latCurl
        ));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const tentGeo = new THREE.TubeGeometry(
        curve, profile.tentacleSegments, 0.015, profile.tentacleRadial, false
      );
      const tentMat = new THREE.MeshPhysicalMaterial({
        color: 0x0a0618,
        emissive: 0x140820,
        emissiveIntensity: 0.25,
        transparent: true, opacity: 0.32,
        roughness: 0.28,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(tentGeo, tentMat);
      group.add(mesh);

      tentacles.push(this._createAppendageDescriptor(mesh, {
        type: 'tentacle', angle,
        dirX: Math.cos(angle), dirZ: Math.sin(angle),
        perpX: Math.cos(angle + HALF_PI), perpZ: Math.sin(angle + HALF_PI),
        phaseOffset: Math.random() * TWO_PI,
        swaySpeed: 0.45 + Math.random() * 0.5,
        swayAmt: 0.04 + Math.random() * 0.04,
        secSpeed: 0.28 + Math.random() * 0.18,
        secSwayAmt: 0.02 + Math.random() * 0.02,
        waveFreq: 4.0 + Math.random() * 1.5,
        secFreq: 7.5 + Math.random() * 2.0,
        twistSpeed: 0.4 + Math.random() * 0.2,
        twistAmt: 0.03 + Math.random() * 0.03,
        trailFactor: 0.4 + Math.random() * 0.4,
        liftAmt: 0.045 + Math.random() * 0.045,
        heaveAmt: 0.015 + Math.random() * 0.018,
        pulseCurl: 0.028 + Math.random() * 0.02,
        relaxCurl: 0.065 + Math.random() * 0.03,
        dropAmt: 0.016 + Math.random() * 0.018,
        radialPulse: 0.035 + Math.random() * 0.02,
        proximityResponse: 0.9 + Math.random() * 0.35,
      }));
    }
    return tentacles;
  }

  // ─── Marginal tentacles — short fine fringe around bell edge ───────────────

  _createMarginalTentacles(group, profile) {
    const marginals = [];
    const count = profile.marginalCount;
    for (let m = 0; m < count; m++) {
      const angle = (m / count) * TWO_PI + (Math.random() - 0.5) * 0.2;
      const len = 0.3 + Math.random() * 0.4;
      const pts = [
        new THREE.Vector3(Math.cos(angle) * 0.92, -0.15, Math.sin(angle) * 0.92),
        new THREE.Vector3(Math.cos(angle) * 0.88, -0.15 - len * 0.5, Math.sin(angle) * 0.88),
        new THREE.Vector3(Math.cos(angle) * 0.82, -0.15 - len, Math.sin(angle) * 0.82),
      ];
      const curve = new THREE.CatmullRomCurve3(pts);
      const geo = new THREE.TubeGeometry(curve, 4, 0.005, 3, false);
      const mat = new THREE.MeshPhysicalMaterial({
        color: 0x0e0a20,
        emissive: 0x1c0c38,
        emissiveIntensity: 0.2,
        transparent: true, opacity: 0.28,
        roughness: 0.3,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      group.add(mesh);

      marginals.push(this._createAppendageDescriptor(mesh, {
        type: 'marginal', angle,
        dirX: Math.cos(angle), dirZ: Math.sin(angle),
        perpX: Math.cos(angle + HALF_PI), perpZ: Math.sin(angle + HALF_PI),
        phaseOffset: Math.random() * TWO_PI,
        swaySpeed: 1.2 + Math.random() * 0.8,
        swayAmt: 0.01 + Math.random() * 0.012,
        secSpeed: 0.8 + Math.random() * 0.5,
        secSwayAmt: 0.006 + Math.random() * 0.008,
        waveFreq: 6 + Math.random() * 3,
        secFreq: 10 + Math.random() * 4,
        twistSpeed: 0.6, twistAmt: 0.008,
        trailFactor: 0.15, liftAmt: 0.01, heaveAmt: 0.004,
        pulseCurl: 0.005, relaxCurl: 0.012, dropAmt: 0.005,
        radialPulse: 0.01, proximityResponse: 0.3,
      }));
    }
    return marginals;
  }

  // ─── Gonads — SphereGeometry(0.15, 16, 12) with organic granule detail ─────

  _createGonads(group, profile) {
    const gonads = [];
    const count = profile.gonadCount;
    for (let g = 0; g < count; g++) {
      const angle = (g / count) * TWO_PI;
      const geo = new THREE.SphereGeometry(0.15, 16, 12);
      // Organic granule micro-detail
      const gp = geo.attributes.position;
      for (let i = 0; i < gp.count; i++) {
        const x = gp.getX(i), y = gp.getY(i), z = gp.getZ(i);
        const granule = Math.sin(x * 40 + y * 30) * 0.008 + Math.cos(z * 35 + x * 25) * 0.006;
        gp.setX(i, x + x * granule);
        gp.setY(i, y + y * granule);
        gp.setZ(i, z + z * granule);
      }
      geo.computeVertexNormals();

      const mat = new THREE.MeshPhysicalMaterial({
        color: 0x1a0e2e,
        emissive: 0x2a1248,
        emissiveIntensity: 0.4 + Math.random() * 0.2, // Procedural brightness variation
        transparent: true, opacity: 0.5,
        roughness: 0.35,
        transmission: 0.2,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(Math.cos(angle) * 0.3, -0.22, Math.sin(angle) * 0.3);
      group.add(mesh);
      gonads.push({ mesh, mat, baseEmissive: mat.emissiveIntensity, phaseOffset: Math.random() * TWO_PI });
    }
    return gonads;
  }

  // ─── Gastrovascular canals on inner surface ────────────────────────────────

  _createGastrovascularCanals(group) {
    const canals = new THREE.Group();
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * TWO_PI;
      const pts = [
        new THREE.Vector3(Math.cos(angle) * 0.08, -0.05, Math.sin(angle) * 0.08),
        new THREE.Vector3(Math.cos(angle + 0.15) * 0.25, -0.18, Math.sin(angle + 0.15) * 0.25),
        new THREE.Vector3(Math.cos(angle - 0.08) * 0.55, -0.35, Math.sin(angle - 0.08) * 0.55),
        new THREE.Vector3(Math.cos(angle + 0.05) * 0.8, -0.12, Math.sin(angle + 0.05) * 0.8),
      ];
      const curve = new THREE.CatmullRomCurve3(pts);
      const geo = new THREE.TubeGeometry(curve, 8, 0.008, 4, false);
      const mat = new THREE.MeshPhysicalMaterial({
        color: 0x140a24,
        emissive: 0x200e38,
        emissiveIntensity: 0.18,
        transparent: true, opacity: 0.22,
        roughness: 0.35,
        transmission: 0.15,
        depthWrite: false,
      });
      canals.add(new THREE.Mesh(geo, mat));
    }
    group.add(canals);
    return canals;
  }

  // ─── Bell interior detail (inner surface 0.85, 32, 24) ────────────────────

  _createBellInterior(group, profile) {
    // Inner bell — (0.85, 32, 24) per spec
    const innerGeo = new THREE.SphereGeometry(
      0.85, profile.innerWidth, profile.innerHeight,
      0, TWO_PI, 0, HALF_PI
    );
    const innerMat = new THREE.MeshPhysicalMaterial({
      color: 0x0a0616,
      emissive: 0x160a28,
      emissiveIntensity: 0.45,
      transparent: true, opacity: 0.22,
      roughness: 0.28,
      transmission: 0.35,
      thickness: 0.25,
      depthWrite: false,
    });
    const inner = new THREE.Mesh(innerGeo, innerMat);
    inner.position.y = -0.04;
    group.add(inner);

    // Manubrium (feeding tube)
    const manuGeo = new THREE.CylinderGeometry(0.04, 0.065, 0.45, 10, 1, true);
    const manuMat = new THREE.MeshPhysicalMaterial({
      color: 0x0c0820,
      emissive: 0x180c30,
      emissiveIntensity: 0.28,
      transparent: true, opacity: 0.3,
      roughness: 0.2,
      transmission: 0.2,
      depthWrite: false,
    });
    const manubrium = new THREE.Mesh(manuGeo, manuMat);
    manubrium.position.y = -0.32;
    group.add(manubrium);

    const gonads = this._createGonads(group, profile);
    const canals = this._createGastrovascularCanals(group);

    return { inner, manubrium, gonads, canals };
  }

  // ─── Create near / mid LOD tier ────────────────────────────────────────────

  _createTier(profile) {
    const group = new THREE.Group();

    // Bell: shader-driven per-vertex contraction with transmission
    const bellMat = this._createBellMaterial(1);
    const bell = new THREE.Mesh(this._createBellGeometry(profile.bellWidth, profile.bellHeight), bellMat);
    group.add(bell);

    // Bell interior
    const interior = this._createBellInterior(group, profile);

    // Oral arms (TubeGeometry + CatmullRomCurve3 + ruffled edges)
    const oralArms = this._createOralArms(group, profile);

    // Tentacles (TubeGeometry with many axial segments)
    const tentacles = this._createTentacles(group, profile);

    // Marginal tentacles (short fine fringe around bell edge)
    const marginals = this._createMarginalTentacles(group, profile);

    // Bell-edge rim with emissive glow (replaces point lights)
    const rimGeo = new THREE.TorusGeometry(0.92, 0.03, 6, profile.bellWidth);
    const rimMat = new THREE.MeshPhysicalMaterial({
      color: 0x0a0618,
      emissive: 0x3818aa,
      emissiveIntensity: 0.7,
      transparent: true, opacity: 0.5,
      roughness: 0.2,
      depthWrite: false,
    });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.x = HALF_PI;
    rim.position.y = -0.15;
    group.add(rim);

    return {
      group, bell, interior, oralArms, tentacles, marginals, rim,
      profile,
    };
  }

  // ─── Far LOD tier: <100 tris, static bell, no tentacles ───────────────────

  _createFarTier() {
    const group = new THREE.Group();

    // Ultra-low-poly bell silhouette (IcosahedronGeometry detail 0 = 20 tris)
    const farBell = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.9, 0),
      new THREE.MeshPhysicalMaterial({
        color: 0x080616,
        emissive: 0x1a0a30,
        emissiveIntensity: 0.4,
        transparent: true, opacity: 0.4,
        roughness: 0.1,
        depthWrite: false,
      })
    );
    group.add(farBell);

    // Single glow billboard
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.4, 6),
      new THREE.MeshBasicMaterial({
        color: 0x2a1155,
        transparent: true, opacity: 0.2,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    disc.rotation.x = HALF_PI;
    disc.position.y = -0.15;
    group.add(disc);

    return {
      group, bell: farBell, disc,
      interior: null, oralArms: [], tentacles: [], marginals: [],
      profile: LOD_PROFILE.far,
    };
  }

  // ─── Shader uniform update ─────────────────────────────────────────────────

  _updateBellUniforms(tier, pulse, t, flashWave) {
    const mat = tier.bell.material;
    if (!mat.userData || !mat.userData.shaderUniforms) return;
    const u = mat.userData.shaderUniforms;
    u.uContractionPhase.value = pulse;
    u.uVoidTime.value = t;
    u.uPulseTravel.value = Math.sin(t * 1.8) * 0.5 + 0.5;
    u.uFlashWave.value = flashWave;
  }

  // ─── Main update loop ─────────────────────────────────────────────────────

  update(dt, playerPos) {
    this.time += dt;
    this._frameCount++;
    const t = this.time;

    // ── Direction change ──
    this.turnTimer += dt;
    if (this.turnTimer > this.turnInterval) {
      this.turnTimer = 0;
      this.turnInterval = 15 + Math.random() * 15;
      this.direction.set(
        Math.random() - 0.5,
        (Math.random() - 0.5) * 0.05,
        Math.random() - 0.5
      ).normalize();
    }

    // ── Player proximity ──
    const dx = playerPos.x - this.group.position.x;
    const dy = playerPos.y - this.group.position.y;
    const dz = playerPos.z - this.group.position.z;
    const distPre = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const planar = Math.max(0.0001, Math.sqrt(dx * dx + dz * dz));
    this._playerDirX = dx / planar;
    this._playerDirZ = dz / planar;
    this._proximityInfluence = THREE.MathUtils.clamp(1 - distPre / 25, 0, 1);

    // Reaction to player proximity: contraction frequency increases
    const phaseSpeedScale = 1 + this._proximityInfluence * 0.75;
    const contractionSpeed = this._contractionRhythm * 1.4 * phaseSpeedScale;
    const relaxSpeed = this._contractionRhythm * 0.65 * phaseSpeedScale;
    const phaseSin = Math.sin(this._swimPhase);
    this._swimPhase += dt * (phaseSin >= 0 ? contractionSpeed : relaxSpeed);
    if (this._swimPhase > TWO_PI) this._swimPhase -= TWO_PI;

    // Breathing / idle cycle: slow bell pulsation even when drifting passively
    this._idlePhase += dt * 0.35;
    const idlePulse = Math.sin(this._idlePhase) * 0.2;
    const pulse = Math.sin(this._swimPhase) * 0.82 + idlePulse * 0.18;
    const contraction = Math.max(0, pulse);
    const relaxation = Math.max(0, -pulse);
    const propulsion = Math.pow(contraction, 1.7);
    const glideDrag = Math.pow(relaxation, 1.2);

    // Bioluminescent stress response: contraction triggers emissive flash wave
    const flashWave = contraction > 0.5 ? (contraction - 0.5) * 2.0 : 0;

    // ── Weight & inertia: bell has water-mass drag, tentacles trail with heavy fluid resistance
    const desiredVX = this.direction.x * this.speed * (0.35 + (1 - contraction) * 0.55)
      + this._playerDirX * this._proximityInfluence * -0.18;
    const desiredVY = this.direction.y * this.speed * 0.3
      + propulsion * 0.45 - glideDrag * 0.06;
    const desiredVZ = this.direction.z * this.speed * (0.35 + (1 - contraction) * 0.55)
      + this._playerDirZ * this._proximityInfluence * -0.18;

    const inertia = 1 - Math.exp(-dt * 2.5);
    const drag = 1 - Math.exp(-dt * 1.6);
    this._velocityX = lerp(this._velocityX, desiredVX, inertia) * (1 - drag * 0.2);
    this._velocityY = lerp(this._velocityY, desiredVY, inertia);
    this._velocityZ = lerp(this._velocityZ, desiredVZ, inertia) * (1 - drag * 0.2);

    this.group.position.x += this._velocityX * dt;
    this.group.position.y += this._velocityY * dt;
    this.group.position.z += this._velocityZ * dt;

    // ── Distance after move ──
    const pdx = playerPos.x - this.group.position.x;
    const pdy = playerPos.y - this.group.position.y;
    const pdz = playerPos.z - this.group.position.z;
    const distPost = Math.sqrt(pdx * pdx + pdy * pdy + pdz * pdz);

    // ── LOD tier selection with hysteresis ──
    const tierName = this._getLodTierName(distPost);
    const tier = this._tiers[tierName];

    // Sync newly visible tier so LOD transitions don't reveal stale geometry
    if (this._lastTierName !== tierName) {
      this._animateTier(tier, pulse, t);
      this._lastTierName = tierName;
    }

    // ── Bell shader uniforms (active tier only, skip far — no bell mat) ──
    const pulseShape = Math.sign(pulse) * Math.pow(Math.abs(pulse), 1.3);
    if (tierName !== 'far') {
      this._updateBellUniforms(tier, pulseShape, t, flashWave);
    }

    // ── Bell squish (active tier only) ──
    const squishX = 1 + pulseShape * 0.1;
    const squishY = 1 - pulseShape * 0.14;
    if (tier.interior) {
      const squishScale = tierName === 'near' ? 0.9 : 0.92;
      tier.interior.inner.scale.set(squishX * 0.97, squishY * squishScale, squishX * 0.97);
    }

    // ── Gonad visibility cycle: opacity/emissive pulsation (near only) ──
    if (tierName === 'near' && tier.interior) {
      for (const g of tier.interior.gonads) {
        const gPulse = Math.sin(t * 1.2 + g.phaseOffset) * 0.5 + 0.5;
        g.mat.emissiveIntensity = g.baseEmissive * (0.6 + gPulse * 0.8);
        g.mat.opacity = 0.3 + gPulse * 0.35;
      }
    }

    // ── Animated appendages on active tier (frame-skipped for GPU opt) ──
    const interval = tier.profile.animInterval || 1;
    if (this._frameCount % interval === 0) {
      this._animateTier(tier, pulse, t);
    }

    // ── Sprite glow (emissive-only, no point lights) ──
    this._sprite.material.opacity = 0.08 + contraction * 0.2 + flashWave * 0.15;
    const farScale = THREE.MathUtils.clamp(distPost / 100, 1, 2.2);
    this._sprite.scale.setScalar(3 * farScale);

    // ── Passive drift: bell tilts into current direction between pulses ──
    this.group.rotation.y += dt * (0.06 + propulsion * 0.04);
    this.group.rotation.x = Math.sin(t * 0.22 + this._velocityX * 0.5) * 0.06;
    this.group.rotation.z = Math.cos(t * 0.2 + this._velocityZ * 0.5) * 0.05;

    // ── Interior animation ──
    if (tierName === 'near' && this._tiers.near.interior) {
      this._tiers.near.interior.manubrium.scale.y = 1 + contraction * 0.18;
    }
    if (tierName === 'medium' && this._tiers.medium.interior) {
      this._tiers.medium.interior.manubrium.scale.y = 1 + contraction * 0.12;
    }

    // ── Respawn if too far ──
    if (distPost > RESPAWN_DISTANCE) {
      const a = Math.random() * TWO_PI;
      this.group.position.set(
        playerPos.x + Math.cos(a) * 80,
        playerPos.y - Math.random() * 15,
        playerPos.z + Math.sin(a) * 80
      );
      this._velocityX = 0;
      this._velocityY = 0;
      this._velocityZ = 0;
    }
  }

  _getLodTierName(dist) {
    const hyst = 4;
    const prev = this._lastTierName;
    if (prev === 'near' && dist < LOD_NEAR + hyst) return 'near';
    if (prev === 'medium' && dist > LOD_NEAR - hyst && dist < LOD_MEDIUM + hyst) return 'medium';
    if (prev === 'far' && dist > LOD_MEDIUM - hyst) return 'far';
    if (dist < LOD_NEAR) return 'near';
    if (dist < LOD_MEDIUM) return 'medium';
    return 'far';
  }

  _animateTier(tier, pulse, t) {
    const ms = tier.profile.motionScale || 1;
    for (const app of tier.tentacles) {
      this._deformAppendage(app, pulse, t, ms);
    }
    for (const app of tier.oralArms) {
      this._deformAppendage(app, pulse, t, ms);
    }
    if (tier.marginals) {
      for (const app of tier.marginals) {
        this._deformAppendage(app, pulse, t, ms);
      }
    }
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  getPosition() { return this.group.position; }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(c => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        if (c.material.map) c.material.map.dispose();
        if (c.material.normalMap && c.material.normalMap !== _bellNormalTexture) {
          c.material.normalMap.dispose();
        }
        c.material.dispose();
      }
    });
    // Module-level singleton textures (_glowTexture, _bellNormalTexture, _veinTexture)
    // are NOT disposed here — they are shared across all VoidJelly instances.
  }
}
