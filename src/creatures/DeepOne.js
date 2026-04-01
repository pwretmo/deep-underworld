import * as THREE from 'three/webgpu';
import { clamp, cos, positionLocal, sin, sub, uniform, vec3 } from 'three/tsl';
import { LOD_NEAR_DISTANCE, LOD_MEDIUM_DISTANCE } from './lodUtils.js';

// ─── Constants ─────────────────────────────────────────────────────────────────
const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI * 0.5;
const RESPAWN_DISTANCE = 300;
// Root-band threshold: fraction of tentacle length used to detect root vertices
const ROOT_BAND_THRESHOLD = 0.08;
// Proximity detection: player within PROXIMITY_RANGE * scale triggers tentacle response
const PROXIMITY_RANGE = 2.5;
// Fin undulation parameters
const FIN_WAVE_SPEED = 0.8;
const FIN_WAVE_AMP = 0.06;
const APPENDAGE_BOUNDS_PADDING = 0.35;

function _inflateGeometryBounds(geometry, padding) {
  if (!padding) return;
  if (!geometry.boundingSphere) {
    geometry.computeBoundingSphere();
  }
  if (geometry.boundingSphere) {
    geometry.boundingSphere.radius += padding;
  }
}

// ─── Module-level singleton textures (never disposed per-instance) ─────────────

function _createGlowTexture() {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = s; c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(80,20,60,1)');
  g.addColorStop(0.3, 'rgba(50,10,40,0.6)');
  g.addColorStop(0.7, 'rgba(30,5,25,0.1)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

function _createCranialNormalTexture() {
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
      // Multi-octave cranial ridge + micro-detail
      const ridge1 = Math.sin(v * 20 + Math.sin(angle * 4) * 0.9) * 0.25;
      const ridge2 = Math.sin(v * 48 + angle * 7) * 0.08;
      const micro = Math.sin(angle * 38 + v * 55) * 0.04;
      const nx = THREE.MathUtils.clamp(0.5 + ridge1 + micro, 0, 1);
      const ny = THREE.MathUtils.clamp(0.5 + ridge2 + Math.cos(v * 14) * 0.12, 0, 1);
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
  tex.needsUpdate = true;
  return tex;
}

function _createSuckerNormalTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const data = image.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1);
      const v = y / (size - 1);
      // Sucker rings + rim teeth pattern along tentacle length
      const ring = Math.cos(v * 40) * 0.35;
      const tooth = Math.sin(u * TWO_PI * 8) * Math.max(0, Math.cos(v * 40)) * 0.18;
      const nx = THREE.MathUtils.clamp(0.5 + tooth, 0, 1);
      const ny = THREE.MathUtils.clamp(0.5 + ring, 0, 1);
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
  tex.repeat.set(1, 10);
  tex.needsUpdate = true;
  return tex;
}

function _createFinNormalTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  // Neutral normal base (pointing in +Z)
  ctx.fillStyle = '#8080ff';
  ctx.fillRect(0, 0, size, size);
  // Fin membrane veining ribs
  ctx.strokeStyle = 'rgba(70,70,200,0.8)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 8; i++) {
    const yPos = (i / 7) * size;
    const xNoise = Math.sin(i * 2.4) * size * 0.06;
    ctx.beginPath();
    ctx.moveTo(xNoise, yPos);
    ctx.bezierCurveTo(
      size * 0.3 + xNoise * 0.5, yPos + size * 0.03,
      size * 0.6 - xNoise * 0.5, yPos - size * 0.03,
      size + xNoise, yPos
    );
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

const _glowTexture = _createGlowTexture();
const _cranialNormalTex = _createCranialNormalTexture();
const _suckerNormalTex = _createSuckerNormalTexture();
const _finNormalTex = _createFinNormalTexture();

// ─── LOD Profiles ─────────────────────────────────────────────────────────────
const LOD_PROFILE = {
  near: {
    headW: 48, headH: 32,
    bodyW: 32, bodyH: 24,
    tentacleCount: 14,
    tentacleSegments: 24,
    tentacleRadial: 12,
    eyeW: 16, eyeH: 12,
    animInterval: 1,
    motionScale: 1.0,
  },
  medium: {
    headW: 24, headH: 16,
    bodyW: 16, bodyH: 12,
    tentacleCount: 7,
    tentacleSegments: 14,
    tentacleRadial: 6,
    eyeW: 8, eyeH: 6,
    animInterval: 3,
    motionScale: 0.55,
  },
  far: {
    animInterval: 6,
    motionScale: 0.2,
  },
};

