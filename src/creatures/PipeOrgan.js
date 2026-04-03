import * as THREE from 'three/webgpu';
import { attribute, clamp, cos, max, normalLocal, positionLocal, sin, uniform, vec3 } from 'three/tsl';
import { LOD_NEAR_DISTANCE, LOD_MEDIUM_DISTANCE } from './lodUtils.js';

// Pre-allocated temps — zero per-frame allocations
const _tmpVec3 = new THREE.Vector3();
const _pipeM4 = new THREE.Matrix4();
const _pipePos = new THREE.Vector3();
const _pipeScale = new THREE.Vector3();
const _pipeEuler = new THREE.Euler();
const _pipeQuat = new THREE.Quaternion();

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
 * Inject standing-wave resonance into an InstancedMesh pipe material.
 * Per-instance attributes: aResFreq, aPhase, aRadius.
 * Shared uniforms: uTime, uResA (base amplitude), uRetractT.
 */
function _applyResonanceShaderInstanced(mat, uTime, uResA, uRetractT) {
  const aResFreq = attribute('aResFreq', 'float');
  const aPhase = attribute('aPhase', 'float');
  const aRadius = attribute('aRadius', 'float');

  // TSL: standing-wave resonance on unit cylinder
  const normY = clamp(positionLocal.y.add(0.5), 0.0, 1.0);
  const breath = sin(uTime.mul(0.75).add(aPhase)).mul(0.18).add(1.0);
  const amp = uResA.mul(breath).mul(uRetractT.mul(0.92).negate().add(1.0)).div(max(aRadius, 0.01));
  const w1 = sin(normY.mul(Math.PI)).mul(cos(uTime.mul(aResFreq).mul(Math.PI * 2)));
  const w2 = sin(normY.mul(Math.PI * 2)).mul(cos(uTime.mul(aResFreq).mul(Math.PI * 4).add(0.7)));
  const disp = w1.mul(0.7).add(w2.mul(0.3)).mul(amp);
  mat.positionNode = vec3(
    positionLocal.x.add(normalLocal.x.mul(disp)),
    positionLocal.y,
    positionLocal.z.add(normalLocal.z.mul(disp))
  );
}

/**
 * Inject cloth-like membrane flutter into a MeshPhysicalMaterial vertex shader.
 */
function _applyMembraneShader(mat, uTime, uPhase, uAmp) {
  // TSL: cloth-like membrane flutter
  const flutter = sin(positionLocal.x.mul(3.8).add(uTime.mul(2.5)).add(uPhase))
    .mul(cos(positionLocal.y.mul(2.9).add(uTime.mul(1.6)))).mul(uAmp);
  mat.positionNode = vec3(positionLocal.x, positionLocal.y, positionLocal.z.add(flutter));
}

// ── PipeOrgan ─────────────────────────────────────────────────────────────────

// Tall stationary creature resembling biomechanical pipe organ - resonates and hums
export class PipeOrgan {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time  = Math.random() * 100;

    // Shared uniforms for GPU shaders
    this._uTime     = uniform(this.time);
    this._uResA     = uniform(0.013);
    this._uRetractT = uniform(0);

    // Hydraulic state machine: idle → retracting → retracted → extending → idle
    this._state    = 'idle';
    this._retractT = 0; // 0 = fully extended, 1 = fully retracted

    // Slowly-varying internal pseudo-current (no global current system exists)
    this._currentAngle    = Math.random() * Math.PI * 2;
    this._currentStrength = 0.006 + Math.random() * 0.004;

    // Per-tier animation handles (null until built)
    this._nearData     = null;
    this._mediumData   = null;
    this._pipeIMeshMat = null;
    this._glowMat      = null;

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  // ── Build ──────────────────────────────────────────────────────────────────

  _getVisibleTierName() {
    if (!this.lod || !this.lod.levels) return null;
    for (let i = 0; i < this.lod.levels.length; i++) {
      if (this.lod.levels[i].object.visible) {
        return this.lod.levels[i].object.userData.tierName || null;
      }
    }
    return null;
  }

  _buildModel() {
    const lod    = new THREE.LOD();
    const near   = this._buildNearTier();
    const medium = this._buildMediumTier();
    const far    = this._buildFarTier();

    this._nearData   = near;
    this._mediumData = medium;

    near.group.userData.tierName   = 'near';
    medium.group.userData.tierName = 'medium';
    far.group.userData.tierName    = 'far';

    lod.addLevel(near.group,   0);
    lod.addLevel(medium.group, LOD_NEAR_DISTANCE);
    lod.addLevel(far.group,    LOD_MEDIUM_DISTANCE);
    this.lod = lod;
    this.group.add(lod);
    this.group.scale.setScalar(2 + Math.random() * 2);
  }

