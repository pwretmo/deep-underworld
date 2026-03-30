import * as THREE from 'three/webgpu';
import { abs, atan, attribute, clamp, cos, dot, float as tslFloat, materialColor, materialEmissive, max as tslMax, normalView, positionLocal, positionView, pow, sin, smoothstep as tslSmoothstep, sub, texture as tslTexture, uniform, uv, varying, vec2, vec3 } from 'three/tsl';

const LOD_NEAR_DISTANCE = 30;
const LOD_MEDIUM_DISTANCE = 80;
const JELLY_RESPAWN_DISTANCE = 340;
const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI * 0.5;

// Max jellies to build synchronously in the constructor to stay within the
// 50 ms spawn budget. The rest are deferred to subsequent update() frames.
const SYNC_JELLY_LIMIT = 2;

const _tmpMatrix = new THREE.Matrix4();
const _tmpQuat = new THREE.Quaternion();
const _tmpPos = new THREE.Vector3();
const _tmpScale = new THREE.Vector3();

function smoothstep(edge0, edge1, x) {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Create a soft circular sprite texture for glow effects.
function createGlowTexture() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.3, "rgba(255,255,255,0.6)");
  gradient.addColorStop(0.7, "rgba(255,255,255,0.1)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

const glowTexture = createGlowTexture();

function createBellNormalTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(size, size);
  const data = image.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1);
      const v = y / (size - 1);
      const angle = u * TWO_PI;
      const band = Math.sin(v * 56 + Math.cos(angle * 3.2) * 2.4) * 0.22;
      const radial = Math.cos(angle * 14 + v * 18) * 0.16;
      const nx = THREE.MathUtils.clamp(0.5 + radial, 0, 1);
      const ny = THREE.MathUtils.clamp(0.5 + band, 0, 1);
      const nz =
        Math.sqrt(Math.max(0, 1 - (nx * 2 - 1) ** 2 - (ny * 2 - 1) ** 2)) *
          0.5 +
        0.5;
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
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 1;

  for (let i = 0; i < 22; i++) {
    const angle = (i / 22) * TWO_PI;
    ctx.beginPath();
    ctx.moveTo(size * 0.5, size * 0.18);
    for (let s = 1; s <= 6; s++) {
      const r = (s / 6) * size * 0.45;
      const wobble = Math.sin(s * 1.7 + angle * 2.2) * size * 0.02;
      ctx.lineTo(
        size * 0.5 + Math.cos(angle + s * 0.11) * (r + wobble),
        size * 0.2 + Math.sin(angle) * 0.08 * size + r * 0.9,
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

function createPoreTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgb(130,130,130)";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 520; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 0.4 + Math.random() * 1.2;
    const shade = 70 + Math.floor(Math.random() * 80);
    ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TWO_PI);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 8);
  tex.needsUpdate = true;
  return tex;
}

const bellNormalTexture = createBellNormalTexture();
const veinTexture = createVeinTexture();
const poreTexture = createPoreTexture();

// ── TSL bell shader — per-vertex contraction wave + bioluminescent emissive ──

function _applyBellShader(mat, uniforms) {
  mat.userData.shaderUniforms = uniforms;

  // TSL vertex: per-vertex bell contraction with wave propagation
  const jellyUv = varying(uv(), 'vJellyUv');
  const xz = vec2(positionLocal.x, positionLocal.z);
  const radial = xz.length().div(tslMax(uniforms.uBellSize, 0.001));
  const edge = tslSmoothstep(0.33, 1.0, radial);
  const crown = sub(1.0, tslSmoothstep(0.0, 0.45, radial));
  const contraction = tslMax(uniforms.uContractionPhase, 0.0);
  const relax = tslMax(uniforms.uContractionPhase.negate(), 0.0);
  const stretchMarks = sin(positionLocal.y.mul(34.0).add(radial.mul(16.0)).add(uniforms.uJellyTime.mul(2.2)))
    .mul(contraction).mul(0.03).mul(uniforms.uBellSize);
  const radialContract = contraction.mul(edge).mul(
    tslFloat(0.2).add(sin(radial.mul(18.0).add(uniforms.uJellyTime.mul(3.1))).mul(0.02))
  );
  const factor = sub(1.0, radialContract).add(relax.mul(edge).mul(0.06));
  const newX = positionLocal.x.mul(factor);
  const newZ = positionLocal.z.mul(factor);

  // Damage — localized bell deformation
  const bellAngle = atan(positionLocal.z, positionLocal.x);
  const damageShape = uniforms.uDamage.mul(tslSmoothstep(0.15, 1.0, radial)).mul(0.24).mul(uniforms.uBellSize);
  const damageOffset = damageShape.mul(tslMax(0.0, cos(bellAngle.sub(uniforms.uDamageSide))));

  const newY = positionLocal.y
    .add(crown.mul(contraction).mul(0.04).mul(uniforms.uBellSize))
    .sub(edge.mul(contraction).mul(0.16).mul(uniforms.uBellSize))
    .add(edge.mul(relax).mul(0.05).mul(uniforms.uBellSize))
    .sub(damageOffset)
    .add(stretchMarks);

  const vBellEdge = varying(edge, 'vBellEdge');
  const vBellTravel = varying(radial, 'vBellTravel');

  mat.positionNode = vec3(newX, newY, newZ);

  // TSL fragment: pulse wave + vein texture + Fresnel + contraction glow
  const pulseHead = tslSmoothstep(uniforms.uPulseTravel.sub(0.2), uniforms.uPulseTravel.add(0.08), vBellTravel)
    .mul(sub(1.0, tslSmoothstep(uniforms.uPulseTravel.add(0.08), uniforms.uPulseTravel.add(0.24), vBellTravel)));
  const veins = tslTexture(veinTexture, vec2(jellyUv.x, jellyUv.y.mul(1.25))).r;
  const viewDir = positionView.negate().normalize();
  const fresnel = pow(sub(1.0, abs(dot(viewDir, normalView))), 2.6);
  const contractionGlow = tslMax(uniforms.uContractionPhase, 0.0).mul(0.55);

  mat.emissiveNode = materialEmissive.add(
    materialColor.mul(
      pulseHead.mul(1.25)
        .add(veins.mul(0.2))
        .add(fresnel.mul(0.32))
        .add(contractionGlow.mul(vBellEdge).mul(0.34))
    )
  );

  mat.needsUpdate = true;
}

// ── TSL nematocyst shader — instance pulse scaling + emissive boost ──

function _applyNematocystShader(mat, uniforms) {
  mat.userData.shaderUniforms = uniforms;

  const instancePulseAttr = attribute('instancePulse');
  const pulse = sin(uniforms.uPulseTime.mul(2.8).add(instancePulseAttr.mul(1.6))).mul(0.2).add(0.8);
  mat.positionNode = positionLocal.mul(pulse);

  const vPulse = varying(pulse, 'vPulse');
  mat.emissiveNode = materialEmissive.add(
    materialColor.mul(vPulse.sub(0.76)).mul(0.42)
  );

  mat.needsUpdate = true;
}

function _inflateGeometryBounds(geometry, padding) {
  if (!padding) return;
  if (!geometry.boundingSphere) {
    geometry.computeBoundingSphere();
  }
  if (geometry.boundingSphere) {
    geometry.boundingSphere.radius += padding;
  }
}

