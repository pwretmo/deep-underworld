import * as THREE from "three/webgpu";
import {
  LOD_NEAR_DISTANCE,
  toStandardMaterial,
} from "./lodUtils.js";
import { abs, dot, materialEmissive, normalLocal, normalView, positionLocal, positionView, pow, screenCoordinate, sin, sub, uniform, vec3 } from "three/tsl";
import { qualityManager } from "../QualityManager.js";

// -- Pre-allocated temps (zero per-frame allocations) -------------------------
const _v3A = new THREE.Vector3();
const _v3B = new THREE.Vector3();
const _v3C = new THREE.Vector3();
const _qA = new THREE.Quaternion();
const _qB = new THREE.Quaternion();
const _webControl = new THREE.Vector3();
const _webCenter = new THREE.Vector3();
const _webTangent = new THREE.Vector3();
const _webNormal = new THREE.Vector3();
const _webBinormal = new THREE.Vector3();
const _webRadial = new THREE.Vector3();
const _webPoint = new THREE.Vector3();
const _webTemp = new THREE.Vector3();

const TWO_PI = Math.PI * 2;
const RESPAWN_DISTANCE = 200;
const RESPAWN_DISTANCE_SQ = RESPAWN_DISTANCE * RESPAWN_DISTANCE;
const PROXIMITY_RANGE = 40;
const PROXIMITY_RANGE_SQ = PROXIMITY_RANGE * PROXIMITY_RANGE;
const WEB_TUBULAR_SEGMENTS = 8;
const WEB_RADIAL_SEGMENTS = 4;
const WEB_RADIUS = 0.016;
const WEB_OUTWARD_OFFSET = 0.18;
const WEB_UP = new THREE.Vector3(0, 1, 0);
const WEB_ALT_UP = new THREE.Vector3(1, 0, 0);
const LIMB_AIM_AXIS = new THREE.Vector3(0, 1, 0);
const SKULL_AIM_AXIS = new THREE.Vector3(0, 0, 1);

// -- Amalgam-specific LOD distances (abyss-zone fog far-plane ≈42m) -----------
const AMALGAM_MEDIUM_DIST = 30;
const AMALGAM_FAR_DIST = LOD_NEAR_DISTANCE; // 42m — fog occludes beyond this

// -- LOD tier profiles --------------------------------------------------------
const AMALGAM_LOD = {
  near: {
    coreSegs: [48, 32],
    skulls: 4,
    limbs: 8,
    claws: 6,
    ribs: 6,
    spineSegs: 14,
    organs: 3,
    webs: 4,
    hasShaderAnim: true,
    hasJawAnim: true,
    hasEyeTracking: true,
    hasMicroDetail: true,
    limbRadial: 12,
    clawSegs: 12,
  },
  medium: {
    coreSegs: [24, 16],
    skulls: 2,
    limbs: 4,
    claws: 3,
    ribs: 4,
    spineSegs: 8,
    organs: 1,
    webs: 0,
    hasShaderAnim: false,
    hasJawAnim: false,
    hasEyeTracking: false,
    hasMicroDetail: false,
    limbRadial: 8,
    clawSegs: 8,
  },
  far: {
    coreSegs: [6, 5], // ~48 triangles: lightweight silhouette beyond fog plane
    skulls: 0,
    limbs: 0,
    claws: 0,
    ribs: 0,
    spineSegs: 0,
    organs: 0,
    webs: 0,
    hasShaderAnim: false,
    hasJawAnim: false,
    hasEyeTracking: false,
    hasMicroDetail: false,
    limbRadial: 3,
    clawSegs: 3,
  },
};

// -- Module-level singleton textures ------------------------------------------
let _fleshNormalTex = null;
let _boneNormalTex = null;

function _createFleshNormalTexture() {
  if (_fleshNormalTex) return _fleshNormalTex;
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  const sampleHeight = (u, v) => {
    const fiber =
      Math.sin(u * 58 + v * 9) * 0.35 + Math.sin(u * 26 + v * 42) * 0.18;
    const vein = Math.sin(v * 48 + u * 4) * 0.22;
    return fiber + vein;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const u = x / size,
        v = y / size;
      const du = 1 / size,
        dv = 1 / size;
      const dx = sampleHeight(u + du, v) - sampleHeight(u - du, v);
      const dy = sampleHeight(u, v + dv) - sampleHeight(u, v - dv);
      const nx = -dx * 2.2,
        ny = -dy * 2.2,
        nz = 1.0;
      const nLen = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      data[idx] = Math.floor((nx * nLen * 0.5 + 0.5) * 255);
      data[idx + 1] = Math.floor((ny * nLen * 0.5 + 0.5) * 255);
      data[idx + 2] = Math.floor((nz * nLen * 0.5 + 0.5) * 255);
      data[idx + 3] = 255;
    }
  }
  _fleshNormalTex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  _fleshNormalTex.wrapS = _fleshNormalTex.wrapT = THREE.RepeatWrapping;
  _fleshNormalTex.needsUpdate = true;
  return _fleshNormalTex;
}

function _createBoneNormalTexture() {
  if (_boneNormalTex) return _boneNormalTex;
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  const sampleHeight = (u, v) => {
    const pore =
      Math.sin(u * 38 + v * 20) * 0.3 + Math.sin(u * 15 + v * 34) * 0.2;
    const ridge = Math.sin(v * 28 + u * 6) * 0.25;
    return pore + ridge;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const u = x / size,
        v = y / size;
      const du = 1 / size,
        dv = 1 / size;
      const dx = sampleHeight(u + du, v) - sampleHeight(u - du, v);
      const dy = sampleHeight(u, v + dv) - sampleHeight(u, v - dv);
      const nx = -dx * 2.0,
        ny = -dy * 2.0,
        nz = 1.0;
      const nLen = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      data[idx] = Math.floor((nx * nLen * 0.5 + 0.5) * 255);
      data[idx + 1] = Math.floor((ny * nLen * 0.5 + 0.5) * 255);
      data[idx + 2] = Math.floor((nz * nLen * 0.5 + 0.5) * 255);
      data[idx + 3] = 255;
    }
  }
  _boneNormalTex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  _boneNormalTex.wrapS = _boneNormalTex.wrapT = THREE.RepeatWrapping;
  _boneNormalTex.needsUpdate = true;
  return _boneNormalTex;
}