/**
 * Applies a TSL positionNode graph to a DeepOne tentacle material for GPU-side
 * deformation. Per-tentacle constants are baked into the graph at construction
 * time; only per-frame state (time, velocity, proximity) reads from shared
 * uniforms that are updated once per frame from the DeepOne instance.
 */
function _applyDeepOneTentacleShader(mat, app, motionScale, sharedUniforms) {
  const { uTime, uVelocityX, uVelocityZ, uProxInfluence, uPlayerDirX, uPlayerDirZ } = sharedUniforms;
  const ms = motionScale;
  const phOff = app.phaseOffset || 0;

  // Normalised position along tentacle: 0 = root, 1 = tip
  const along = clamp(
    positionLocal.y.negate().add(app.maxY).div(Math.max(app.length, 0.001)),
    0.0, 1.0,
  );
  const tip = along.mul(along).mul(sub(3.0, along.mul(2.0)));
  const tipSq = tip.mul(tip);

  // Primary wave
  const waveA = sin(
    uTime.mul(app.swaySpeed || 0.3)
      .add(phOff)
      .add(along.mul(app.waveFreq || 2.5)),
  ).mul((app.swayAmt || 0.28) * ms).mul(tip);

  // Secondary harmonic
  const waveB = sin(
    uTime.mul(app.secSpeed || 0.15)
      .add(phOff * 0.7)
      .add(along.mul(app.secFreq || 5.0)),
  ).mul((app.secSwayAmt || 0.14) * ms).mul(tip);

  // Axial twist
  const axialTwist = cos(
    uTime.mul(app.twistSpeed || 0.18)
      .add(phOff)
      .add(along.mul((app.waveFreq || 2.5) * 0.5)),
  ).mul(app.twistAmt || 0.07).mul(tip);

  // Curl / gravitational droop
  const curl = sin(
    uTime.mul(app.curlSpeed || 0.12).add(phOff),
  ).mul(app.curlAmt || 0.1).mul(tipSq);

  // Vertical heave
  const vertical = sin(
    uTime.mul((app.secSpeed || 0.15) * 0.8).add(phOff),
  ).mul(app.heaveAmt || 0.04).mul(tipSq)
    .sub(along.mul((app.dropAmt || 0.03) * 0.4));

  // Trail drift (velocity × trailFactor × 0.45 × tip)
  const trailK = (app.trailFactor || 0.4) * 0.45;
  const driftX = uVelocityX.mul(trailK).mul(tip);
  const driftZ = uVelocityZ.mul(trailK).mul(tip);

  // Proximity reaction
  const proxK = (app.proximityResponse || 0.7) * 0.1;
  const reactX = uPlayerDirX.mul(uProxInfluence.mul(proxK)).mul(tip);
  const reactZ = uPlayerDirZ.mul(uProxInfluence.mul(proxK)).mul(tip);

  const pX = app.perpX || 0;
  const pZ = app.perpZ || 0;
  const dX = app.dirX || 0;
  const dZ = app.dirZ || 0;

  const radX = positionLocal.x.sub(app.rootCenter.x);
  const radZ = positionLocal.z.sub(app.rootCenter.z);

  mat.positionNode = vec3(
    positionLocal.x
      .add(waveA.add(waveB).add(reactX).mul(pX))
      .add(axialTwist.add(driftX).mul(dX))
      .add(radX.mul(curl)),
    positionLocal.y.add(vertical),
    positionLocal.z
      .add(waveA.add(waveB).add(reactZ).mul(pZ))
      .add(axialTwist.add(driftZ).mul(dZ))
      .add(radZ.mul(curl)),
  );

  mat.userData.shaderUniforms = { ...(mat.userData.shaderUniforms || {}), ...sharedUniforms };
  mat.needsUpdate = true;
}

// ─── DeepOne — massive deep-sea cephalopod horror ─────────────────────────────
// 3-tier LOD creature with GPU-driven TSL positionNode tentacle animation.
// MeshPhysicalMaterial subsurface scattering, cranial normal maps, and
// bioluminescent pulse. Spawns at 250m+ depth.

