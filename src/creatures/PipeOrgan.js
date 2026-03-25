import * as THREE from 'three';
import { LOD_NEAR_DISTANCE, LOD_MEDIUM_DISTANCE } from './lodUtils.js';

// Pre-allocated temp — zero per-frame allocations
const _tmpVec3 = new THREE.Vector3();

// ── Module-level shared textures (lazily created, one per process) ──────────
let _pipeNormalTex = null;
let _membraneNormalTex = null;

function _getPipeNormalTex() {
  if (_pipeNormalTex) return _pipeNormalTex;
  const SIZE = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(SIZE, SIZE);
  const d = img.data;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const v = y / (SIZE - 1);
      const u = x / (SIZE - 1);
      // Growth rings (horizontal bands) with slight angular wobble
      const ring   = Math.sin(v * Math.PI * 20) * 0.42;
      const wobble = Math.cos(u * Math.PI * 6 + v * Math.PI * 4) * 0.10;
      const ny = THREE.MathUtils.clamp(0.5 + ring + wobble, 0, 1);
      const nx = 0.5;
      const nz = Math.sqrt(Math.max(0, 1 - (nx * 2 - 1) ** 2 - (ny * 2 - 1) ** 2)) * 0.5 + 0.5;
      const i = (y * SIZE + x) * 4;
      d[i]     = Math.round(nx * 255);
      d[i + 1] = Math.round(ny * 255);
      d[i + 2] = Math.round(nz * 255);
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  _pipeNormalTex = new THREE.CanvasTexture(canvas);
  _pipeNormalTex.wrapS = THREE.RepeatWrapping;
  _pipeNormalTex.wrapT = THREE.RepeatWrapping;
  _pipeNormalTex.repeat.set(2, 6);
  _pipeNormalTex.needsUpdate = true;
  return _pipeNormalTex;
}

function _getMembraneNormalTex() {
  if (_membraneNormalTex) return _membraneNormalTex;
  const SIZE = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(SIZE, SIZE);
  const d = img.data;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = x / (SIZE - 1);
      const v = y / (SIZE - 1);
      const vein = Math.sin(u * Math.PI * 6) * 0.25 + Math.cos(v * Math.PI * 5 + u * 2) * 0.18;
      const ny = THREE.MathUtils.clamp(0.5 + vein, 0, 1);
      const nx = 0.5;
      const nz = Math.sqrt(Math.max(0, 1 - (nx * 2 - 1) ** 2 - (ny * 2 - 1) ** 2)) * 0.5 + 0.5;
      const i = (y * SIZE + x) * 4;
      d[i]     = Math.round(nx * 255);
      d[i + 1] = Math.round(ny * 255);
      d[i + 2] = Math.round(nz * 255);
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  _membraneNormalTex = new THREE.CanvasTexture(canvas);
  _membraneNormalTex.wrapS = THREE.RepeatWrapping;
  _membraneNormalTex.wrapT = THREE.RepeatWrapping;
  _membraneNormalTex.needsUpdate = true;
  return _membraneNormalTex;
}

// ── Vertex shader helpers ─────────────────────────────────────────────────────

/**
 * Inject a standing-wave resonance displacement into a MeshPhysicalMaterial
 * vertex shader.  Fundamental half-wave + 2nd harmonic computed on the GPU.
 * All pipe materials share the same compiled program via customProgramCacheKey.
 */
function _applyResonanceShader(mat, uTime, uFreq, uAmp, uH) {
  mat.onBeforeCompile = shader => {
    shader.uniforms.uTime  = uTime;
    shader.uniforms.uResF  = uFreq;
    shader.uniforms.uResA  = uAmp;
    shader.uniforms.uPipeH = uH;
    shader.vertexShader = [
      'uniform float uTime;',
      'uniform float uResF;',
      'uniform float uResA;',
      'uniform float uPipeH;',
      shader.vertexShader,
    ].join('\n').replace(
      '#include <begin_vertex>',
      /* glsl */`
      vec3 transformed = position;
      // Standing wave: fundamental (half-wave) + 2nd harmonic
      float normY = clamp((position.y + uPipeH * 0.5) / uPipeH, 0.0, 1.0);
      float w1    = sin(normY * 3.14159265) * cos(uTime * uResF * 6.28318530);
      float w2    = sin(normY * 6.28318530) * cos(uTime * uResF * 12.5663706 + 0.7);
      float disp  = (w1 * 0.7 + w2 * 0.3) * uResA;
      transformed.x += normal.x * disp;
      transformed.z += normal.z * disp;
      `
    );
  };
  // All pipe materials share the same compiled program
  mat.customProgramCacheKey = () => 'pipeorgan-resonance';
}