function _computeWebArchMidpoint(target, start, end) {
  target.addVectors(start, end).multiplyScalar(0.5);
  const len = target.length();
  if (len > 1e-5) {
    target.multiplyScalar((len + WEB_OUTWARD_OFFSET) / len);
  } else {
    target.set(0, WEB_OUTWARD_OFFSET, 0);
  }
  return target;
}

function _computeQuadraticControlPoint(target, start, mid, end) {
  return target
    .copy(mid)
    .multiplyScalar(2)
    .sub(_webTemp.addVectors(start, end).multiplyScalar(0.5));
}

function _setQuadraticPoint(target, start, control, end, t) {
  const oneMinusT = 1 - t;
  return target
    .copy(start)
    .multiplyScalar(oneMinusT * oneMinusT)
    .addScaledVector(control, 2 * oneMinusT * t)
    .addScaledVector(end, t * t);
}

function _setQuadraticTangent(target, start, control, end, t) {
  target.subVectors(control, start).multiplyScalar(2 * (1 - t));
  target.addScaledVector(_webTemp.subVectors(end, control), 2 * t);
  if (target.lengthSq() < 1e-6) {
    target.set(0, 1, 0);
  }
  return target.normalize();
}

function _updateWebGeometry(
  geometry,
  start,
  mid,
  end,
  radius,
  tubularSegments,
  radialSegments,
) {
  const positionAttr = geometry.attributes.position;
  const normalAttr = geometry.attributes.normal;
  const positions = positionAttr.array;
  const normals = normalAttr.array;
  let writeIndex = 0;

  _computeQuadraticControlPoint(_webControl, start, mid, end);

  for (let ring = 0; ring <= tubularSegments; ring++) {
    const t = ring / tubularSegments;
    _setQuadraticPoint(_webCenter, start, _webControl, end, t);
    _setQuadraticTangent(_webTangent, start, _webControl, end, t);

    const referenceAxis =
      Math.abs(_webTangent.dot(WEB_UP)) > 0.98 ? WEB_ALT_UP : WEB_UP;
    _webBinormal.crossVectors(_webTangent, referenceAxis);
    if (_webBinormal.lengthSq() < 1e-6) {
      _webBinormal.crossVectors(_webTangent, WEB_ALT_UP);
    }
    _webBinormal.normalize();
    _webNormal.crossVectors(_webBinormal, _webTangent).normalize();

    for (let side = 0; side <= radialSegments; side++) {
      const angle = (side / radialSegments) * TWO_PI;
      _webRadial
        .copy(_webNormal)
        .multiplyScalar(Math.cos(angle))
        .addScaledVector(_webBinormal, Math.sin(angle));
      _webPoint.copy(_webCenter).addScaledVector(_webRadial, radius);

      positions[writeIndex] = _webPoint.x;
      normals[writeIndex++] = _webRadial.x;
      positions[writeIndex] = _webPoint.y;
      normals[writeIndex++] = _webRadial.y;
      positions[writeIndex] = _webPoint.z;
      normals[writeIndex++] = _webRadial.z;
    }
  }

  positionAttr.needsUpdate = true;
  normalAttr.needsUpdate = true;
}

function _createWebGeometry(start, mid, end) {
  const control = _computeQuadraticControlPoint(
    new THREE.Vector3(),
    start,
    mid,
    end,
  );
  const geometry = new THREE.TubeGeometry(
    new THREE.QuadraticBezierCurve3(start.clone(), control, end.clone()),
    WEB_TUBULAR_SEGMENTS,
    WEB_RADIUS,
    WEB_RADIAL_SEGMENTS,
    false,
  );
  geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
  geometry.attributes.normal.setUsage(THREE.DynamicDrawUsage);
  _updateWebGeometry(
    geometry,
    start,
    mid,
    end,
    WEB_RADIUS,
    WEB_TUBULAR_SEGMENTS,
    WEB_RADIAL_SEGMENTS,
  );
  geometry.computeBoundingSphere();
  return geometry;
}

// -- Vertex shader: core organic pulsation (near LOD only) --------------------
function _applyCoreShader(material, uniformsOut) {
  const shaderUniforms = {
    uTime: uniform(0),
    uPulse: uniform(0),
    uProximity: uniform(0),
  };
  uniformsOut.core = shaderUniforms;

  // TSL: vertex pulsation displacement
  const dist = positionLocal.length();
  const wave = sin(dist.mul(6.0).sub(shaderUniforms.uTime.mul(3.0))).mul(0.08).mul(shaderUniforms.uPulse);
  const breathe = sin(shaderUniforms.uTime.mul(1.2).add(dist.mul(2.0))).mul(0.03);
  const react = sin(shaderUniforms.uTime.mul(8.0).add(positionLocal.y.mul(5.0))).mul(0.04).mul(shaderUniforms.uProximity);
  material.positionNode = positionLocal.add(normalLocal.mul(wave.add(breathe).add(react)));

  // TSL: fragment Fresnel rim + organ pulse
  const viewDir = positionView.negate().normalize();
  const rim = pow(sub(1.0, abs(dot(normalView, viewDir))), 2.5);
  const organPulse = sin(shaderUniforms.uTime.mul(2.5).add(screenCoordinate.x.mul(0.02)).add(screenCoordinate.y.mul(0.015))).mul(0.5).add(0.5);
  material.emissiveNode = materialEmissive
    .add(vec3(0.18, 0.06, 0.12).mul(rim).mul(shaderUniforms.uProximity.mul(0.5).add(0.6)))
    .add(vec3(0.12, 0.02, 0.06).mul(organPulse).mul(shaderUniforms.uPulse));

  material.needsUpdate = true;
}