  // Near tier: full fidelity — 8 instanced pipes (1 draw call), membrane frills,
  // polyp tentacles, GPU resonance shader
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

    // ── Pipe InstancedMesh (single draw call for all 8 pipe bodies) ──────────
    const PIPE_COUNT = 8;
    const FLARE_SEGS = 20;

    // Unit cylinder template shared by all pipe instances
    const unitPipeGeo = new THREE.CylinderGeometry(1, 1.1, 1, 20, 16);
    const pp = unitPipeGeo.attributes.position;
    for (let v = 0; v < pp.count; v++) {
      pp.setX(v, pp.getX(v) + Math.sin(pp.getY(v) * 14) * 0.004);
    }
    unitPipeGeo.computeVertexNormals();

    // Pre-compute per-pipe layout
    const pipeLayout  = [];
    const attrHeight  = new Float32Array(PIPE_COUNT);
    const attrRadius  = new Float32Array(PIPE_COUNT);
    const attrResFreq = new Float32Array(PIPE_COUNT);
    const attrPhase   = new Float32Array(PIPE_COUNT);

    for (let i = 0; i < PIPE_COUNT; i++) {
      const x      = (i - (PIPE_COUNT - 1) * 0.5) * 0.38;
      const height = 2.0 + Math.sin(i * 0.7) * 1.5 + Math.random() * 0.5;
      const radius = 0.09 + Math.random() * 0.06;
      const resFreq = 1.4 / height + 0.25;
      const phase   = Math.random() * Math.PI * 2;
      const z       = (Math.random() - 0.5) * 0.4;
      pipeLayout.push({ x, z, height, radius, resFreq, phase });
      attrHeight[i]  = height;
      attrRadius[i]  = radius;
      attrResFreq[i] = resFreq;
      attrPhase[i]   = phase;
    }

    // Per-instance attributes for the resonance vertex shader
    unitPipeGeo.setAttribute('aResFreq', new THREE.InstancedBufferAttribute(attrResFreq, 1));
    unitPipeGeo.setAttribute('aPhase',   new THREE.InstancedBufferAttribute(attrPhase, 1));
    unitPipeGeo.setAttribute('aRadius',  new THREE.InstancedBufferAttribute(attrRadius, 1));

    // Single InstancedMesh material with instanced resonance shader
    const pipeIMat = pipeSrcMat.clone();
    _applyResonanceShaderInstanced(pipeIMat, this._uTime, this._uResA, this._uRetractT);
    this._pipeIMeshMat = pipeIMat;

    const pipeIMesh = new THREE.InstancedMesh(unitPipeGeo, pipeIMat, PIPE_COUNT);
    pipeIMesh.frustumCulled = false; // LOD manages visibility

    // Set initial instance transforms
    for (let i = 0; i < PIPE_COUNT; i++) {
      const d = pipeLayout[i];
      _pipePos.set(d.x, d.height * 0.5, d.z);
      _pipeScale.set(d.radius, d.height, d.radius);
      _pipeM4.compose(_pipePos, _pipeQuat.identity(), _pipeScale);
      pipeIMesh.setMatrixAt(i, _pipeM4);
    }
    pipeIMesh.instanceMatrix.needsUpdate = true;
    g.add(pipeIMesh);

    // ── Per-pipe accessories (flare, rings, barnacles, polyp tentacles) ──────
    const pipes     = [];
    const membranes = [];
    const polyps    = [];