/**
 * Inject cloth-like membrane flutter into a MeshPhysicalMaterial vertex shader.
 */
function _applyMembraneShader(mat, uTime, uPhase, uAmp) {
  mat.onBeforeCompile = shader => {
    shader.uniforms.uTime  = uTime;
    shader.uniforms.uMemPh = uPhase;
    shader.uniforms.uMemA  = uAmp;
    shader.vertexShader = [
      'uniform float uTime;',
      'uniform float uMemPh;',
      'uniform float uMemA;',
      shader.vertexShader,
    ].join('\n').replace(
      '#include <begin_vertex>',
      /* glsl */`
      vec3 transformed = position;
      float flutter = sin(position.x * 3.8 + uTime * 2.5 + uMemPh)
                    * cos(position.y * 2.9 + uTime * 1.6) * uMemA;
      transformed.z += flutter;
      `
    );
  };
  mat.customProgramCacheKey = () => 'pipeorgan-membrane';
}

// ── PipeOrgan ─────────────────────────────────────────────────────────────────

// Tall stationary creature resembling biomechanical pipe organ - resonates and hums
export class PipeOrgan {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time  = Math.random() * 100;

    // Shared time uniform drives all GPU shaders on this instance
    this._uTime = { value: this.time };

    // Hydraulic state machine: idle → retracting → retracted → extending → idle
    this._state    = 'idle';
    this._retractT = 0; // 0 = fully extended, 1 = fully retracted

    // Per-tier animation handles (null until built)
    this._nearData   = null;
    this._mediumData = null;
    this._glowMat    = null;

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  // ── Build ──────────────────────────────────────────────────────────────────

  _buildModel() {
    const lod    = new THREE.LOD();
    const near   = this._buildNearTier();
    const medium = this._buildMediumTier();
    const far    = this._buildFarTier();

    this._nearData   = near;
    this._mediumData = medium;

    lod.addLevel(near.group,   0);
    lod.addLevel(medium.group, LOD_NEAR_DISTANCE);
    lod.addLevel(far.group,    LOD_MEDIUM_DISTANCE);
    this.lod = lod;
    this.group.add(lod);
    this.group.scale.setScalar(2 + Math.random() * 2);
  }