// -- Vertex shader: limb twitch (near LOD only) -------------------------------
function _applyLimbShader(material, uniformsOut, limbIdx) {
  const shaderUniforms = {
    uTime: uniform(0),
    uTwitch: uniform(0),
  };
  if (!uniformsOut.limbs) uniformsOut.limbs = [];
  uniformsOut.limbs[limbIdx] = shaderUniforms;

  // TSL: vertex limb twitch
  const muscleWave = sin(positionLocal.y.mul(8.0).add(shaderUniforms.uTime.mul(4.0))).mul(0.015).mul(shaderUniforms.uTwitch);
  const zTwitch = sin(positionLocal.y.mul(6.0).add(shaderUniforms.uTime.mul(3.0)).add(1.5)).mul(0.01).mul(shaderUniforms.uTwitch);
  material.positionNode = vec3(
    positionLocal.x.add(muscleWave),
    positionLocal.y,
    positionLocal.z.add(zTwitch)
  );

  material.needsUpdate = true;
}

// =============================================================================
//  Amalgam -- Fused mass of multiple creature bodies merged together
// =============================================================================
export class Amalgam {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time = Math.random() * 100;
    this.speed = 0.3 + Math.random() * 0.2;
    this.direction = new THREE.Vector3(
      Math.random() - 0.5,
      -0.05,
      Math.random() - 0.5,
    ).normalize();

    // Pre-allocated animation state
    this._breathPhase = Math.random() * TWO_PI;
    this._twitchTimers = [];
    this._twitchNext = [];
    this._jawAngles = [];
    this._jawTargets = [];
    this._spineWhipPhase = 0;
    this._spineWhipActive = false;
    this._spineWhipDecay = 0;
    this._proximityFactor = 0;
    this._ribBreathPhase = 0;
    this._shaderUniforms = {};
    this._frameCount = 0;

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  _buildModel() {
    this.tiers = {};
    const lod = new THREE.LOD();
    for (const [tierName, profile] of Object.entries(AMALGAM_LOD)) {
      const tier = this._buildTier(profile, tierName);
      this.tiers[tierName] = tier;
      const dist =
        tierName === "near"
          ? 0
          : tierName === "medium"
            ? AMALGAM_MEDIUM_DIST
            : AMALGAM_FAR_DIST;
      lod.addLevel(tier.group, dist);
    }
    this.lod = lod;
    this.group.add(lod);

    const s = 2 + Math.random() * 2;
    this._baseScale = s;
    this.group.scale.setScalar(s);
  }

  _getVisibleTierName() {
    const levels = this.lod.levels;
    for (let i = levels.length - 1; i >= 0; i--) {
      if (levels[i].object.visible) {
        if (levels[i].distance === 0) return "near";
        if (levels[i].distance === AMALGAM_MEDIUM_DIST) return "medium";
        return "far";
      }
    }
    return "far";
  }

