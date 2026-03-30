import { performance } from "node:perf_hooks";

import * as THREE from "three";

const DT = 1 / 60;
const WARMUP_FRAMES = 90;
const MEASURE_FRAMES = 180;
const BENCHMARK_SEEDS = [101, 202, 303, 404, 505, 606];
const TOTAL_CREATURE_COUNTS = [4, 8, 16, 32];

const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI * 0.5;
const ROOT_BAND_THRESHOLD = 0.08;
const JELLY_ANIMATION_INTERVAL = 4;
const HERO_NORMAL_INTERVAL = 3;
const APPENDAGE_BOUNDS_PADDING = 0.35;

const JELLY_NEAR_PROFILE = {
  oralArmCount: 4,
  oralArmSegments: 14,
  oralArmRadialSegments: 10,
  oralArmRadiusScale: 1.0,
  tentacleMin: 10,
  tentacleMaxExtra: 4,
  tentacleSegments: 12,
  tentacleRadialSegments: 8,
  tentacleRadiusScale: 1.0,
  tentacleNematocystClusters: 6,
  appendageMotionScale: 1,
};

const DEEP_ONE_NEAR_PROFILE = {
  tentacleCount: 14,
  tentacleSegments: 24,
  tentacleRadial: 12,
  motionScale: 1.0,
};

const SIREN_NEAR_PROFILE = {
  membraneCount: 3,
  membraneSegments: [24, 16],
  membraneCpuStep: 1,
};

const MECH_NEAR_PROFILE = {
  mantleW: 48,
  mantleH: 32,
};

const _tmpPos = new THREE.Vector3();
const _tmpScale = new THREE.Vector3();
const _tmpMatrix = new THREE.Matrix4();
const _identityQuat = new THREE.Quaternion();

function createMulberry32(seed) {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function withSeededRandom(seed, callback) {
  const originalRandom = Math.random;
  Math.random = createMulberry32(seed);

  try {
    return callback();
  } finally {
    Math.random = originalRandom;
  }
}

function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values, ratio) {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * ratio;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);

  if (lowerIndex === upperIndex) {
    return sorted[lowerIndex];
  }

  const weight = position - lowerIndex;
  return sorted[lowerIndex] + (sorted[upperIndex] - sorted[lowerIndex]) * weight;
}

function reductionPercent(before, after) {
  if (before <= 0) return 0;
  return ((before - after) / before) * 100;
}

function formatMs(value) {
  return `${value.toFixed(3)} ms`;
}

function formatPercent(value) {
  return `${value.toFixed(2)}%`;
}

function formatCount(value) {
  return value.toFixed(2);
}

function writeMatrixAt(buffer, index, matrix) {
  buffer.set(matrix.elements, index * 16);
}

function createOperationCounters() {
  return {
    normalCalls: 0,
    boundingSphereCalls: 0,
  };
}

function inflateGeometryBounds(geometry, padding) {
  if (!padding) return;
  if (!geometry.boundingSphere) {
    geometry.computeBoundingSphere();
  }
  if (geometry.boundingSphere) {
    geometry.boundingSphere.radius += padding;
  }
}

function computeRootCenter(restPositions, minY, maxY) {
  const rootBand = maxY - Math.max((maxY - minY) * ROOT_BAND_THRESHOLD, 0.001);
  let rootX = 0;
  let rootZ = 0;
  let rootCount = 0;

  for (let index = 0; index < restPositions.length; index += 3) {
    if (restPositions[index + 1] < rootBand) continue;
    rootX += restPositions[index];
    rootZ += restPositions[index + 2];
    rootCount += 1;
  }

  return {
    x: rootCount > 0 ? rootX / rootCount : 0,
    z: rootCount > 0 ? rootZ / rootCount : 0,
  };
}

function createJellyAppendageShaderUniforms() {
  return {
    uAppendageTime: { value: 0 },
    uContractionPhase: { value: 0 },
    uDriftX: { value: 0 },
    uDriftZ: { value: 0 },
    uPlayerDirX: { value: 0 },
    uPlayerDirZ: { value: 0 },
    uProximityInfluence: { value: 0 },
  };
}

function createJellyAppendageDescriptor(geometry, options) {
  const positionAttr = geometry.attributes.position;
  const restPositions = Float32Array.from(positionAttr.array);
  let minY = Infinity;
  let maxY = -Infinity;

  for (let index = 0; index < restPositions.length; index += 3) {
    const y = restPositions[index + 1];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  inflateGeometryBounds(geometry, options.boundsPadding || 0);

  return {
    geometry,
    restPositions,
    rootCenter: computeRootCenter(restPositions, minY, maxY),
    minY,
    maxY,
    length: Math.max(maxY - minY, 0.001),
    shaderUniforms: createJellyAppendageShaderUniforms(),
    ...options,
  };
}

function createJellyOralArmFrillGeometry(curve, size, profile) {
  const frillGeometry = new THREE.TubeGeometry(
    curve,
    profile.oralArmSegments,
    (0.055 * size + 0.012) * profile.oralArmRadiusScale,
    3,
    false,
  );
  const positions = frillGeometry.attributes.position;

  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const y = positions.getY(index);
    const z = positions.getZ(index);
    const angle = Math.atan2(z, x);
    const ripple = Math.sin(angle * 6 + y * 8) * size * 0.01;
    positions.setX(index, x + Math.cos(angle) * ripple);
    positions.setZ(index, z + Math.sin(angle) * ripple);
  }

  frillGeometry.computeVertexNormals();
  return frillGeometry;
}

