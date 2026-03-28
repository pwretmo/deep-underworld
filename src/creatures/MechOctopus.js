import * as THREE from 'three';
import { LOD_NEAR_DISTANCE, LOD_MEDIUM_DISTANCE, toStandardMaterial } from './lodUtils.js';
import { qualityManager } from '../QualityManager.js';

// Pre-allocated temps — zero per-frame allocations
const _tv0 = new THREE.Vector3();
const _tv1 = new THREE.Vector3();
const _tv2 = new THREE.Vector3();

// LOD geometry profile per tier
// Issue 1: near mantleW 48, mantleH 32
// Issue 7: far mantleW 6, mantleH 4, radial 3 for < 100 total tris
const MOC_LOD = {
  near:   { tubSegs: 16, radial: 6,  mantleW: 48, mantleH: 32, rivets: 24, details: true  },
  medium: { tubSegs: 8,  radial: 4,  mantleW: 20, mantleH: 16, rivets: 12, details: false },
  far:    { tubSegs: 0,  radial: 3,  mantleW: 6,  mantleH: 4,  rivets: 0,  details: false },
};

const TENT_LENGTH = 2.5;
const TENT_BASE_RADIUS = 0.1;
const TENT_TAPER = 0.6;
const CUP_T_VALUES = [0.15, 0.3, 0.45, 0.6, 0.75];

/** Procedural DataTexture normal map (issue 8). */
function _generateProceduralNormalMap(w, h, scale) {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const px = (i % w) / w, py = Math.floor(i / w) / h;
    const nx = Math.sin(px * scale * 6.2832 + py * 3.0) * 30;
    const ny = Math.cos(py * scale * 6.2832 + px * 2.5) * 30;
    data[i * 4]     = 128 + nx;
    data[i * 4 + 1] = 128 + ny;
    data[i * 4 + 2] = 255;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, w, h);
  tex.needsUpdate = true;
  return tex;
}

/** CatmullRomCurve3 for a straight tentacle (issue 2). */
function _makeTentacleCurve() {
  const pts = [];
  const nPts = 6;
  for (let i = 0; i <= nPts; i++) {
    pts.push(new THREE.Vector3(0, -i * (TENT_LENGTH / nPts), 0));
  }
  return new THREE.CatmullRomCurve3(pts);
}

