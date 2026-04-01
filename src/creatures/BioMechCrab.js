import * as THREE from 'three/webgpu';
import { normalLocal, positionLocal, sin, uniform } from 'three/tsl';
import { LOD_NEAR_DISTANCE, LOD_MEDIUM_DISTANCE, toStandardMaterial } from './lodUtils.js';
import { qualityManager } from '../QualityManager.js';

// ── Shared module-level textures (created once, never disposed per-instance) ──

let _carapaceNormalTex = null;
let _carapaceRoughnessTex = null;
let _barnacleGeo = null;
let _spineGeo = null;

const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI * 0.5;

// ── Fast acos lookup table (64-entry, linear interpolation over [-1, 1] → [0, π]) ──
const ACOS_TABLE_SIZE = 64;
const ACOS_TABLE = new Float32Array(ACOS_TABLE_SIZE + 1);
for (let i = 0; i <= ACOS_TABLE_SIZE; i++) {
  ACOS_TABLE[i] = Math.acos(2 * i / ACOS_TABLE_SIZE - 1);
}

function fastAcos(x) {
  // Clamp to [-1, 1] and map to [0, ACOS_TABLE_SIZE]
  const t = (Math.min(1, Math.max(-1, x)) + 1) * 0.5 * ACOS_TABLE_SIZE;
  const i = t | 0; // floor
  if (i >= ACOS_TABLE_SIZE) return ACOS_TABLE[ACOS_TABLE_SIZE];
  const f = t - i;
  return ACOS_TABLE[i] * (1 - f) + ACOS_TABLE[i + 1] * f;
}

function _hash(x, y, seed) {
  let h = seed | 0;
  h = ((h ^ ((x | 0) * 374761393)) >>> 0) * 1103515245;
  h = ((h ^ ((y | 0) * 668265263)) >>> 0) * 1103515245;
  return ((h >>> 16) & 0xffff) / 65535;
}

function _createCarapaceNormalTexture() {
  if (_carapaceNormalTex) return _carapaceNormalTex;
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1);
      const v = y / (size - 1);
      const hex = Math.sin(u * 24 + Math.cos(v * 18) * 1.6) * 0.3
        + Math.sin(v * 30 + Math.sin(u * 22) * 1.4) * 0.25
        + Math.sin((u + v) * 14) * 0.15;
      const pit = _hash(x, y, 7) * 0.2 - 0.1;
      const dx = hex + pit;
      const dy = Math.sin(v * 30 + u * 12) * 0.3 + _hash(x, y, 13) * 0.15 - 0.075;
      const nx = THREE.MathUtils.clamp(0.5 + dx * 0.5, 0, 1);
      const ny = THREE.MathUtils.clamp(0.5 + dy * 0.5, 0, 1);
      const nz = Math.sqrt(Math.max(0, 1 - (nx * 2 - 1) ** 2 - (ny * 2 - 1) ** 2)) * 0.5 + 0.5;
      const idx = (y * size + x) * 4;
      data[idx] = Math.round(nx * 255);
      data[idx + 1] = Math.round(ny * 255);
      data[idx + 2] = Math.round(nz * 255);
      data[idx + 3] = 255;
    }
  }
  _carapaceNormalTex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  _carapaceNormalTex.wrapS = _carapaceNormalTex.wrapT = THREE.RepeatWrapping;
  _carapaceNormalTex.repeat.set(2, 2);
  _carapaceNormalTex.needsUpdate = true;
  return _carapaceNormalTex;
}

function _createCarapaceRoughnessTex() {
  if (_carapaceRoughnessTex) return _carapaceRoughnessTex;
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const base = 0.22 + _hash(x, y, 41) * 0.45;
      const wet = Math.sin(y / size * 8) * 0.08;
      const val = Math.round(THREE.MathUtils.clamp(base + wet, 0, 1) * 255);
      data[idx] = val;
      data[idx + 1] = val;
      data[idx + 2] = val;
      data[idx + 3] = 255;
    }
  }
  _carapaceRoughnessTex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  _carapaceRoughnessTex.wrapS = _carapaceRoughnessTex.wrapT = THREE.RepeatWrapping;
  _carapaceRoughnessTex.needsUpdate = true;
  return _carapaceRoughnessTex;
}

