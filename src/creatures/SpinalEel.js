import * as THREE from 'three';
import { qualityManager } from '../QualityManager.js';

const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI * 0.5;
const RESPAWN_DISTANCE = 220;
const NEAR_DISTANCE = 30;
const MEDIUM_DISTANCE = 80;
const PLAYER_REACTION_DISTANCE = 30;
const COIL_DISTANCE = 18;
const JAW_REACTION_DISTANCE = 24;

const _tmpVec3A = new THREE.Vector3();
const _tmpVec3B = new THREE.Vector3();
const _sharedTextures = new Set();

let _bodyNormalTexture = null;
let _finNormalTexture = null;
let _bodyDisplacementTexture = null;
let _finDisplacementTexture = null;

const LOD_PROFILE = {
  near: {
    length: 13.8,
    tubularSegments: 120,
    radialSegments: 18,
    chainCount: 18,
    ribCount: 12,
    finCount: 12,
    finSegmentsX: 6,
    finSegmentsY: 6,
    tailSegmentsX: 8,
    tailSegmentsY: 6,
    headWidthSegments: 48,
    headHeightSegments: 32,
    eyeWidthSegments: 16,
    eyeHeightSegments: 12,
    jawSegments: 20,
    dorsalProcessCount: 14,
    tailRays: 5,
    hasPerVertexFinFlutter: true,
    hasRibs: true,
    hasTeeth: true,
    hasHeadExtraDetail: true,
    animStep: 1,
  },
  medium: {
    length: 13.2,
    tubularSegments: 60,
    radialSegments: 12,
    chainCount: 9,
    ribCount: 6,
    finCount: 6,
    finSegmentsX: 2,
    finSegmentsY: 2,
    tailSegmentsX: 4,
    tailSegmentsY: 3,
    headWidthSegments: 28,
    headHeightSegments: 20,
    eyeWidthSegments: 12,
    eyeHeightSegments: 10,
    jawSegments: 12,
    dorsalProcessCount: 7,
    tailRays: 2,
    hasPerVertexFinFlutter: false,
    hasRibs: true,
    hasTeeth: true,
    hasHeadExtraDetail: false,
    animStep: 2,
  },
  far: {
    length: 11.0,
    radialSegments: 8,
    heightSegments: 4,
    animStep: 4,
  },
};

function _shortestAngle(angle) {
  let wrapped = angle;
  while (wrapped > Math.PI) wrapped -= TWO_PI;
  while (wrapped < -Math.PI) wrapped += TWO_PI;
  return wrapped;
}

function _makeCanvasTexture(width, height, drawFn) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  drawFn(ctx, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 2);
  texture.needsUpdate = true;
  _sharedTextures.add(texture);
  return texture;
}