export class DeepOne {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.position.copy(position);

    this.scale = 8 + Math.random() * 12; // Massive — 8x to 20x player size
    this.group.scale.setScalar(this.scale);

    // Per-instance timing
    this._time = Math.random() * 100;
    this._frameCount = 0;
    this._lastTierName = null;

    // Pre-allocated physics state (zero per-frame allocation)
    this._velocityX = 0;
    this._velocityY = 0;
    this._velocityZ = 0;
    this._proximityInfluence = 0;
    this._playerDirX = 0;
    this._playerDirZ = 0;
    this._idlePhase = Math.random() * TWO_PI;
    this._breathPhase = Math.random() * TWO_PI;

    // Pre-allocated reusable objects
    this._tmpQuat = new THREE.Quaternion();
    this._tmpMat4 = new THREE.Matrix4();
    this._tmpVec = new THREE.Vector3();
    this._originVec = new THREE.Vector3(0, 0, 0);
    this._upVec = new THREE.Vector3(0, 1, 0);

    // Shared uniforms for GPU tentacle deformation — one set per instance,
    // updated once per frame; baked per-tentacle constants live in positionNode.
    this._tentacleUniforms = {
      uTime:          uniform(0),
      uVelocityX:     uniform(0),
      uVelocityZ:     uniform(0),
      uProxInfluence: uniform(0),
      uPlayerDirX:    uniform(0),
      uPlayerDirZ:    uniform(0),
    };

    this._buildModel();
    scene.add(this.group);

    // Movement — slow, ominous drifting
    this.speed = 1.5 + Math.random() * 1.5;
    this.direction = new THREE.Vector3(
      Math.random() - 0.5, Math.random() * 0.1 - 0.05, Math.random() - 0.5
    ).normalize();
    this.turnTimer = 0;
    this.turnInterval = 20 + Math.random() * 30;