    for (let i = 0; i < PIPE_COUNT; i++) {
      const d  = pipeLayout[i];
      const pg = new THREE.Group();

      // Trumpet flare with ruffled rim
      const flareGeo = new THREE.CylinderGeometry(
        d.radius * 2.4, d.radius * 1.0, d.radius * 3.2, FLARE_SEGS, 4, true
      );
      const fp = flareGeo.attributes.position;
      for (let v = 0; v < fp.count; v++) {
        const fy  = fp.getY(v);
        const ang = Math.atan2(fp.getZ(v), fp.getX(v));
        const ruf = Math.cos(ang * 6) * d.radius * 0.09
                  * THREE.MathUtils.clamp(-fy / (d.radius * 1.6), 0, 1);
        fp.setX(v, fp.getX(v) + Math.cos(ang) * ruf);
        fp.setZ(v, fp.getZ(v) + Math.sin(ang) * ruf);
      }
      flareGeo.computeVertexNormals();
      const flare = new THREE.Mesh(flareGeo, pipeSrcMat);
      flare.position.y = d.height + d.radius * 1.6;
      pg.add(flare);

      // Bone ring at base
      const baseRing = new THREE.Mesh(
        new THREE.TorusGeometry(d.radius * 1.5, 0.026, 8, 14), boneMat
      );
      baseRing.position.y = 0.12;
      baseRing.rotation.x = Math.PI / 2;
      pg.add(baseRing);

      // Growth collar rings along pipe
      const RING_COUNT = Math.max(2, Math.floor(d.height * 1.8));
      for (let r = 0; r < RING_COUNT; r++) {
        const ry   = (r + 0.5) / RING_COUNT * d.height;
        const rRad = d.radius * THREE.MathUtils.lerp(1.18, 1.08, ry / d.height);
        const cRing = new THREE.Mesh(
          new THREE.TorusGeometry(rRad, 0.013, 5, 10), boneMat
        );
        cRing.position.y = ry;
        cRing.rotation.x = Math.PI / 2;
        pg.add(cRing);
      }

      // Barnacle clusters with plate structure (12+ segments)
      const BARN_COUNT = 2 + Math.floor(Math.random() * 3);
      for (let b = 0; b < BARN_COUNT; b++) {
        const barnY   = (b + 0.5) / BARN_COUNT * d.height * 0.72;
        const barnAng = Math.random() * Math.PI * 2;
        const barnGeo = new THREE.SphereGeometry(
          d.radius * 0.5, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.65
        );
        const barn = new THREE.Mesh(barnGeo, barnMat);
        barn.position.set(
          Math.cos(barnAng) * d.radius * 1.15, barnY, Math.sin(barnAng) * d.radius * 1.15
        );
        barn.rotation.set(Math.random() * 0.5, barnAng, Math.random() * 0.4);
        // Barnacle plate structure
        for (let p = 0; p < 6; p++) {
          const pAng  = (p / 6) * Math.PI * 2;
          const plate = new THREE.Mesh(
            new THREE.BoxGeometry(d.radius * 0.16, d.radius * 0.07, d.radius * 0.24), barnMat
          );
          plate.position.set(
            Math.cos(pAng) * d.radius * 0.30, d.radius * 0.12, Math.sin(pAng) * d.radius * 0.30
          );
          plate.rotation.y = pAng;
          barn.add(plate);
        }
        pg.add(barn);
      }

      // Polyp tentacle cluster — tip is child of tent so it follows motion
      const TENT_COUNT = 9;
      const tentacles  = [];
      const tH = d.radius * 3.0;
      const tR = d.radius * 2.0;
      for (let tp = 0; tp < TENT_COUNT; tp++) {
        const tAng = (tp / TENT_COUNT) * Math.PI * 2;
        const tent = new THREE.Mesh(
          new THREE.CylinderGeometry(0.012, 0.028, tH, 5, 3), polypMat
        );
        tent.position.set(
          Math.cos(tAng) * tR, d.height + d.radius * 1.6 + tH * 0.5, Math.sin(tAng) * tR
        );
        tent.rotation.x = Math.cos(tAng) * 0.28;
        tent.rotation.z = Math.sin(tAng) * 0.28;
        pg.add(tent);

        // Tip attached as child of tent so it follows all tentacle rotation
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 4), polypTipMat);
        tip.position.set(0, tH * 0.5, 0);
        tent.add(tip);
        tentacles.push({ tent, tip, angle: tAng, phase: Math.random() * Math.PI * 2 });
      }
      polyps.push({ tentacles });

      // Rim ring crowning the flare
      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(d.radius * 2.4, 0.020, 6, FLARE_SEGS), boneMat
      );
      rim.position.y = d.height + d.radius * 1.6 + tH * 0.5 + 0.02;
      rim.rotation.x = Math.PI / 2;
      pg.add(rim);

      pg.position.set(d.x, 0, d.z);
      g.add(pg);
      pipes.push({
        accessoryGroup: pg, height: d.height, phase: d.phase,
        radius: d.radius, x: d.x, z: d.z,
      });

      // Membrane frill between adjacent pipes — cloth-flutter shader
      if (i < PIPE_COUNT - 1) {
        const fW    = 0.38;
        const fH    = d.height * 0.6;
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
        const mAmp  = uniform(0.065);
        const mPh   = uniform(d.phase);
        _applyMembraneShader(mMat, this._uTime, mPh, mAmp);
        const membrane = new THREE.Mesh(memGeo, mMat);
        membrane.position.set(d.x + 0.19, fH * 0.5, 0);
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

    // Dispose membrane template; pipeSrcMat kept alive for flare meshes
    // (cleaned up via traverse in dispose())
    memSrcMat.dispose();

    return { group: g, pipes, membranes, polyps, pipeIMesh };
  }

  // Medium tier: 5 instanced pipes (1 draw call), simplified barnacles, no polyps/resonance
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

    // ── InstancedMesh for 5 medium-tier pipe bodies (single draw call) ──
    const PIPE_COUNT = 5;

    const unitMedGeo = new THREE.CylinderGeometry(1, 1.1, 1, 12, 8);
    unitMedGeo.computeVertexNormals();

    const medLayout = [];
    for (let i = 0; i < PIPE_COUNT; i++) {
      const x      = (i - (PIPE_COUNT - 1) * 0.5) * 0.40;
      const height = 2.0 + Math.sin(i * 0.7) * 1.5 + Math.random() * 0.5;
      const radius = 0.09 + Math.random() * 0.06;
      const phase  = Math.random() * Math.PI * 2;
      const z      = (Math.random() - 0.5) * 0.4;
      medLayout.push({ x, z, height, radius, phase });
    }

    const medPipeIMesh = new THREE.InstancedMesh(unitMedGeo, pipeMat, PIPE_COUNT);
    medPipeIMesh.frustumCulled = false;

    for (let i = 0; i < PIPE_COUNT; i++) {
      const d = medLayout[i];
      _pipePos.set(d.x, d.height * 0.5, d.z);
      _pipeScale.set(d.radius, d.height, d.radius);
      _pipeM4.compose(_pipePos, _pipeQuat.identity(), _pipeScale);
      medPipeIMesh.setMatrixAt(i, _pipeM4);
    }
    medPipeIMesh.instanceMatrix.needsUpdate = true;
    g.add(medPipeIMesh);

    // ── Per-pipe accessories ──
    const pipes     = [];
    const membranes = [];

    for (let i = 0; i < PIPE_COUNT; i++) {
      const d  = medLayout[i];
      const pg = new THREE.Group();

      const flare = new THREE.Mesh(
        new THREE.CylinderGeometry(d.radius * 2.0, d.radius * 1.0, d.radius * 2.8, 12, 2, true),
        pipeMat
      );
      flare.position.y = d.height + d.radius * 1.4;
      pg.add(flare);

      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(d.radius * 1.4, 0.022, 6, 10), boneMat
      );
      ring.position.y = 0.10;
      ring.rotation.x = Math.PI / 2;
      pg.add(ring);

      // Simplified barnacle
      const barn = new THREE.Mesh(
        new THREE.SphereGeometry(d.radius * 0.4, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.6), boneMat
      );
      barn.position.set(d.radius * 1.1, d.height * 0.4, 0);
      barn.rotation.x = Math.PI / 2;
      pg.add(barn);

      pg.position.set(d.x, 0, d.z);
      g.add(pg);
      pipes.push({
        accessoryGroup: pg, height: d.height, phase: d.phase,
        radius: d.radius, x: d.x, z: d.z,
      });

      // Simplified membrane frill
      if (i < PIPE_COUNT - 1) {
        const fW = 0.40;
        const fH = d.height * 0.55;
        const membrane = new THREE.Mesh(new THREE.PlaneGeometry(fW, fH, 8, 4), membraneMat);
        membrane.position.set(d.x + 0.20, fH * 0.5, 0);
        g.add(membrane);
        membranes.push({ mesh: membrane, phase: d.phase });
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

    return { group: g, pipes, membranes, pipeIMesh: medPipeIMesh };
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

  update(dt, playerPos, distSq) {
    this.time        += dt;
    this._uTime.value = this.time;

    // Hydraulic state machine
    if      (this._state === 'idle'      && distSq < 225) this._state = 'retracting';
    else if (this._state === 'retracted' && distSq > 625) this._state = 'extending';

    if      (this._state === 'retracting') {
      this._retractT = Math.min(1, this._retractT + dt * 2.5);
      if (this._retractT >= 1) this._state = 'retracted';
    } else if (this._state === 'extending') {
      this._retractT = Math.max(0, this._retractT - dt * 0.35);
      if (this._retractT <= 0) this._state = 'idle';
    }

    const rt = this._retractT;
    this._uRetractT.value = rt;

    // Slowly varying pseudo-current lean direction
    this._currentAngle += dt * 0.03;
    const currentLeanZ = Math.sin(this._currentAngle) * this._currentStrength * (1 - rt);
    const currentLeanX = Math.cos(this._currentAngle * 0.7) * this._currentStrength * 0.55 * (1 - rt);

    // Determine active LOD tier via actual visibility (not distance heuristic)
    const tier = this._getVisibleTierName();

    // Near-tier animation
    if (tier === 'near' && this._nearData) {
      const { pipes, membranes, polyps, pipeIMesh } = this._nearData;

      // Breathing glow
      if (this._glowMat) {
        this._glowMat.emissiveIntensity =
          0.5 + Math.sin(this.time * 0.8) * 0.28 + Math.sin(this.time * 3.1) * 0.11;
      }

      // Shared pipe material emissive breathing
      if (this._pipeIMeshMat) {
        this._pipeIMeshMat.emissiveIntensity =
          THREE.MathUtils.lerp(0.3, 0.7,
            0.5 + Math.sin(this.time * 0.9) * 0.5)
          * (1 - rt * 0.55);
      }

      // Update pipe InstancedMesh matrices (sway + retraction + current lean)
      for (let i = 0; i < pipes.length; i++) {
        const pd    = pipes[i];
        const phase = this.time * 1.5 + pd.phase;

        // Hydraulic retraction
        const extY = 1 - rt * 0.88;
        const hExt  = pd.height * extY;
        const halfH = hExt * 0.5;
        const baseY = -(1 - extY) * pd.height * 0.5;

        // Water-current drag sway + current-direction lean
        const sway = 0.013 * (1 - rt);
        const rz   = Math.sin(phase * 0.5 + i * 0.4)  * sway + currentLeanZ;
        const rx   = Math.cos(phase * 0.3 + i * 0.35) * sway * 0.55 + currentLeanX;

        // Base-anchored rotation: offset center so pipe bottom stays at baseY
        _pipePos.set(
          pd.x + halfH * Math.sin(rz),
          baseY + halfH,
          pd.z - halfH * Math.sin(rx)
        );
        _pipeScale.set(pd.radius, hExt, pd.radius);
        _pipeEuler.set(rx, 0, rz);
        _pipeQuat.setFromEuler(_pipeEuler);
        _pipeM4.compose(_pipePos, _pipeQuat, _pipeScale);
        pipeIMesh.setMatrixAt(i, _pipeM4);

        // Sync accessory group transform
        pd.accessoryGroup.scale.y    = extY;
        pd.accessoryGroup.position.y = baseY;
        pd.accessoryGroup.rotation.z = rz;
        pd.accessoryGroup.rotation.x = rx;
      }
      pipeIMesh.instanceMatrix.needsUpdate = true;

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

    // Medium-tier animation — simplified sway via instance matrices
    if (tier === 'medium' && this._mediumData) {
      const { pipes, pipeIMesh } = this._mediumData;
      for (let i = 0; i < pipes.length; i++) {
        const pd    = pipes[i];
        const phase = this.time * 1.2 + pd.phase;
        const extY  = 1 - rt * 0.88;
        const hExt  = pd.height * extY;
        const halfH = hExt * 0.5;
        const baseY = -(1 - extY) * pd.height * 0.5;
        const swayZ = Math.sin(phase * 0.5 + i * 0.4) * 0.010 * (1 - rt) + currentLeanZ;
        const swayX = Math.cos(phase * 0.3 + i * 0.35) * 0.006 * (1 - rt) + currentLeanX;

        _pipePos.set(
          pd.x + halfH * Math.sin(swayZ),
          baseY + halfH,
          pd.z - halfH * Math.sin(swayX)
        );
        _pipeScale.set(pd.radius, hExt, pd.radius);
        _pipeEuler.set(swayX, 0, swayZ);
        _pipeQuat.setFromEuler(_pipeEuler);
        _pipeM4.compose(_pipePos, _pipeQuat, _pipeScale);
        pipeIMesh.setMatrixAt(i, _pipeM4);

        pd.accessoryGroup.scale.y    = extY;
        pd.accessoryGroup.position.y = baseY;
        pd.accessoryGroup.rotation.z = swayZ;
        pd.accessoryGroup.rotation.x = swayX;
      }
      pipeIMesh.instanceMatrix.needsUpdate = true;
    }

    // Respawn when player has moved too far away
    if (distSq > 40000) {
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