function createJellyNematocystSystem(tentacles, size, clusterCount, tierMotionScale) {
  if (!clusterCount || tentacles.length === 0) {
    return null;
  }

  const references = [];
  for (let tentacleIndex = 0; tentacleIndex < tentacles.length; tentacleIndex += 1) {
    const descriptor = tentacles[tentacleIndex];
    for (let clusterIndex = 0; clusterIndex < clusterCount; clusterIndex += 1) {
      const along = 0.2 + (clusterIndex / Math.max(1, clusterCount - 1)) * 0.72;
      let closestVertex = 0;
      let closestDelta = Infinity;

      for (let index = 0; index < descriptor.restPositions.length; index += 3) {
        const y = descriptor.restPositions[index + 1];
        const localAlong = THREE.MathUtils.clamp(
          (descriptor.maxY - y) / descriptor.length,
          0,
          1,
        );
        const delta = Math.abs(localAlong - along);
        if (delta < closestDelta) {
          closestDelta = delta;
          closestVertex = index / 3;
        }
      }

      references.push({
        appendageIndex: tentacleIndex,
        vertexIndex: closestVertex,
        baseScale: (0.012 + Math.random() * 0.018) * size,
        pulseOffset: Math.random() * TWO_PI,
        liftBias: (Math.random() - 0.5) * 0.02 * size,
      });
    }
  }

  return {
    references,
    tierMotionScale,
    matrices: new Float32Array(references.length * 16),
    pulseUniform: { value: 0 },
  };
}