  _buildTier(profile, tierName) {
    const tierGroup = new THREE.Group();
    const isNear = tierName === "near";
    const isFar = tierName === "far";

    const fleshNormal = isNear ? _createFleshNormalTexture() : null;
    const boneNormal = isNear ? _createBoneNormalTexture() : null;

    // -- Materials ------------------------------------------------------------
    let fleshMat = new THREE.MeshPhysicalMaterial({
      color: 0x201018,
      roughness: isNear ? 0.2 : 0.3,
      metalness: 0,
      clearcoat: isNear ? 0.9 : 0.5,
      clearcoatRoughness: 0.15,
      emissive: 0x502040,
      emissiveIntensity: isFar ? 0 : 0.7,
      normalMap: fleshNormal,
      ...(isNear && { normalScale: new THREE.Vector2(0.6, 0.6) }),
      transmission: isNear ? 0.15 : 0,
      thickness: isNear ? 0.8 : 0,
    });

    let metalMat = new THREE.MeshPhysicalMaterial({
      color: 0x0a0a0a,
      roughness: 0.12,
      metalness: 0.85,
      clearcoat: isNear ? 1.0 : 0.5,
      emissive: 0x203858,
      emissiveIntensity: isFar ? 0 : 0.3,
    });

    let boneMat = new THREE.MeshPhysicalMaterial({
      color: 0x3a3228,
      roughness: isNear ? 0.2 : 0.3,
      metalness: 0,
      clearcoat: isNear ? 0.8 : 0.4,
      emissive: 0x504030,
      emissiveIntensity: isFar ? 0 : 0.5,
      normalMap: boneNormal,
      ...(isNear && { normalScale: new THREE.Vector2(0.5, 0.5) }),
    });

    let organMat = new THREE.MeshPhysicalMaterial({
      color: 0x401020,
      roughness: 0.15,
      metalness: 0,
      clearcoat: 1.0,
      emissive: 0x801040,
      emissiveIntensity: 1.2,
      transmission: isNear ? 0.3 : 0,
      thickness: isNear ? 0.5 : 0,
      transparent: true,
      opacity: 0.85,
    });

    let eyeMat = new THREE.MeshPhysicalMaterial({
      color: 0xffcc00,
      emissive: 0xffaa00,
      emissiveIntensity: isNear ? 2.5 : 1.5,
      roughness: 0,
      clearcoat: 1.0,
    });

    if (isFar) {
      const origFlesh = fleshMat;
      fleshMat = toStandardMaterial(fleshMat);
      origFlesh.dispose();
      const origMetal = metalMat;
      metalMat = toStandardMaterial(metalMat);
      origMetal.dispose();
      const origBone = boneMat;
      boneMat = toStandardMaterial(boneMat);
      origBone.dispose();
      const origOrgan = organMat;
      organMat = toStandardMaterial(organMat);
      origOrgan.dispose();
      const origEye = eyeMat;
      eyeMat = toStandardMaterial(eyeMat);
      origEye.dispose();
    }

    // -- Core mass (48x32 min at near) ----------------------------------------
    const coreGeo = new THREE.SphereGeometry(
      1.0,
      profile.coreSegs[0],
      profile.coreSegs[1],
    );
    const cp = coreGeo.attributes.position;
    for (let i = 0; i < cp.count; i++) {
      const x = cp.getX(i),
        y = cp.getY(i),
        z = cp.getZ(i);
      // Multi-octave noise displacement
      const n1 = Math.sin(x * 3.2 + y * 4.1) * 0.2;
      const n2 = Math.cos(z * 5.3 + x * 2.7) * 0.15;
      const n3 = Math.sin(x * 7.8 + z * 6.2 + y * 3.5) * 0.08;
      const n4 = Math.cos(y * 11.3 + x * 9.1 + z * 7.7) * 0.05;
      const n = 1 + n1 + n2 + n3 + n4;
      cp.setX(i, x * n);
      cp.setY(i, y * n);
      cp.setZ(i, z * n);
    }
    coreGeo.computeVertexNormals();
    const coreMesh = new THREE.Mesh(coreGeo, fleshMat.clone());
    coreMesh.userData.baseScale = 1;
    if (coreMesh.material && coreMesh.material.emissiveIntensity !== undefined) {
      if (isFar) {
        coreMesh.material.emissiveIntensity = 0.9;
      }
      coreMesh.userData.baseEmissiveIntensity =
        coreMesh.material.emissiveIntensity;
    }

    if (isNear) {
      _applyCoreShader(coreMesh.material, this._shaderUniforms);
      coreMesh.material.normalMap = fleshNormal;
      coreMesh.material.normalScale = new THREE.Vector2(0.6, 0.6);
    }
    tierGroup.add(coreMesh);

    // -- Skulls with cranial detail and jaw articulation -----------------------
    const skulls = [];
    const skullJaws = [];
    const skullEyes = [];
    const skullAnchors = this._distributeOnSphere(profile.skulls, 1.15);

    for (let si = 0; si < profile.skulls; si++) {
      const skullGroup = new THREE.Group();
      skullGroup.userData.eyes = [];
      const r = 0.28 + Math.random() * 0.08;
      const skullGeo = new THREE.SphereGeometry(
        r,
        isNear ? 24 : isFar ? 6 : 12,
        isNear ? 16 : isFar ? 4 : 8,
      );

      // Cranial detail: flatten bottom, elongate, eye sockets
      const spos = skullGeo.attributes.position;
      for (let vi = 0; vi < spos.count; vi++) {
        let sx = spos.getX(vi),
          sy = spos.getY(vi),
          sz = spos.getZ(vi);
        if (isNear) {
          const eyeL = Math.exp(
            -((sx - 0.08) ** 2 + (sy - 0.06) ** 2 + (sz - r * 0.8) ** 2) * 60,
          );
          const eyeR = Math.exp(
            -((sx + 0.08) ** 2 + (sy - 0.06) ** 2 + (sz - r * 0.8) ** 2) * 60,
          );
          const indent = (eyeL + eyeR) * 0.04;
          sz -= indent;
          const browMask = Math.exp(-((sy - 0.1) ** 2) * 40) * Math.max(0, sz);
          sy += browMask * 0.02;
        }
        spos.setX(vi, sx * 1.15);
        spos.setY(vi, sy * 0.85);
        spos.setZ(vi, sz);
      }
      skullGeo.computeVertexNormals();

      const skull = new THREE.Mesh(skullGeo, boneMat);
      skullGroup.add(skull);

      // Jaw (lower half-sphere, hinged)
      let jaw;
      if (profile.hasJawAnim || !isFar) {
        const jawGeo = new THREE.SphereGeometry(
          r * 0.75,
          isNear ? 16 : 8,
          isNear ? 8 : 4,
          0,
          TWO_PI,
          Math.PI * 0.5,
          Math.PI * 0.5,
        );
        jawGeo.scale(1.1, 0.6, 0.8);
        jaw = new THREE.Mesh(jawGeo, boneMat);
        jaw.position.set(0, -r * 0.15, r * 0.2);
        skullGroup.add(jaw);
        skullJaws.push(jaw);
        this._jawAngles.push(0);
        this._jawTargets.push(0);
      }

      // Eye sockets with glow
      if (!isFar) {
        for (const side of [-1, 1]) {
          const eyeGeo = new THREE.SphereGeometry(
            0.04,
            isNear ? 10 : 6,
            isNear ? 10 : 6,
          );
          const eye = new THREE.Mesh(eyeGeo, eyeMat);
          eye.position.set(side * 0.08, 0.06, r * 0.85);
          eye.userData.basePosition = eye.position.clone();
          eye.userData.idlePhase = Math.random() * TWO_PI;
          skullGroup.add(eye);
          skullGroup.userData.eyes.push(eye);
          skullEyes.push(eye);
        }
      }

      const anchor = skullAnchors[si];
      skullGroup.position.copy(anchor);
      skullGroup.lookAt(0, 0, 0);
      skullGroup.userData.baseQuaternion = skullGroup.quaternion.clone();
      skulls.push(skullGroup);
      tierGroup.add(skullGroup);
    }

    // -- Limbs with muscle fiber surface --------------------------------------
    const limbs = [];
    const limbAnchors = this._distributeOnSphere(profile.limbs, 1.1);

    for (let li = 0; li < profile.limbs; li++) {
      const limbGroup = new THREE.Group();
      const len = 0.6 + Math.random() * 1.8;
      const limbGeo = new THREE.CylinderGeometry(
        0.08,
        0.04,
        len,
        profile.limbRadial,
        isNear ? 8 : isFar ? 1 : 4,
      );

      // Muscle fiber surface detail
      if (isNear) {
        const lp = limbGeo.attributes.position;
        for (let vi = 0; vi < lp.count; vi++) {
          const lx = lp.getX(vi),
            ly = lp.getY(vi),
            lz = lp.getZ(vi);
          const fiber = Math.sin(ly * 16 + lx * 24) * 0.003;
          const twist = Math.sin(ly * 8) * 0.005;
          lp.setX(vi, lx + fiber + twist);
          lp.setZ(vi, lz + Math.cos(ly * 14 + lz * 20) * 0.003);
        }
        limbGeo.computeVertexNormals();
      }

      const limbMat = li % 2 === 0 ? metalMat.clone() : fleshMat.clone();
      if (isNear) {
        _applyLimbShader(limbMat, this._shaderUniforms, li);
        if (li % 2 !== 0 && fleshNormal) {
          limbMat.normalMap = fleshNormal;
          limbMat.normalScale = new THREE.Vector2(0.6, 0.6);
        }
      }
      const limbMesh = new THREE.Mesh(limbGeo, limbMat);
      limbGroup.add(limbMesh);

      // Joint knob
      if (Math.random() > 0.3) {
        const knob = new THREE.Mesh(
          new THREE.SphereGeometry(0.07, isNear ? 10 : 6, isNear ? 10 : 6),
          boneMat,
        );
        knob.position.y = -len * 0.5;
        limbGroup.add(knob);
      }

      const anchor = limbAnchors[li];
      limbGroup.position.copy(anchor);
      limbGroup.lookAt(0, 0, 0);
      limbGroup.userData.baseQuaternion = limbGroup.quaternion.clone();
      limbs.push(limbGroup);
      tierGroup.add(limbGroup);

      this._twitchTimers.push(0);
      this._twitchNext.push(2 + Math.random() * 5);
    }

    // -- Claws with bone detail -----------------------------------------------
    const claws = [];
    for (let ci = 0; ci < profile.claws; ci++) {
      const clawGeo = new THREE.ConeGeometry(
        0.035,
        0.4 + Math.random() * 0.2,
        profile.clawSegs,
        isNear ? 4 : 2,
      );
      if (isNear) {
        const clp = clawGeo.attributes.position;
        for (let vi = 0; vi < clp.count; vi++) {
          const cy = clp.getY(vi);
          const cz = clp.getZ(vi);
          clp.setZ(vi, cz + Math.sin(cy * 30) * 0.003);
        }
        clawGeo.computeVertexNormals();
      }

      const claw = new THREE.Mesh(clawGeo, boneMat);
      if (ci < limbs.length) {
        claw.position.set(0, -0.3 - Math.random() * 0.2, 0);
        claw.rotation.x = Math.random() * 0.3 - 0.15;
        limbs[ci].add(claw);
      } else {
        const phi = Math.random() * TWO_PI;
        const theta = Math.random() * Math.PI;
        claw.position.set(
          Math.sin(theta) * Math.cos(phi) * 1.35,
          Math.sin(theta) * Math.sin(phi) * 1.35,
          Math.cos(theta) * 1.35,
        );
        claw.lookAt(0, 0, 0);
        tierGroup.add(claw);
      }
      claw.userData.clawTimer = 0;
      claw.userData.clawNext = 3 + Math.random() * 5;
      claw.userData.clawBase = claw.rotation.x;
      claw.userData.clawTarget = claw.rotation.x;
      claws.push(claw);
    }

    // -- Rib cage with breathing ----------------------------------------------
    const ribs = [];
    for (let ri = 0; ri < profile.ribs; ri++) {
      const ribGeo = new THREE.TorusGeometry(0.3, 0.02, 8, 16);
      const rib = new THREE.Mesh(ribGeo, boneMat);
      const yOff = -0.4 + ri * 0.15;
      rib.position.set(0, yOff, 0);
      rib.rotation.x = Math.PI * 0.5 + (Math.random() - 0.5) * 0.2;
      rib.rotation.y = (Math.random() - 0.5) * 0.15;
      rib.userData.baseScale = 0.7;
      rib.userData.breathRandom = Math.random() * 0.3;
      rib.scale.setScalar(rib.userData.baseScale + rib.userData.breathRandom);
      ribs.push(rib);
      tierGroup.add(rib);
    }

    // -- Spinal tail with vertebral process detail ----------------------------
    const spineSegments = [];
    for (let spi = 0; spi < profile.spineSegs; spi++) {
      const t = spi / Math.max(1, profile.spineSegs - 1);
      const r = 0.06 * (1 - t * 0.6);
      const segGeo = new THREE.SphereGeometry(
        r,
        isNear ? 16 : isFar ? 4 : 8,
        isNear ? 12 : isFar ? 3 : 6,
      );

      // Vertebral process spikes at near
      if (isNear) {
        const vp = segGeo.attributes.position;
        for (let vi = 0; vi < vp.count; vi++) {
          const vy = vp.getY(vi);
          if (vy > r * 0.4) {
            vp.setY(vi, vy * 1.4);
          }
        }
        segGeo.computeVertexNormals();
      }

      const seg = new THREE.Mesh(segGeo, boneMat);
      seg.position.set(0, -0.8 - spi * 0.14, 0);
      spineSegments.push(seg);
      tierGroup.add(seg);
    }

    // -- Connective tissue webs (TubeGeometry spanning adjacent limb pairs) ----
    const webs = [];
    if (profile.webs > 0) {
      const webMat = new THREE.MeshPhysicalMaterial({
        color: 0x301020,
        roughness: 0.4,
        metalness: 0,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        emissive: 0x200810,
        emissiveIntensity: 0.4,
      });
      for (let wi = 0; wi < profile.webs; wi++) {
        const limbAIdx = (wi * 2) % Math.max(1, limbs.length);
        const limbBIdx = Math.min(wi * 2 + 1, limbs.length - 1);
        const limbA = limbs[limbAIdx];
        const limbB = limbs[limbBIdx];
        const pA = limbA.position;
        const pB = limbB.position;
        const midPt = _computeWebArchMidpoint(new THREE.Vector3(), pA, pB);
        const webGeo = _createWebGeometry(pA, midPt, pB);
        const web = new THREE.Mesh(webGeo, webMat);
        web.userData.limbA = limbA;
        web.userData.limbB = limbB;
        web.userData.tubeSegs = WEB_TUBULAR_SEGMENTS;
        web.userData.tubeRadius = WEB_RADIUS;
        web.userData.tubeSides = WEB_RADIAL_SEGMENTS;
        webs.push(web);
        tierGroup.add(web);
      }
    }

    // -- Exposed organ lumps --------------------------------------------------
    const organs = [];
    for (let oi = 0; oi < profile.organs; oi++) {
      const orgSize = 0.12 + Math.random() * 0.1;
      const orgGeo = new THREE.SphereGeometry(
        orgSize,
        isNear ? 16 : 8,
        isNear ? 12 : 6,
      );
      const orgP = orgGeo.attributes.position;
      for (let vi = 0; vi < orgP.count; vi++) {
        const ox = orgP.getX(vi),
          oy = orgP.getY(vi),
          oz = orgP.getZ(vi);
        const bump =
          Math.sin(ox * 12 + oy * 10) * 0.01 + Math.cos(oz * 14) * 0.01;
        orgP.setX(vi, ox + bump);
        orgP.setY(vi, oy + bump * 0.5);
      }
      orgGeo.computeVertexNormals();
      const organ = new THREE.Mesh(orgGeo, organMat);
      const phi = Math.random() * TWO_PI;
      const theta = Math.random() * Math.PI;
      const rad = 0.85 + Math.random() * 0.25;
      organ.position.set(
        Math.sin(theta) * Math.cos(phi) * rad,
        Math.sin(theta) * Math.sin(phi) * rad,
        Math.cos(theta) * rad,
      );
      organ.userData.basePos = organ.position.clone();
      organs.push(organ);
      tierGroup.add(organ);
    }

    // Dispose base materials used only for .clone() calls — not assigned to any mesh
    fleshMat.dispose();
    metalMat.dispose();

    return {
      group: tierGroup,
      limbs,
      skulls,
      skullJaws,
      skullEyes,
      claws,
      ribs,
      spineSegments,
      webs,
      organs,
      coreMesh,
      isNear,
      isFar,
    };
  }