function _createAppendageShaderUniforms() {
  return {
    uAppendageTime: uniform(0),
    uContractionPhase: uniform(0),
    uDriftX: uniform(0),
    uDriftZ: uniform(0),
    uPlayerDirX: uniform(0),
    uPlayerDirZ: uniform(0),
    uProximityInfluence: uniform(0),
  };
}

function _applyAppendageShader(mat, uniforms, appendage) {
  mat.userData.shaderUniforms = uniforms;

  const along = clamp(
    positionLocal.y.negate().add(appendage.maxY).div(Math.max(appendage.length, 0.001)),
    0.0,
    1.0,
  );
  const tipWeight = along.mul(along).mul(sub(3.0, along.mul(2.0)));
  const tipWeightSq = tipWeight.mul(tipWeight);
  const contraction = tslMax(uniforms.uContractionPhase, 0.0);
  const relaxed = tslMax(uniforms.uContractionPhase.negate(), 0.0);
  const flowFactor = relaxed.mul(0.82).add(0.3);
  const pulseSqueeze = sub(1.0, contraction.mul(appendage.radialPulse || 0));

  const waveA = sin(
    uniforms.uAppendageTime
      .mul(appendage.swaySpeed || 0)
      .add(appendage.phaseOffset || 0)
      .add(along.mul(appendage.waveFrequency || 0)),
  );
  const waveB = sin(
    uniforms.uAppendageTime
      .mul(appendage.secondarySpeed || 0)
      .add((appendage.phaseOffset || 0) * 0.67)
      .add(along.mul(appendage.secondaryFrequency || 0)),
  );
  const lateral = waveA
    .mul(appendage.swayAmount || 0)
    .add(waveB.mul(appendage.secondarySwayAmount || 0))
    .mul(flowFactor)
    .mul(tipWeight);
  const axial = cos(
    uniforms.uAppendageTime
      .mul(appendage.twistSpeed || 0)
      .add(appendage.phaseOffset || 0)
      .add(along.mul((appendage.waveFrequency || 0) * 0.55)),
  )
    .mul(appendage.twistAmount || 0)
    .mul(tipWeight);
  const curl = relaxed
    .mul(appendage.relaxCurlAmount || 0)
    .sub(contraction.mul(appendage.pulseCurlAmount || 0))
    .mul(tipWeightSq);
  const crossing = sin(
    uniforms.uAppendageTime
      .mul(appendage.crossSpeed || 0)
      .add(appendage.crossPhase || 0)
      .add(along.mul(appendage.crossFrequency || 0)),
  )
    .mul(appendage.crossAmount || 0)
    .mul(contraction)
    .mul(tipWeight)
    .mul(appendage.crossSign || 1);
  const oralSpread = contraction.mul(appendage.spreadAmount || 0).mul(tipWeight);
  const proximityWeight = uniforms.uProximityInfluence.mul(
    appendage.proximityResponse || 0,
  );
  const playerReact = proximityWeight.mul(tipWeight);
  const vertical = contraction
    .mul((appendage.modelScale || 1) * (appendage.liftAmount || 0))
    .mul(tipWeight)
    .sub(
      relaxed
        .mul((appendage.modelScale || 1) * (appendage.dropAmount || 0))
        .mul(along)
        .mul(0.4),
    )
    .add(waveB.mul(appendage.heaveAmount || 0).mul(tipWeightSq));

  const radialX = positionLocal.x.sub(appendage.rootCenter.x);
  const radialZ = positionLocal.z.sub(appendage.rootCenter.z);
  const radialScale = pulseSqueeze.sub(1.0).mul(tipWeight).add(1.0);
  const lateralX = lateral
    .add(crossing)
    .add(uniforms.uPlayerDirX.mul(playerReact).mul(0.06))
    .mul(appendage.perpX || 0);
  const lateralZ = lateral
    .add(crossing)
    .add(uniforms.uPlayerDirZ.mul(playerReact).mul(0.06))
    .mul(appendage.perpZ || 0);
  const axialX = axial
    .add(uniforms.uDriftX.mul(tipWeight))
    .mul(appendage.dirX || 0);
  const axialZ = axial
    .add(uniforms.uDriftZ.mul(tipWeight))
    .mul(appendage.dirZ || 0);

  mat.positionNode = vec3(
    radialX
      .mul(radialScale.add(oralSpread))
      .add(lateralX)
      .add(axialX)
      .add(radialX.mul(curl))
      .add(appendage.rootCenter.x),
    positionLocal.y.add(vertical),
    radialZ
      .mul(radialScale.add(oralSpread))
      .add(lateralZ)
      .add(axialZ)
      .add(radialZ.mul(curl))
      .add(appendage.rootCenter.z),
  );

  mat.needsUpdate = true;
}

const LOD_PROFILE = {
  near: {
    bellWidthSegments: 64,
    bellHeightSegments: 40,
    innerWidthSegments: 40,
    innerHeightSegments: 28,
    rimTubeSegments: 96,
    rimRadialSegments: 16,
    oralArmCount: 4,
    oralArmSegments: 14,
    oralArmRadialSegments: 10,
    oralArmRadiusScale: 1.0,
    tentacleMin: 10,
    tentacleMaxExtra: 4,
    tentacleSegments: 12,
    tentacleRadialSegments: 8,
    tentacleRadiusScale: 1.0,
    animationInterval: 4,
    tentacleNematocystClusters: 6,
    appendageMotionScale: 1,
    appendageCountScale: 1,
  },
  medium: {
    bellWidthSegments: 34,
    bellHeightSegments: 22,
    innerWidthSegments: 22,
    innerHeightSegments: 16,
    rimTubeSegments: 52,
    rimRadialSegments: 10,
    oralArmCount: 3,
    oralArmSegments: 8,
    oralArmRadialSegments: 6,
    oralArmRadiusScale: 0.85,
    tentacleMin: 7,
    tentacleMaxExtra: 3,
    tentacleSegments: 8,
    tentacleRadialSegments: 5,
    tentacleRadiusScale: 0.85,
    animationInterval: 12,
    tentacleNematocystClusters: 3,
    appendageMotionScale: 0.6,
    appendageCountScale: 0.5,
  },
  far: {
    bellWidthSegments: 8,
    bellHeightSegments: 6,
    innerWidthSegments: 12,
    innerHeightSegments: 10,
    rimTubeSegments: 12,
    rimRadialSegments: 6,
    oralArmCount: 1,
    oralArmSegments: 3,
    oralArmRadialSegments: 3,
    oralArmRadiusScale: 0.7,
    tentacleMin: 2,
    tentacleMaxExtra: 1,
    tentacleSegments: 3,
    tentacleRadialSegments: 3,
    tentacleRadiusScale: 0.7,
    animationInterval: 4,
    tentacleNematocystClusters: 0,
    appendageMotionScale: 0.28,
    appendageCountScale: 0.25,
  },
};

export class Jellyfish {
  constructor(scene, position, count = 6) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.jellies = [];
    this.time = Math.random() * 100;
    this._frameCount = 0;

    // More natural, muted bioluminescent palette.
    const colors = [
      0x2288cc, 0xcc3388, 0x33bb88, 0x8844cc, 0xcc6633, 0x3399bb, 0x5566dd,
      0xdd5577, 0x44ccaa, 0xbb55dd,
    ];