function _getBodyNormalTexture() {
  if (_bodyNormalTexture) return _bodyNormalTexture;
  _bodyNormalTexture = _makeCanvasTexture(256, 256, (ctx, width, height) => {
    const img = ctx.createImageData(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const nx = Math.sin(x * 0.12) * 0.45 + Math.sin((x + y) * 0.07) * 0.25;
        const ny = Math.cos(y * 0.17) * 0.4 + Math.sin((x - y) * 0.05) * 0.2;
        const index = (y * width + x) * 4;
        img.data[index] = Math.round((nx * 0.5 + 0.5) * 255);
        img.data[index + 1] = Math.round((ny * 0.5 + 0.5) * 255);
        img.data[index + 2] = 255;
        img.data[index + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
  return _bodyNormalTexture;
}

function _getFinNormalTexture() {
  if (_finNormalTexture) return _finNormalTexture;
  _finNormalTexture = _makeCanvasTexture(128, 128, (ctx, width, height) => {
    ctx.fillStyle = 'rgb(128,128,255)';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = 'rgb(164,190,255)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 10; i++) {
      const x = (i / 9) * width;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + Math.sin(i * 0.9) * 6, height);
      ctx.stroke();
    }
  });
  _finNormalTexture.repeat.set(1.5, 2.5);
  return _finNormalTexture;
}

function _getBodyDisplacementTexture() {
  if (_bodyDisplacementTexture) return _bodyDisplacementTexture;
  _bodyDisplacementTexture = _makeCanvasTexture(256, 256, (ctx, width, height) => {
    const img = ctx.createImageData(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Muscle surface: segmented banding along tube length (y = along V)
        const muscleBand = Math.pow(Math.abs(Math.sin(y * 0.28)), 2.8) * 0.6;
        // Spinal ridge: concentrated near U=0.5 which maps to the dorsal apex
        const uNorm = x / (width - 1);
        const ridgePeak = Math.exp(-Math.pow((uNorm - 0.5) * 6.0, 2.0)) * 0.55;
        const lateralRipple = Math.abs(Math.sin(uNorm * Math.PI * 4 + y * 0.12)) * 0.18;
        const d = Math.min(1.0, muscleBand + ridgePeak + lateralRipple);
        const val = Math.round(d * 255);
        const index = (y * width + x) * 4;
        img.data[index] = val;
        img.data[index + 1] = val;
        img.data[index + 2] = val;
        img.data[index + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
  // keep the default repeat(3,2) set by _makeCanvasTexture
  return _bodyDisplacementTexture;
}

function _getFinDisplacementTexture() {
  if (_finDisplacementTexture) return _finDisplacementTexture;
  _finDisplacementTexture = _makeCanvasTexture(128, 128, (ctx, width, height) => {
    const img = ctx.createImageData(width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Fin membrane ribbing: parallel veins running across the fin span
        const uNorm = x / (width - 1);
        const rib = Math.pow(Math.max(0, Math.cos(uNorm * Math.PI * 9.0)), 4.0);
        // Taper toward fin edges so displacement fades at tips
        const vNorm = y / (height - 1);
        const taper = Math.sin(vNorm * Math.PI);
        const d = rib * taper * 0.7;
        const val = Math.round(d * 255);
        const index = (y * width + x) * 4;
        img.data[index] = val;
        img.data[index + 1] = val;
        img.data[index + 2] = val;
        img.data[index + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
  _finDisplacementTexture.repeat.set(1.5, 2.5);
  return _finDisplacementTexture;
}

function _applyOrganicShader(material, uniformRefs, options = {}) {
  const uniforms = {
    uTime: { value: 0 },
    uWavePhase: { value: 0 },
    uAmplitude: { value: options.amplitude ?? 0.16 },
    uRotAmplitude: { value: options.rotAmplitude ?? 0.22 },
    uSwimSpeed: { value: options.swimSpeed ?? 4.0 },
    uFrequency: { value: options.frequency ?? 10.0 },
    uCoilStrength: { value: 0 },
    uMuscle: { value: options.muscle ?? 0.8 },
    uGlowPulse: { value: 1.0 },
    uFinFlutter: { value: options.finFlutter ?? 0 },
    uRimStrength: { value: options.rimStrength ?? 0.75 },
    uJawGlow: { value: options.jawGlow ?? 0 },
    uLength: { value: options.length ?? 1 },
  };
  uniformRefs.push(uniforms);

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
       uniform float uTime;
       uniform float uWavePhase;
       uniform float uAmplitude;
       uniform float uRotAmplitude;
       uniform float uSwimSpeed;
       uniform float uFrequency;
       uniform float uCoilStrength;
       uniform float uMuscle;
       uniform float uFinFlutter;
       uniform float uLength;
       varying vec3 vEelWorldNormal;
       varying vec3 vEelViewDir;
       varying vec2 vEelUv;
       varying float vEelProgress;
      `
    );

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vEelUv = uv;
       float eelProgress = clamp(-position.x / max(uLength, 0.001), 0.0, 1.0);
       vEelProgress = eelProgress;
       float eelWave = sin(uTime * uSwimSpeed - eelProgress * uFrequency + uWavePhase);
       float eelCross = cos(uTime * (uSwimSpeed * 0.75) - eelProgress * (uFrequency * 0.82) + uWavePhase * 0.63);
       float eelRot = eelWave * uRotAmplitude * (0.14 + eelProgress);
       mat2 eelRotMat = mat2(cos(eelRot), -sin(eelRot), sin(eelRot), cos(eelRot));
       transformed.yz = eelRotMat * transformed.yz;
       transformed.y += eelWave * uAmplitude * (0.22 + eelProgress * 1.15);
       transformed.z += eelCross * uAmplitude * 0.38 * (0.15 + eelProgress);
       float eelBulge = sin(uTime * 3.1 - eelProgress * 17.0 + uWavePhase);
       transformed.yz *= 1.0 + eelBulge * uMuscle * 0.05;
       float eelCoil = sin(uTime * 2.1 + eelProgress * 12.0 + uWavePhase) * uCoilStrength * pow(1.0 - eelProgress, 1.65);
       transformed.y += sin(eelProgress * 9.0 + uTime * 2.25) * eelCoil;
       transformed.z += cos(eelProgress * 9.0 + uTime * 2.05) * eelCoil * 0.8;
       transformed.z += sin(uTime * 7.0 + uv.x * 10.0 + uv.y * 5.0 + uWavePhase) * uFinFlutter * uv.y;
      `
    );

    shader.vertexShader = shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
       vEelWorldNormal = normalize(normalMatrix * objectNormal);
       vEelViewDir = normalize(-mvPosition.xyz);
      `
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
       uniform float uTime;
       uniform float uGlowPulse;
       uniform float uRimStrength;
       uniform float uJawGlow;
       varying vec3 vEelWorldNormal;
       varying vec3 vEelViewDir;
       varying vec2 vEelUv;
       varying float vEelProgress;
      `
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `float eelRim = pow(1.0 - max(dot(normalize(vEelWorldNormal), normalize(vEelViewDir)), 0.0), 3.0);
       float eelStripe = exp(-pow(vEelUv.y - 0.24, 2.0) * 180.0) + exp(-pow(vEelUv.y - 0.76, 2.0) * 180.0);
       float eelJawPulse = (1.0 - vEelProgress) * (0.5 + 0.5 * sin(uTime * 5.0));
       vec3 eelGlowColor = vec3(0.08, 0.55, 0.4) * eelStripe * uGlowPulse;
       eelGlowColor += vec3(0.16, 0.22, 0.08) * eelJawPulse * uJawGlow;
       gl_FragColor.rgb += eelGlowColor + eelRim * (vec3(0.08, 0.2, 0.16) * uRimStrength + eelGlowColor * 0.35);
       #include <dithering_fragment>`
    );
  };

  // Static key: all organic shader variants use identical GLSL — differences
  // are uniform values only, so there is no need for per-tier shader variants.
  material.customProgramCacheKey = () => 'organicShader_v1';

  return material;
}

function _createBodyMaterial(uniformRefs, length, tierName) {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0x16131d,
    roughness: tierName === 'far' ? 0.32 : 0.18,
    metalness: 0.08,
    clearcoat: tierName === 'far' ? 0.2 : 1.0,
    clearcoatRoughness: 0.08,
    emissive: 0x081814,
    emissiveIntensity: tierName === 'far' ? 0.7 : 1.0,
    normalMap: _getBodyNormalTexture(),
    normalScale: new THREE.Vector2(0.65, 0.65),
    // Displacement for spinal ridge and muscle surface (far tier omitted — too few
    // geometry segments for displacement to contribute meaningfully)
    displacementMap: tierName !== 'far' ? _getBodyDisplacementTexture() : null,
    displacementScale: tierName === 'near' ? 0.04 : tierName === 'medium' ? 0.025 : 0,
  });
  return _applyOrganicShader(mat, uniformRefs, {
    amplitude: tierName === 'far' ? 0.08 : tierName === 'medium' ? 0.13 : 0.18,
    rotAmplitude: tierName === 'far' ? 0.12 : tierName === 'medium' ? 0.18 : 0.25,
    frequency: tierName === 'far' ? 7.5 : 10.5,
    swimSpeed: tierName === 'far' ? 3.0 : 4.2,
    muscle: tierName === 'far' ? 0.3 : tierName === 'medium' ? 0.55 : 0.9,
    rimStrength: tierName === 'far' ? 0.4 : 0.8,
    length,
  });
}

function _createHeadMaterial(uniformRefs, length) {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0x17141e,
    roughness: 0.14,
    metalness: 0.1,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    emissive: 0x0a1615,
    emissiveIntensity: 1.1,
    normalMap: _getBodyNormalTexture(),
    normalScale: new THREE.Vector2(0.8, 0.8),
  });
  return _applyOrganicShader(mat, uniformRefs, {
    amplitude: 0.07,
    rotAmplitude: 0.09,
    frequency: 7.0,
    swimSpeed: 2.7,
    muscle: 0.55,
    rimStrength: 0.95,
    jawGlow: 0.3,
    length,
  });
}

function _createJawMaterial(uniformRefs, length) {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0x2a1d18,
    roughness: 0.2,
    metalness: 0.05,
    clearcoat: 0.7,
    clearcoatRoughness: 0.1,
    emissive: 0x18320f,
    emissiveIntensity: 1.4,
    normalMap: _getBodyNormalTexture(),
    normalScale: new THREE.Vector2(0.5, 0.5),
    side: THREE.DoubleSide,
  });
  return _applyOrganicShader(mat, uniformRefs, {
    amplitude: 0.04,
    rotAmplitude: 0.04,
    frequency: 5.0,
    swimSpeed: 2.0,
    muscle: 0.25,
    rimStrength: 0.55,
    jawGlow: 1.0,
    length,
  });
}

function _createFinMaterial(uniformRefs, length, flutterAmount, tierName) {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0x172226,
    roughness: 0.12,
    metalness: 0.02,
    transmission: 0.45,
    thickness: 0.35,
    transparent: true,
    opacity: 0.84,
    clearcoat: 0.8,
    clearcoatRoughness: 0.07,
    emissive: 0x0b241c,
    emissiveIntensity: 0.7,
    normalMap: _getFinNormalTexture(),
    normalScale: new THREE.Vector2(0.45, 0.45),
    // Displacement for fin membrane ribbing (near: full, medium: reduced)
    displacementMap: _getFinDisplacementTexture(),
    displacementScale: tierName === 'near' ? 0.02 : 0.01,
    side: THREE.DoubleSide,
  });
  return _applyOrganicShader(mat, uniformRefs, {
    amplitude: 0.05,
    rotAmplitude: 0.04,
    frequency: 8.0,
    swimSpeed: 3.6,
    muscle: 0.2,
    finFlutter: flutterAmount,
    rimStrength: 0.85,
    length,
  });
}