  _distributeOnSphere(count, radius) {
    const points = [];
    for (let i = 0; i < count; i++) {
      const y = 1 - (i / Math.max(1, count - 1)) * 2;
      const radiusAtY = Math.sqrt(1 - y * y);
      const theta = i * 2.399963; // golden angle
      points.push(
        new THREE.Vector3(
          Math.cos(theta) * radiusAtY * radius,
          y * radius,
          Math.sin(theta) * radiusAtY * radius,
        ),
      );
    }
    return points;
  }

  update(dt, playerPos, distSq) {
    this.time += dt;
    this._frameCount++;
    const tier = this._getVisibleTierName();

    // -- Movement: slow agonized drift ----------------------------------------
    _v3A.copy(this.direction).multiplyScalar(this.speed * dt);
    this.group.position.add(_v3A);
    this.group.position.y += Math.sin(this.time * 0.2) * 0.08 * dt;

    // Slow tumbling rotation
    this.group.rotation.x += dt * 0.02;
    this.group.rotation.z += dt * 0.015;

    // Breathing phase drives near-tier deformation and medium/far glow timing.
    this._breathPhase += dt * 1.2;

    // Player proximity factor — uses squared distance to avoid sqrt
    const targetProx = distSq < PROXIMITY_RANGE_SQ
      ? THREE.MathUtils.clamp(1 - Math.sqrt(distSq) / PROXIMITY_RANGE, 0, 1)
      : 0;
    this._proximityFactor +=
      (targetProx - this._proximityFactor) * Math.min(1, dt * 2);

    // -- Spinal tail whip on threat -------------------------------------------
    if (this._proximityFactor > 0.5 && !this._spineWhipActive) {
      this._spineWhipActive = true;
      this._spineWhipPhase = 0;
      this._spineWhipDecay = 1;
    }
    if (this._spineWhipActive) {
      this._spineWhipPhase += dt * 8;
      this._spineWhipDecay = Math.max(0, this._spineWhipDecay - dt * 2);
      if (this._spineWhipDecay < 0.01) {
        this._spineWhipActive = false;
        this._spineWhipDecay = 0;
      }
    }

    // -- Per-tier animation ---------------------------------------------------
    const nearTier = this.tiers.near;
    const medTier = this.tiers.medium;
    const farTier = this.tiers.far;

    // Near-tier shader uniform updates
    if (tier === "near" && this._shaderUniforms.core) {
      this._shaderUniforms.core.uTime.value = this.time;
      this._shaderUniforms.core.uPulse.value =
        0.5 + Math.sin(this.time * 1.5) * 0.5;
      this._shaderUniforms.core.uProximity.value = this._proximityFactor;
    }

    const breathWave = Math.sin(this._breathPhase);
    if (tier === "near") {
      this.group.scale.setScalar(this._baseScale * (1 + breathWave * 0.02));
    } else {
      this.group.scale.setScalar(this._baseScale);
    }

    if (tier === "near") {
      this.group.updateMatrixWorld(true);
      _v3A.copy(playerPos);
      this.group.worldToLocal(_v3A);
    }

    if (medTier.coreMesh) {
      const mediumPulse = tier === "medium" ? Math.sin(this.time * 1.4) : 0;
      medTier.coreMesh.scale.setScalar(1 + mediumPulse * 0.035);
      if (
        medTier.coreMesh.material &&
        medTier.coreMesh.material.emissiveIntensity !== undefined
      ) {
        medTier.coreMesh.material.emissiveIntensity =
          medTier.coreMesh.userData.baseEmissiveIntensity +
          (tier === "medium" ? 0.12 + mediumPulse * 0.08 : 0);
      }
    }
    if (farTier.coreMesh?.material?.emissiveIntensity !== undefined) {
      const farGlowStep = qualityManager.tier === "ultra" ? 4 : 1;
      const shouldUpdateFarGlow =
        tier !== "far" ||
        farGlowStep === 1 ||
        this._frameCount % farGlowStep === 0;

      if (shouldUpdateFarGlow) {
        const farGlow = tier === "far" ? Math.sin(this.time * 1.8) * 0.18 : 0;
        farTier.coreMesh.material.emissiveIntensity =
          farTier.coreMesh.userData.baseEmissiveIntensity + farGlow;
      }
      farTier.coreMesh.scale.setScalar(1);
    }

    // Limb animation — gate to visible tier only
    if (tier === "near") {
      this._animateLimbs(dt, nearTier, _v3A, true);
    } else if (tier === "medium") {
      this._animateLimbsBasic(dt, medTier);
    }

    if (tier === "near" && nearTier.skulls.length > 0) {
      this._animateSkullsAndEyes(nearTier, _v3A);
    }

    // Skull jaw articulation (near only)
    if (tier === "near" && nearTier.skullJaws.length > 0) {
      for (let i = 0; i < nearTier.skullJaws.length; i++) {
        if (Math.random() < dt * 0.3) {
          this._jawTargets[i] = Math.random() * 0.35;
        }
        if (Math.random() < dt * 0.15) {
          this._jawTargets[i] = 0;
        }
        this._jawAngles[i] +=
          (this._jawTargets[i] - this._jawAngles[i]) * Math.min(1, dt * 3);
        nearTier.skullJaws[i].rotation.x = this._jawAngles[i];
      }
    }

    // Claw grasping articulation (near only)
    if (tier === "near" && nearTier.claws.length > 0) {
      for (let i = 0; i < nearTier.claws.length; i++) {
        const claw = nearTier.claws[i];
        claw.userData.clawTimer += dt;
        if (claw.userData.clawTimer >= claw.userData.clawNext) {
          claw.userData.clawTimer = 0;
          claw.userData.clawNext = 2 + Math.random() * 5;
          const isOpen = claw.rotation.x > claw.userData.clawBase + 0.1;
          claw.userData.clawTarget = isOpen
            ? claw.userData.clawBase
            : claw.userData.clawBase + 0.5;
        }
        claw.rotation.x +=
          (claw.userData.clawTarget - claw.rotation.x) * Math.min(1, dt * 4);
      }
    }

    // Rib cage breathing (near+medium)
    if (tier !== "far") {
      this._ribBreathPhase += dt * 1.0;
      const activeTier = tier === "near" ? nearTier : medTier;
      for (let i = 0; i < activeTier.ribs.length; i++) {
        const rib = activeTier.ribs[i];
        const ribBreath = Math.sin(this._ribBreathPhase + i * 0.4) * 0.04;
        rib.scale.setScalar(
          rib.userData.baseScale + rib.userData.breathRandom + ribBreath,
        );
      }
    }

    // Spinal tail animation
    if (tier === "near") {
      this._animateSpine(dt, nearTier);
    } else if (tier === "medium") {
      this._animateSpine(dt, medTier);
    }

    // Organ bioluminescence pulse + radial shift with core pulsation (near only)
    if (tier === "near") {
      const radialPush = Math.sin(this._breathPhase) * 0.04;
      for (let i = 0; i < nearTier.organs.length; i++) {
        const organ = nearTier.organs[i];
        if (organ.material && organ.material.emissiveIntensity !== undefined) {
          organ.material.emissiveIntensity =
            1.0 + Math.sin(this.time * 2 + i * 1.7) * 0.4;
        }
        // Secondary motion: organs shift radially outward as core expands
        if (organ.userData.basePos) {
          _v3A.copy(organ.userData.basePos).multiplyScalar(1.0 + radialPush);
          organ.position.lerp(_v3A, Math.min(1, dt * 8));
        }
      }
    }

    // Secondary motion: connective web stretch with limb movement (near only, every 3rd frame)
    if (
      tier === "near" &&
      nearTier.webs.length > 0 &&
      this._frameCount % 3 === 0
    ) {
      for (let wi = 0; wi < nearTier.webs.length; wi++) {
        const web = nearTier.webs[wi];
        const limbA = web.userData.limbA;
        const limbB = web.userData.limbB;
        if (!limbA || !limbB) continue;
        // Approximate displaced positions based on limb rotation
        _v3B.copy(limbA.position);
        _v3B.x += Math.sin(limbA.rotation.x) * 0.35;
        _v3B.z += Math.sin(limbA.rotation.z) * 0.35;
        _v3C.copy(limbB.position);
        _v3C.x += Math.sin(limbB.rotation.x) * 0.35;
        _v3C.z += Math.sin(limbB.rotation.z) * 0.35;
        // Midpoint pushed outward — web bows taut as limbs extend
        const webMidpoint = _computeWebArchMidpoint(_v3A, _v3B, _v3C);
        _updateWebGeometry(
          web.geometry,
          _v3B,
          webMidpoint,
          _v3C,
          web.userData.tubeRadius,
          web.userData.tubeSegs,
          web.userData.tubeSides,
        );
      }
    }

    // Respawn if too far (squared comparison avoids sqrt)
    if (distSq > RESPAWN_DISTANCE_SQ) {
      const a = Math.random() * TWO_PI;
      this.group.position.set(
        playerPos.x + Math.cos(a) * 80,
        playerPos.y - Math.random() * 15,
        playerPos.z + Math.sin(a) * 80,
      );
    }
  }