function _getBarnacleGeo() {
  if (_barnacleGeo) return _barnacleGeo;
  _barnacleGeo = new THREE.SphereGeometry(0.04, 6, 4);
  _barnacleGeo.scale(1, 0.6, 1);
  return _barnacleGeo;
}

function _getSpineGeo() {
  if (_spineGeo) return _spineGeo;
  _spineGeo = new THREE.ConeGeometry(0.025, 0.12, 4);
  return _spineGeo;
}

// ── LOD profiles ──

const LOD_PROFILE = {
  near: {
    carapaceWSeg: 48, carapaceHSeg: 32,
    legRadial: 12, pistonRadial: 12,
    footRadial: 12,
    mandibleRadial: 6,
    eyeDetail: 10, eyeStalkRadial: 6,
    barnacleCount: 24, spineCount: 16,
    ventralSeg: 12, ventralRadial: 8,
    useIKGait: true, usePistonAnim: true,
    useEyeTracking: true, useMandibleAnim: true,
  },
  medium: {
    carapaceWSeg: 24, carapaceHSeg: 16,
    legRadial: 6, pistonRadial: 6,
    footRadial: 6,
    mandibleRadial: 4,
    eyeDetail: 6, eyeStalkRadial: 4,
    barnacleCount: 8, spineCount: 6,
    ventralSeg: 6, ventralRadial: 4,
    useIKGait: true, usePistonAnim: false,
    useEyeTracking: true, useMandibleAnim: true,
  },
  far: {
    carapaceWSeg: 10, carapaceHSeg: 6,
    legRadial: 3, pistonRadial: 3,
    footRadial: 4,
    mandibleRadial: 3,
    eyeDetail: 4, eyeStalkRadial: 3,
    barnacleCount: 0, spineCount: 0,
    ventralSeg: 4, ventralRadial: 3,
    useIKGait: false, usePistonAnim: false,
    useEyeTracking: false, useMandibleAnim: false,
  },
};

// ── Reusable vectors (zero per-frame allocs) ──

const _tmpVec = new THREE.Vector3();
const _tmpVec2 = new THREE.Vector3();
const _toPlayer = new THREE.Vector3();
const _tmpMatrix = new THREE.Matrix4();
const _tmpQuat = new THREE.Quaternion();
const _invWorldQuat = new THREE.Quaternion();
const _upVec = new THREE.Vector3(0, 1, 0);

// Biomechanical crab — hydraulic-piston legs, chitinous carapace, mandible articulation
export class BioMechCrab {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time = Math.random() * 100;
    this.speed = 1.2 + Math.random() * 0.8;
    this.direction = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    this.turnTimer = 0;
    this.turnInterval = 8 + Math.random() * 12;

    // Per-instance procedural variation
    this._instanceSeed = Math.random() * 1000;
    this._gaitPhaseOffset = Math.random() * TWO_PI;
    this._mandibleRate = 0.8 + Math.random() * 0.4;
    this._bodyScale = 1.5 + Math.random() * 1.5;

    // LOD state
    this._lodTier = 'near';
    this._lastLodTier = 'near';
    this._frameCounter = 0;

    // Animation state (pre-allocated, zero per-frame allocs)
    this._gaitPhase = 0;
    this._mandibleOpen = 0;
    this._mandibleTarget = 0;
    this._eyeTrackBlend = new THREE.Vector3();
    this._velocity = new THREE.Vector3();
    this._desiredDir = new THREE.Vector3().copy(this.direction);
    this._jointPulse = 0;
    this._baseY = position.y;