function _createSpineMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0x5ea082,
    roughness: 0.15,
    metalness: 0.25,
    emissive: 0x2bb66d,
    emissiveIntensity: 1.4,
  });
}

function _createBoneMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0x5b5550,
    roughness: 0.28,
    metalness: 0.08,
    clearcoat: 0.2,
    emissive: 0x17100c,
    emissiveIntensity: 0.18,
  });
}

function _createEyeMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0x84ffb1,
    emissive: 0x52ff96,
    emissiveIntensity: 2.4,
    roughness: 0.02,
    metalness: 0.12,
    clearcoat: 1.0,
    clearcoatRoughness: 0.03,
  });
}

function _createBodyCurve(length) {
  const points = [];
  for (let i = 0; i <= 7; i++) {
    const t = i / 7;
    points.push(new THREE.Vector3(-t * length, Math.sin(t * Math.PI * 1.1) * 0.05, Math.sin(t * 2.8 + 0.6) * 0.04));
  }
  return new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.45);
}

function _shapeTubeGeometry(geometry, length) {
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const progress = THREE.MathUtils.clamp(-x / length, 0, 1);
    const radiusScale = THREE.MathUtils.lerp(1.26, 0.18, Math.pow(progress, 0.7));
    const spinalRidge = Math.max(0, y) * (0.16 + Math.sin(progress * 44) * 0.04);
    const ribbing = Math.sin(progress * 68) * 0.025 * (1 - progress * 0.6);
    const lateralStriation = Math.sin(progress * 32 + Math.atan2(z, Math.max(0.001, y + 0.001)) * 3.0) * 0.02;
    pos.setXYZ(
      i,
      x,
      y * radiusScale + spinalRidge + ribbing + lateralStriation * 0.4,
      z * radiusScale * (0.9 + Math.sin(progress * 19) * 0.03)
    );
  }
  geometry.computeVertexNormals();
  // NOTE: do NOT bake the orientation flip into the geometry — the shader reads
  // raw geometry positions to compute eelProgress (clamp(-x/uLength, 0, 1)).
  // geometry.rotateZ(PI) would negate X, collapsing progress to zero on
  // near/medium LODs and breaking wave/glow animation.  The visual flip is
  // applied instead as body.rotation.z = Math.PI on the mesh object.
}