  _animateLimbs(dt, tier, playerLocal, isNear) {
    const aimBlend = this._proximityFactor * 0.9;
    for (let i = 0; i < tier.limbs.length; i++) {
      const limb = tier.limbs[i];

      // Twitch events
      this._twitchTimers[i] = (this._twitchTimers[i] || 0) + dt;
      if (this._twitchTimers[i] > (this._twitchNext[i] || 3)) {
        this._twitchTimers[i] = 0;
        this._twitchNext[i] = 1.5 + Math.random() * 4;
      }

      const twitchRaw = this._twitchTimers[i] < 0.4 ? 1 : 0;
      const phase = this.time * 2 + i * 1.3;
      const twitchIntensity = twitchRaw * (1 + this._proximityFactor * 1.8);
      const twitchKick =
        Math.sin(this.time * 36 + i * 13.7) * 0.03 * twitchIntensity;
      const idleX = Math.sin(phase) * 0.012;
      const idleZ = Math.cos(phase * 0.7) * 0.006;
      const reachBias =
        this._proximityFactor > 0.3
          ? Math.sin(this.time * 3 + i * 0.8) * 0.008 * this._proximityFactor
          : 0;

      if (playerLocal) {
        _v3B.copy(playerLocal).sub(limb.position);
        if (_v3B.lengthSq() > 1e-6) {
          _v3B.normalize();
          _qA.setFromUnitVectors(LIMB_AIM_AXIS, _v3B);
          limb.quaternion
            .copy(limb.userData.baseQuaternion)
            .slerp(_qA, aimBlend);
        } else {
          limb.quaternion.copy(limb.userData.baseQuaternion);
        }
      } else {
        limb.quaternion.copy(limb.userData.baseQuaternion);
      }

      // Keep the existing idle/twitch layer, but apply it relative to the aimed pose.
      limb.rotateX(idleX + reachBias + twitchKick);
      limb.rotateZ(idleZ + twitchKick * 0.6);

      // Near-LOD shader uniforms
      if (
        isNear &&
        this._shaderUniforms.limbs &&
        this._shaderUniforms.limbs[i]
      ) {
        this._shaderUniforms.limbs[i].uTime.value = this.time;
        this._shaderUniforms.limbs[i].uTwitch.value = twitchIntensity;
      }
    }
  }