    this._buildModel();
    this.group.position.copy(position);
    this.group.scale.setScalar(this._bodyScale);
    scene.add(this.group);
  }

  // ── Materials ──

  _createShellMaterial(tierName) {
    const isNear = tierName === 'near';
    const normalMap = isNear ? _createCarapaceNormalTexture() : null;
    const roughnessMap = isNear ? _createCarapaceRoughnessTex() : null;
    const props = {
      color: 0x1a2430,
      roughness: 0.25,
      metalness: 0.15,
      clearcoat: isNear ? 0.7 : 0.3,
      clearcoatRoughness: 0.3,
      emissive: 0x0a1828,
      emissiveIntensity: 0.35,
    };
    if (normalMap) { props.normalMap = normalMap; props.normalScale = new THREE.Vector2(1.2, 1.2); }
    if (roughnessMap) props.roughnessMap = roughnessMap;

    const mat = new THREE.MeshPhysicalMaterial(props);

    // TSL: vertex shader carapace displacement (near tier only)
    if (isNear) {
      const uCrabTime = uniform(0.0);
      mat.userData.shaderUniforms = { uCrabTime };
      const disp = sin(positionLocal.x.mul(8.0).add(uCrabTime.mul(0.5))).mul(0.012)
        .add(sin(positionLocal.z.mul(6.0).add(uCrabTime.mul(0.3))).mul(0.008));
      mat.positionNode = positionLocal.add(normalLocal.mul(disp));
    }

    if (tierName === 'far') { const std = toStandardMaterial(mat); mat.dispose(); return std; }
    return mat;
  }

  _createMetalMaterial(tierName) {
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0x1c1c1c,
      roughness: 0.3,
      metalness: 0.72,
      clearcoat: tierName === 'near' ? 0.55 : 0.2,
      clearcoatRoughness: 0.35,
      emissive: 0x0c1828,
      emissiveIntensity: 0.2,
    });
    if (tierName === 'far') { const std = toStandardMaterial(mat); mat.dispose(); return std; }
    return mat;
  }

  _createJointMaterial(tierName) {
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0x2a2018,
      roughness: 0.25,
      metalness: 0.1,
      clearcoat: tierName === 'near' ? 0.8 : 0.3,
      emissive: 0x1a4878,
      emissiveIntensity: 0.6,
    });
    if (tierName === 'far') { const std = toStandardMaterial(mat); mat.dispose(); return std; }
    return mat;
  }

  _createEyeMaterial() {
    return new THREE.MeshPhysicalMaterial({
      color: 0xff2200,
      emissive: 0xff2200,
      emissiveIntensity: 2.5,
      clearcoat: 1.0,
      roughness: 0.0,
      metalness: 0.0,
    });
  }

  // ── Model builder ──

  _buildModel() {
    this.tiers = {
      near: this._buildTier('near'),
      medium: this._buildTier('medium'),
      far: this._buildTier('far'),
    };

    this.group.add(this.tiers.near.group);
    this.group.add(this.tiers.medium.group);
    this.group.add(this.tiers.far.group);
    this.tiers.medium.group.visible = false;
    this.tiers.far.group.visible = false;
  }

  _buildTier(tierName) {
    const profile = LOD_PROFILE[tierName];
    const g = new THREE.Group();
    const shellMat = this._createShellMaterial(tierName);
    const metalMat = this._createMetalMaterial(tierName);
    const jointMat = this._createJointMaterial(tierName);
    const eyeMat = this._createEyeMaterial();

    const tier = {
      group: g,
      shellMat,
      metalMat,
      jointMat,
      pistons: [],
      legGroups: [],
      legGroupSides: [],
      legGroupIndices: [],
      mandibles: [],
      eyeStalks: [],
      isNear: tierName === 'near',
      isMedium: tierName === 'medium',
      isFar: tierName === 'far',
    };

    // ═══ Carapace (high-poly 48×32 in near) ═══
    const carapaceGeo = new THREE.SphereGeometry(
      1.2, profile.carapaceWSeg, profile.carapaceHSeg
    );
    carapaceGeo.scale(1.6, 0.6, 1.2);
    const cp = carapaceGeo.attributes.position;
    for (let i = 0; i < cp.count; i++) {
      const x = cp.getX(i), y = cp.getY(i), z = cp.getZ(i);
      const rib = Math.sin(x * 5 + z * 4) * 0.05 + Math.sin(x * 12 + z * 8) * 0.02;
      cp.setY(i, y < 0 ? y * 0.3 : y + rib);
    }
    carapaceGeo.computeVertexNormals();
    g.add(new THREE.Mesh(carapaceGeo, shellMat));

    // ═══ Ventral underside plating ═══
    if (tierName !== 'far') {
      const ventGeo = new THREE.PlaneGeometry(
        2.8, 1.8, profile.ventralSeg, profile.ventralRadial
      );
      const vp = ventGeo.attributes.position;
      for (let i = 0; i < vp.count; i++) {
        const vx = vp.getX(i), vy = vp.getY(i);
        vp.setZ(i, Math.sin(vx * 4) * 0.03 + Math.sin(vy * 6) * 0.02);
      }
      ventGeo.computeVertexNormals();
      const ventMesh = new THREE.Mesh(ventGeo, metalMat);
      ventMesh.rotation.x = -HALF_PI;
      ventMesh.position.y = -0.16;
      g.add(ventMesh);
    }

    // ═══ Dorsal pipes ═══
    for (const side of [-1, 1]) {
      const pipeGeo = new THREE.CylinderGeometry(0.06, 0.06, 2.2, profile.legRadial);
      const pipe = new THREE.Mesh(pipeGeo, metalMat);
      pipe.position.set(0, 0.38, side * 0.5);
      pipe.rotation.z = HALF_PI;
      g.add(pipe);
    }

    // ═══ Exhaust vents ═══
    for (let i = 0; i < 3; i++) {
      const ventGeo = new THREE.CylinderGeometry(
        0.08, 0.12, 0.15, profile.legRadial, 1, true
      );
      const vent = new THREE.Mesh(ventGeo, metalMat);
      vent.position.set(-1.6, 0.12, (i - 1) * 0.3);
      vent.rotation.z = HALF_PI;
      g.add(vent);
    }

    // ═══ Hydraulic legs (8 total: 4 per side) ═══
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < 4; i++) {
        const legGroup = new THREE.Group();
        const angle = (i / 4) * Math.PI * 0.6 - 0.3;

        // Upper leg (femur)
        const upperGeo = new THREE.CylinderGeometry(0.09, 0.055, 1.4, profile.legRadial);
        const upper = new THREE.Mesh(upperGeo, metalMat);
        upper.position.y = -0.5;
        upper.rotation.z = side * 0.6;
        legGroup.add(upper);
        legGroup.userData.upper = upper;
        legGroup.userData.upperLen = 1.4;

        // Hydraulic piston housing & rod (only when pistons enabled)
        if (profile.usePistonAnim) {
          const pistonOuterGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.5, profile.pistonRadial);
          const pistonOuter = new THREE.Mesh(pistonOuterGeo, jointMat);
          pistonOuter.position.set(side * 0.3, -1, 0);
          legGroup.add(pistonOuter);

          const pistonInnerGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.35, profile.pistonRadial);
          const pistonInner = new THREE.Mesh(pistonInnerGeo, metalMat);
          pistonInner.position.set(side * 0.3, -1.25, 0);
          legGroup.add(pistonInner);
          tier.pistons.push(pistonInner);

          const collarGeo = new THREE.TorusGeometry(0.065, 0.02, 4, profile.pistonRadial);
          const collar = new THREE.Mesh(collarGeo, jointMat);
          collar.position.set(side * 0.3, -1, 0);
          collar.rotation.x = HALF_PI;
          legGroup.add(collar);
        }

        // Lower leg (tibia)
        const lowerGeo = new THREE.CylinderGeometry(0.055, 0.03, 1.3, profile.legRadial);
        const lower = new THREE.Mesh(lowerGeo, metalMat);
        lower.position.set(side * 0.5, -1.55, 0);
        lower.rotation.z = side * 1.2;
        legGroup.add(lower);
        legGroup.userData.lower = lower;
        legGroup.userData.lowerLen = 1.3;

        // Foot claw
        const footGeo = new THREE.ConeGeometry(0.045, 0.28, profile.footRadial);
        const foot = new THREE.Mesh(footGeo, shellMat);
        foot.position.set(side * 1.0, -2.05, 0);
        legGroup.add(foot);
        legGroup.userData.foot = foot;

        legGroup.position.set(Math.cos(angle) * 0.8, 0, side * (0.6 + i * 0.2));
        tier.legGroups.push(legGroup);
        tier.legGroupSides.push(side);
        tier.legGroupIndices.push(i);
        g.add(legGroup);
      }
    }

    // ═══ Eye stalks with tracking ═══
    for (const side of [-1, 1]) {
      const stalkGroup = new THREE.Group();
      const stalkGeo = new THREE.CylinderGeometry(0.04, 0.055, 0.55, profile.eyeStalkRadial);
      const stalk = new THREE.Mesh(stalkGeo, shellMat);
      stalk.position.y = 0.25;
      stalkGroup.add(stalk);

      const eyeGeo = new THREE.SphereGeometry(0.065, profile.eyeDetail, profile.eyeDetail);
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.y = 0.52;
      stalkGroup.add(eye);

      // Fresnel rim glow ring (near only)
      if (tierName === 'near') {
        const rimGeo = new THREE.TorusGeometry(0.07, 0.012, 6, 12);
        const rimMat = new THREE.MeshPhysicalMaterial({
          color: 0xff4400, emissive: 0xff4400, emissiveIntensity: 1.5,
          transparent: true, opacity: 0.7, roughness: 0.1,
        });
        const rim = new THREE.Mesh(rimGeo, rimMat);
        rim.position.y = 0.52;
        rim.rotation.x = HALF_PI;
        stalkGroup.add(rim);
      }

      stalkGroup.position.set(1.3, 0.15, side * 0.25);
      stalkGroup.rotation.z = -0.4;
      stalkGroup.userData.baseRotZ = -0.4;
      tier.eyeStalks.push(stalkGroup);
      g.add(stalkGroup);
    }

    // ═══ Mandibles / Pincers ═══
    for (const side of [-1, 1]) {
      const clawGroup = new THREE.Group();
      const armGeo = new THREE.CylinderGeometry(0.09, 0.065, 1.5, profile.mandibleRadial);
      const arm = new THREE.Mesh(armGeo, metalMat);
      arm.rotation.z = HALF_PI;
      clawGroup.add(arm);

      // Joint sphere at shoulder
      const jointGeo = new THREE.SphereGeometry(0.1, profile.mandibleRadial, profile.mandibleRadial);
      const joint = new THREE.Mesh(jointGeo, jointMat);
      joint.position.set(-0.75, 0, 0);
      clawGroup.add(joint);

      // Upper pincer
      const upperPinGeo = new THREE.BoxGeometry(0.65, 0.05, 0.16);
      const upperPin = new THREE.Mesh(upperPinGeo, shellMat);
      upperPin.position.set(0.9, 0.08, 0);
      clawGroup.add(upperPin);

      // Serrated teeth on upper (near only)
      if (tierName === 'near') {
        for (let t = 0; t < 5; t++) {
          const toothGeo = new THREE.ConeGeometry(0.015, 0.045, 3);
          const tooth = new THREE.Mesh(toothGeo, shellMat);
          tooth.position.set(0.66 + t * 0.08, 0.055, 0);
          tooth.rotation.z = Math.PI;
          clawGroup.add(tooth);
        }
      }

      // Lower pincer (articulated)
      const lowerPinGeo = new THREE.BoxGeometry(0.65, 0.05, 0.16);
      const lowerPin = new THREE.Mesh(lowerPinGeo, shellMat);
      lowerPin.position.set(0.9, -0.08, 0);
      clawGroup.add(lowerPin);

      clawGroup.position.set(1.45, -0.1, side * 1.0);
      clawGroup.rotation.y = side * -0.3;
      tier.mandibles.push({ group: clawGroup, upperPin, lowerPin, side });
      g.add(clawGroup);
    }

    // ═══ InstancedMesh barnacles ═══
    if (profile.barnacleCount > 0) {
      const barnGeo = _getBarnacleGeo();
      const barnMat = tierName === 'near'
        ? new THREE.MeshPhysicalMaterial({
            color: 0x3a3830, roughness: 0.8, metalness: 0.05,
            emissive: 0x0a0a08, emissiveIntensity: 0.2,
          })
        : new THREE.MeshStandardMaterial({
            color: 0x3a3830, roughness: 0.8, metalness: 0.05,
          });

      const barnInst = new THREE.InstancedMesh(barnGeo, barnMat, profile.barnacleCount);
      for (let b = 0; b < profile.barnacleCount; b++) {
        const theta = _hash(b, 0, this._instanceSeed) * TWO_PI;
        const phi = _hash(b, 1, this._instanceSeed) * Math.PI * 0.4;
        const r = 1.15 + _hash(b, 2, this._instanceSeed) * 0.15;
        const bx = Math.cos(theta) * Math.sin(phi) * r * 1.6;
        const by = Math.cos(phi) * r * 0.6 + 0.1;
        const bz = Math.sin(theta) * Math.sin(phi) * r * 1.2;
        const scale = 0.7 + _hash(b, 3, this._instanceSeed) * 0.8;
        _tmpMatrix.makeScale(scale, scale, scale);
        _tmpMatrix.setPosition(bx, by, bz);
        barnInst.setMatrixAt(b, _tmpMatrix);
      }
      barnInst.instanceMatrix.needsUpdate = true;
      barnInst.computeBoundingSphere();
      g.add(barnInst);
    }

    // ═══ InstancedMesh spines ═══
    if (profile.spineCount > 0) {
      const spnGeo = _getSpineGeo();
      const spnMat = tierName === 'near'
        ? new THREE.MeshPhysicalMaterial({
            color: 0x1a2830, roughness: 0.4, metalness: 0.35,
            emissive: 0x0a1418, emissiveIntensity: 0.3,
          })
        : new THREE.MeshStandardMaterial({
            color: 0x1a2830, roughness: 0.4, metalness: 0.35,
          });

      const spnInst = new THREE.InstancedMesh(spnGeo, spnMat, profile.spineCount);
      for (let s = 0; s < profile.spineCount; s++) {
        const theta = _hash(s, 10, this._instanceSeed) * TWO_PI;
        const phi = _hash(s, 11, this._instanceSeed) * Math.PI * 0.3;
        const r = 1.2 + _hash(s, 12, this._instanceSeed) * 0.1;
        const sx = Math.cos(theta) * Math.sin(phi) * r * 1.6;
        const sy = Math.cos(phi) * r * 0.6 + 0.15;
        const sz = Math.sin(theta) * Math.sin(phi) * r * 1.2;
        _tmpVec.set(sx, sy, sz).normalize();
        _tmpQuat.setFromUnitVectors(_upVec, _tmpVec);
        _tmpMatrix.makeRotationFromQuaternion(_tmpQuat);
        _tmpMatrix.setPosition(sx, sy, sz);
        spnInst.setMatrixAt(s, _tmpMatrix);
      }
      spnInst.instanceMatrix.needsUpdate = true;
      spnInst.computeBoundingSphere();
      g.add(spnInst);
    }

    return tier;
  }

  // ── LOD resolution with hysteresis ──

  _resolveLodTier(dist) {
    const h = 4;
    if (this._lastLodTier === 'near' && dist < LOD_NEAR_DISTANCE + h) return 'near';
    if (this._lastLodTier === 'medium' && dist > LOD_NEAR_DISTANCE - h && dist < LOD_MEDIUM_DISTANCE + h) return 'medium';
    if (this._lastLodTier === 'far' && dist > LOD_MEDIUM_DISTANCE - h) return 'far';
    if (dist < LOD_NEAR_DISTANCE) return 'near';
    if (dist < LOD_MEDIUM_DISTANCE) return 'medium';
    return 'far';
  }

  // ── IK tripod gait ──
  // Group A: left legs 0,3 + right legs 1,2
  // Group B: left legs 1,2 + right legs 0,3
  // Alternating groups produce a stable tripod walk

  _isGroupA(side, idx) {
    return side === -1 ? (idx === 0 || idx === 3) : (idx === 1 || idx === 2);
  }

  _animateLegsIK(tier, dt, speedFactor) {
    const phase = this._gaitPhase;
    const amplitude = 0.25 * speedFactor;
    const liftHeight = 0.15 * speedFactor;

    for (let l = 0; l < tier.legGroups.length; l++) {
      const leg = tier.legGroups[l];
      const side = tier.legGroupSides[l];
      const idx = tier.legGroupIndices[l];
      const isA = this._isGroupA(side, idx);
      const legPhase = phase + (isA ? 0 : Math.PI) + this._gaitPhaseOffset;
      const swing = Math.sin(legPhase);
      const lift = Math.max(0, Math.sin(legPhase)) * liftHeight;

      // 2-bone IK: compute target foot position, solve for upper/lower angles
      const upperLen = leg.userData.upperLen || 1.4;
      const lowerLen = leg.userData.lowerLen || 1.3;
      const upper = leg.userData.upper;
      const lower = leg.userData.lower;
      const foot = leg.userData.foot;

      // Target foot ground contact point (stride + lift)
      const strideX = swing * amplitude * side;
      const groundY = -upperLen - lowerLen + 0.1 + lift;

      // Distance from hip to target foot
      const dx = strideX;
      const dy = groundY;
      const dist2 = dx * dx + dy * dy;
      const dist = Math.sqrt(dist2);

      // Clamp reach to prevent impossible solutions
      const maxReach = upperLen + lowerLen - 0.05;
      const minReach = Math.abs(upperLen - lowerLen) + 0.05;
      const clampedDist = THREE.MathUtils.clamp(dist, minReach, maxReach);

      // Law of cosines for knee angle
      const cosKnee = (upperLen * upperLen + lowerLen * lowerLen - clampedDist * clampedDist) / (2 * upperLen * lowerLen);
      const kneeAngle = fastAcos(cosKnee);

      // Hip angle
      const cosHip = (upperLen * upperLen + clampedDist * clampedDist - lowerLen * lowerLen) / (2 * upperLen * clampedDist);
      const hipOffset = fastAcos(cosHip);
      const targetAngle = Math.atan2(dx, -dy);
      const hipAngle = targetAngle + hipOffset * side;

      // Apply to upper leg
      if (upper) {
        upper.rotation.z = side * 0.6 + hipAngle;
      }

      // Apply to lower leg
      if (lower) {
        lower.rotation.z = side * 1.2 + (Math.PI - kneeAngle) * side;
      }

      // Foot stays pointed down
      if (foot) {
        foot.position.y = -2.05 + lift;
        foot.position.x = side * 1.0 + strideX * 0.5;
      }

      leg.position.y = 0; // don't move entire group, IK handles positioning

      // Hydraulic piston extension during stance phase
      if (l < tier.pistons.length) {
        const extension = Math.max(0, -swing) * 0.12;
        tier.pistons[l].scale.y = 1.0 + extension;
        tier.pistons[l].position.y = -1.25 - extension * 0.06;
      }
    }
  }

  _animateLegsSimple(tier) {
    for (let l = 0; l < tier.legGroups.length; l++) {
      tier.legGroups[l].rotation.x = Math.sin(this.time * 4 + l * 0.8) * 0.12;
    }
  }

  // ── Mandible crushing animation ──

  _animateMandibles(tier, dt, proximity) {
    this._mandibleTarget = proximity > 0.5
      ? 0.18 + Math.sin(this.time * this._mandibleRate * 6) * 0.12
      : 0.04;
    this._mandibleOpen += (this._mandibleTarget - this._mandibleOpen) * (1 - Math.exp(-8 * dt));

    for (let m = 0; m < tier.mandibles.length; m++) {
      const md = tier.mandibles[m];
      md.upperPin.rotation.z = this._mandibleOpen * 0.5;
      md.lowerPin.rotation.z = -this._mandibleOpen * 0.5;
    }
  }

  // ── Eye stalk tracking ──

  _animateEyeTracking(tier, dt) {
    // Convert world-space player direction into crab local space
    _invWorldQuat.copy(this.group.quaternion).invert();
    const localTarget = _tmpVec.copy(_toPlayer).applyQuaternion(_invWorldQuat);

    const blendSpeed = 1 - Math.exp(-3 * dt);
    this._eyeTrackBlend.lerp(localTarget, blendSpeed);

    for (let e = 0; e < tier.eyeStalks.length; e++) {
      const stalk = tier.eyeStalks[e];
      const localDir = _tmpVec.copy(this._eyeTrackBlend).normalize();
      const pitch = Math.atan2(localDir.y, Math.sqrt(localDir.x * localDir.x + localDir.z * localDir.z));
      const yaw = Math.atan2(localDir.x, localDir.z);
      const baseZ = stalk.userData.baseRotZ || 0;

      stalk.rotation.x = THREE.MathUtils.clamp(
        -0.4 + pitch * 0.3 + Math.sin(this.time * 1.5 + e * 2) * 0.03,
        -0.8, 0.1
      );
      stalk.rotation.z = THREE.MathUtils.clamp(
        baseZ + yaw * 0.15 + Math.sin(this.time * 1.1 + e * 3) * 0.04,
        baseZ - 0.4, baseZ + 0.4
      );
    }
  }

  // ── Joint emissive pulse ──

  _updateJointEmissive(tier) {
    this._jointPulse = 0.6 + Math.sin(this.time * 2.2 + this._instanceSeed) * 0.4;
    if (tier.jointMat && tier.jointMat.emissiveIntensity !== undefined) {
      tier.jointMat.emissiveIntensity = 0.4 + this._jointPulse * 0.35;
    }
  }

  // ── Main update ──

  update(dt, playerPos) {
    this.time += dt;
    this._frameCounter++;
    this.turnTimer += dt;

    // Movement AI
    if (this.turnTimer > this.turnInterval) {
      this.turnTimer = 0;
      this.turnInterval = 8 + Math.random() * 12;
      if (Math.random() < 0.3) {
        this._desiredDir.subVectors(playerPos, this.group.position).normalize();
        this._desiredDir.y = 0;
      } else {
        this._desiredDir.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
      }
    }

    // Smooth heavy-crab direction blending
    const dirBlend = 1 - Math.exp(-1.5 * dt);
    this.direction.lerp(this._desiredDir, dirBlend).normalize();

    // Weight-appropriate slow acceleration
    const targetVel = _tmpVec2.copy(this.direction).multiplyScalar(this.speed);
    const accelBlend = 1 - Math.exp(-2.0 * dt);
    this._velocity.lerp(targetVel, accelBlend);
    this.group.position.addScaledVector(this._velocity, dt);

    // Gait phase linked to velocity
    const velMag = this._velocity.length();
    this._gaitPhase += dt * (4 + velMag * 2);

    // Face movement direction
    const targetAngle = Math.atan2(this.direction.x, this.direction.z);
    this.group.rotation.y = THREE.MathUtils.lerp(this.group.rotation.y, targetAngle, dt * 1.5);

    // Subtle body bob (relative to base Y to prevent drift)
    this.group.position.y = this._baseY + Math.sin(this._gaitPhase * 0.5) * 0.015 * velMag;

    // LOD resolution
    _toPlayer.subVectors(playerPos, this.group.position);
    const dist = _toPlayer.length();
    this._lodTier = this._resolveLodTier(dist);
    this._lastLodTier = this._lodTier;

    this.tiers.near.group.visible = this._lodTier === 'near';
    this.tiers.medium.group.visible = this._lodTier === 'medium';
    this.tiers.far.group.visible = this._lodTier === 'far';

    // Skip animation frames for far LOD
    const farStep = qualityManager.tier === 'ultra' ? 4 : 3;
    if (this._lodTier === 'far' && (this._frameCounter % farStep) !== 0) return;

    const proximity = THREE.MathUtils.clamp(1 - dist / 30, 0, 1);
    const tier = this.tiers[this._lodTier];
    const profile = LOD_PROFILE[this._lodTier];

    // Legs
    if (profile.useIKGait) {
      this._animateLegsIK(tier, dt, Math.max(0.3, velMag / this.speed));
    } else {
      this._animateLegsSimple(tier);
    }

    // Mandibles
    if (profile.useMandibleAnim) {
      this._animateMandibles(tier, dt, proximity);
    }

    // Eye tracking
    if (profile.useEyeTracking) {
      this._animateEyeTracking(tier, dt);
    }

    // Joint emissive
    this._updateJointEmissive(tier);

    // Carapace displacement shader (near only)
    if (tier.isNear && tier.shellMat?.userData?.shaderUniforms) {
      tier.shellMat.userData.shaderUniforms.uCrabTime.value = this.time;
    }

    // Respawn when too far
    if (dist > 200) {
      const a = Math.random() * TWO_PI;
      this.group.position.set(
        playerPos.x + Math.cos(a) * 70,
        playerPos.y,
        playerPos.z + Math.sin(a) * 70
      );
      this._baseY = playerPos.y;
    }
  }

  getPosition() { return this.group.position; }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(child => {
      if (child.geometry && child.geometry !== _barnacleGeo && child.geometry !== _spineGeo) {
        child.geometry.dispose();
      }
      if (child.material) {
        if (Array.isArray(child.material)) {
          for (const m of child.material) m.dispose();
        } else {
          child.material.dispose();
        }
      }
    });
    // Module-level shared textures & geometries (_carapaceNormalTex etc.) are NOT disposed here
  }
}