    // Pre-compute spawn positions and colors for all jellies so deferred
    // ones land in the same spatial cluster as immediate ones.
    this._pendingJellies = [];
    this._pendingJellyIndex = 0;
    for (let i = 0; i < count; i++) {
      const color = colors[i % colors.length];
      const pos = new THREE.Vector3(
        position.x + (Math.random() - 0.5) * 30,
        position.y + (Math.random() - 0.5) * 15,
        position.z + (Math.random() - 0.5) * 30,
      );

      if (i < SYNC_JELLY_LIMIT) {
        const jelly = this._createJelly(color);
        jelly.group.position.copy(pos);
        this.jellies.push(jelly);
        this.group.add(jelly.group);
      } else {
        this._pendingJellies.push({ color, position: pos });
      }
    }

    scene.add(this.group);
  }

  /** Drain all remaining deferred jellies synchronously. */
  finalize() {
    while (this._pendingJellyIndex < this._pendingJellies.length) {
      const pending = this._pendingJellies[this._pendingJellyIndex++];
      const jelly = this._createJelly(pending.color);
      jelly.group.position.copy(pending.position);
      this.jellies.push(jelly);
      this.group.add(jelly.group);
    }
    this._pendingJellies.length = 0;
    this._pendingJellyIndex = 0;
  }

  _createBellMaterial(color, size, detailScale = 1) {
    const mat = new THREE.MeshPhysicalMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.16,
      transparent: true,
      opacity: 0.4,
      roughness: 0.08,
      metalness: 0.02,
      transmission: 0.76,
      thickness: 0.62,
      iridescence: 0.78,
      iridescenceIOR: 1.24,
      clearcoat: 0.9,
      clearcoatRoughness: 0.08,
      side: THREE.DoubleSide,
      depthWrite: false,
      normalMap: bellNormalTexture,
      normalScale: new THREE.Vector2(0.28 * detailScale, 0.42 * detailScale),
    });

    const bellUniforms = {
      uContractionPhase: uniform(0),
      uJellyTime: uniform(0),
      uPulseTravel: uniform(0),
      uDamage: uniform(0),
      uDamageSide: uniform(1),
      uBellSize: uniform(size),
    };
    _applyBellShader(mat, bellUniforms);

    return mat;
  }

  _createBellGeometry(size, widthSegments, heightSegments) {
    const bellGeo = new THREE.SphereGeometry(
      size,
      widthSegments,
      heightSegments,
      0,
      Math.PI * 2,
      0,
      Math.PI * 0.55,
    );
    const positions = bellGeo.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const z = positions.getZ(i);
      const radial = Math.sqrt(x * x + z * z) / size;
      const angle = Math.atan2(z, x);
      const rimBand = smoothstep(0.62, 1.0, radial);
      const crownBand = 1 - smoothstep(0.0, 0.35, radial);
      const rimLobes = Math.sin(angle * 9) * 0.032 * rimBand * size;
      const crownUndulate = Math.sin(angle * 2.5) * 0.012 * crownBand * size;
      const radialSqueeze = (0.12 * rimBand - 0.05 * crownBand) * size;
      const subUmbrellaDip = -smoothstep(0.42, 0.95, radial) * 0.11 * size;

      const radialScale = 1 + (rimLobes + crownUndulate + radialSqueeze) / size;
      positions.setX(i, x * radialScale);
      positions.setY(i, y + subUmbrellaDip + crownBand * 0.03 * size);
      positions.setZ(i, z * radialScale);
    }
    bellGeo.computeVertexNormals();
    return bellGeo;
  }

  _createAppendageDescriptor(mesh, options) {
    mesh.frustumCulled = true;

    const geometry = mesh.geometry;
    const restPositions = Float32Array.from(geometry.attributes.position.array);
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < restPositions.length; i += 3) {
      const y = restPositions[i + 1];
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    const rootBand = maxY - Math.max((maxY - minY) * 0.08, 0.001);
    let rootX = 0;
    let rootZ = 0;
    let rootCount = 0;
    for (let i = 0; i < restPositions.length; i += 3) {
      if (restPositions[i + 1] < rootBand) continue;
      rootX += restPositions[i];
      rootZ += restPositions[i + 2];
      rootCount++;
    }

    const descriptor = {
      mesh,
      geometry,
      restPositions,
      rootCenter: {
        x: rootCount > 0 ? rootX / rootCount : 0,
        z: rootCount > 0 ? rootZ / rootCount : 0,
      },
      minY,
      maxY,
      length: Math.max(maxY - minY, 0.001),
      type: options.type,
      ...options,
    };

    _inflateGeometryBounds(geometry, options.boundsPadding || 0);

    if (!mesh.material.isMeshBasicMaterial) {
      descriptor.shaderUniforms = _createAppendageShaderUniforms();
      _applyAppendageShader(mesh.material, descriptor.shaderUniforms, descriptor);
    }

    return descriptor;
  }

  _updateAppendageShaderUniforms(appendage, jelly, pulse, t) {
    const uniforms = appendage.shaderUniforms;
    if (!uniforms) return;

    uniforms.uAppendageTime.value = t;
    uniforms.uContractionPhase.value = pulse;
    uniforms.uDriftX.value = jelly.velocityX * appendage.trailFactor * 0.32;
    uniforms.uDriftZ.value = jelly.velocityZ * appendage.trailFactor * 0.32;
    uniforms.uPlayerDirX.value = jelly.playerDirX;
    uniforms.uPlayerDirZ.value = jelly.playerDirZ;
    uniforms.uProximityInfluence.value = jelly.proximityInfluence;
  }

  _evaluateAppendagePoint(appendage, jelly, pulse, t, vertexIndex, target) {
    const rest = appendage.restPositions;
    const baseIndex = vertexIndex * 3;
    const contraction = Math.max(0, pulse);
    const relaxed = Math.max(0, -pulse);
    const flowFactor = 0.3 + relaxed * 0.82;
    const pulseSqueeze = 1 - contraction * appendage.radialPulse;
    const driftX = jelly.velocityX * appendage.trailFactor * 0.32;
    const driftZ = jelly.velocityZ * appendage.trailFactor * 0.32;
    const proximityWeight =
      jelly.proximityInfluence * appendage.proximityResponse;

    const baseX = rest[baseIndex];
    const baseY = rest[baseIndex + 1];
    const baseZ = rest[baseIndex + 2];
    const along = THREE.MathUtils.clamp(
      (appendage.maxY - baseY) / appendage.length,
      0,
      1,
    );
    const tipWeight = along * along * (3 - 2 * along);
    const tipWeightSq = tipWeight * tipWeight;

    const waveA = Math.sin(
      t * appendage.swaySpeed +
        appendage.phaseOffset +
        along * appendage.waveFrequency,
    );
    const waveB = Math.sin(
      t * appendage.secondarySpeed +
        appendage.phaseOffset * 0.67 +
        along * appendage.secondaryFrequency,
    );
    const lateral =
      (waveA * appendage.swayAmount + waveB * appendage.secondarySwayAmount) *
      flowFactor *
      tipWeight;
    const axial =
      Math.cos(
        t * appendage.twistSpeed +
          appendage.phaseOffset +
          along * appendage.waveFrequency * 0.55,
      ) *
      appendage.twistAmount *
      tipWeight;
    const curl =
      (relaxed * appendage.relaxCurlAmount -
        contraction * appendage.pulseCurlAmount) *
      tipWeightSq;
    const crossing =
      Math.sin(
        t * appendage.crossSpeed +
          appendage.crossPhase +
          along * appendage.crossFrequency,
      ) *
      appendage.crossAmount *
      contraction *
      tipWeight *
      appendage.crossSign;
    const oralSpread =
      appendage.type === "oral"
        ? contraction * appendage.spreadAmount * tipWeight
        : 0;
    const playerReact = proximityWeight * tipWeight;
    const vertical =
      contraction * jelly.size * appendage.liftAmount * tipWeight -
      relaxed * jelly.size * appendage.dropAmount * along * 0.4 +
      waveB * appendage.heaveAmount * tipWeightSq;

    const radialX = baseX - appendage.rootCenter.x;
    const radialZ = baseZ - appendage.rootCenter.z;
    const radialScale = THREE.MathUtils.lerp(1, pulseSqueeze, tipWeight);

    target.set(
      appendage.rootCenter.x +
        radialX * (radialScale + oralSpread) +
        appendage.perpX *
          (lateral + crossing + jelly.playerDirX * playerReact * 0.06) +
        appendage.dirX * (axial + driftX * tipWeight) +
        radialX * curl,
      baseY + vertical,
      appendage.rootCenter.z +
        radialZ * (radialScale + oralSpread) +
        appendage.perpZ *
          (lateral + crossing + jelly.playerDirZ * playerReact * 0.06) +
        appendage.dirZ * (axial + driftZ * tipWeight) +
        radialZ * curl,
    );

    return target;
  }

  _createOralArmFrill(curve, size, color, profile) {
    const frillGeo = new THREE.TubeGeometry(
      curve,
      profile.oralArmSegments,
      (0.055 * size + 0.012) * profile.oralArmRadiusScale,
      3,
      false,
    );
    const frillPositions = frillGeo.attributes.position;
    for (let i = 0; i < frillPositions.count; i++) {
      const x = frillPositions.getX(i);
      const y = frillPositions.getY(i);
      const z = frillPositions.getZ(i);
      const angle = Math.atan2(z, x);
      const ripple = Math.sin(angle * 6 + y * 8) * size * 0.01;
      frillPositions.setX(i, x + Math.cos(angle) * ripple);
      frillPositions.setZ(i, z + Math.sin(angle) * ripple);
    }
    frillGeo.computeVertexNormals();
    const frillMat = new THREE.MeshPhysicalMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.22,
      transparent: true,
      opacity: 0.25,
      roughness: 0.45,
      transmission: 0.2,
      side: THREE.DoubleSide,
      bumpMap: poreTexture,
      bumpScale: 0.018,
      depthWrite: false,
    });
    return new THREE.Mesh(frillGeo, frillMat);
  }

  _createNematocystSystem(
    group,
    tentacles,
    color,
    size,
    clusterCount,
    tierMotionScale,
  ) {
    if (!clusterCount || tentacles.length === 0) {
      return null;
    }

    const references = [];
    for (let t = 0; t < tentacles.length; t++) {
      const descriptor = tentacles[t];
      for (let c = 0; c < clusterCount; c++) {
        const along = 0.2 + (c / Math.max(1, clusterCount - 1)) * 0.72;
        let closestVertex = 0;
        let closestDelta = Infinity;
        for (let i = 0; i < descriptor.restPositions.length; i += 3) {
          const y = descriptor.restPositions[i + 1];
          const localAlong = THREE.MathUtils.clamp(
            (descriptor.maxY - y) / descriptor.length,
            0,
            1,
          );
          const delta = Math.abs(localAlong - along);
          if (delta < closestDelta) {
            closestDelta = delta;
            closestVertex = i / 3;
          }
        }
        references.push({
          appendageIndex: t,
          vertexIndex: closestVertex,
          baseScale: (0.012 + Math.random() * 0.018) * size,
          pulseOffset: Math.random() * TWO_PI,
          liftBias: (Math.random() - 0.5) * 0.02 * size,
        });
      }
    }

    const geo = new THREE.SphereGeometry(1, 5, 4);
    const mat = new THREE.MeshPhysicalMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.55,
      roughness: 0.35,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });

    const count = references.length;
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const pulseAttribute = new THREE.InstancedBufferAttribute(
      new Float32Array(count),
      1,
    );
    for (let i = 0; i < count; i++) {
      pulseAttribute.setX(i, references[i].pulseOffset);
    }
    geo.setAttribute("instancePulse", pulseAttribute);

    const nemaUniforms = {
      uPulseTime: uniform(0),
    };
    _applyNematocystShader(mat, nemaUniforms);

    group.add(mesh);

    return {
      mesh,
      references,
      tierMotionScale,
    };
  }

  _updateNematocysts(system, tier, jelly, t) {
    if (!system) return;

    const refs = system.references;
    for (let i = 0; i < refs.length; i++) {
      const ref = refs[i];
      const appendage = tier.tentacles[ref.appendageIndex];
      this._evaluateAppendagePoint(
        appendage,
        jelly,
        jelly._activePulse,
        t,
        ref.vertexIndex,
        _tmpPos,
      );
      _tmpPos.y += ref.liftBias;
      _tmpScale.setScalar(
        ref.baseScale *
          (0.86 +
            Math.sin(t * 2.7 + ref.pulseOffset) *
              0.17 *
              system.tierMotionScale),
      );
      _tmpMatrix.compose(_tmpPos, _tmpQuat.identity(), _tmpScale);
      system.mesh.setMatrixAt(i, _tmpMatrix);
    }

    system.mesh.instanceMatrix.needsUpdate = true;
    if (system.mesh.material.userData.shaderUniforms) {
      system.mesh.material.userData.shaderUniforms.uPulseTime.value = t;
    }
  }

  _createBellInteriorDetail(group, color, size) {
    const stomachGeo = new THREE.SphereGeometry(size * 0.23, 16, 12);
    const stomachMat = new THREE.MeshPhysicalMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.35,
      transparent: true,
      opacity: 0.25,
      roughness: 0.2,
      transmission: 0.35,
      depthWrite: false,
    });
    const stomach = new THREE.Mesh(stomachGeo, stomachMat);
    stomach.position.y = -size * 0.07;
    group.add(stomach);

    const manubriumGeo = new THREE.CylinderGeometry(
      size * 0.042,
      size * 0.07,
      size * 0.5,
      10,
      1,
      true,
    );
    const manubriumMat = new THREE.MeshPhysicalMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.3,
      transparent: true,
      opacity: 0.32,
      roughness: 0.18,
      transmission: 0.24,
      depthWrite: false,
    });
    const manubrium = new THREE.Mesh(manubriumGeo, manubriumMat);
    manubrium.position.y = -size * 0.34;
    group.add(manubrium);

    const gonadArms = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * TWO_PI;
      const pts = [
        new THREE.Vector3(
          Math.cos(angle) * size * 0.12,
          -size * 0.1,
          Math.sin(angle) * size * 0.12,
        ),
        new THREE.Vector3(
          Math.cos(angle + 0.2) * size * 0.16,
          -size * 0.24,
          Math.sin(angle + 0.2) * size * 0.16,
        ),
        new THREE.Vector3(
          Math.cos(angle - 0.1) * size * 0.1,
          -size * 0.44,
          Math.sin(angle - 0.1) * size * 0.1,
        ),
      ];
      const armGeo = new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(pts),
        8,
        size * 0.03,
        6,
        false,
      );
      const armMat = new THREE.MeshPhysicalMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.24,
        transparent: true,
        opacity: 0.2,
        roughness: 0.34,
        transmission: 0.25,
        depthWrite: false,
      });
      const arm = new THREE.Mesh(armGeo, armMat);
      gonadArms.add(arm);
    }
    group.add(gonadArms);

    const gastricFilaments = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * TWO_PI;
      const filamentPts = [
        new THREE.Vector3(
          Math.cos(angle) * size * 0.06,
          -size * 0.12,
          Math.sin(angle) * size * 0.06,
        ),
        new THREE.Vector3(
          Math.cos(angle + 0.3) * size * 0.08,
          -size * 0.24,
          Math.sin(angle + 0.3) * size * 0.08,
        ),
        new THREE.Vector3(
          Math.cos(angle - 0.2) * size * 0.04,
          -size * 0.35,
          Math.sin(angle - 0.2) * size * 0.04,
        ),
      ];
      const filamentGeo = new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(filamentPts),
        5,
        size * 0.01,
        4,
        false,
      );
      const filament = new THREE.Mesh(
        filamentGeo,
        new THREE.MeshPhysicalMaterial({
          color,
          emissive: color,
          emissiveIntensity: 0.16,
          transparent: true,
          opacity: 0.2,
          roughness: 0.4,
          transmission: 0.18,
          depthWrite: false,
        }),
      );
      gastricFilaments.add(filament);
    }
    group.add(gastricFilaments);

    return {
      stomach,
      manubrium,
      gonadArms,
      gastricFilaments,
    };
  }

  _createJetMesh(color, size) {
    const geo = new THREE.ConeGeometry(size * 0.08, size * 0.8, 12, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = Math.PI;
    mesh.position.y = -size * 0.56;
    return mesh;
  }

  _createFlowingAppendages(group, color, size, profile) {
    const oralArms = [];
    const tentacles = [];

    for (let a = 0; a < profile.oralArmCount; a++) {
      const angle = (a / profile.oralArmCount) * Math.PI * 2;
      const armLen = size * 2.2 + Math.random() * size * 1.8;
      const rootRadius = size * (0.12 + Math.random() * 0.12);
      const points = [];
      for (let s = 0; s <= profile.oralArmSegments; s++) {
        const t = s / profile.oralArmSegments;
        const curl =
          Math.sin(t * Math.PI * 1.4 + angle) * (0.03 + 0.05 * t) * size;
        points.push(
          new THREE.Vector3(
            Math.cos(angle) * rootRadius * (1 - t * 0.55) +
              Math.cos(angle + Math.PI * 0.5) * curl,
            -size * 0.2 - t * armLen,
            Math.sin(angle) * rootRadius * (1 - t * 0.55) +
              Math.sin(angle + Math.PI * 0.5) * curl,
          ),
        );
      }
      const curve = new THREE.CatmullRomCurve3(points);
      const armGeo = new THREE.TubeGeometry(
        curve,
        profile.oralArmSegments,
        (0.04 * size + 0.01) * profile.oralArmRadiusScale,
        profile.oralArmRadialSegments,
        false,
      );
      const armMat = new THREE.MeshPhysicalMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.3,
        transparent: true,
        opacity: 0.43,
        roughness: 0.3,
        bumpMap: poreTexture,
        bumpScale: 0.022,
        depthWrite: false,
      });
      const arm = new THREE.Mesh(armGeo, armMat);
      group.add(arm);

      const frill = this._createOralArmFrill(curve, size, color, profile);
      group.add(frill);

      oralArms.push(
        this._createAppendageDescriptor(arm, {
          type: "oral",
          modelScale: size,
          angle,
          dirX: Math.cos(angle),
          dirZ: Math.sin(angle),
          perpX: Math.cos(angle + Math.PI * 0.5),
          perpZ: Math.sin(angle + Math.PI * 0.5),
          phaseOffset: Math.random() * Math.PI * 2,
          swaySpeed: 0.58 + Math.random() * 0.24,
          secondarySpeed: 0.34 + Math.random() * 0.18,
          swayAmount: 0.025 + Math.random() * 0.035,
          secondarySwayAmount: 0.015 + Math.random() * 0.02,
          waveFrequency: 2.8 + Math.random() * 0.8,
          secondaryFrequency: 5.2 + Math.random() * 1.1,
          twistSpeed: 0.36 + Math.random() * 0.12,
          twistAmount: 0.02 + Math.random() * 0.03,
          liftAmount: 0.03 + Math.random() * 0.03,
          heaveAmount: 0.01 + Math.random() * 0.012,
          pulseCurlAmount: 0.02 + Math.random() * 0.018,
          relaxCurlAmount: 0.045 + Math.random() * 0.025,
          dropAmount: 0.015 + Math.random() * 0.02,
          radialPulse: 0.03 + Math.random() * 0.02,
          trailFactor: 0.3 + Math.random() * 0.25,
          proximityResponse: 0.6 + Math.random() * 0.4,
          spreadAmount: 0.14 + Math.random() * 0.1,
          crossSpeed: 0.4 + Math.random() * 0.2,
          crossPhase: Math.random() * TWO_PI,
          crossFrequency: 3.4 + Math.random() * 1.8,
          crossAmount: 0.02 + Math.random() * 0.018,
          crossSign: Math.random() > 0.5 ? 1 : -1,
          boundsPadding: size * 0.35,
        }),
      );

      oralArms.push(
        this._createAppendageDescriptor(frill, {
          type: "oral",
          modelScale: size,
          angle,
          dirX: Math.cos(angle),
          dirZ: Math.sin(angle),
          perpX: Math.cos(angle + HALF_PI),
          perpZ: Math.sin(angle + HALF_PI),
          phaseOffset: Math.random() * TWO_PI,
          swaySpeed: 0.6 + Math.random() * 0.2,
          secondarySpeed: 0.35 + Math.random() * 0.2,
          swayAmount: 0.03 + Math.random() * 0.025,
          secondarySwayAmount: 0.018 + Math.random() * 0.015,
          waveFrequency: 3 + Math.random() * 0.8,
          secondaryFrequency: 5.6 + Math.random() * 1,
          twistSpeed: 0.4 + Math.random() * 0.15,
          twistAmount: 0.025 + Math.random() * 0.02,
          liftAmount: 0.026 + Math.random() * 0.024,
          heaveAmount: 0.012 + Math.random() * 0.012,
          pulseCurlAmount: 0.016 + Math.random() * 0.016,
          relaxCurlAmount: 0.036 + Math.random() * 0.02,
          dropAmount: 0.014 + Math.random() * 0.012,
          radialPulse: 0.028 + Math.random() * 0.018,
          trailFactor: 0.26 + Math.random() * 0.2,
          proximityResponse: 0.7 + Math.random() * 0.35,
          spreadAmount: 0.19 + Math.random() * 0.08,
          crossSpeed: 0.35 + Math.random() * 0.16,
          crossPhase: Math.random() * TWO_PI,
          crossFrequency: 2.8 + Math.random() * 1.2,
          crossAmount: 0.03 + Math.random() * 0.015,
          crossSign: Math.random() > 0.5 ? 1 : -1,
          boundsPadding: size * 0.35,
        }),
      );
    }

    const tentacleCount =
      profile.tentacleMin +
      Math.floor(Math.random() * profile.tentacleMaxExtra);
    for (let t = 0; t < tentacleCount; t++) {
      const clusterPhase = (t / tentacleCount) * Math.PI * 2;
      const angle = clusterPhase + (Math.random() - 0.5) * 0.45;
      const radius = size * (0.58 + Math.random() * 0.22);
      const tentLen = size * 3.4 + Math.random() * size * 4.5;
      const rootYOffset = -size * (0.16 + Math.random() * 0.08);
      const points = [];
      for (let s = 0; s <= profile.tentacleSegments; s++) {
        const frac = s / profile.tentacleSegments;
        const lateralCurl =
          Math.sin(frac * Math.PI * 2 + angle * 1.5) * 0.05 * frac * size;
        points.push(
          new THREE.Vector3(
            Math.cos(angle) * radius * (1 - frac * 0.48) +
              Math.cos(angle + Math.PI * 0.5) * lateralCurl,
            rootYOffset - frac * tentLen,
            Math.sin(angle) * radius * (1 - frac * 0.48) +
              Math.sin(angle + Math.PI * 0.5) * lateralCurl,
          ),
        );
      }
      const curve = new THREE.CatmullRomCurve3(points);
      const tentGeo = new THREE.TubeGeometry(
        curve,
        profile.tentacleSegments,
        (0.015 * size + 0.005) * profile.tentacleRadiusScale,
        profile.tentacleRadialSegments,
        false,
      );
      const tentMat = new THREE.MeshPhysicalMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.25,
        transparent: true,
        opacity: 0.3,
        roughness: 0.3,
        depthWrite: false,
      });
      const tentacle = new THREE.Mesh(tentGeo, tentMat);
      group.add(tentacle);
      tentacles.push(
        this._createAppendageDescriptor(tentacle, {
          type: "tentacle",
          modelScale: size,
          angle,
          dirX: Math.cos(angle),
          dirZ: Math.sin(angle),
          perpX: Math.cos(angle + Math.PI * 0.5),
          perpZ: Math.sin(angle + Math.PI * 0.5),
          phaseOffset: Math.random() * Math.PI * 2,
          swaySpeed: 0.5 + Math.random() * 0.5,
          swayAmount: 0.04 + Math.random() * 0.04,
          secondarySpeed: 0.3 + Math.random() * 0.18,
          secondarySwayAmount: 0.02 + Math.random() * 0.02,
          waveFrequency: 4.2 + Math.random() * 1.3,
          secondaryFrequency: 7.8 + Math.random() * 1.6,
          twistSpeed: 0.42 + Math.random() * 0.2,
          twistAmount: 0.03 + Math.random() * 0.03,
          trailFactor: 0.4 + Math.random() * 0.4,
          liftAmount: 0.05 + Math.random() * 0.05,
          heaveAmount: 0.016 + Math.random() * 0.018,
          pulseCurlAmount: 0.03 + Math.random() * 0.025,
          relaxCurlAmount: 0.07 + Math.random() * 0.03,
          dropAmount: 0.018 + Math.random() * 0.02,
          radialPulse: 0.04 + Math.random() * 0.02,
          proximityResponse: 0.95 + Math.random() * 0.35,
          spreadAmount: 0,
          crossSpeed: 0.64 + Math.random() * 0.24,
          crossPhase: Math.random() * TWO_PI,
          crossFrequency: 5.8 + Math.random() * 2.5,
          crossAmount: 0.05 + Math.random() * 0.04,
          crossSign: Math.random() > 0.5 ? 1 : -1,
          boundsPadding: size * 0.45,
        }),
      );
    }

    const nematocysts = this._createNematocystSystem(
      group,
      tentacles,
      color,
      size,
      profile.tentacleNematocystClusters,
      profile.appendageMotionScale,
    );

    return { oralArms, tentacles, nematocysts };
  }

  _createFarTier(color, size) {
    const group = new THREE.Group();

    const farBell = new THREE.Mesh(
      new THREE.IcosahedronGeometry(size * 0.9, 0),
      this._createBellMaterial(color, size, 0.8),
    );
    group.add(farBell);

    const silhouette = new THREE.Mesh(
      new THREE.CircleGeometry(size * 0.48, 7),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    silhouette.rotation.x = HALF_PI;
    silhouette.position.y = -size * 0.18;
    group.add(silhouette);

    const trailGroup = new THREE.Group();
    trailGroup.userData.baseRotX = (Math.random() - 0.5) * 0.12;
    trailGroup.userData.baseRotZ = (Math.random() - 0.5) * 0.12;

    const oralArms = [];
    const tentacles = [];
    const farCountScale = LOD_PROFILE.far.appendageCountScale;
    const reducedOralCount = Math.max(
      1,
      Math.round(LOD_PROFILE.near.oralArmCount * farCountScale),
    );
    const reducedTentacleCount = Math.max(
      1,
      Math.round(LOD_PROFILE.near.tentacleMin * farCountScale),
    );

    const oralMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const tentacleMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    for (let i = 0; i < reducedOralCount; i++) {
      const angle = (i / reducedOralCount) * TWO_PI;
      const oralPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(size * 0.12, size * 1.35),
        oralMat,
      );
      oralPlane.position.set(
        Math.cos(angle) * size * 0.1,
        -size * 0.8,
        Math.sin(angle) * size * 0.1,
      );
      oralPlane.rotation.y = angle;
      trailGroup.add(oralPlane);
      oralArms.push(
        this._createAppendageDescriptor(oralPlane, {
          type: "oral",
          angle,
        }),
      );
    }

    for (let i = 0; i < reducedTentacleCount; i++) {
      const angle =
        (i / reducedTentacleCount) * TWO_PI + (Math.random() - 0.5) * 0.22;
      const tentaclePlane = new THREE.Mesh(
        new THREE.PlaneGeometry(size * 0.06, size * 1.8),
        tentacleMat,
      );
      tentaclePlane.position.set(
        Math.cos(angle) * size * 0.22,
        -size * 1.05,
        Math.sin(angle) * size * 0.22,
      );
      tentaclePlane.rotation.y = angle;
      trailGroup.add(tentaclePlane);
      tentacles.push(
        this._createAppendageDescriptor(tentaclePlane, {
          type: "tentacle",
          angle,
        }),
      );
    }

    group.add(trailGroup);

    const jet = this._createJetMesh(color, size);
    group.add(jet);

    return {
      group,
      bell: farBell,
      inner: silhouette,
      rim: silhouette,
      oralArms,
      tentacles,
      nematocysts: null,
      animationInterval: 4,
      profile: LOD_PROFILE.far,
      interior: null,
      jet,
      farTrailGroup: trailGroup,
    };
  }

  _createJellyTier(color, size, profile) {
    const group = new THREE.Group();

    const bellMat = this._createBellMaterial(color, size, 1);
    const bell = new THREE.Mesh(
      this._createBellGeometry(
        size,
        profile.bellWidthSegments,
        profile.bellHeightSegments,
      ),
      bellMat,
    );
    group.add(bell);

    const innerGeo = new THREE.SphereGeometry(
      size * 0.65,
      profile.innerWidthSegments,
      profile.innerHeightSegments,
      0,
      Math.PI * 2,
      0,
      Math.PI * 0.5,
    );
    const innerMat = new THREE.MeshPhysicalMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.5,
      transparent: true,
      opacity: 0.24,
      roughness: 0.3,
      transmission: 0.4,
      thickness: 0.3,
      depthWrite: false,
    });
    const inner = new THREE.Mesh(innerGeo, innerMat);
    inner.position.y = -0.05 * size;
    group.add(inner);

    const rimInnerRadius = size * 0.72;
    const rimOuterRadius = size * 0.98;
    const rimGeo = new THREE.RingGeometry(
      rimInnerRadius,
      rimOuterRadius,
      profile.rimTubeSegments,
      1,
    );
    const rimPositions = rimGeo.attributes.position;
    const rimWidth = rimOuterRadius - rimInnerRadius;
    for (let i = 0; i < rimPositions.count; i++) {
      const x = rimPositions.getX(i);
      const y = rimPositions.getY(i);
      const r = Math.sqrt(x * x + y * y);
      const edge = THREE.MathUtils.clamp((r - rimInnerRadius) / rimWidth, 0, 1);
      const theta = Math.atan2(y, x);
      const scallop = Math.sin(theta * 8) * 0.018 * size * edge;
      const sag = (0.02 - edge * 0.07) * size;
      rimPositions.setZ(i, scallop + sag);
    }
    rimGeo.computeVertexNormals();
    const rimMat = new THREE.MeshPhysicalMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.36,
      transparent: true,
      opacity: 0.28,
      roughness: 0.24,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.position.y = -size * 0.18;
    rim.rotation.x = Math.PI / 2;
    group.add(rim);

    const appendages = this._createFlowingAppendages(
      group,
      color,
      size,
      profile,
    );
    const interior = this._createBellInteriorDetail(group, color, size);
    const jet = this._createJetMesh(color, size);
    group.add(jet);

    return {
      group,
      bell,
      inner,
      rim,
      oralArms: appendages.oralArms,
      tentacles: appendages.tentacles,
      nematocysts: appendages.nematocysts,
      animationInterval: profile.animationInterval,
      profile,
      interior,
      jet,
      farTrailGroup: null,
    };
  }

  _createJelly(color) {
    const group = new THREE.Group();
    const size = 0.5 + Math.random() * 1.5;

    const nearTier = this._createJellyTier(color, size, LOD_PROFILE.near);
    const mediumTier = this._createJellyTier(color, size, LOD_PROFILE.medium);
    const farTier = this._createFarTier(color, size);

    const lod = new THREE.LOD();
    lod.addLevel(nearTier.group, 0);
    lod.addLevel(mediumTier.group, LOD_NEAR_DISTANCE);
    lod.addLevel(farTier.group, LOD_MEDIUM_DISTANCE);
    group.add(lod);

    const spriteMat = new THREE.SpriteMaterial({
      map: glowTexture,
      color,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.setScalar(size * 3);
    sprite.position.y = -size * 0.1;
    group.add(sprite);

    const light = new THREE.PointLight(color, 0.42, 8);
    light.userData.duwCategory = 'creature_bio';
    light.position.y = -0.1;
    group.add(light);

    return {
      group,
      size,
      lod,
      tiers: {
        near: nearTier,
        medium: mediumTier,
        far: farTier,
      },
      light,
      sprite,
      phase: Math.random() * Math.PI * 2,
      driftX: (Math.random() - 0.5) * 0.4,
      driftZ: (Math.random() - 0.5) * 0.4,
      verticalDrift: -0.03 - Math.random() * 0.03,
      rollPhase: Math.random() * Math.PI * 2,
      pulseSpeed: 0.9 + Math.random() * 0.35,
      swimPhase: Math.random() * TWO_PI,
      velocityX: 0,
      velocityY: 0,
      velocityZ: 0,
      playerDirX: 0,
      playerDirZ: 0,
      proximityInfluence: 0,
      reactionBias: Math.random() > 0.5 ? 1 : -1,
      damageAmount: 0,
      damageCooldown: Math.random() * 1.5,
      damageSide: Math.random() * TWO_PI,
      _activePulse: 0,
      lastActiveTierName: null,
    };
  }

  _getLodTierName(distanceToPlayer, previousTierName) {
    const hysteresis = 4;
    if (
      previousTierName === "near" &&
      distanceToPlayer < LOD_NEAR_DISTANCE + hysteresis
    )
      return "near";
    if (
      previousTierName === "medium" &&
      distanceToPlayer > LOD_NEAR_DISTANCE - hysteresis &&
      distanceToPlayer < LOD_MEDIUM_DISTANCE + hysteresis
    )
      return "medium";
    if (
      previousTierName === "far" &&
      distanceToPlayer > LOD_MEDIUM_DISTANCE - hysteresis
    )
      return "far";
    if (distanceToPlayer < LOD_NEAR_DISTANCE) return "near";
    if (distanceToPlayer < LOD_MEDIUM_DISTANCE) return "medium";
    return "far";
  }

  _updateBellShaderUniforms(tier, pulse, t, jelly) {
    const bellMaterial = tier.bell.material;
    if (!bellMaterial.userData || !bellMaterial.userData.shaderUniforms) return;
    const uniforms = bellMaterial.userData.shaderUniforms;
    uniforms.uContractionPhase.value = pulse;
    uniforms.uJellyTime.value = t;
    uniforms.uPulseTravel.value = Math.sin(t * 2 + jelly.phase) * 0.5 + 0.5;
    uniforms.uDamage.value = jelly.damageAmount;
    uniforms.uDamageSide.value = jelly.damageSide;
  }

  _animateTierAppendages(jelly, tier, pulse, t) {
    if (tier.farTrailGroup) {
      tier.farTrailGroup.rotation.y += 0.025 + Math.max(0, pulse) * 0.05;
      tier.farTrailGroup.rotation.x =
        tier.farTrailGroup.userData.baseRotX +
        Math.sin(t * 0.45 + jelly.phase) * 0.08;
      tier.farTrailGroup.rotation.z =
        tier.farTrailGroup.userData.baseRotZ +
        Math.cos(t * 0.38 + jelly.rollPhase) * 0.07;
      return;
    }

    for (const tent of tier.tentacles) {
      this._updateAppendageShaderUniforms(tent, jelly, pulse, t);
    }

    for (const arm of tier.oralArms) {
      this._updateAppendageShaderUniforms(arm, jelly, pulse, t);
    }

    this._updateNematocysts(tier.nematocysts, tier, jelly, t);
  }

  update(dt, playerPos) {
    // Drain one deferred jelly per frame to spread construction cost.
    if (this._pendingJellyIndex < this._pendingJellies.length) {
      const pending = this._pendingJellies[this._pendingJellyIndex++];
      const jelly = this._createJelly(pending.color);
      jelly.group.position.copy(pending.position);
      this.jellies.push(jelly);
      this.group.add(jelly.group);
      // Release references once fully drained.
      if (this._pendingJellyIndex >= this._pendingJellies.length) {
        this._pendingJellies.length = 0;
        this._pendingJellyIndex = 0;
      }
    }

    this.time += dt;
    this._frameCount++;

    for (const jelly of this.jellies) {
      const t = this.time;

      const dx = playerPos.x - jelly.group.position.x;
      const dy = playerPos.y - jelly.group.position.y;
      const dz = playerPos.z - jelly.group.position.z;
      const preMoveDistToPlayer = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const planarLength = Math.max(0.0001, Math.sqrt(dx * dx + dz * dz));
      jelly.playerDirX = dx / planarLength;
      jelly.playerDirZ = dz / planarLength;
      jelly.proximityInfluence = THREE.MathUtils.clamp(
        1 - preMoveDistToPlayer / 22,
        0,
        1,
      );

      const phaseSpeedScale = 1 + jelly.proximityInfluence * 0.7;
      const contractionSpeed = jelly.pulseSpeed * 1.45 * phaseSpeedScale;
      const relaxSpeed = jelly.pulseSpeed * 0.68 * phaseSpeedScale;
      const phaseSin = Math.sin(jelly.swimPhase);
      jelly.swimPhase += dt * (phaseSin >= 0 ? contractionSpeed : relaxSpeed);
      if (jelly.swimPhase > TWO_PI) jelly.swimPhase -= TWO_PI;

      const idlePulse = Math.sin(t * 0.35 + jelly.phase * 0.6) * 0.22;
      const pulse = Math.sin(jelly.swimPhase) * 0.85 + idlePulse * 0.15;
      jelly._activePulse = pulse;
      const contraction = Math.max(0, pulse);
      const relaxation = Math.max(0, -pulse);
      const propulsion = Math.pow(contraction, 1.7);
      const glideDrag = Math.pow(relaxation, 1.2);

      if (jelly.damageCooldown > 0) {
        jelly.damageCooldown -= dt;
      } else if (preMoveDistToPlayer < 2.3) {
        jelly.damageAmount = 1;
        jelly.damageCooldown = 2.2;
        jelly.damageSide = Math.atan2(dz, dx);
      }
      jelly.damageAmount = Math.max(0, jelly.damageAmount - dt * 0.6);

      const desiredVX =
        jelly.driftX * (0.32 + (1 - contraction) * 0.58) +
        jelly.playerDirX * jelly.proximityInfluence * jelly.reactionBias * 0.22;
      const desiredVY =
        jelly.verticalDrift + propulsion * 0.56 - glideDrag * 0.08;
      const desiredVZ =
        jelly.driftZ * (0.32 + (1 - contraction) * 0.58) +
        jelly.playerDirZ * jelly.proximityInfluence * jelly.reactionBias * 0.22;

      const inertia = 1 - Math.exp(-dt * 2.8);
      const drag = 1 - Math.exp(-dt * 1.7);
      jelly.velocityX =
        lerp(jelly.velocityX, desiredVX, inertia) * (1 - drag * 0.2);
      jelly.velocityY = lerp(jelly.velocityY, desiredVY, inertia);
      jelly.velocityZ =
        lerp(jelly.velocityZ, desiredVZ, inertia) * (1 - drag * 0.2);

      jelly.group.position.x += jelly.velocityX * dt;
      jelly.group.position.y += jelly.velocityY * dt;
      jelly.group.position.z += jelly.velocityZ * dt;

      const postMoveDx = playerPos.x - jelly.group.position.x;
      const postMoveDy = playerPos.y - jelly.group.position.y;
      const postMoveDz = playerPos.z - jelly.group.position.z;
      const distToPlayer = Math.sqrt(
        postMoveDx * postMoveDx +
          postMoveDy * postMoveDy +
          postMoveDz * postMoveDz,
      );

      const activeTierName = this._getLodTierName(
        distToPlayer,
        jelly.lastActiveTierName,
      );
      const activeTier = jelly.tiers[activeTierName];

      // Keep newly visible tiers in sync so LOD transitions don't reveal stale appendage geometry.
      if (jelly.lastActiveTierName !== activeTierName) {
        this._animateTierAppendages(jelly, activeTier, pulse, t);
        jelly.lastActiveTierName = activeTierName;
      }

      const pulseShape = Math.sign(pulse) * Math.pow(Math.abs(pulse), 1.4);
      const squishX = 1 + pulseShape * 0.11;
      const squishY = 1 - pulseShape * 0.16;

      this._updateBellShaderUniforms(jelly.tiers.near, pulseShape, t, jelly);
      this._updateBellShaderUniforms(jelly.tiers.medium, pulseShape, t, jelly);
      this._updateBellShaderUniforms(jelly.tiers.far, pulseShape, t, jelly);

      jelly.tiers.near.inner.scale.set(
        squishX * 0.98,
        squishY * 0.92,
        squishX * 0.98,
      );
      jelly.tiers.near.rim.scale.set(
        1 + contraction * 0.12,
        1,
        1 + contraction * 0.12,
      );
      jelly.tiers.medium.inner.scale.set(
        squishX * 0.98,
        squishY * 0.94,
        squishX * 0.98,
      );
      jelly.tiers.medium.rim.scale.set(
        1 + contraction * 0.08,
        1,
        1 + contraction * 0.08,
      );

      const jetOpacity = contraction > 0.16 ? (contraction - 0.16) * 0.55 : 0;
      jelly.tiers.near.jet.material.opacity = jetOpacity;
      jelly.tiers.near.jet.scale.set(
        1 + contraction * 1.8,
        1 + contraction * 1.6,
        1 + contraction * 1.8,
      );
      jelly.tiers.medium.jet.material.opacity = jetOpacity * 0.8;
      jelly.tiers.medium.jet.scale.set(
        1 + contraction * 1.4,
        1 + contraction * 1.3,
        1 + contraction * 1.4,
      );
      jelly.tiers.far.jet.material.opacity = jetOpacity * 0.6;

      jelly.light.intensity =
        activeTierName === "near" ? 0.12 + contraction * 0.28 : 0;
      jelly.sprite.material.opacity = 0.05 + contraction * 0.18;
      const farScale = THREE.MathUtils.clamp(distToPlayer / 120, 1, 2.1);
      jelly.sprite.scale.setScalar(jelly.size * 3 * farScale);

      if (this._frameCount % activeTier.animationInterval === 0) {
        this._animateTierAppendages(jelly, activeTier, pulse, t);
      }

      jelly.group.rotation.y += dt * (0.04 + propulsion * 0.03);
      jelly.group.rotation.x =
        Math.sin(t * 0.25 + jelly.rollPhase + jelly.velocityX * 0.6) * 0.07;
      jelly.group.rotation.z =
        Math.cos(t * 0.22 + jelly.rollPhase + jelly.velocityZ * 0.6) * 0.06;

      if (jelly.tiers.near.interior) {
        jelly.tiers.near.interior.manubrium.scale.y = 1 + contraction * 0.2;
        jelly.tiers.near.interior.gonadArms.rotation.y = t * 0.08;
      }
      if (jelly.tiers.medium.interior) {
        jelly.tiers.medium.interior.manubrium.scale.y = 1 + contraction * 0.14;
      }

      if (distToPlayer > JELLY_RESPAWN_DISTANCE) {
        jelly.group.position.set(
          playerPos.x + (Math.random() - 0.5) * 240,
          playerPos.y + (Math.random() - 0.5) * 60 - 14,
          playerPos.z + (Math.random() - 0.5) * 240,
        );
        jelly.velocityX = 0;
        jelly.velocityY = 0;
        jelly.velocityZ = 0;
      }
    }
  }

  getPosition() {
    return this.group.position;
  }

  getPositions() {
    return this.jellies.map((j) => j.group.position);
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (child.material.map) child.material.map.dispose();
        child.material.dispose();
      }
    });
  }
}