function createJellyState() {
  const size = 0.5 + Math.random() * 1.5;
  const oralArms = [];
  const tentacles = [];

  for (let armIndex = 0; armIndex < JELLY_NEAR_PROFILE.oralArmCount; armIndex += 1) {
    const angle = (armIndex / JELLY_NEAR_PROFILE.oralArmCount) * TWO_PI;
    const armLength = size * 2.2 + Math.random() * size * 1.8;
    const rootRadius = size * (0.12 + Math.random() * 0.12);
    const points = [];

    for (let segmentIndex = 0; segmentIndex <= JELLY_NEAR_PROFILE.oralArmSegments; segmentIndex += 1) {
      const t = segmentIndex / JELLY_NEAR_PROFILE.oralArmSegments;
      const curl = Math.sin(t * Math.PI * 1.4 + angle) * (0.03 + 0.05 * t) * size;
      points.push(
        new THREE.Vector3(
          Math.cos(angle) * rootRadius * (1 - t * 0.55) +
            Math.cos(angle + HALF_PI) * curl,
          -size * 0.2 - t * armLength,
          Math.sin(angle) * rootRadius * (1 - t * 0.55) +
            Math.sin(angle + HALF_PI) * curl,
        ),
      );
    }

    const curve = new THREE.CatmullRomCurve3(points);
    const armGeometry = new THREE.TubeGeometry(
      curve,
      JELLY_NEAR_PROFILE.oralArmSegments,
      (0.04 * size + 0.01) * JELLY_NEAR_PROFILE.oralArmRadiusScale,
      JELLY_NEAR_PROFILE.oralArmRadialSegments,
      false,
    );

    oralArms.push(
      createJellyAppendageDescriptor(armGeometry, {
        type: "oral",
        modelScale: size,
        angle,
        dirX: Math.cos(angle),
        dirZ: Math.sin(angle),
        perpX: Math.cos(angle + HALF_PI),
        perpZ: Math.sin(angle + HALF_PI),
        phaseOffset: Math.random() * TWO_PI,
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

    const frillGeometry = createJellyOralArmFrillGeometry(
      curve,
      size,
      JELLY_NEAR_PROFILE,
    );
    oralArms.push(
      createJellyAppendageDescriptor(frillGeometry, {
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
    JELLY_NEAR_PROFILE.tentacleMin +
    Math.floor(Math.random() * JELLY_NEAR_PROFILE.tentacleMaxExtra);
  for (let tentacleIndex = 0; tentacleIndex < tentacleCount; tentacleIndex += 1) {
    const clusterPhase = (tentacleIndex / tentacleCount) * TWO_PI;
    const angle = clusterPhase + (Math.random() - 0.5) * 0.45;
    const radius = size * (0.58 + Math.random() * 0.22);
    const tentacleLength = size * 3.4 + Math.random() * size * 4.5;
    const rootYOffset = -size * (0.16 + Math.random() * 0.08);
    const points = [];

    for (let segmentIndex = 0; segmentIndex <= JELLY_NEAR_PROFILE.tentacleSegments; segmentIndex += 1) {
      const frac = segmentIndex / JELLY_NEAR_PROFILE.tentacleSegments;
      const lateralCurl =
        Math.sin(frac * TWO_PI + angle * 1.5) * 0.05 * frac * size;
      points.push(
        new THREE.Vector3(
          Math.cos(angle) * radius * (1 - frac * 0.48) +
            Math.cos(angle + HALF_PI) * lateralCurl,
          rootYOffset - frac * tentacleLength,
          Math.sin(angle) * radius * (1 - frac * 0.48) +
            Math.sin(angle + HALF_PI) * lateralCurl,
        ),
      );
    }

    const curve = new THREE.CatmullRomCurve3(points);
    const tentacleGeometry = new THREE.TubeGeometry(
      curve,
      JELLY_NEAR_PROFILE.tentacleSegments,
      (0.015 * size + 0.005) * JELLY_NEAR_PROFILE.tentacleRadiusScale,
      JELLY_NEAR_PROFILE.tentacleRadialSegments,
      false,
    );

    tentacles.push(
      createJellyAppendageDescriptor(tentacleGeometry, {
        type: "tentacle",
        modelScale: size,
        angle,
        dirX: Math.cos(angle),
        dirZ: Math.sin(angle),
        perpX: Math.cos(angle + HALF_PI),
        perpZ: Math.sin(angle + HALF_PI),
        phaseOffset: Math.random() * TWO_PI,
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

  return {
    size,
    phase: Math.random() * TWO_PI,
    rollPhase: Math.random() * TWO_PI,
    velocityX: 0,
    velocityZ: 0,
    playerDirX: 1,
    playerDirZ: 0,
    proximityInfluence: 0,
    activePulse: 0,
    oralArms,
    tentacles,
    nematocysts: createJellyNematocystSystem(
      tentacles,
      size,
      JELLY_NEAR_PROFILE.tentacleNematocystClusters,
      JELLY_NEAR_PROFILE.appendageMotionScale,
    ),
  };
}

function createDeepOneAppendageDescriptor(geometry, options) {
  const positionAttr = geometry.attributes.position;
  const restPositions = Float32Array.from(positionAttr.array);
  let minY = Infinity;
  let maxY = -Infinity;

  for (let index = 0; index < restPositions.length; index += 3) {
    const y = restPositions[index + 1];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  inflateGeometryBounds(geometry, options.boundsPadding ?? APPENDAGE_BOUNDS_PADDING);

  return {
    geometry,
    restPositions,
    rootCenter: computeRootCenter(restPositions, minY, maxY),
    minY,
    maxY,
    length: Math.max(maxY - minY, 0.001),
    ...options,
  };
}

function createDeepOneState(isHeroCandidate) {
  const tentacles = [];

  for (let tentacleIndex = 0; tentacleIndex < DEEP_ONE_NEAR_PROFILE.tentacleCount; tentacleIndex += 1) {
    const angle =
      (tentacleIndex / DEEP_ONE_NEAR_PROFILE.tentacleCount) * TWO_PI +
      (Math.random() - 0.5) * 0.3;
    const radius = 0.5 + Math.random() * 0.4;
    const length = 3 + Math.random() * 5;
    const points = [];

    for (let pointIndex = 0; pointIndex <= DEEP_ONE_NEAR_PROFILE.tentacleSegments; pointIndex += 1) {
      const frac = pointIndex / DEEP_ONE_NEAR_PROFILE.tentacleSegments;
      const initCurl = Math.sin(frac * Math.PI * 1.2 + angle) * 0.04 * frac;
      points.push(
        new THREE.Vector3(
          Math.cos(angle) * radius * (1 - frac * 0.5) +
            Math.cos(angle + HALF_PI) * initCurl,
          -frac * length,
          Math.sin(angle) * radius * (1 - frac * 0.5) +
            Math.sin(angle + HALF_PI) * initCurl,
        ),
      );
    }

    const curve = new THREE.CatmullRomCurve3(points);
    const geometry = new THREE.TubeGeometry(
      curve,
      DEEP_ONE_NEAR_PROFILE.tentacleSegments,
      0.12,
      DEEP_ONE_NEAR_PROFILE.tentacleRadial,
      false,
    );
    const positions = geometry.attributes.position;

    for (let index = 0; index < positions.count; index += 1) {
      const y = positions.getY(index);
      const taper = Math.max(0.1, 1 - THREE.MathUtils.clamp(-y / length, 0, 1) * 0.85);
      positions.setX(index, positions.getX(index) * taper);
      positions.setZ(index, positions.getZ(index) * taper);
    }
    geometry.computeVertexNormals();

    tentacles.push(
      createDeepOneAppendageDescriptor(geometry, {
        angle,
        dirX: Math.cos(angle),
        dirZ: Math.sin(angle),
        perpX: Math.cos(angle + HALF_PI),
        perpZ: Math.sin(angle + HALF_PI),
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
      }),
    );
  }

  return {
    isHeroCandidate,
    timeOffset: Math.random() * TWO_PI,
    velocityX: 0,
    velocityZ: 0,
    playerDirX: 1,
    playerDirZ: 0,
    proximityInfluence: 0,
    tentacles,
  };
}

function createMechOctopusState() {
  const geometry = new THREE.SphereGeometry(
    1.2,
    MECH_NEAR_PROFILE.mantleW,
    MECH_NEAR_PROFILE.mantleH,
  );
  geometry.scale(1, 1.3, 0.9);
  const positions = geometry.attributes.position;

  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const y = positions.getY(index);
    const z = positions.getZ(index);
    positions.setX(index, x + Math.sin(y * 10) * 0.02 + Math.sin(z * 6 + y * 4) * 0.015);
    positions.setY(index, y + Math.sin(x * 5 + z * 3) * 0.01);
  }
  geometry.computeVertexNormals();

  const originalPositions = new Float32Array(positions.array);
  const inverseLengths = new Float32Array(positions.count);
  for (let index = 0; index < positions.count; index += 1) {
    const ox = positions.getX(index);
    const oy = positions.getY(index);
    const oz = positions.getZ(index);
    const length = Math.sqrt(ox * ox + oy * oy + oz * oz);
    inverseLengths[index] = length > 0.001 ? 1 / length : 0;
  }

  return {
    geometry,
    positions,
    originalPositions,
    inverseLengths,
    alarmFlash: Math.random() * 0.5,
    phaseOffset: Math.random() * TWO_PI,
    mantleInflation: { value: 0 },
  };
}

function createSirenSkullState() {
  const membranes = [];
  const membranePhase = Math.random() * TWO_PI;

  for (let membraneIndex = 0; membraneIndex < SIREN_NEAR_PROFILE.membraneCount; membraneIndex += 1) {
    const width = 1.5 - membraneIndex * 0.2;
    const height = 0.8 + membraneIndex * 0.4;
    const phase = membranePhase + membraneIndex * 1.7;
    const geometry = new THREE.PlaneGeometry(
      width,
      height,
      SIREN_NEAR_PROFILE.membraneSegments[0],
      SIREN_NEAR_PROFILE.membraneSegments[1],
    );
    const positions = geometry.attributes.position;
    const uvs = geometry.attributes.uv;

    for (let index = 0; index < positions.count; index += 1) {
      const y = positions.getY(index);
      const uvx = uvs.getX(index);
      const edge = Math.abs(uvx * 2 - 1);
      positions.setZ(index, Math.sin(y * 3.2 + membraneIndex * 0.9) * 0.055 + edge * 0.01);
    }
    geometry.computeVertexNormals();

    membranes.push({
      geometry,
      position: positions,
      uv: uvs,
      base: new Float32Array(positions.array),
      phase,
      originalX: -1.36 - membraneIndex * 0.22,
      positionX: -1.36 - membraneIndex * 0.22,
    });
  }

  return {
    timeOffset: Math.random() * TWO_PI,
    songPhase: Math.random() * TWO_PI,
    velocity: new THREE.Vector3(),
    flutterUniform: { value: 0 },
    velocityUniform: new THREE.Vector3(),
    pulseUniform: { value: 0 },
    proximityUniform: { value: 0 },
    membranes,
  };
}

function createScene(seed, totalCreatureCount) {
  return withSeededRandom(seed, () => {
    const perFamilyCount = totalCreatureCount / 4;
    return {
      frame: 0,
      time: 0,
      operations: createOperationCounters(),
      jellyfish: Array.from({ length: perFamilyCount }, () => createJellyState()),
      deepOnes: Array.from({ length: perFamilyCount }, (_, index) =>
        createDeepOneState(index === 0),
      ),
      mechOctopuses: Array.from({ length: perFamilyCount }, () => createMechOctopusState()),
      sirenSkulls: Array.from({ length: perFamilyCount }, () => createSirenSkullState()),
    };
  });
}

function updateJellyMotionState(jelly, time) {
  jelly.velocityX = Math.sin(time * 0.9 + jelly.phase) * 0.32;
  jelly.velocityZ = Math.cos(time * 0.85 + jelly.rollPhase) * 0.28;
  const planar = Math.max(0.0001, Math.hypot(jelly.velocityX, jelly.velocityZ));
  jelly.playerDirX = jelly.velocityX / planar;
  jelly.playerDirZ = jelly.velocityZ / planar;
  jelly.proximityInfluence = THREE.MathUtils.clamp(
    0.55 + Math.sin(time * 0.42 + jelly.phase) * 0.45,
    0,
    1,
  );
  jelly.activePulse = Math.sin(time * 2.8 + jelly.phase);
}

function updateJellyAppendageUniforms(appendage, jelly, pulse, time) {
  const uniforms = appendage.shaderUniforms;
  uniforms.uAppendageTime.value = time;
  uniforms.uContractionPhase.value = pulse;
  uniforms.uDriftX.value = jelly.velocityX * appendage.trailFactor * 0.32;
  uniforms.uDriftZ.value = jelly.velocityZ * appendage.trailFactor * 0.32;
  uniforms.uPlayerDirX.value = jelly.playerDirX;
  uniforms.uPlayerDirZ.value = jelly.playerDirZ;
  uniforms.uProximityInfluence.value = jelly.proximityInfluence;
}

function evaluateJellyAppendagePoint(appendage, jelly, pulse, time, vertexIndex, target) {
  const rest = appendage.restPositions;
  const baseIndex = vertexIndex * 3;
  const contraction = Math.max(0, pulse);
  const relaxed = Math.max(0, -pulse);
  const flowFactor = 0.3 + relaxed * 0.82;
  const pulseSqueeze = 1 - contraction * appendage.radialPulse;
  const driftX = jelly.velocityX * appendage.trailFactor * 0.32;
  const driftZ = jelly.velocityZ * appendage.trailFactor * 0.32;
  const proximityWeight = jelly.proximityInfluence * appendage.proximityResponse;

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
    time * appendage.swaySpeed +
      appendage.phaseOffset +
      along * appendage.waveFrequency,
  );
  const waveB = Math.sin(
    time * appendage.secondarySpeed +
      appendage.phaseOffset * 0.67 +
      along * appendage.secondaryFrequency,
  );
  const lateral =
    (waveA * appendage.swayAmount + waveB * appendage.secondarySwayAmount) *
    flowFactor *
    tipWeight;
  const axial =
    Math.cos(
      time * appendage.twistSpeed +
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
      time * appendage.crossSpeed +
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
      appendage.perpX * (lateral + crossing + jelly.playerDirX * playerReact * 0.06) +
      appendage.dirX * (axial + driftX * tipWeight) +
      radialX * curl,
    baseY + vertical,
    appendage.rootCenter.z +
      radialZ * (radialScale + oralSpread) +
      appendage.perpZ * (lateral + crossing + jelly.playerDirZ * playerReact * 0.06) +
      appendage.dirZ * (axial + driftZ * tipWeight) +
      radialZ * curl,
  );

  return target;
}

function deformJellyAppendageLegacy(appendage, jelly, pulse, time, operations) {
  const positions = appendage.geometry.attributes.position;
  const array = positions.array;

  for (let vertexIndex = 0; vertexIndex < positions.count; vertexIndex += 1) {
    evaluateJellyAppendagePoint(appendage, jelly, pulse, time, vertexIndex, _tmpPos);
    const baseIndex = vertexIndex * 3;
    array[baseIndex] = _tmpPos.x;
    array[baseIndex + 1] = _tmpPos.y;
    array[baseIndex + 2] = _tmpPos.z;
  }

  positions.needsUpdate = true;
  appendage.geometry.computeVertexNormals();
  operations.normalCalls += 1;
  appendage.geometry.attributes.normal.needsUpdate = true;
  appendage.geometry.computeBoundingSphere();
  operations.boundingSphereCalls += 1;
}

function updateJellyNematocysts(system, tentacles, jelly, time) {
  if (!system) return;

  for (let index = 0; index < system.references.length; index += 1) {
    const ref = system.references[index];
    const appendage = tentacles[ref.appendageIndex];
    evaluateJellyAppendagePoint(
      appendage,
      jelly,
      jelly.activePulse,
      time,
      ref.vertexIndex,
      _tmpPos,
    );
    _tmpPos.y += ref.liftBias;
    _tmpScale.setScalar(
      ref.baseScale *
        (0.86 + Math.sin(time * 2.7 + ref.pulseOffset) * 0.17 * system.tierMotionScale),
    );
    _tmpMatrix.compose(_tmpPos, _identityQuat, _tmpScale);
    writeMatrixAt(system.matrices, index, _tmpMatrix);
  }

  system.pulseUniform.value = time;
}

function stepJellyfishLegacy(scene) {
  for (const jelly of scene.jellyfish) {
    updateJellyMotionState(jelly, scene.time);
    if (scene.frame % JELLY_ANIMATION_INTERVAL !== 0) continue;

    for (const tentacle of jelly.tentacles) {
      deformJellyAppendageLegacy(tentacle, jelly, jelly.activePulse, scene.time, scene.operations);
    }

    for (const arm of jelly.oralArms) {
      deformJellyAppendageLegacy(arm, jelly, jelly.activePulse, scene.time, scene.operations);
    }

    updateJellyNematocysts(jelly.nematocysts, jelly.tentacles, jelly, scene.time);
  }
}

function stepJellyfishCurrent(scene) {
  for (const jelly of scene.jellyfish) {
    updateJellyMotionState(jelly, scene.time);
    if (scene.frame % JELLY_ANIMATION_INTERVAL !== 0) continue;

    for (const tentacle of jelly.tentacles) {
      updateJellyAppendageUniforms(tentacle, jelly, jelly.activePulse, scene.time);
    }

    for (const arm of jelly.oralArms) {
      updateJellyAppendageUniforms(arm, jelly, jelly.activePulse, scene.time);
    }

    updateJellyNematocysts(jelly.nematocysts, jelly.tentacles, jelly, scene.time);
  }
}

function updateDeepOneMotionState(deepOne, time) {
  deepOne.velocityX = Math.sin(time * 0.55 + deepOne.timeOffset) * 0.24;
  deepOne.velocityZ = Math.cos(time * 0.48 + deepOne.timeOffset * 0.7) * 0.21;
  const planar = Math.max(0.0001, Math.hypot(deepOne.velocityX, deepOne.velocityZ));
  deepOne.playerDirX = deepOne.velocityX / planar;
  deepOne.playerDirZ = deepOne.velocityZ / planar;
  deepOne.proximityInfluence = THREE.MathUtils.clamp(
    0.45 + Math.sin(time * 0.31 + deepOne.timeOffset) * 0.35,
    0,
    1,
  );
}

function deformDeepOneAppendage(deepOne, appendage, time, motionScale, refreshNormals, refreshBounds, operations) {
  const positions = appendage.geometry.attributes.position;
  const array = positions.array;
  const rest = appendage.restPositions;
  const driftX = deepOne.velocityX * (appendage.trailFactor || 0.4) * 0.45;
  const driftZ = deepOne.velocityZ * (appendage.trailFactor || 0.4) * 0.45;
  const proxWeight = deepOne.proximityInfluence * (appendage.proximityResponse || 0.7);

  for (let index = 0; index < rest.length; index += 3) {
    const bx = rest[index];
    const by = rest[index + 1];
    const bz = rest[index + 2];
    const along = THREE.MathUtils.clamp((appendage.maxY - by) / appendage.length, 0, 1);
    const tip = along * along * (3 - 2 * along);
    const tipSq = tip * tip;

    const waveA =
      Math.sin(time * (appendage.swaySpeed || 0.3) + (appendage.phaseOffset || 0) + along * (appendage.waveFreq || 2.5)) *
      (appendage.swayAmt || 0.28) *
      motionScale *
      tip;
    const waveB =
      Math.sin(time * (appendage.secSpeed || 0.15) + (appendage.phaseOffset || 0) * 0.7 + along * (appendage.secFreq || 5)) *
      (appendage.secSwayAmt || 0.14) *
      motionScale *
      tip;
    const axialTwist =
      Math.cos(time * (appendage.twistSpeed || 0.18) + (appendage.phaseOffset || 0) + along * (appendage.waveFreq || 2.5) * 0.5) *
      (appendage.twistAmt || 0.07) *
      tip;
    const curl =
      Math.sin(time * (appendage.curlSpeed || 0.12) + (appendage.phaseOffset || 0)) *
      (appendage.curlAmt || 0.1) *
      tipSq;
    const vertical =
      Math.sin(time * (appendage.secSpeed || 0.15) * 0.8 + (appendage.phaseOffset || 0)) *
        (appendage.heaveAmt || 0.04) *
        tipSq -
      (appendage.dropAmt || 0.03) * along * 0.4;

    const radialX = bx - appendage.rootCenter.x;
    const radialZ = bz - appendage.rootCenter.z;
    const perpX = appendage.perpX || 0;
    const perpZ = appendage.perpZ || 0;
    const dirX = appendage.dirX || 0;
    const dirZ = appendage.dirZ || 0;

    array[index] =
      appendage.rootCenter.x +
      radialX +
      perpX * (waveA + waveB + deepOne.playerDirX * proxWeight * 0.1 * tip) +
      dirX * (axialTwist + driftX * tip) +
      radialX * curl;
    array[index + 1] = by + vertical;
    array[index + 2] =
      appendage.rootCenter.z +
      radialZ +
      perpZ * (waveA + waveB + deepOne.playerDirZ * proxWeight * 0.1 * tip) +
      dirZ * (axialTwist + driftZ * tip) +
      radialZ * curl;
  }

  positions.needsUpdate = true;
  if (refreshNormals) {
    appendage.geometry.computeVertexNormals();
    operations.normalCalls += 1;
    appendage.geometry.attributes.normal.needsUpdate = true;
  }
  if (refreshBounds) {
    appendage.geometry.computeBoundingSphere();
    operations.boundingSphereCalls += 1;
  }
}

function stepDeepOnesLegacy(scene) {
  for (const deepOne of scene.deepOnes) {
    updateDeepOneMotionState(deepOne, scene.time);
    for (const tentacle of deepOne.tentacles) {
      deformDeepOneAppendage(
        deepOne,
        tentacle,
        scene.time,
        DEEP_ONE_NEAR_PROFILE.motionScale,
        true,
        true,
        scene.operations,
      );
    }
  }
}

function stepDeepOnesCurrent(scene) {
  for (const deepOne of scene.deepOnes) {
    updateDeepOneMotionState(deepOne, scene.time);
    const refreshNormals =
      deepOne.isHeroCandidate && scene.frame % HERO_NORMAL_INTERVAL === 0;
    for (const tentacle of deepOne.tentacles) {
      deformDeepOneAppendage(
        deepOne,
        tentacle,
        scene.time,
        DEEP_ONE_NEAR_PROFILE.motionScale,
        refreshNormals,
        false,
        scene.operations,
      );
    }
  }
}

function stepMechOctopusesLegacy(scene) {
  for (const octopus of scene.mechOctopuses) {
    const pulse = Math.sin(scene.time * 2.2 + octopus.phaseOffset) * 0.5 + 0.5;
    const inflation = 0.04 * pulse + octopus.alarmFlash * 0.05;

    for (let index = 0; index < octopus.positions.count; index += 1) {
      const ox = octopus.originalPositions[index * 3];
      const oy = octopus.originalPositions[index * 3 + 1];
      const oz = octopus.originalPositions[index * 3 + 2];
      const scale = 1 + inflation * octopus.inverseLengths[index];
      octopus.positions.setXYZ(index, ox * scale, oy * scale, oz * scale);
    }

    octopus.positions.needsUpdate = true;
    octopus.geometry.computeVertexNormals();
    scene.operations.normalCalls += 1;
  }
}

function stepMechOctopusesCurrent(scene) {
  for (const octopus of scene.mechOctopuses) {
    const pulse = Math.sin(scene.time * 2.2 + octopus.phaseOffset) * 0.5 + 0.5;
    octopus.mantleInflation.value = 0.04 * pulse + octopus.alarmFlash * 0.05;
  }
}

function updateSirenMotionState(siren, time) {
  siren.velocity.set(
    Math.sin(time * 0.6 + siren.timeOffset) * 0.65,
    Math.sin(time * 0.38 + siren.timeOffset * 0.5) * 0.12,
    Math.cos(time * 0.52 + siren.timeOffset) * 0.58,
  );
}

function stepSirenSkullsLegacy(scene) {
  for (const siren of scene.sirenSkulls) {
    updateSirenMotionState(siren, scene.time);
    const proximity = THREE.MathUtils.clamp(
      0.5 + Math.sin(scene.time * 0.4 + siren.timeOffset) * 0.4,
      0,
      1,
    );

    for (let membraneIndex = 0; membraneIndex < siren.membranes.length; membraneIndex += 1) {
      const membrane = siren.membranes[membraneIndex];
      const posArray = membrane.position.array;
      const uvArray = membrane.uv.array;
      const velocityStretchX = siren.velocity.x * (0.08 + proximity * 0.04);
      const velocityStretchY = Math.abs(siren.velocity.y) * (0.06 + proximity * 0.04);

      for (let vertexIndex = 0; vertexIndex < membrane.position.count; vertexIndex += SIREN_NEAR_PROFILE.membraneCpuStep) {
        const positionIndex = vertexIndex * 3;
        const uvIndex = vertexIndex * 2;
        const u = uvArray[uvIndex];
        const v = uvArray[uvIndex + 1];
        const trail = 1 - v;
        const edge = Math.abs(u * 2 - 1);
        const propagation =
          Math.sin(scene.time * (2.4 + membraneIndex * 0.35) + trail * 8.5 + membrane.phase) *
          trail;
        const drag = Math.sin(scene.time * 6.8 + u * 14.0 + membraneIndex) * edge * trail;

        posArray[positionIndex] = membrane.base[positionIndex] + velocityStretchX * trail * 0.9;
        posArray[positionIndex + 1] =
          membrane.base[positionIndex + 1] - velocityStretchY * trail * 0.3;
        posArray[positionIndex + 2] =
          membrane.base[positionIndex + 2] +
          propagation * (0.09 + proximity * 0.05) +
          drag * 0.04;
      }

      membrane.position.needsUpdate = true;
      membrane.geometry.computeVertexNormals();
      scene.operations.normalCalls += 1;
      membrane.positionX = membrane.originalX - siren.velocity.length() * (0.06 + membraneIndex * 0.01);
    }
  }
}

function stepSirenSkullsCurrent(scene) {
  for (const siren of scene.sirenSkulls) {
    updateSirenMotionState(siren, scene.time);
    const proximity = THREE.MathUtils.clamp(
      0.5 + Math.sin(scene.time * 0.4 + siren.timeOffset) * 0.4,
      0,
      1,
    );
    const songPulse = 0.5 + Math.sin(scene.time * 2.8 + siren.songPhase) * 0.5;

    siren.flutterUniform.value = scene.time;
    siren.velocityUniform.copy(siren.velocity);
    siren.pulseUniform.value = songPulse;
    siren.proximityUniform.value = proximity;

    for (let membraneIndex = 0; membraneIndex < siren.membranes.length; membraneIndex += 1) {
      const membrane = siren.membranes[membraneIndex];
      membrane.positionX = membrane.originalX - siren.velocity.length() * (0.06 + membraneIndex * 0.01);
    }
  }
}

function stepLegacyScene(scene) {
  scene.frame += 1;
  scene.time += DT;
  stepJellyfishLegacy(scene);
  stepDeepOnesLegacy(scene);
  stepMechOctopusesLegacy(scene);
  stepSirenSkullsLegacy(scene);
}

function stepCurrentScene(scene) {
  scene.frame += 1;
  scene.time += DT;
  stepJellyfishCurrent(scene);
  stepDeepOnesCurrent(scene);
  stepMechOctopusesCurrent(scene);
  stepSirenSkullsCurrent(scene);
}

function disposeScene(scene) {
  for (const jelly of scene.jellyfish) {
    for (const appendage of [...jelly.oralArms, ...jelly.tentacles]) {
      appendage.geometry.dispose();
    }
  }

  for (const deepOne of scene.deepOnes) {
    for (const appendage of deepOne.tentacles) {
      appendage.geometry.dispose();
    }
  }

  for (const octopus of scene.mechOctopuses) {
    octopus.geometry.dispose();
  }

  for (const siren of scene.sirenSkulls) {
    for (const membrane of siren.membranes) {
      membrane.geometry.dispose();
    }
  }
}

function summarizeRun(frameTimes, scene) {
  return {
    meanFrameMs: mean(frameTimes),
    p95FrameMs: percentile(frameTimes, 0.95),
    maxFrameMs: percentile(frameTimes, 1),
    normalCallsPerFrame: scene.operations.normalCalls / MEASURE_FRAMES,
    boundingSphereCallsPerFrame: scene.operations.boundingSphereCalls / MEASURE_FRAMES,
  };
}

function measureScenario(seed, totalCreatureCount, step) {
  const scene = createScene(seed, totalCreatureCount);

  try {
    for (let frame = 0; frame < WARMUP_FRAMES; frame += 1) {
      step(scene);
    }

    scene.operations = createOperationCounters();
    const frameTimes = [];
    for (let frame = 0; frame < MEASURE_FRAMES; frame += 1) {
      const start = performance.now();
      step(scene);
      frameTimes.push(performance.now() - start);
    }

    return summarizeRun(frameTimes, scene);
  } finally {
    disposeScene(scene);
  }
}

function aggregateScenarioResults(results) {
  return {
    meanFrameMs: median(results.map((result) => result.meanFrameMs)),
    p95FrameMs: median(results.map((result) => result.p95FrameMs)),
    maxFrameMs: median(results.map((result) => result.maxFrameMs)),
    normalCallsPerFrame: median(results.map((result) => result.normalCallsPerFrame)),
    boundingSphereCallsPerFrame: median(results.map((result) => result.boundingSphereCallsPerFrame)),
  };
}

function buildMarkdownTableRows(rows) {
  return rows.join("\n");
}

function main() {
  const aggregateResults = [];

  for (const totalCreatureCount of TOTAL_CREATURE_COUNTS) {
    const legacyResults = BENCHMARK_SEEDS.map((seed) =>
      measureScenario(seed, totalCreatureCount, stepLegacyScene),
    );
    const currentResults = BENCHMARK_SEEDS.map((seed) =>
      measureScenario(seed, totalCreatureCount, stepCurrentScene),
    );

    aggregateResults.push({
      totalCreatureCount,
      legacy: aggregateScenarioResults(legacyResults),
      current: aggregateScenarioResults(currentResults),
    });
  }

  const first = aggregateResults[0];
  const last = aggregateResults[aggregateResults.length - 1];
  const meanSlopeLegacy =
    (last.legacy.meanFrameMs - first.legacy.meanFrameMs) /
    (last.totalCreatureCount - first.totalCreatureCount);
  const meanSlopeCurrent =
    (last.current.meanFrameMs - first.current.meanFrameMs) /
    (last.totalCreatureCount - first.totalCreatureCount);
  const p95SlopeLegacy =
    (last.legacy.p95FrameMs - first.legacy.p95FrameMs) /
    (last.totalCreatureCount - first.totalCreatureCount);
  const p95SlopeCurrent =
    (last.current.p95FrameMs - first.current.p95FrameMs) /
    (last.totalCreatureCount - first.totalCreatureCount);

  console.log("Creature deformation scaling profile");
  console.log("");
  console.log(`Command: npm run profile:creature-deformation`);
  console.log(`Warmup frames: ${WARMUP_FRAMES}`);
  console.log(`Measured frames: ${MEASURE_FRAMES}`);
  console.log(`Seeds: ${BENCHMARK_SEEDS.join(", ")}`);
  console.log(
    `Scene counts: ${TOTAL_CREATURE_COUNTS.join(", ")} total affected creatures (${TOTAL_CREATURE_COUNTS.map((count) => count / 4).join(", ")} per affected creature family)`,
  );
  console.log(
    "Scope: near-tier deformation hot paths only for Jellyfish, DeepOne, MechOctopus, and SirenSkull; one DeepOne per scene keeps the hero-only normal budget while all remaining DeepOnes stay on the default near path.",
  );
  console.log("");
  console.log("| Total affected creatures | Legacy mean | Current mean | Delta | Legacy P95 | Current P95 | Delta | Legacy max | Current max | Delta |");
  console.log("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  console.log(
    buildMarkdownTableRows(
      aggregateResults.map((result) =>
        `| ${result.totalCreatureCount} | ${formatMs(result.legacy.meanFrameMs)} | ${formatMs(result.current.meanFrameMs)} | ${formatPercent(reductionPercent(result.legacy.meanFrameMs, result.current.meanFrameMs))} lower | ${formatMs(result.legacy.p95FrameMs)} | ${formatMs(result.current.p95FrameMs)} | ${formatPercent(reductionPercent(result.legacy.p95FrameMs, result.current.p95FrameMs))} lower | ${formatMs(result.legacy.maxFrameMs)} | ${formatMs(result.current.maxFrameMs)} | ${formatPercent(reductionPercent(result.legacy.maxFrameMs, result.current.maxFrameMs))} lower |`,
      ),
    ),
  );
  console.log("");
  console.log("| Total affected creatures | Legacy normal recomputes / frame | Current normal recomputes / frame | Legacy bounds recomputes / frame | Current bounds recomputes / frame |");
  console.log("| --- | ---: | ---: | ---: | ---: |");
  console.log(
    buildMarkdownTableRows(
      aggregateResults.map(
        (result) =>
          `| ${result.totalCreatureCount} | ${formatCount(result.legacy.normalCallsPerFrame)} | ${formatCount(result.current.normalCallsPerFrame)} | ${formatCount(result.legacy.boundingSphereCallsPerFrame)} | ${formatCount(result.current.boundingSphereCallsPerFrame)} |`,
      ),
    ),
  );
  console.log("");
  console.log("| Scaling metric | Legacy | Current | Delta |");
  console.log("| --- | ---: | ---: | ---: |");
  console.log(
    `| Mean slope (${first.totalCreatureCount}->${last.totalCreatureCount}) | ${formatMs(meanSlopeLegacy)} / creature | ${formatMs(meanSlopeCurrent)} / creature | ${formatPercent(reductionPercent(meanSlopeLegacy, meanSlopeCurrent))} lower |`,
  );
  console.log(
    `| P95 slope (${first.totalCreatureCount}->${last.totalCreatureCount}) | ${formatMs(p95SlopeLegacy)} / creature | ${formatMs(p95SlopeCurrent)} / creature | ${formatPercent(reductionPercent(p95SlopeLegacy, p95SlopeCurrent))} lower |`,
  );
}

main();