/** Apply Fresnel rim-light via onBeforeCompile (issue 9). */
function _applyFresnelShader(mat) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader) => {
    if (prev) prev(shader);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
float _fresnel = pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 3.0);
totalEmissiveRadiance += vec3(0.12, 0.20, 0.35) * _fresnel * 0.6;`
    );
  };
}

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
    // Backward-compatible public array: contains root nodes of near-tier tentacle groups
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

    // Issue 7: frame counter for far-tier animation skip
    this._frameCounter = 0;

    // Issue 5: pupil mesh references for dilation
    this._pupils = [];

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
    this.eyeLight.userData.duwCategory = 'creature_bio';
    this.eyeLight.position.set(0.5, 0, 0);
    this._tierGroups.near.add(this.eyeLight);

    this.group.scale.setScalar(2 + Math.random() * 1.5);
  }

  _buildTier(tierName) {
    const p = MOC_LOD[tierName];
    const g = new THREE.Group();
    const useFar = tierName === 'far';
    const isNearTier = tierName === 'near';

    // Issue 8: procedural normal maps — small textures, near+medium only
    const mantleNormal = !useFar ? _generateProceduralNormalMap(64, 64, 4.0) : null;
    const tentNormal   = !useFar ? _generateProceduralNormalMap(32, 32, 6.0) : null;
    const cupNormal    = isNearTier ? _generateProceduralNormalMap(32, 32, 8.0) : null;

    // --- Materials ---
    let bodyMat = new THREE.MeshPhysicalMaterial({
      color: 0x182028, roughness: 0.28, metalness: 0.05,
      clearcoat: 0.65, clearcoatRoughness: 0.36,
      emissive: 0x203858, emissiveIntensity: 0.45,
      iridescence: isNearTier ? 0.4 : 0,
      iridescenceIOR: 1.6,
      normalMap: mantleNormal,
    });
    let metalMat = new THREE.MeshPhysicalMaterial({
      color: 0x141414, roughness: 0.26, metalness: 0.7,
      clearcoat: 0.5, clearcoatRoughness: 0.4,
      emissive: 0x204060, emissiveIntensity: 0.22,
    });
    let organicMat = new THREE.MeshPhysicalMaterial({
      color: 0x201828, roughness: 0.25, metalness: 0,
      clearcoat: 0.7, clearcoatRoughness: 0.35,
      emissive: 0x203858, emissiveIntensity: 0.5,
      normalMap: tentNormal,
    });

    // Issue 9: Fresnel rim-light — non-far tiers only
    if (!useFar) {
      _applyFresnelShader(bodyMat);
      _applyFresnelShader(organicMat);
    }

    if (useFar) {
      const ob = bodyMat;   bodyMat   = toStandardMaterial(bodyMat);   ob.dispose();
      const om = metalMat;  metalMat  = toStandardMaterial(metalMat);  om.dispose();
      const oo = organicMat; organicMat = toStandardMaterial(organicMat); oo.dispose();
    }

    if (isNearTier) this._bodyMatNear = bodyMat;

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
    if (isNearTier) {
      this._mantleOrigPos = new Float32Array(mp.array);
      this._mantlePosAttr = mp;
      this._mantleGeoNear = mantleGeo; // Issue 10: store for computeVertexNormals
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
      // Issue 11: convert eyeMat for far tier
      const eyePhysicalMat = new THREE.MeshPhysicalMaterial({
        color: 0xffaa00, emissive: 0xcc8800,
        emissiveIntensity: isNearTier ? 2.0 : 1.2,
        roughness: 0.1, clearcoat: 1.0,
      });
      const eyeMat = useFar ? toStandardMaterial(eyePhysicalMat) : eyePhysicalMat;
      if (eyeMat !== eyePhysicalMat) eyePhysicalMat.dispose();
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
        // Issue 5: store pupil references for dilation
        this._pupils.push(pupil);
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
    if (useFar) {
      // Far LOD: lightweight single-cylinder tentacles, group-rotation only
      for (let t = 0; t < 8; t++) {
        const angle = (t / 8) * Math.PI * 2;
        const tg = new THREE.Group();
        const tGeo = new THREE.CylinderGeometry(0.06, 0.1, 2.5, p.radial);
        tg.add(new THREE.Mesh(tGeo, organicMat));
        tg.children[0].position.y = -1.25;
        tg.position.set(Math.cos(angle) * 0.6, -0.8, Math.sin(angle) * 0.5);
        tg.rotation.x = 0.3;
        this._tentaclesByTier.far.push(tg);
        g.add(tg);
      }
    } else {
      // Issue 2: TubeGeometry tentacles with shader curl (near / medium)
      const tentacles = this._tentaclesByTier[tierName];
      for (let t = 0; t < 8; t++) {
        const angle = (t / 8) * Math.PI * 2;
        const tent = this._buildTubeTentacle(tierName, organicMat, metalMat, p.details, p.radial, cupNormal);
        tent.group.position.set(Math.cos(angle) * 0.6, -0.8, Math.sin(angle) * 0.5);
        tentacles.push(tent);
        if (isNearTier) this.tentacles.push(tent.group);
        g.add(tent.group);
      }
    }

    // --- Siphon jet (open-ended cylinder) ---
    const siphonGeo = new THREE.CylinderGeometry(0.1, 0.18, 0.45, p.details ? 10 : 6, 1, true);
    const siphonMesh = new THREE.Mesh(siphonGeo, metalMat);
    siphonMesh.position.set(-0.8, -0.3, 0);
    siphonMesh.rotation.z = Math.PI / 4;
    g.add(siphonMesh);
    if (isNearTier) this._siphon = siphonMesh;

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
   * Build a TubeGeometry tentacle with taper, shader curl, and suction cups.
   * Issues 2, 3, 6.
   */
  _buildTubeTentacle(tierName, tentMat, metalMat, hasCups, radial, cupNormal) {
    const tentGroup = new THREE.Group();
    const curve = _makeTentacleCurve();
    const p = MOC_LOD[tierName];

    const geo = new THREE.TubeGeometry(curve, p.tubSegs, TENT_BASE_RADIUS, radial, false);

    // Taper radius along length using UV.x as t parameter
    const uvAttr = geo.attributes.uv;
    const posAttr = geo.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const t = uvAttr.getX(i);
      const taper = 1 - t * TENT_TAPER;
      posAttr.setX(i, posAttr.getX(i) * taper);
      posAttr.setZ(i, posAttr.getZ(i) * taper);
    }
    geo.computeVertexNormals();

    // Issue 6: material with per-segment curl vertex shader
    const mat = tentMat.clone();
    const shaderRef = { uniforms: null };
    const origOnBeforeCompile = mat.onBeforeCompile;
    mat.onBeforeCompile = (shader) => {
      if (origOnBeforeCompile) origOnBeforeCompile(shader);
      shader.uniforms.uCurlPhase = { value: 0 };
      shader.uniforms.uCurlAmount = { value: 0.15 };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
uniform float uCurlPhase;
uniform float uCurlAmount;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
float _t = uv.x;
float _curl = sin(uCurlPhase - _t * 6.2832) * uCurlAmount * _t;
transformed.y += _curl;
float _curlZ = cos(uCurlPhase * 0.7 - _t * 4.0) * uCurlAmount * _t * 0.6;
transformed.z += _curlZ;`);
      shaderRef.uniforms = shader.uniforms;
    };

    const mesh = new THREE.Mesh(geo, mat);
    tentGroup.add(mesh);

    // Issue 3: suction cups at t-values using curve tangent for orientation
    if (hasCups) {
      const cupInteriorMat = new THREE.MeshPhysicalMaterial({
        color: 0x050810, roughness: 0.5, metalness: 0.3,
        emissive: 0x001828, emissiveIntensity: 0.25,
        normalMap: cupNormal,
      });
      for (const ct of CUP_T_VALUES) {
        const pt = curve.getPointAt(ct);
        const tangent = curve.getTangentAt(ct);
        const taper = 1 - ct * TENT_TAPER;
        const r = TENT_BASE_RADIUS * taper;

        // Clamp ring perpendicular to tentacle surface
        const clampGeo = new THREE.TorusGeometry(r * 1.25, 0.012, 8, 12);
        const clamp = new THREE.Mesh(clampGeo, metalMat);
        clamp.position.copy(pt);
        _tv0.copy(pt).add(tangent);
        clamp.lookAt(_tv0);
        tentGroup.add(clamp);

        // Cup interior — dark concave disc facing outward
        const cupGeo = new THREE.CircleGeometry(r * 0.9, 8);
        const cup = new THREE.Mesh(cupGeo, cupInteriorMat);
        cup.position.copy(pt);
        cup.lookAt(_tv0);
        tentGroup.add(cup);
      }
    }

    return { group: tentGroup, shaderRef, curve };
  }

  // ─── Update ──────────────────────────────────────────────────────────────────

  update(dt, playerPos) {
    this.time += dt;
    this.turnTimer += dt;
    this._frameCounter++;

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
      // Issue 12: direction lerp clamp + normalize
      this.direction.lerp(_tv0, Math.min(1, dt * 3)).normalize();
      this._alarmFlash = Math.min(1, this._alarmFlash + dt * 2);
    } else {
      this._alarmFlash = Math.max(0, this._alarmFlash - dt);
    }

    // Issue 13: velocity lerp alpha clamp
    _tv0.copy(this.direction).multiplyScalar(this.speed);
    const velLerpAlpha = Math.min(dt * 1.5, 1);
    this._velocity.lerp(_tv0, velLerpAlpha);

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

    // Issue 7: frame skip for far animation
    if (!isNear && !isMed) {
      const farStep = qualityManager.tier === 'ultra' ? 4 : 2;
      if ((this._frameCounter % farStep) !== 0) {
        this._respawnCheck(playerPos);
        return;
      }
    }

    if (isNear) {
      this._animateTentaclesNear();
      this._animateMantleBreathing(pulse);
      this._animateChromatophore();
      this._animateEyeDilation();
      this._animateWebStretch();
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

    this._respawnCheck(playerPos);
  }

  _respawnCheck(playerPos) {
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

  /** Issue 6: near-tier curl via shader uniforms instead of per-segment group rotation. */
  _animateTentaclesNear() {
    const tents = this._tentaclesByTier.near;
    for (let i = 0; i < tents.length; i++) {
      const { group, shaderRef } = tents[i];
      const phase = this.time * this._tentFreq[i] + this._tentPhase[i];

      // Root orientation: spread wave
      group.rotation.x = Math.sin(phase) * 0.35;
      group.rotation.z = Math.cos(phase * 0.6) * 0.25;

      // Proximity reach: lean toward player
      if (this._playerDist < 30) {
        const reach = 1 - this._playerDist / 30;
        group.rotation.x += reach * 0.4 * Math.cos(i * Math.PI / 4);
        group.rotation.z += reach * 0.4 * Math.sin(i * Math.PI / 4);
      }

      // Per-segment curl via shader uniforms
      if (shaderRef.uniforms) {
        shaderRef.uniforms.uCurlPhase.value = phase;
        shaderRef.uniforms.uCurlAmount.value = 0.10 + Math.sin(this.time * 0.5 + i) * 0.08;
      }
    }
  }

  _animateTentaclesMed() {
    const tents = this._tentaclesByTier.medium;
    for (let i = 0; i < tents.length; i++) {
      const { group, shaderRef } = tents[i];
      const phase = this.time * 2 + this._tentPhase[i];

      group.rotation.x = Math.sin(phase) * 0.3;
      group.rotation.z = Math.cos(phase * 0.6) * 0.2;

      if (shaderRef.uniforms) {
        shaderRef.uniforms.uCurlPhase.value = phase;
        shaderRef.uniforms.uCurlAmount.value = 0.12;
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

  // ─── Eye dilation (issue 5) ──────────────────────────────────────────────────

  _animateEyeDilation() {
    if (!this._pupils.length) return;
    let sx = 1.0;
    if (this._alarmFlash > 0.3) {
      sx = 0.4;
    } else if (this._playerDist < 15) {
      sx = 1.5;
    }
    for (const pupil of this._pupils) {
      pupil.scale.x = THREE.MathUtils.lerp(pupil.scale.x, sx, 0.1);
    }
  }

  // ─── Web membrane stretch (issue 4) ──────────────────────────────────────────

  _animateWebStretch() {
    if (!this._webMeshes) return;
    const tents = this._tentaclesByTier.near;
    for (let i = 0; i < this._webMeshes.length; i++) {
      const web = this._webMeshes[i];
      const pos = web.geometry.attributes.position;
      if (!web.userData.origPos) {
        web.userData.origPos = new Float32Array(pos.array);
      }
      const orig = web.userData.origPos;

      // Drive outer vertices by adjacent tentacle rotations
      const tA = tents[i] ? tents[i].group.rotation.x : 0;
      const tB = tents[(i + 1) % 8] ? tents[(i + 1) % 8].group.rotation.x : 0;
      const stretch = (Math.abs(tA) + Math.abs(tB)) * 0.3;

      for (let v = 0; v < pos.count; v++) {
        const isOuter = (v % 2 === 1);
        if (isOuter) {
          pos.setY(v, orig[v * 3 + 1] - stretch * 0.15);
          const ox = orig[v * 3], oz = orig[v * 3 + 2];
          pos.setX(v, ox * (1 + stretch * 0.1));
          pos.setZ(v, oz * (1 + stretch * 0.1));
        } else {
          pos.setXYZ(v, orig[v * 3], orig[v * 3 + 1], orig[v * 3 + 2]);
        }
      }
      pos.needsUpdate = true;
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
    // Issue 10: recompute normals after vertex deformation
    if (this._mantleGeoNear) this._mantleGeoNear.computeVertexNormals();
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

    // Issue 7: scale down emissive on Ultra to avoid overblown bloom
    const ultraScale = qualityManager.tier === 'ultra' ? 0.7 : 1.0;
    this._bodyMatNear.emissiveIntensity = (0.40 + wave * 0.20 + alarm * 0.60) * ultraScale;

    // Individual chromatophore cells: travelling wave across spots
    if (this._chromaMats) {
      for (let i = 0; i < this._chromaMats.length; i++) {
        const cw = Math.sin(this.time * 2.2 + i * 0.75) * 0.5 + 0.5;
        this._chromaMats[i].emissiveIntensity = (0.3 + cw * 1.3) * (1 + alarm * 0.8) * ultraScale;
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