    // Lurking behavior
    this.state = 'drift'; // drift, approach, loom
    this.loomTimer = 0;
  }

  // ─── Model construction ──────────────────────────────────────────────────────

  _buildModel() {
    const nearTier = this._buildNearTier();
    const medTier = this._buildMediumTier();
    const farTier = this._buildFarTier();

    this._lod = new THREE.LOD();
    this._lod.addLevel(nearTier.group, 0);
    this._lod.addLevel(medTier.group, LOD_NEAR_DISTANCE);
    this._lod.addLevel(farTier.group, LOD_MEDIUM_DISTANCE);
    this.group.add(this._lod);

    this._tiers = { near: nearTier, medium: medTier, far: farTier };

    // Single point light — near tier only; mid/far use emissive-only glow
    this._eyeLight = new THREE.PointLight(0x440000, 0.5, 4 * this.scale);
    this._eyeLight.userData.duwCategory = 'creature_bio';
    this._eyeLight.position.set(0, 2.0, 0.8);
    nearTier.group.add(this._eyeLight);

    // Ambient glow sprite (emissive-only visual, single additional draw call)
    const spriteMat = new THREE.SpriteMaterial({
      map: _glowTexture,
      color: 0x802040,
      transparent: true,
      opacity: 0.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this._sprite = new THREE.Sprite(spriteMat);
    this._sprite.scale.setScalar(4);
    this._sprite.position.y = 1.5;
    this.group.add(this._sprite);
  }

  // ─── Head geometry: SphereGeometry(1.2, W, H) with multi-octave cranial displacement

  _buildHeadGeometry(wSeg, hSeg) {
    const headGeo = new THREE.SphereGeometry(1.2, wSeg, hSeg);
    const pos = headGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      // Elongate and shape the mantle
      let nx = x * (1 + Math.sin(y * 2) * 0.2);
      let ny = y * 1.8;
      let nz = z * (1 + Math.cos(y * 3) * 0.15);
      // Multi-octave cranial displacement
      const angle = Math.atan2(nz, nx);
      const oct1 = Math.sin(angle * 3 + ny * 2.5) * 0.12;
      const oct2 = Math.sin(angle * 7 + ny * 5) * 0.04;
      const oct3 = Math.sin(angle * 15 + ny * 8) * 0.015;
      const disp = oct1 + oct2 + oct3;
      nx += Math.cos(angle) * disp;
      nz += Math.sin(angle) * disp;
      ny += Math.sin(nx * 3 + nz * 2) * 0.15; // wart/blemish micro-detail
      pos.setX(i, nx);
      pos.setY(i, ny);
      pos.setZ(i, nz);
    }
    headGeo.computeVertexNormals();
    return headGeo;
  }

  // ─── Body geometry: SphereGeometry(1, W, H) with smooth head-body transition

  _buildBodyGeometry(wSeg, hSeg) {
    const bodyGeo = new THREE.SphereGeometry(1, wSeg, hSeg);
    const pos = bodyGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const widthFactor = y > 0 ? 1.2 : 0.7 + y * 0.3;
      pos.setX(i, x * widthFactor * (1 + Math.sin(y * 3 + z * 2) * 0.05));
      pos.setZ(i, z * widthFactor * (1 + Math.cos(y * 2 + x * 2) * 0.05));
    }
    bodyGeo.computeVertexNormals();
    return bodyGeo;
  }

  // ─── Fin: ExtrudeGeometry for membrane thickness + fin ray normal map

  _buildFin(group, side, mat) {
    const finShape = new THREE.Shape();
    finShape.moveTo(0, 0);
    finShape.bezierCurveTo(0.5 * side, 0.3, 1.5 * side, 0.1, 2 * side, -0.5);
    finShape.bezierCurveTo(1.2 * side, -0.2, 0.4 * side, -0.1, 0, 0);

    const finGeo = new THREE.ExtrudeGeometry(finShape, {
      depth: 0.04,
      bevelEnabled: true,
      bevelThickness: 0.015,
      bevelSize: 0.008,
      bevelSegments: 2,
      steps: 1,
    });
    // Center in Z so extrusion is symmetric around the fin plane
    finGeo.translate(0, 0, -0.02);
    finGeo.computeVertexNormals();

    const fin = new THREE.Mesh(finGeo, mat);
    fin.position.set(side * 0.8, 0.5, 0);
    fin.userData.baseRotZ = side * 0.3;
    fin.rotation.z = fin.userData.baseRotZ;
    group.add(fin);
    return fin;
  }

  // ─── Tentacles: pre-allocated TubeGeometry with buffer-mutation animation

  _buildTentacles(group, profile) {
    const tentacles = [];
    const count = profile.tentacleCount;

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * TWO_PI + (Math.random() - 0.5) * 0.3;
      const radius = 0.5 + Math.random() * 0.4;
      const length = 3 + Math.random() * 5;
      const segments = profile.tentacleSegments;
      const radial = profile.tentacleRadial;

      const points = [];
      for (let j = 0; j <= segments; j++) {
        const frac = j / segments;
        // Initial lateral curl for organic variety
        const initCurl = Math.sin(frac * Math.PI * 1.2 + angle) * 0.04 * frac;
        points.push(new THREE.Vector3(
          Math.cos(angle) * radius * (1 - frac * 0.5) + Math.cos(angle + HALF_PI) * initCurl,
          -frac * length,
          Math.sin(angle) * radius * (1 - frac * 0.5) + Math.sin(angle + HALF_PI) * initCurl
        ));
      }

      const curve = new THREE.CatmullRomCurve3(points);
      const tubeGeo = new THREE.TubeGeometry(curve, segments, 0.12, radial, false);

      // Organic taper: thicker at root, tapers to tip
      const pos = tubeGeo.attributes.position;
      for (let j = 0; j < pos.count; j++) {
        const vy = pos.getY(j);
        const t = THREE.MathUtils.clamp(-vy / length, 0, 1);
        const taper = Math.max(0.1, 1 - t * 0.85);
        pos.setX(j, pos.getX(j) * taper);
        pos.setZ(j, pos.getZ(j) * taper);
      }
      tubeGeo.computeVertexNormals();

      const isNearTier = profile === LOD_PROFILE.near;
      const tentacleMat = isNearTier
        ? new THREE.MeshPhysicalMaterial({
          color: 0x1a1a30,
          roughness: 0.82,
          metalness: 0,
          emissive: 0x502040,
          emissiveIntensity: 0.4,
          transparent: true,
          opacity: 0.92,
          transmission: 0.12,
          thickness: 0.08,
          normalMap: _suckerNormalTex,
          normalScale: new THREE.Vector2(0.45, 0.45),
        })
        : new THREE.MeshStandardMaterial({
          color: 0x1a1a30,
          roughness: 0.88,
          metalness: 0,
          emissive: 0x502040,
          emissiveIntensity: 0.34,
          transparent: true,
          opacity: 0.88,
          normalMap: _suckerNormalTex,
          normalScale: new THREE.Vector2(0.35, 0.35),
        });

      const mesh = new THREE.Mesh(tubeGeo, tentacleMat);
      mesh.position.y = -0.5;
      group.add(mesh);

      const desc = this._createAppendageDescriptor(mesh, {
        angle,
        dirX: Math.cos(angle), dirZ: Math.sin(angle),
        perpX: Math.cos(angle + HALF_PI), perpZ: Math.sin(angle + HALF_PI),
        length,
        phaseOffset: Math.random() * TWO_PI,
        swaySpeed: 0.28 + Math.random() * 0.35,
        swayAmt: 0.28 + Math.random() * 0.28,
        secSpeed: 0.14 + Math.random() * 0.12,
        secSwayAmt: 0.14 + Math.random() * 0.14,
        waveFreq: 2.5 + Math.random() * 1.5,
        secFreq: 5.0 + Math.random() * 2.0,
        twistSpeed: 0.18 + Math.random() * 0.12,
        twistAmt: 0.07 + Math.random() * 0.05,
        liftAmt: 0.12 + Math.random() * 0.08,
        heaveAmt: 0.04 + Math.random() * 0.03,
        dropAmt: 0.03 + Math.random() * 0.03,
        curlSpeed: 0.12 + Math.random() * 0.08,
        curlAmt: 0.1 + Math.random() * 0.06,
        trailFactor: 0.45 + Math.random() * 0.35,
        proximityResponse: 0.7 + Math.random() * 0.4,
      });
      _applyDeepOneTentacleShader(tentacleMat, desc, profile.motionScale ?? 1.0, this._tentacleUniforms);
      tentacles.push(desc);
    }

    return tentacles;
  }

  // ─── Eyes: SphereGeometry(0.08, W, H) with corneal detail at near tier

  _buildEyes(group, profile) {
    const eyePositions = [
      { x: 0.5, y: 2.0, z: 0.9 },
      { x: -0.5, y: 2.0, z: 0.9 },
      { x: 0.3, y: 2.4, z: 0.7 },
      { x: -0.3, y: 2.4, z: 0.7 },
    ];

    const usePhysicalEyes = profile.eyeW >= 16;
    const eyeMat = usePhysicalEyes ? new THREE.MeshPhysicalMaterial({
      color: 0x330000,
      emissive: 0x550000,
      emissiveIntensity: 2.2,
      roughness: 0.05,
      metalness: 0.1,
      clearcoat: 1.0,
      clearcoatRoughness: 0.02,
    }) : new THREE.MeshStandardMaterial({
      color: 0x330000,
      emissive: 0x550000,
      emissiveIntensity: 1.8,
      roughness: 0.15,
      metalness: 0.05,
    });

    const cornealMat = usePhysicalEyes ? new THREE.MeshPhysicalMaterial({
      color: 0x000000,
      emissive: 0x220000,
      emissiveIntensity: 0.5,
      roughness: 0.0,
      transparent: true,
      opacity: 0.6,
      transmission: 0.5,
    }) : null;

    for (const ep of eyePositions) {
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, profile.eyeW, profile.eyeH),
        eyeMat
      );
      eye.position.set(ep.x, ep.y, ep.z);
      group.add(eye);

      // Corneal detail — near tier only
      if (cornealMat) {
        const cornea = new THREE.Mesh(
          new THREE.SphereGeometry(0.055, 12, 8),
          cornealMat
        );
        cornea.position.set(ep.x, ep.y, ep.z + 0.04);
        group.add(cornea);
      }
    }
  }

  // ─── Appendage descriptor: computes geometry bounds for TSL shader baking

  _createAppendageDescriptor(mesh, opts) {
    mesh.frustumCulled = true;
    const geom = mesh.geometry;
    const arr = geom.attributes.position.array;

    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < arr.length; i += 3) {
      const y = arr[i + 1];
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    // Root center: centroid of the top band of vertices
    const rootBand = maxY - Math.max((maxY - minY) * ROOT_BAND_THRESHOLD, 0.001);
    let rootX = 0, rootZ = 0, rootCount = 0;
    for (let i = 0; i < arr.length; i += 3) {
      if (arr[i + 1] < rootBand) continue;
      rootX += arr[i]; rootZ += arr[i + 2]; rootCount++;
    }

    _inflateGeometryBounds(geom, opts.boundsPadding ?? APPENDAGE_BOUNDS_PADDING);

    return {
      mesh, geometry: geom,
      rootCenter: {
        x: rootCount > 0 ? rootX / rootCount : 0,
        z: rootCount > 0 ? rootZ / rootCount : 0,
      },
      minY, maxY,
      length: Math.max(maxY - minY, 0.001),
      ...opts,
    };
  }

  // ─── GPU tentacle animation — update shared uniforms once per frame ──────────
  // positionNode graphs on each tentacle material read these uniforms.
  // All per-tentacle constants were baked into the graph at construction time.

  _updateTentacleUniforms(t) {
    const u = this._tentacleUniforms;
    u.uTime.value          = t;
    u.uVelocityX.value     = this._velocityX;
    u.uVelocityZ.value     = this._velocityZ;
    u.uProxInfluence.value = this._proximityInfluence;
    u.uPlayerDirX.value    = this._playerDirX;
    u.uPlayerDirZ.value    = this._playerDirZ;
  }

  // ─── Near tier: full detail ───────────────────────────────────────────────────

  _buildNearTier() {
    const group = new THREE.Group();
    const profile = LOD_PROFILE.near;

    // MeshPhysicalMaterial: subsurface scattering, clearcoat, cranial normal map
    const headMat = new THREE.MeshPhysicalMaterial({
      color: 0x1a1a2e,
      roughness: 0.82,
      metalness: 0.04,
      emissive: 0x502040,
      emissiveIntensity: 0.55,
      clearcoat: 0.35,
      clearcoatRoughness: 0.6,
      normalMap: _cranialNormalTex,
      normalScale: new THREE.Vector2(0.55, 0.55),
    });

    const head = new THREE.Mesh(this._buildHeadGeometry(profile.headW, profile.headH), headMat);
    head.position.y = 1.5;
    group.add(head);

    const body = new THREE.Mesh(this._buildBodyGeometry(profile.bodyW, profile.bodyH), headMat);
    group.add(body);

    // Fins — ExtrudeGeometry with fin membrane normal map
    const finMat = new THREE.MeshPhysicalMaterial({
      color: 0x1a1a38,
      roughness: 0.9,
      metalness: 0,
      emissive: 0x502040,
      emissiveIntensity: 0.38,
      transparent: true,
      opacity: 0.82,
      transmission: 0.08,
      side: THREE.DoubleSide,
      normalMap: _finNormalTex,
      normalScale: new THREE.Vector2(0.3, 0.3),
    });
    const fins = [
      this._buildFin(group, -1, finMat),
      this._buildFin(group, 1, finMat),
    ];

    // Eyes with corneal detail
    this._buildEyes(group, profile);

    // Tentacles (pre-allocated, buffer-mutation animation)
    const tentacles = this._buildTentacles(group, profile);

    return { group, head, fins, tentacles, profile };
  }

  // ─── Medium tier: simplified geometry, MeshStandardMaterial ─────────────────

  _buildMediumTier() {
    const group = new THREE.Group();
    const profile = LOD_PROFILE.medium;

    const headMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a2e,
      roughness: 0.88,
      metalness: 0,
      emissive: 0x502040,
      emissiveIntensity: 0.5,
    });

    const head = new THREE.Mesh(this._buildHeadGeometry(profile.headW, profile.headH), headMat);
    head.position.y = 1.5;
    group.add(head);

    const body = new THREE.Mesh(this._buildBodyGeometry(profile.bodyW, profile.bodyH), headMat);
    group.add(body);

    const finMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a38,
      roughness: 0.9,
      emissive: 0x502040,
      emissiveIntensity: 0.3,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
    });
    this._buildFin(group, -1, finMat);
    this._buildFin(group, 1, finMat);

    this._buildEyes(group, profile);

    const tentacles = this._buildTentacles(group, profile);

    return { group, head, fins: [], tentacles, profile };
  }

  // ─── Far tier: ultra-low-poly silhouette, static, <100 triangles ─────────────

  _buildFarTier() {
    const group = new THREE.Group();

    // Elongated icosahedron body silhouette
    const silhouette = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.2, 0),
      new THREE.MeshStandardMaterial({
        color: 0x0f0f1a,
        emissive: 0x401030,
        emissiveIntensity: 0.5,
        roughness: 0.9,
      })
    );
    silhouette.scale.y = 1.6;
    group.add(silhouette);

    // Static tentacle cluster suggestion (single cone, very low-poly)
    const tentacleMesh = new THREE.Mesh(
      new THREE.ConeGeometry(0.35, 2.5, 6),
      new THREE.MeshStandardMaterial({
        color: 0x1a1a30,
        emissive: 0x401030,
        emissiveIntensity: 0.35,
      })
    );
    tentacleMesh.position.y = -1.75;
    group.add(tentacleMesh);

    return { group, tentacles: [], profile: LOD_PROFILE.far };
  }

  // ─── LOD tier selection matched to THREE.LOD thresholds ─────────────────────

  _getLodTierName(dist) {
    if (dist < LOD_NEAR_DISTANCE) return 'near';
    if (dist < LOD_MEDIUM_DISTANCE) return 'medium';
    return 'far';
  }

  // ─── Sync newly visible tier to current animation state ──────────────────────

  _syncTier(tier, t) {
    // With GPU positionNode animation the uniforms are what drive deformation;
    // updating them is sufficient to sync a newly visible tier.
    this._updateTentacleUniforms(t);
  }

  // ─── Main update loop ─────────────────────────────────────────────────────────

  update(dt, playerPos) {
    this._time += dt;
    this._frameCount++;
    const t = this._time;

    this.turnTimer += dt;

    // ── Distance and player direction ──
    const dx = playerPos.x - this.group.position.x;
    const dy = playerPos.y - this.group.position.y;
    const dz = playerPos.z - this.group.position.z;
    const distToPlayer = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const planar = Math.max(0.0001, Math.sqrt(dx * dx + dz * dz));
    this._playerDirX = dx / planar;
    this._playerDirZ = dz / planar;
    this._proximityInfluence = THREE.MathUtils.clamp(
      1 - distToPlayer / (PROXIMITY_RANGE * this.scale), 0, 1
    );

    // ── State transitions ──
    if (this.state === 'drift') {
      if (distToPlayer < 80 * this.scale * 0.1 && Math.random() < 0.005) {
        this.state = 'approach';
      }
    } else if (this.state === 'approach') {
      if (distToPlayer < 30 * this.scale * 0.1) {
        this.state = 'loom';
        this.loomTimer = 0;
      }
      if (distToPlayer > 120 * this.scale * 0.1) {
        this.state = 'drift';
      }
    } else if (this.state === 'loom') {
      this.loomTimer += dt;
      if (this.loomTimer > 20) {
        this.state = 'drift';
        this.direction.set(
          Math.random() - 0.5, Math.random() * 0.1 - 0.05, Math.random() - 0.5
        ).normalize();
      }
    }

    // ── Movement based on state ──
    if (this.state === 'drift') {
      if (this.turnTimer > this.turnInterval) {
        this.turnTimer = 0;
        this.turnInterval = 20 + Math.random() * 30;
        this._tmpVec.set(
          Math.random() - 0.5, Math.random() * 0.1 - 0.05, Math.random() - 0.5
        ).normalize();
        this.direction.lerp(this._tmpVec, 0.3).normalize();
      }
      this.group.position.x += this.direction.x * this.speed * dt;
      this.group.position.y += this.direction.y * this.speed * dt;
      this.group.position.z += this.direction.z * this.speed * dt;
    } else if (this.state === 'approach') {
      this._tmpVec.copy(playerPos).sub(this.group.position).normalize();
      this.direction.lerp(this._tmpVec, 0.02).normalize();
      this.group.position.x += this.direction.x * this.speed * 0.7 * dt;
      this.group.position.y += this.direction.y * this.speed * 0.7 * dt;
      this.group.position.z += this.direction.z * this.speed * 0.7 * dt;
    } else if (this.state === 'loom') {
      // Slowly orbit near the player
      this._tmpVec.copy(this.group.position).sub(playerPos);
      const orbitAngle = Math.atan2(this._tmpVec.z, this._tmpVec.x) + dt * 0.05;
      const orbitDist = 20 + Math.sin(this.loomTimer * 0.2) * 10;
      this.group.position.x = playerPos.x + Math.cos(orbitAngle) * orbitDist;
      this.group.position.z = playerPos.z + Math.sin(orbitAngle) * orbitDist;
      this.group.position.y += (playerPos.y - 15 - this.group.position.y) * dt * 0.3;
    }

    // ── Velocity tracking for tentacle trail physics ──
    const inertia = 1 - Math.exp(-dt * 2.5);
    this._velocityX += (this.direction.x * this.speed - this._velocityX) * inertia;
    this._velocityY += (this.direction.y * this.speed - this._velocityY) * inertia;
    this._velocityZ += (this.direction.z * this.speed - this._velocityZ) * inertia;

    // ── Rotation to face movement direction + head bobbing ──
    const lookDir = this.state === 'loom'
      ? this._tmpVec.copy(playerPos).sub(this.group.position).normalize()
      : this.direction;
    this._tmpMat4.lookAt(this._originVec, lookDir, this._upVec);
    this._tmpQuat.setFromRotationMatrix(this._tmpMat4);
    this.group.quaternion.slerp(this._tmpQuat, dt * 0.3);

    // Head bob: subtle rotation during idle/drift
    this._idlePhase += dt * 0.35;
    this.group.rotation.x += Math.sin(this._idlePhase) * 0.02 * dt;

    // ── LOD tier selection ──
    const tierName = this._getLodTierName(distToPlayer);
    const tier = this._tiers[tierName];

    // Sync newly visible tier so transitions don't reveal stale geometry
    if (this._lastTierName !== tierName) {
      this._syncTier(tier, t);
      this._lastTierName = tierName;
    }

    // ── Tentacle animation: GPU positionNode — update shared uniforms once per frame ──
    this._updateTentacleUniforms(t);

    // ── Bioluminescent pulse ──
    this._breathPhase += dt * 0.4;
    const pulse = Math.sin(this._breathPhase) * 0.5 + 0.5;

    // Animated emissive on near-tier head
    const nearHead = this._tiers.near.head;
    if (nearHead && nearHead.material) {
      nearHead.material.emissiveIntensity = 0.4 + pulse * 0.3;
    }

    // Eye point light flicker (near tier only — point light is in near group)
    this._eyeLight.intensity = 0.25 + pulse * 0.25 + Math.sin(t * 3.1) * 0.05;

    // Glow sprite pulsation
    this._sprite.material.opacity = 0.1 + pulse * 0.15;

    // ── Fin undulation (near tier only — per-vertex wave) ──
    if (tierName === 'near' && this._tiers.near.fins.length > 0) {
      for (let fi = 0; fi < this._tiers.near.fins.length; fi++) {
        const fin = this._tiers.near.fins[fi];
        fin.rotation.z = fin.userData.baseRotZ + Math.sin(t * FIN_WAVE_SPEED + fi * Math.PI) * FIN_WAVE_AMP;
      }
    }

    // ── Respawn if player moves too far ──
    if (distToPlayer > RESPAWN_DISTANCE) {
      const a = Math.random() * TWO_PI;
      const dist = 100 + Math.random() * 80;
      this.group.position.set(
        playerPos.x + Math.cos(a) * dist,
        playerPos.y - 20 - Math.random() * 40,
        playerPos.z + Math.sin(a) * dist
      );
      this.state = 'drift';
      this._velocityX = 0;
      this._velocityY = 0;
      this._velocityZ = 0;
    }
  }

  getPosition() {
    return this.group.position;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        // Singleton module-level textures are NOT disposed per-instance
        if (child.material.normalMap
          && child.material.normalMap !== _cranialNormalTex
          && child.material.normalMap !== _suckerNormalTex
          && child.material.normalMap !== _finNormalTex) {
          child.material.normalMap.dispose();
        }
        child.material.dispose();
      }
    });
  }
}