function _shapeHeadGeometry(geometry, detailEnabled) {
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const snout = Math.max(0, x) * 0.38;
    const cranialRidge = Math.max(0, y) * (detailEnabled ? 0.22 : 0.12) * (0.7 + Math.cos(z * 8) * 0.3);
    const cheek = Math.sin(z * 7) * 0.03 * (1 - Math.abs(y));
    pos.setXYZ(i, x * 1.5 + snout, y * 0.88 + cranialRidge, z * 0.82 + cheek);
  }
  geometry.computeVertexNormals();
}

function _shapeJawGeometry(geometry) {
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const taper = 1 - THREE.MathUtils.clamp((x + 0.36) / 0.72, 0, 1) * 0.55;
    pos.setXYZ(i, x * 1.1, y * 0.45 * taper, z * 0.7 * taper + Math.sin(x * 8) * 0.02);
  }
  geometry.computeVertexNormals();
}

function _shapeTailFinGeometry(geometry) {
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const edge = Math.abs(y) / 0.18;
    const notch = Math.sin(edge * Math.PI) * 0.08;
    pos.setXYZ(i, x + edge * 0.12 - notch, y, pos.getZ(i));
  }
  geometry.computeVertexNormals();
}

function _createTooth(length, radius) {
  const geometry = new THREE.ConeGeometry(radius, length, 5);
  geometry.rotateZ(-HALF_PI);
  return geometry;
}

export class SpinalEel {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time = Math.random() * 100;
    this.speed = 4.6 + Math.random() * 2.1;
    this._baseSpeed = this.speed;
    this._phaseOffset = Math.random() * TWO_PI;
    this._flutterOffset = Math.random() * TWO_PI;
    this._breathingPhase = Math.random() * TWO_PI;
    this._ampVariation = 0.9 + Math.random() * 0.35;
    this._freqVariation = 0.88 + Math.random() * 0.26;
    this._coilBias = Math.random() < 0.5 ? -1 : 1;
    this._idleBias = Math.random() * 0.5 + 0.75;
    this._turnTimer = 0;
    this._turnInterval = 4 + Math.random() * 5;
    this._frameCount = 0;
    this._lastLodTier = 'near';
    this._jawAngle = 0;
    this._skullTilt = 0;
    this._coilState = 0;
    this._coilingWanted = 0;
    this._proximity = 0;
    this._yaw = 0;
    this._pitch = 0;
    this._bank = 0;

    this.direction = new THREE.Vector3(Math.random() - 0.5, (Math.random() - 0.5) * 0.12, Math.random() - 0.5).normalize();
    this._smoothedDirection = this.direction.clone();
    this._velocity = this.direction.clone().multiplyScalar(this.speed);

    this.tiers = {};
    this._buildModel();