  // Near tier: full fidelity — 8 pipes, membrane frills, polyp tentacles, resonance shader
  _buildNearTier() {
    const g = new THREE.Group();

    const pipeSrcMat = new THREE.MeshPhysicalMaterial({
      color: 0x2a2838, roughness: 0.20, metalness: 0.50,
      clearcoat: 1.0, clearcoatRoughness: 0.10,
      emissive: 0x1a3050, emissiveIntensity: 0.6,
      normalMap: _getPipeNormalTex(),
      normalScale: new THREE.Vector2(0.9, 0.9),
    });
    const memSrcMat = new THREE.MeshPhysicalMaterial({
      color: 0x1a2840, roughness: 0.35, metalness: 0,
      clearcoat: 0.6, clearcoatRoughness: 0.25,
      transmission: 0.30, thickness: 0.05,
      transparent: true, opacity: 0.82,
      side: THREE.DoubleSide,
      emissive: 0x0a1828, emissiveIntensity: 0.35,
      normalMap: _getMembraneNormalTex(),
      normalScale: new THREE.Vector2(0.5, 0.5),
    });
    const boneMat = new THREE.MeshStandardMaterial({
      color: 0x504030, roughness: 0.45, metalness: 0,
      emissive: 0x403020, emissiveIntensity: 0.40,
    });
    const fleshMat = new THREE.MeshStandardMaterial({
      color: 0x3a2838, roughness: 0.55, metalness: 0,
      emissive: 0x1a2840, emissiveIntensity: 0.50,
    });
    const polypMat = new THREE.MeshPhysicalMaterial({
      color: 0x0a1830, roughness: 0.30, metalness: 0,
      clearcoat: 0.9, clearcoatRoughness: 0.15,
      emissive: 0x001a55, emissiveIntensity: 1.0,
    });
    const polypTipMat = new THREE.MeshStandardMaterial({
      color: 0x00aaff, emissive: 0x0044ee, emissiveIntensity: 2.5,
      roughness: 0.15, metalness: 0,
    });
    const barnMat = new THREE.MeshStandardMaterial({
      color: 0x403828, roughness: 0.65, metalness: 0,
      emissive: 0x201810, emissiveIntensity: 0.25,
    });

    // Organic holdfast base
    const baseGeo = new THREE.SphereGeometry(1.5, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2);
    const bPos = baseGeo.attributes.position;
    for (let i = 0; i < bPos.count; i++) {
      const x = bPos.getX(i), z = bPos.getZ(i);
      bPos.setX(i, x + Math.sin(z * 5.0) * 0.07 + Math.sin(z * 11 + x * 3) * 0.03);
      bPos.setZ(i, z + Math.cos(x * 4.0) * 0.05);
    }
    baseGeo.computeVertexNormals();
    const base = new THREE.Mesh(baseGeo, fleshMat);
    base.rotation.x = -Math.PI;
    g.add(base);

    // Holdfast root tendrils — QuadraticBezierCurve3 tubes anchoring to substrate
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const len   = 1.2 + Math.random() * 0.7;
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(Math.cos(angle) * 0.7, -0.20, Math.sin(angle) * 0.7),
        new THREE.Vector3(Math.cos(angle) * 1.0, -0.55, Math.sin(angle) * 1.0),
        new THREE.Vector3(Math.cos(angle) * len,  -0.9,  Math.sin(angle) * len)
      );
      const tGeo = new THREE.TubeGeometry(curve, 6, 0.045, 6, false);
      g.add(new THREE.Mesh(tGeo, fleshMat));
    }

    // Pipes
    const PIPE_COUNT = 8;
    const FLARE_SEGS = 20;
    const pipes     = [];
    const membranes = [];
    const polyps    = [];

    for (let i = 0; i < PIPE_COUNT; i++) {
      const pg     = new THREE.Group();
      const x      = (i - (PIPE_COUNT - 1) * 0.5) * 0.38;
      const height = 2.0 + Math.sin(i * 0.7) * 1.5 + Math.random() * 0.5;
      const radius = 0.09 + Math.random() * 0.06;
      const resFreq = 1.4 / height + 0.25;  // shorter pipe → higher frequency
      const phase   = Math.random() * Math.PI * 2;

      // Per-pipe resonance uniforms (each pipe clones the material; all share program)
      const uFreq = { value: resFreq };
      const uAmp  = { value: 0.013  };
      const uH    = { value: height };
      const pMat  = pipeSrcMat.clone();
      _applyResonanceShader(pMat, this._uTime, uFreq, uAmp, uH);

      // Pipe body — 20 radial × 16 height segments for smooth form
      const pipeGeo = new THREE.CylinderGeometry(radius, radius * 1.10, height, 20, 16);
      const pp = pipeGeo.attributes.position;
      for (let v = 0; v < pp.count; v++) {
        pp.setX(v, pp.getX(v) + Math.sin(pp.getY(v) * 14) * 0.004);
      }
      pipeGeo.computeVertexNormals();
      const pipeMesh = new THREE.Mesh(pipeGeo, pMat);
      pipeMesh.position.y = height * 0.5;
      pg.add(pipeMesh);

      // Trumpet flare with ruffled rim
      const flareGeo = new THREE.CylinderGeometry(
        radius * 2.4, radius * 1.0, radius * 3.2, FLARE_SEGS, 4, true
      );
      const fp = flareGeo.attributes.position;
      for (let v = 0; v < fp.count; v++) {
        const fy  = fp.getY(v);
        const ang = Math.atan2(fp.getZ(v), fp.getX(v));
        const ruf = Math.cos(ang * 6) * radius * 0.09
                  * THREE.MathUtils.clamp(-fy / (radius * 1.6), 0, 1);
        fp.setX(v, fp.getX(v) + Math.cos(ang) * ruf);
        fp.setZ(v, fp.getZ(v) + Math.sin(ang) * ruf);
      }
      flareGeo.computeVertexNormals();
      const flare = new THREE.Mesh(flareGeo, pMat);
      flare.position.y = height + radius * 1.6;
      pg.add(flare);

      // Bone ring at base
      const baseRing = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.5, 0.026, 8, 14), boneMat);
      baseRing.position.y = 0.12;
      baseRing.rotation.x = Math.PI / 2;
      pg.add(baseRing);

      // Growth collar rings along pipe (baked into pipeMesh child list)
      const RING_COUNT = Math.max(2, Math.floor(height * 1.8));
      for (let r = 0; r < RING_COUNT; r++) {
        const ry   = (r + 0.5) / RING_COUNT * height;
        const rRad = radius * THREE.MathUtils.lerp(1.18, 1.08, ry / height);
        const cRing = new THREE.Mesh(
          new THREE.TorusGeometry(rRad, 0.013, 5, 10), boneMat
        );
        cRing.position.y = ry;
        cRing.rotation.x = Math.PI / 2;
        pipeMesh.add(cRing);
      }

      // Barnacle clusters with plate structure (12+ segments)
      const BARN_COUNT = 2 + Math.floor(Math.random() * 3);
      for (let b = 0; b < BARN_COUNT; b++) {
        const barnY   = (b + 0.5) / BARN_COUNT * height * 0.72;
        const barnAng = Math.random() * Math.PI * 2;
        const barnGeo = new THREE.SphereGeometry(
          radius * 0.5, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.65
        );
        const barn = new THREE.Mesh(barnGeo, barnMat);
        barn.position.set(
          Math.cos(barnAng) * radius * 1.15, barnY, Math.sin(barnAng) * radius * 1.15
        );
        barn.rotation.set(Math.random() * 0.5, barnAng, Math.random() * 0.4);
        // Barnacle plate structure
        for (let p = 0; p < 6; p++) {
          const pAng  = (p / 6) * Math.PI * 2;
          const plate = new THREE.Mesh(
            new THREE.BoxGeometry(radius * 0.16, radius * 0.07, radius * 0.24), barnMat
          );
          plate.position.set(
            Math.cos(pAng) * radius * 0.30, radius * 0.12, Math.sin(pAng) * radius * 0.30
          );
          plate.rotation.y = pAng;
          barn.add(plate);
        }
        pipeMesh.add(barn);
      }

      // Polyp tentacle cluster around flare opening
      const TENT_COUNT = 9;
      const tentacles  = [];
      const tH = radius * 3.0;
      const tR = radius * 2.0;
      for (let tp = 0; tp < TENT_COUNT; tp++) {
        const tAng = (tp / TENT_COUNT) * Math.PI * 2;
        const tent = new THREE.Mesh(
          new THREE.CylinderGeometry(0.012, 0.028, tH, 5, 3), polypMat
        );
        tent.position.set(
          Math.cos(tAng) * tR, height + radius * 1.6 + tH * 0.5, Math.sin(tAng) * tR
        );
        tent.rotation.x = Math.cos(tAng) * 0.28;
        tent.rotation.z = Math.sin(tAng) * 0.28;
        pg.add(tent);

        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 4), polypTipMat);
        tip.position.set(
          Math.cos(tAng) * tR, height + radius * 1.6 + tH, Math.sin(tAng) * tR
        );
        pg.add(tip);
        tentacles.push({ tent, angle: tAng, phase: Math.random() * Math.PI * 2 });
      }
      polyps.push({ tentacles });

      // Rim ring crowning the flare
      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(radius * 2.4, 0.020, 6, FLARE_SEGS), boneMat
      );
      rim.position.y = height + radius * 1.6 + tH * 0.5 + 0.02;
      rim.rotation.x = Math.PI / 2;
      pg.add(rim);

      pg.position.set(x, 0, (Math.random() - 0.5) * 0.4);
      g.add(pg);
      pipes.push({ group: pg, pipeMesh, height, phase, resFreq, resAmpUniform: uAmp });

      // Membrane frill between adjacent pipes — cloth-flutter shader
      if (i < PIPE_COUNT - 1) {
        const fW    = 0.38;
        const fH    = height * 0.6;
        const memGeo = new THREE.PlaneGeometry(fW, fH, 16, 8);
        // Baked-in edge ruffling
        const mp = memGeo.attributes.position;
        for (let v = 0; v < mp.count; v++) {
          const vy = mp.getY(v);
          const vx = mp.getX(v);
          const ef = Math.abs(vx / (fW * 0.5));
          mp.setZ(v, Math.sin(vy * 7 + vx * 5) * ef * 0.045);
        }
        memGeo.computeVertexNormals();
        const mMat  = memSrcMat.clone();
        const mAmp  = { value: 0.065 };
        const mPh   = { value: phase };
        _applyMembraneShader(mMat, this._uTime, mPh, mAmp);
        const membrane = new THREE.Mesh(memGeo, mMat);
        membrane.position.set(x + 0.19, fH * 0.5, 0);
        g.add(membrane);
        membranes.push({ mesh: membrane, ampUniform: mAmp });
      }
    }

    // Cross-connecting bone tubes
    for (let i = 0; i < PIPE_COUNT - 1; i += 2) {
      const cx   = (i - (PIPE_COUNT - 1) * 0.5 + 0.5) * 0.38;
      const cGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.36 + Math.random() * 0.16, 6, 1);
      const conn = new THREE.Mesh(cGeo, boneMat);
      conn.position.set(cx, 0.8 + Math.random() * 1.0, 0);
      conn.rotation.z = Math.PI / 2;
      g.add(conn);
    }

    // Emissive glow column — replaces PointLight for GPU savings
    const glowMat = new THREE.MeshStandardMaterial({
      color: 0x3311cc, emissive: 0x3311cc, emissiveIntensity: 0.7,
      transparent: true, opacity: 0.28, depthWrite: false,
    });
    this._glowMat = glowMat;
    const glowMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 3.8, 10), glowMat);
    glowMesh.position.y = 2.0;
    g.add(glowMesh);

    // Dispose template materials; each pipe/membrane already holds a clone
    pipeSrcMat.dispose();
    memSrcMat.dispose();

    return { group: g, pipes, membranes, polyps };
  }

  // Medium tier: 5 pipes, no polyps, no resonance shader, simplified barnacles
  _buildMediumTier() {
    const g = new THREE.Group();

    const pipeMat = new THREE.MeshStandardMaterial({
      color: 0x2a2838, roughness: 0.25, metalness: 0.45,
      emissive: 0x1a3050, emissiveIntensity: 0.55,
    });
    const membraneMat = new THREE.MeshStandardMaterial({
      color: 0x1a2840, roughness: 0.4, metalness: 0,
      transparent: true, opacity: 0.70, side: THREE.DoubleSide,
      emissive: 0x0a1828, emissiveIntensity: 0.30,
    });
    const boneMat = new THREE.MeshStandardMaterial({
      color: 0x504030, roughness: 0.45, metalness: 0,
      emissive: 0x403020, emissiveIntensity: 0.35,
    });
    const fleshMat = new THREE.MeshStandardMaterial({
      color: 0x3a2838, roughness: 0.55, metalness: 0,
      emissive: 0x1a2840, emissiveIntensity: 0.45,
    });

    // Base
    const baseGeo = new THREE.SphereGeometry(1.5, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    const base = new THREE.Mesh(baseGeo, fleshMat);
    base.rotation.x = -Math.PI;
    g.add(base);

    // Simplified tendrils
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const len   = 1.3 + Math.random() * 0.5;
      const tGeo  = new THREE.CylinderGeometry(0.04, 0.08, len, 5, 2);
      const t     = new THREE.Mesh(tGeo, fleshMat);
      t.position.set(Math.cos(angle) * 1.1, -len * 0.35, Math.sin(angle) * 1.1);
      t.rotation.x = (Math.random() - 0.5) * 0.4;
      t.rotation.z = (Math.random() - 0.5) * 0.4;
      g.add(t);
    }

    const PIPE_COUNT = 5;
    const pipes     = [];
    const membranes = [];

    for (let i = 0; i < PIPE_COUNT; i++) {
      const x      = (i - (PIPE_COUNT - 1) * 0.5) * 0.40;
      const height = 2.0 + Math.sin(i * 0.7) * 1.5 + Math.random() * 0.5;
      const radius = 0.09 + Math.random() * 0.06;
      const phase  = Math.random() * Math.PI * 2;

      const pg = new THREE.Group();
      const pipeGeo = new THREE.CylinderGeometry(radius, radius * 1.10, height, 12, 8);
      const pipeMesh = new THREE.Mesh(pipeGeo, pipeMat);
      pipeMesh.position.y = height * 0.5;
      pg.add(pipeMesh);

      const flare = new THREE.Mesh(
        new THREE.CylinderGeometry(radius * 2.0, radius * 1.0, radius * 2.8, 12, 2, true), pipeMat
      );
      flare.position.y = height + radius * 1.4;
      pg.add(flare);

      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.4, 0.022, 6, 10), boneMat);
      ring.position.y = 0.10;
      ring.rotation.x = Math.PI / 2;
      pg.add(ring);

      // Simplified barnacle
      const barn = new THREE.Mesh(
        new THREE.SphereGeometry(radius * 0.4, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.6), boneMat
      );
      barn.position.set(radius * 1.1, height * 0.4, 0);
      barn.rotation.x = Math.PI / 2;
      pg.add(barn);

      pg.position.set(x, 0, (Math.random() - 0.5) * 0.4);
      g.add(pg);
      pipes.push({ group: pg, height, phase });

      // Simplified membrane frill
      if (i < PIPE_COUNT - 1) {
        const fW = 0.40;
        const fH = height * 0.55;
        const membrane = new THREE.Mesh(new THREE.PlaneGeometry(fW, fH, 8, 4), membraneMat);
        membrane.position.set(x + 0.20, fH * 0.5, 0);
        g.add(membrane);
        membranes.push({ mesh: membrane, phase });
      }
    }

    // Cross tubes
    for (let i = 0; i < PIPE_COUNT - 1; i += 2) {
      const cx  = (i - (PIPE_COUNT - 1) * 0.5 + 0.5) * 0.40;
      const cGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.38, 5, 1);
      const conn = new THREE.Mesh(cGeo, boneMat);
      conn.position.set(cx, 0.9 + Math.random() * 0.8, 0);
      conn.rotation.z = Math.PI / 2;
      g.add(conn);
    }

    return { group: g, pipes, membranes };
  }

  // Far tier: ultra-lightweight static mesh — under 100 triangles
  // CylinderGeometry(r0,r1,h, radSeg=5, hSeg=1): 5*2 sides + 2*5 caps = 20 tri each
  // Base (radSeg=8, hSeg=1): 8*2 sides + 2*8 caps = 32 tri
  // 3 pipes × 20 + 32 = 92 tri total
  _buildFarTier() {
    const g = new THREE.Group();
    const pipeMat = new THREE.MeshStandardMaterial({
      color: 0x252233, roughness: 0.25, metalness: 0.40,
      emissive: 0x1a3050, emissiveIntensity: 0.50,
    });
    const fleshMat = new THREE.MeshStandardMaterial({
      color: 0x3a2838, roughness: 0.55, metalness: 0,
      emissive: 0x1a2840, emissiveIntensity: 0.40,
    });

    g.add(new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.65, 0.3, 8, 1), fleshMat));
    for (let i = 0; i < 3; i++) {
      const height = 2.5 + i * 0.85;
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, height, 5, 1), pipeMat);
      p.position.set((i - 1) * 0.48, height * 0.5, 0);
      g.add(p);
    }
    return { group: g };
  }

  // ── Update ─────────────────────────────────────────────────────────────────

  update(dt, playerPos) {
    this.time        += dt;
    this._uTime.value = this.time;

    const dist = _tmpVec3.copy(this.group.position).distanceTo(playerPos);

    // Hydraulic state machine
    if      (this._state === 'idle'      && dist < 15) this._state = 'retracting';
    else if (this._state === 'retracted' && dist > 25) this._state = 'extending';

    if      (this._state === 'retracting') {
      this._retractT = Math.min(1, this._retractT + dt * 2.5);
      if (this._retractT >= 1) this._state = 'retracted';
    } else if (this._state === 'extending') {
      this._retractT = Math.max(0, this._retractT - dt * 0.35);
      if (this._retractT <= 0) this._state = 'idle';
    }

    const rt = this._retractT;

    // Near-tier animation (skip only when far tier is active)
    if (dist < LOD_MEDIUM_DISTANCE + 30 && this._nearData) {
      const { pipes, membranes, polyps } = this._nearData;

      // Breathing glow
      if (this._glowMat) {
        this._glowMat.emissiveIntensity =
          0.5 + Math.sin(this.time * 0.8) * 0.28 + Math.sin(this.time * 3.1) * 0.11;
      }

      for (let i = 0; i < pipes.length; i++) {
        const pd    = pipes[i];
        const phase = this.time * 1.5 + pd.phase;

        // Hydraulic retraction (scale Y, sink into base)
        const extY = 1 - rt * 0.88;
        pd.group.scale.y = extY;
        pd.group.position.y = -(1 - extY) * pd.height * 0.5;

        // Water-current drag sway
        const sway = 0.013 * (1 - rt);
        pd.group.rotation.z = Math.sin(phase * 0.5 + i * 0.4)  * sway;
        pd.group.rotation.x = Math.cos(phase * 0.3 + i * 0.35) * sway * 0.55;

        // Resonance amplitude — breathes with idle cycle, dies on retract
        if (pd.resAmpUniform) {
          const breath = 1 + Math.sin(this.time * 0.75 + pd.phase) * 0.18;
          pd.resAmpUniform.value = 0.013 * breath * (1 - rt * 0.92);
        }

        // Emissive breathing keyed to resonance
        if (pd.pipeMesh && pd.pipeMesh.material) {
          pd.pipeMesh.material.emissiveIntensity =
            THREE.MathUtils.lerp(0.3, 0.7,
              0.5 + Math.sin(this.time * 0.9 + i * 0.55) * 0.5)
            * (1 - rt * 0.55);
        }
      }

      // Membrane flutter — billows briefly during retraction, then folds away
      for (let m = 0; m < membranes.length; m++) {
        const md = membranes[m];
        if (md.ampUniform) {
          md.ampUniform.value = 0.065 * (1 + rt * 1.4) * (1 - rt * 0.80);
        }
      }

      // Polyp tentacle sway + fold inward on retract
      for (let pg = 0; pg < polyps.length; pg++) {
        const grp = polyps[pg];
        for (let tp = 0; tp < grp.tentacles.length; tp++) {
          const td    = grp.tentacles[tp];
          const tPh   = this.time * 2.1 + td.phase;
          td.tent.rotation.x = Math.sin(tPh + td.angle)   * 0.09 * (1 - rt)
                              + Math.cos(td.angle) * rt * -0.25;
          td.tent.rotation.z = Math.cos(tPh * 0.72) * 0.07 * (1 - rt)
                              + Math.sin(td.angle) * rt * -0.25;
        }
      }
    }

    // Medium-tier animation — simplified sway, no shader changes
    if (dist >= LOD_NEAR_DISTANCE && dist < LOD_MEDIUM_DISTANCE + 30 && this._mediumData) {
      const { pipes } = this._mediumData;
      for (let i = 0; i < pipes.length; i++) {
        const pd    = pipes[i];
        const phase = this.time * 1.2 + pd.phase;
        const extY  = 1 - rt * 0.88;
        pd.group.scale.y      = extY;
        pd.group.position.y   = -(1 - extY) * pd.height * 0.5;
        pd.group.rotation.z   = Math.sin(phase * 0.5 + i * 0.4) * 0.010 * (1 - rt);
        pd.group.rotation.x   = Math.cos(phase * 0.3 + i * 0.35) * 0.006 * (1 - rt);
      }
    }

    // Respawn when player has moved too far away
    if (dist > 200) {
      const a = Math.random() * Math.PI * 2;
      this.group.position.set(
        playerPos.x + Math.cos(a) * 80, playerPos.y, playerPos.z + Math.sin(a) * 80
      );
    }
  }

  getPosition() { return this.group.position; }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(c => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    });
    // Module-level textures (_pipeNormalTex, _membraneNormalTex) are shared across
    // all PipeOrgan instances and must NOT be disposed here.
  }
}