  _animateSkullsAndEyes(tier, playerLocal) {
    const aimBlend = this._proximityFactor * 0.95;
    for (let i = 0; i < tier.skulls.length; i++) {
      const skull = tier.skulls[i];
      _v3B.copy(playerLocal).sub(skull.position);
      if (_v3B.lengthSq() > 1e-6) {
        _v3B.normalize();
        _qA.setFromUnitVectors(SKULL_AIM_AXIS, _v3B);
        skull.quaternion
          .copy(skull.userData.baseQuaternion)
          .slerp(_qA, aimBlend);
      } else {
        skull.quaternion.copy(skull.userData.baseQuaternion);
      }

      const skullPhase = this.time * 0.9 + i * 1.7;
      skull.rotateX(Math.sin(skullPhase) * 0.03);
      skull.rotateY(Math.cos(skullPhase * 0.7) * 0.025);

      const skullEyes = skull.userData.eyes;
      if (!skullEyes || skullEyes.length === 0) continue;

      _qB.copy(skull.quaternion).invert();
      _v3C.copy(_v3B).applyQuaternion(_qB);

      const focusX = THREE.MathUtils.clamp(_v3C.x, -0.8, 0.8) * 0.012 * aimBlend;
      const focusY = THREE.MathUtils.clamp(_v3C.y, -0.8, 0.8) * 0.009 * aimBlend;
      const focusZ = Math.max(0, _v3C.z) * 0.006 * aimBlend;

      for (let eyeIndex = 0; eyeIndex < skullEyes.length; eyeIndex++) {
        const eye = skullEyes[eyeIndex];
        const eyePhase = this.time * 1.5 + eye.userData.idlePhase;
        eye.position.copy(eye.userData.basePosition);
        eye.position.x += focusX + Math.sin(eyePhase) * 0.0003;
        eye.position.y += focusY + Math.cos(eyePhase * 0.7) * 0.0002;
        eye.position.z += focusZ;
      }
    }
  }