    this.group.position.copy(position);
    this._yaw = Math.atan2(this.direction.x, this.direction.z) + HALF_PI;
    this.group.rotation.y = this._yaw;
    scene.add(this.group);
  }

  _buildModel() {
    this.lod = new THREE.LOD();

    for (const tierName of ['near', 'medium']) {
      const tier = this._buildDetailedTier(tierName, LOD_PROFILE[tierName]);
      this.tiers[tierName] = tier;
      this.lod.addLevel(tier.group, tierName === 'near' ? 0 : NEAR_DISTANCE);
    }

    this.tiers.far = this._buildFarTier(LOD_PROFILE.far);
    this.lod.addLevel(this.tiers.far.group, MEDIUM_DISTANCE);
    this.group.add(this.lod);

    const scale = 1.65 + Math.random() * 1.1;
    this.group.scale.setScalar(scale);
  }

  _buildDetailedTier(tierName, profile) {
    const group = new THREE.Group();
    const shaderUniforms = [];
    const bodyMat = _createBodyMaterial(shaderUniforms, profile.length, tierName);
    const headMat = _createHeadMaterial(shaderUniforms, profile.length * 0.3);
    const jawMat = _createJawMaterial(shaderUniforms, profile.length * 0.2);
    const finMat = _createFinMaterial(shaderUniforms, profile.length, profile.hasPerVertexFinFlutter ? 0.065 : 0.0, tierName);
    const spineMat = _createSpineMaterial();
    const boneMat = _createBoneMaterial();
    const eyeMat = _createEyeMaterial();

    const bodyCurve = _createBodyCurve(profile.length);
    const bodyGeo = new THREE.TubeGeometry(bodyCurve, profile.tubularSegments, 0.34, profile.radialSegments, false);
    _shapeTubeGeometry(bodyGeo, profile.length);
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    group.add(body);

    const spineGeo = new THREE.TubeGeometry(bodyCurve, Math.max(18, Math.floor(profile.tubularSegments * 0.35)), 0.06, 6, false);
    const spine = new THREE.Mesh(spineGeo, spineMat);
    group.add(spine);

    const nodes = [];
    for (let i = 0; i < profile.chainCount; i++) {
      const progress = i / Math.max(1, profile.chainCount - 1);
      const node = new THREE.Group();
      node.userData.progress = progress;
      group.add(node);
      nodes.push(node);
    }

    const headPivot = new THREE.Group();
    headPivot.position.x = 0.18;
    nodes[0].add(headPivot);

    const headGeo = new THREE.SphereGeometry(0.52, profile.headWidthSegments, profile.headHeightSegments);
    _shapeHeadGeometry(headGeo, profile.hasHeadExtraDetail);
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.x = 0.38;
    headPivot.add(head);

    if (profile.hasHeadExtraDetail) {
      for (let i = 0; i < 3; i++) {
        const crestGeo = new THREE.ConeGeometry(0.05 - i * 0.008, 0.18 - i * 0.02, 8);
        const crest = new THREE.Mesh(crestGeo, boneMat);
        crest.position.set(0.12 - i * 0.14, 0.3 + i * 0.02, 0);
        crest.rotation.z = Math.PI;
        headPivot.add(crest);
      }
    }

    const upperJawGeo = new THREE.CylinderGeometry(0.05, 0.12, 0.7, profile.jawSegments, 1, false);
    _shapeJawGeometry(upperJawGeo);
    upperJawGeo.rotateZ(HALF_PI);
    const upperJaw = new THREE.Mesh(upperJawGeo, jawMat);
    upperJaw.position.set(0.46, -0.02, 0);
    headPivot.add(upperJaw);

    const jawPivot = new THREE.Group();
    jawPivot.position.set(0.21, -0.08, 0);
    headPivot.add(jawPivot);

    const lowerJawGeo = new THREE.CylinderGeometry(0.04, 0.11, 0.72, profile.jawSegments, 1, false);
    _shapeJawGeometry(lowerJawGeo);
    lowerJawGeo.rotateZ(HALF_PI);
    const lowerJaw = new THREE.Mesh(lowerJawGeo, jawMat);
    lowerJaw.position.set(0.3, -0.05, 0);
    jawPivot.add(lowerJaw);

    if (profile.hasTeeth) {
      const toothGeo = _createTooth(tierName === 'near' ? 0.09 : 0.06, tierName === 'near' ? 0.014 : 0.011);
      for (let i = 0; i < 9; i++) {
        const t = i / 8;
        const offsetX = 0.1 + t * 0.46;
        const spread = 0.065 + Math.sin(t * Math.PI) * 0.02;
        for (const side of [-1, 1]) {
          const upperTooth = new THREE.Mesh(toothGeo, boneMat);
          upperTooth.position.set(offsetX, -0.01, spread * side);
          upperTooth.rotation.z = side < 0 ? 0.15 : -0.15;
          upperTooth.rotation.x = side * 0.25;
          headPivot.add(upperTooth);

          const lowerTooth = new THREE.Mesh(toothGeo, boneMat);
          lowerTooth.position.set(offsetX - 0.02, -0.03, spread * side * 0.9);
          lowerTooth.rotation.z = Math.PI + (side < 0 ? -0.2 : 0.2);
          lowerTooth.rotation.x = side * -0.18;
          jawPivot.add(lowerTooth);
        }
      }
    }

    for (const side of [-1, 1]) {
      const eyeGeo = new THREE.SphereGeometry(0.065, profile.eyeWidthSegments, profile.eyeHeightSegments);
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(0.55, 0.09, side * 0.27);
      headPivot.add(eye);
    }

    const ribs = [];
    const dorsalProcesses = [];
    for (let i = 1; i < profile.chainCount - 1; i++) {
      const node = nodes[i];
      const progress = node.userData.progress;
      const radius = THREE.MathUtils.lerp(0.38, 0.09, Math.pow(progress, 0.72));

      if (profile.hasRibs && i <= profile.ribCount) {
        const ribGroup = new THREE.Group();
        for (const side of [-1, 1]) {
          const ribGeo = new THREE.CylinderGeometry(0.012, 0.02, radius * 1.2, 5, 1, false);
          ribGeo.translate(0, -radius * 0.55, 0);
          const rib = new THREE.Mesh(ribGeo, boneMat);
          rib.position.z = side * (radius * 0.55);
          rib.rotation.x = side * HALF_PI;
          rib.rotation.z = side * 0.35;
          ribGroup.add(rib);
        }
        ribGroup.position.y = radius * 0.18;
        node.add(ribGroup);
        ribs.push(ribGroup);
      }

      if (i <= profile.dorsalProcessCount) {
        const spineProcessGeo = new THREE.ConeGeometry(0.03 * (1 - progress * 0.4), 0.25 * (1 - progress * 0.35), 6);
        const spineProcess = new THREE.Mesh(spineProcessGeo, boneMat);
        spineProcess.position.y = radius + 0.08;
        node.add(spineProcess);
        dorsalProcesses.push(spineProcess);
      }
    }

    const finGeo = new THREE.PlaneGeometry(0.18, 0.28, profile.finSegmentsX, profile.finSegmentsY);
    const fins = [];
    for (let i = 1; i <= profile.finCount; i++) {
      const nodeIndex = Math.min(nodes.length - 2, Math.max(1, Math.round((i / profile.finCount) * (nodes.length - 2))));
      const node = nodes[nodeIndex];
      const fin = new THREE.Mesh(finGeo, finMat);
      const progress = node.userData.progress;
      const radius = THREE.MathUtils.lerp(0.34, 0.08, Math.pow(progress, 0.75));
      fin.position.set(0.02, radius + 0.1, 0);
      fin.rotation.y = HALF_PI;
      fin.scale.set(1.0 - progress * 0.2, 0.9 + (1 - progress) * 0.6, 1);
      node.add(fin);
      fins.push(fin);
    }

    const tailFinGeo = new THREE.PlaneGeometry(0.5, 0.36, profile.tailSegmentsX, profile.tailSegmentsY);
    _shapeTailFinGeometry(tailFinGeo);
    const tailFin = new THREE.Mesh(tailFinGeo, finMat.clone());
    const tailNode = nodes[nodes.length - 1];
    tailFin.position.set(-0.08, 0, 0);
    tailFin.rotation.y = HALF_PI;
    tailNode.add(tailFin);

    const tailRays = [];
    for (let i = 0; i < profile.tailRays; i++) {
      const rayGeo = new THREE.CylinderGeometry(0.006, 0.012, 0.36 + i * 0.03, 4, 1, false);
      const ray = new THREE.Mesh(rayGeo, boneMat);
      const spread = (i / Math.max(1, profile.tailRays - 1)) - 0.5;
      ray.position.set(-0.14, spread * 0.22, 0);
      ray.rotation.z = HALF_PI + spread * 0.8;
      tailNode.add(ray);
      tailRays.push(ray);
    }

    return {
      group,
      profile,
      shaderUniforms,
      nodes,
      headPivot,
      jawPivot,
      fins,
      tailFin,
      tailRays,
      ribs,
      dorsalProcesses,
    };
  }

  _buildFarTier(profile) {
    const group = new THREE.Group();
    const shaderUniforms = [];
    const bodyMat = _createBodyMaterial(shaderUniforms, profile.length, 'far');
    const bodyGeo = new THREE.CylinderGeometry(0.28, 0.06, profile.length, profile.radialSegments, profile.heightSegments, true);
    bodyGeo.rotateZ(HALF_PI);
    const pos = bodyGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const progress = THREE.MathUtils.clamp((-x + profile.length * 0.5) / profile.length, 0, 1);
      const radius = THREE.MathUtils.lerp(1.0, 0.25, progress);
      pos.setXYZ(i, x - profile.length * 0.5, y * radius, z * radius * 0.7);
    }
    bodyGeo.computeVertexNormals();
    group.add(new THREE.Mesh(bodyGeo, bodyMat));

    return { group, profile, shaderUniforms };
  }

  _getVisibleTierName() {
    if (!this.lod || !this.lod.levels) return 'near';
    for (let i = 0; i < this.lod.levels.length; i++) {
      if (this.lod.levels[i].object.visible) {
        return i === 0 ? 'near' : i === 1 ? 'medium' : 'far';
      }
    }
    return this._lastLodTier;
  }

  _updateMovement(dt, playerPos) {
    this._turnTimer += dt;

    _tmpVec3A.subVectors(playerPos, this.group.position);
    const dist = Math.max(0.001, _tmpVec3A.length());
    this._proximity = THREE.MathUtils.clamp(1 - dist / PLAYER_REACTION_DISTANCE, 0, 1);
    this._coilingWanted = THREE.MathUtils.clamp(1 - dist / COIL_DISTANCE, 0, 1);

    if (this._turnTimer > this._turnInterval) {
      this._turnTimer = 0;
      this._turnInterval = 3.5 + Math.random() * 4.5;
      if (dist < PLAYER_REACTION_DISTANCE * 1.6 || Math.random() < 0.45) {
        _tmpVec3A.normalize();
        this.direction.lerp(_tmpVec3A, dist < PLAYER_REACTION_DISTANCE ? 0.55 : 0.28).normalize();
      } else {
        this.direction.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.18, Math.random() - 0.5).normalize();
      }
    }

    if (dist < PLAYER_REACTION_DISTANCE) {
      _tmpVec3B.copy(_tmpVec3A).normalize();
      this.direction.lerp(_tmpVec3B, dt * 0.9).normalize();
    }

    this._smoothedDirection.lerp(this.direction, dt * 1.9).normalize();
    this.speed = THREE.MathUtils.lerp(this.speed, this._baseSpeed * (1 + this._proximity * 0.45), dt * 1.3);
    this._velocity.copy(this._smoothedDirection).multiplyScalar(this.speed);
    this.group.position.addScaledVector(this._velocity, dt);

    const targetYaw = Math.atan2(this._smoothedDirection.x, this._smoothedDirection.z) + HALF_PI;
    this._yaw += _shortestAngle(targetYaw - this._yaw) * Math.min(1, dt * 2.8);
    const horizontal = Math.sqrt(this._smoothedDirection.x * this._smoothedDirection.x + this._smoothedDirection.z * this._smoothedDirection.z);
    const targetPitch = THREE.MathUtils.clamp(Math.atan2(this._smoothedDirection.y, Math.max(0.001, horizontal)), -0.35, 0.35);
    this._pitch = THREE.MathUtils.lerp(this._pitch, targetPitch, dt * 2.2);
    this._bank = THREE.MathUtils.lerp(this._bank, THREE.MathUtils.clamp(_shortestAngle(targetYaw - this.group.rotation.y) * 0.8, -0.35, 0.35), dt * 3.0);
    this.group.rotation.set(this._pitch, this._yaw, this._bank);
    this._coilState = THREE.MathUtils.lerp(this._coilState, this._coilingWanted, dt * 2.4);

    if (dist > RESPAWN_DISTANCE) {
      const angle = Math.random() * TWO_PI;
      this.group.position.set(
        playerPos.x + Math.cos(angle) * 90,
        playerPos.y + (Math.random() - 0.5) * 16,
        playerPos.z + Math.sin(angle) * 90
      );
    }

    return dist;
  }

  _updateTierUniforms(tierName) {
    const tier = this.tiers[tierName];
    if (!tier) return;

    const isNear = tierName === 'near';
    const isFar = tierName === 'far';
    const swimPulse = 0.72 + (Math.sin(this.time * 3.4 + this._phaseOffset) * 0.5 + 0.5) * 0.55;
    const coilStrength = this._coilState * (isNear ? 0.24 : isFar ? 0.12 : 0.16) * this._coilBias;
    const amplitude = (isNear ? 0.18 : isFar ? 0.085 : 0.13) * this._ampVariation * (0.85 + this._proximity * 0.55);
    const rotAmplitude = (isNear ? 0.24 : isFar ? 0.12 : 0.18) * (0.8 + this._proximity * 0.4);
    const finFlutter = isNear ? (0.05 + this._proximity * 0.03) : 0;

    for (const uniforms of tier.shaderUniforms) {
      uniforms.uTime.value = this.time;
      uniforms.uWavePhase.value = this._phaseOffset;
      uniforms.uAmplitude.value = amplitude;
      uniforms.uRotAmplitude.value = rotAmplitude;
      uniforms.uSwimSpeed.value = (isFar ? 2.8 : 4.0) * this._freqVariation;
      uniforms.uFrequency.value = (isFar ? 7.0 : 10.5) * this._freqVariation;
      uniforms.uCoilStrength.value = coilStrength;
      uniforms.uMuscle.value = isNear ? 0.82 + this._proximity * 0.28 : isFar ? 0.25 : 0.52;
      uniforms.uGlowPulse.value = swimPulse;
      uniforms.uFinFlutter.value = finFlutter;
      uniforms.uJawGlow.value = 0.8 + this._proximity * 0.9;
    }
  }

  _updateDetailedTier(tierName, dt, distToPlayer) {
    const tier = this.tiers[tierName];
    if (!tier) return;

    const isNear = tierName === 'near';
    const breath = Math.sin(this.time * (1.1 + this._idleBias * 0.2) + this._breathingPhase) * 0.03;
    const jawTarget = distToPlayer < JAW_REACTION_DISTANCE
      ? THREE.MathUtils.clamp(1 - distToPlayer / JAW_REACTION_DISTANCE, 0, 1) * 0.85
      : 0.14 + Math.sin(this.time * 1.7 + this._phaseOffset) * 0.06;

    this._jawAngle = THREE.MathUtils.lerp(this._jawAngle, jawTarget, dt * 4.5);
    this._skullTilt = THREE.MathUtils.lerp(this._skullTilt, jawTarget * 0.18 + breath * 0.8, dt * 3.8);

    tier.headPivot.rotation.z = -this._skullTilt;
    tier.headPivot.rotation.y = Math.sin(this.time * 1.1 + this._phaseOffset) * 0.08 + this._coilState * 0.18 * this._coilBias;
    tier.jawPivot.rotation.z = this._jawAngle;
    tier.jawPivot.rotation.y = Math.sin(this.time * 2.0 + this._phaseOffset) * 0.06;

    for (let i = 0; i < tier.nodes.length; i++) {
      const node = tier.nodes[i];
      const progress = node.userData.progress;
      const phase = this.time * (4.1 * this._freqVariation) - progress * 9.8 + this._phaseOffset;
      const wave = Math.sin(phase);
      const crossWave = Math.cos(phase * 0.76 + this._coilBias * 0.7);
      const inertia = 1 - progress * 0.42;
      const baseX = -progress * tier.profile.length;
      const lateralAmp = (0.12 + progress * 0.62) * this._ampVariation * (0.75 + this._proximity * 0.45);
      const verticalAmp = lateralAmp * 0.35;
      const coilEnvelope = Math.pow(1 - progress, 1.55) * this._coilState * 1.2;
      const coilPhase = this.time * 2.2 + progress * 12.0 * this._coilBias + this._phaseOffset;

      node.position.set(
        baseX,
        wave * lateralAmp + Math.sin(coilPhase) * coilEnvelope * 0.55,
        crossWave * verticalAmp + Math.cos(coilPhase) * coilEnvelope * 0.72
      );
      node.rotation.set(
        crossWave * (isNear ? 0.12 : 0.08) * inertia,
        wave * (isNear ? 0.34 : 0.22) * inertia + Math.sin(coilPhase) * this._coilState * 0.18,
        wave * 0.08 * (0.4 + progress) + Math.cos(coilPhase) * this._coilState * 0.1
      );

      const bulge = 1 + Math.sin(this.time * 3.25 - progress * 18 + this._phaseOffset) * (isNear ? 0.08 : 0.04) + (1 + breath) * 0.015;
      node.scale.set(1, bulge, bulge * (1 + this._coilState * 0.08));
    }

    for (let i = 0; i < tier.fins.length; i++) {
      const fin = tier.fins[i];
      fin.rotation.z = Math.sin(this.time * 7.2 + i * 0.75 + this._flutterOffset) * (isNear ? 0.18 : 0.09);
      fin.rotation.x = Math.cos(this.time * 4.2 + i * 0.6) * 0.06;
      fin.scale.y = 0.92 + Math.sin(this.time * 3.2 + i * 0.5) * (isNear ? 0.12 : 0.05);
    }

    const tailPhase = this.time * (4.4 * this._freqVariation) + this._phaseOffset;
    const powerStroke = Math.sin(tailPhase);
    const asymmetricStroke = powerStroke > 0 ? powerStroke * 0.65 : powerStroke * 1.18;
    tier.tailFin.rotation.z = asymmetricStroke * 0.55 + this._coilState * 0.28;
    tier.tailFin.rotation.x = Math.cos(tailPhase * 0.8) * 0.14;
    tier.tailFin.scale.y = 1 + Math.abs(asymmetricStroke) * 0.12;

    for (let i = 0; i < tier.tailRays.length; i++) {
      const ray = tier.tailRays[i];
      const spread = (i / Math.max(1, tier.tailRays.length - 1)) - 0.5;
      ray.rotation.y = asymmetricStroke * 0.3 * spread;
    }

    for (let i = 0; i < tier.ribs.length; i++) {
      tier.ribs[i].rotation.x = Math.sin(this.time * 2.6 + i * 0.7) * 0.05;
      tier.ribs[i].scale.y = 1 + Math.sin(this.time * 3.0 - i * 0.55) * 0.06;
    }

    for (let i = 0; i < tier.dorsalProcesses.length; i++) {
      tier.dorsalProcesses[i].scale.y = 1 + Math.sin(this.time * 3.8 - i * 0.7) * 0.12 * (isNear ? 1 : 0.45);
      tier.dorsalProcesses[i].rotation.z = Math.sin(this.time * 4.2 - i * 0.45) * 0.08;
    }
  }

  update(dt, playerPos) {
    if (!playerPos) return;

    this.time += dt;
    this._frameCount++;

    const distToPlayer = this._updateMovement(dt, playerPos);
    const tierName = this._getVisibleTierName();
    this._lastLodTier = tierName;

    this._updateTierUniforms('near');
    this._updateTierUniforms('medium');

    const farStep = qualityManager.tier === 'ultra' ? LOD_PROFILE.far.animStep : 3;
    if (this._frameCount % farStep === 0) {
      this._updateTierUniforms('far');
    }

    if (tierName === 'near') {
      this._updateDetailedTier('near', dt, distToPlayer);
    } else if (tierName === 'medium' && this._frameCount % LOD_PROFILE.medium.animStep === 0) {
      this._updateDetailedTier('medium', dt, distToPlayer);
    }
  }

  getPosition() {
    return this.group.position;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (!child.material) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        if (material.map && !_sharedTextures.has(material.map)) material.map.dispose();
        if (material.normalMap && !_sharedTextures.has(material.normalMap)) material.normalMap.dispose();
        if (material.emissiveMap && !_sharedTextures.has(material.emissiveMap)) material.emissiveMap.dispose();
        material.dispose();
      }
    });
  }
}