  _animateLimbsBasic(dt, tier) {
    for (let i = 0; i < tier.limbs.length; i++) {
      const phase = this.time * 2 + i * 1.3;
      tier.limbs[i].rotation.x += Math.sin(phase) * 0.01;
      tier.limbs[i].rotation.z += Math.cos(phase * 0.7) * 0.005;
    }
  }

  _animateSpine(dt, tier) {
    for (let i = 0; i < tier.spineSegments.length; i++) {
      const seg = tier.spineSegments[i];
      const t = i / Math.max(1, tier.spineSegments.length - 1);

      // Idle undulation
      const idleWave = Math.sin(this.time * 1.5 + t * 4) * 0.02 * (0.5 + t);
      seg.position.x = idleWave;
      seg.position.z = Math.cos(this.time * 1.2 + t * 3.5) * 0.015 * (0.5 + t);

      // Whip reaction
      if (this._spineWhipActive) {
        const whipWave =
          Math.sin(this._spineWhipPhase - t * 3) *
          0.08 *
          this._spineWhipDecay *
          (0.3 + t);
        seg.position.x += whipWave;
      }
    }
  }

  getPosition() {
    return this.group.position;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((c) => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        if (Array.isArray(c.material)) {
          c.material.forEach((m) => m.dispose());
        } else {
          c.material.dispose();
        }
      }
    });
  }
}
