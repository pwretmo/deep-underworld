import { performance } from "node:perf_hooks";

import * as THREE from "three";

import { createTerrainPayload as createCurrentTerrainPayload } from "../src/environment/chunkPayloadWorker.js";
import { PhysicsWorld } from "../src/physics/PhysicsWorld.js";
import { fbm2D, noise2D } from "../src/utils/noise.js";

const CHUNK_FINALIZATION_STAGES = [
  "geometry",
  "rocks",
  "terrainCollider",
  "rockColliders",
  "attach",
];
const CHUNK_SIZE = 80;
const RESOLUTION = 40;
const VIEW_DISTANCE = 3;
const MAX_IN_FLIGHT = 2;
const REQUESTS_PER_FRAME = 1;
const WORKER_LATENCY_FRAMES = 1;
const STREAM_FINALIZATION_BUDGET_MS = 4;
const MAX_FINALIZATION_STAGES_PER_SLICE = 8;
const FRAME_DT = 1 / 60;
const PLAYER_MOVE_SPEED = 15;
const PLAYER_DAMPENING = 3;
const BOUNDARY_CROSSINGS = 4;
const BENCHMARK_SEEDS = [101, 202, 303, 404, 505, 606];
const REPETITIONS_PER_SEED = 3;
const TERRAIN_ROCK_TYPE_COUNT = 4;
const TERRAIN_COLORS = {
  shallow: [0.6, 0.5, 0.3],
  mid: [0.3, 0.25, 0.2],
  deep: [0.15, 0.12, 0.15],
  abyss: [0.08, 0.05, 0.1],
};

const STEADY_STATE_FORWARD_SPEED =
  (PLAYER_MOVE_SPEED * (1 - PLAYER_DAMPENING * FRAME_DT)) / PLAYER_DAMPENING;

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

function hashSeed(seed, cx, cz) {
  let value = seed >>> 0;
  value ^= Math.imul((cx + 0x9e3779b9) >>> 0, 0x85ebca6b);
  value ^= Math.imul((cz + 0xc2b2ae35) >>> 0, 0x27d4eb2d);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return value >>> 0;
}

function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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

function max(values) {
  if (values.length === 0) return 0;
  return Math.max(...values);
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

function createLegacyTerrainPayload({ cx, cz, chunkSize, resolution }) {
  const offsetX = cx * chunkSize;
  const offsetZ = cz * chunkSize;
  const vertsPerSide = resolution + 1;
  const vertCount = vertsPerSide * vertsPerSide;

  const positions = new Float32Array(vertCount * 3);
  const colors = new Float32Array(vertCount * 3);
  const colliderVertices = new Float32Array(vertCount * 3);

  const step = chunkSize / resolution;
  const half = chunkSize * 0.5;
  let writeIndex = 0;

  for (let iz = 0; iz <= resolution; iz++) {
    const localZ = iz * step - half;

    for (let ix = 0; ix <= resolution; ix++) {
      const localX = ix * step - half;
      const worldX = localX + offsetX;
      const worldZ = localZ + offsetZ;
      const height = getTerrainHeight(worldX, worldZ);
      const baseDepth = getTerrainBaseDepth(worldX, worldZ);
      const y = baseDepth + height;

      positions[writeIndex] = localX;
      positions[writeIndex + 1] = y;
      positions[writeIndex + 2] = localZ;

      colliderVertices[writeIndex] = worldX;
      colliderVertices[writeIndex + 1] = y;
      colliderVertices[writeIndex + 2] = worldZ;

      const depth = -y;
      let color = TERRAIN_COLORS.abyss;
      if (depth < 80) color = TERRAIN_COLORS.shallow;
      else if (depth < 200) color = TERRAIN_COLORS.mid;
      else if (depth < 500) color = TERRAIN_COLORS.deep;

      const variation = noise2D(worldX * 0.1, worldZ * 0.1) * 0.05;
      colors[writeIndex] = color[0] + variation;
      colors[writeIndex + 1] = color[1] + variation;
      colors[writeIndex + 2] = color[2] + variation;

      writeIndex += 3;
    }
  }

  const triangleCount = resolution * resolution * 2;
  const indices = new Uint32Array(triangleCount * 3);
  let indexWrite = 0;

  for (let iz = 0; iz < resolution; iz++) {
    for (let ix = 0; ix < resolution; ix++) {
      const a = ix + vertsPerSide * iz;
      const b = ix + vertsPerSide * (iz + 1);
      const c = ix + 1 + vertsPerSide * (iz + 1);
      const d = ix + 1 + vertsPerSide * iz;

      indices[indexWrite++] = a;
      indices[indexWrite++] = b;
      indices[indexWrite++] = d;

      indices[indexWrite++] = b;
      indices[indexWrite++] = c;
      indices[indexWrite++] = d;
    }
  }

  const rockCount = 8 + Math.floor(Math.random() * 8);
  const rockTransforms = new Float32Array(rockCount * 9);
  const rockColliders = new Float32Array(rockCount * 4);
  const rockTypes = new Uint8Array(rockCount);
  const rockColors = new Float32Array(rockCount * 3);

  for (let index = 0; index < rockCount; index++) {
    const localX = (Math.random() - 0.5) * chunkSize * 0.8;
    const localZ = (Math.random() - 0.5) * chunkSize * 0.8;
    const worldX = localX + offsetX;
    const worldZ = localZ + offsetZ;
    const height = getTerrainHeight(worldX, worldZ);
    const baseDepth = getTerrainBaseDepth(worldX, worldZ);

    const scaleX = 1 + Math.random() * 4;
    const scaleY = scaleX * (0.5 + Math.random() * 0.8);
    const scaleZ = scaleX;
    const localY = baseDepth + height + scaleX * 0.3;

    const transformIndex = index * 9;
    rockTransforms[transformIndex] = localX;
    rockTransforms[transformIndex + 1] = localY;
    rockTransforms[transformIndex + 2] = localZ;
    rockTransforms[transformIndex + 3] = scaleX;
    rockTransforms[transformIndex + 4] = scaleY;
    rockTransforms[transformIndex + 5] = scaleZ;
    rockTransforms[transformIndex + 6] = Math.random();
    rockTransforms[transformIndex + 7] = Math.random();
    rockTransforms[transformIndex + 8] = Math.random();

    const radius = (scaleX + scaleY + scaleZ) / 3;
    const colliderIndex = index * 4;
    rockColliders[colliderIndex] = worldX;
    rockColliders[colliderIndex + 1] = localY;
    rockColliders[colliderIndex + 2] = worldZ;
    rockColliders[colliderIndex + 3] = radius;

    rockTypes[index] = Math.floor(Math.random() * TERRAIN_ROCK_TYPE_COUNT);

    const rockDepth = -localY;
    const colorIndex = index * 3;
    const variation = Math.random() * 0.08;
    if (rockDepth < 100) {
      rockColors[colorIndex] = 0.35 + variation;
      rockColors[colorIndex + 1] = 0.32 + variation * 0.8;
      rockColors[colorIndex + 2] = 0.28 + variation * 0.5;
    } else if (rockDepth < 300) {
      rockColors[colorIndex] = 0.25 + variation;
      rockColors[colorIndex + 1] = 0.22 + variation * 0.7;
      rockColors[colorIndex + 2] = 0.22 + variation;
    } else {
      rockColors[colorIndex] = 0.15 + variation;
      rockColors[colorIndex + 1] = 0.12 + variation * 0.5;
      rockColors[colorIndex + 2] = 0.16 + variation;
    }
  }

  return {
    positions,
    colors,
    indices,
    colliderVertices,
    rockTransforms,
    rockColliders,
    rockTypes,
    rockColors,
  };
}

function getTerrainHeight(x, z) {
  let height = fbm2D(x * 0.003, z * 0.003, 6) * 40;
  height += Math.abs(noise2D(x * 0.01, z * 0.01)) * 15;

  const trench = noise2D(x * 0.005 + 100, z * 0.005 + 100);
  if (trench > 0.3) {
    height -= (trench - 0.3) * 100;
  }

  return height;
}

function getTerrainBaseDepth(x, z) {
  return -80 - Math.abs(fbm2D(x * 0.001, z * 0.001)) * 600;
}

function createRockGeometries() {
  const geometries = [];
  geometries.push(distortGeo(new THREE.DodecahedronGeometry(1, 1), 0.15));
  geometries.push(distortGeo(new THREE.IcosahedronGeometry(1, 2), 0.1));

  const slab = new THREE.DodecahedronGeometry(1, 0);
  const slabPositions = slab.attributes.position;
  for (let index = 0; index < slabPositions.count; index++) {
    slabPositions.setY(index, slabPositions.getY(index) * 0.4);
  }
  geometries.push(distortGeo(slab, 0.08));

  const spire = new THREE.OctahedronGeometry(1, 1);
  const spirePositions = spire.attributes.position;
  for (let index = 0; index < spirePositions.count; index++) {
    spirePositions.setY(index, spirePositions.getY(index) * 1.6);
  }
  geometries.push(distortGeo(spire, 0.12));

  return geometries;
}

function distortGeo(geometry, amount) {
  const position = geometry.attributes.position;
  for (let index = 0; index < position.count; index++) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const hash = Math.sin(x * 12.9898 + y * 78.233 + z * 45.164) * 43758.5453;
    const delta = (hash - Math.floor(hash)) * amount;
    const length = Math.sqrt(x * x + y * y + z * z) || 1;
    position.setXYZ(
      index,
      x + (x / length) * delta,
      y + (y / length) * delta,
      z + (z / length) * delta,
    );
  }
  geometry.computeVertexNormals();
  return geometry;
}

function createEmptyStageTimings() {
  const timings = {};
  for (const stageName of CHUNK_FINALIZATION_STAGES) {
    timings[stageName] = 0;
  }
  return timings;
}

function measureStage(stageTimings, stageName, callback) {
  const start = performance.now();
  const result = callback();
  stageTimings[stageName] = performance.now() - start;
  return result;
}

function summarizeSamples(frameCosts, chunkSamples) {
  const activeFrameCosts = frameCosts.filter((cost) => cost > 0);
  const stageMeans = {};
  const stageMaximums = {};

  for (const stageName of CHUNK_FINALIZATION_STAGES) {
    const values = chunkSamples.map((sample) => sample.stages[stageName] || 0);
    stageMeans[stageName] = mean(values);
    stageMaximums[stageName] = max(values);
  }

  return {
    activeFrameCount: activeFrameCosts.length,
    completedChunks: chunkSamples.length,
    meanActiveFrameMs: mean(activeFrameCosts),
    p95ActiveFrameMs: percentile(activeFrameCosts, 0.95),
    maxActiveFrameMs: max(activeFrameCosts),
    meanChunkTotalMs: mean(chunkSamples.map((sample) => sample.totalMs)),
    p95ChunkTotalMs: percentile(
      chunkSamples.map((sample) => sample.totalMs),
      0.95,
    ),
    maxChunkTotalMs: max(chunkSamples.map((sample) => sample.totalMs)),
    stageMeans,
    stageMaximums,
  };
}

function summarizeAttempts(attempts) {
  const summaries = attempts.map((attempt) => attempt.summary);
  const stageMeans = {};
  const stageMaximums = {};

  for (const stageName of CHUNK_FINALIZATION_STAGES) {
    stageMeans[stageName] = median(
      summaries.map((summary) => summary.stageMeans[stageName]),
    );
    stageMaximums[stageName] = median(
      summaries.map((summary) => summary.stageMaximums[stageName]),
    );
  }

  return {
    activeFrameCount: Math.round(
      median(summaries.map((summary) => summary.activeFrameCount)),
    ),
    completedChunks: Math.round(
      median(summaries.map((summary) => summary.completedChunks)),
    ),
    meanActiveFrameMs: median(
      summaries.map((summary) => summary.meanActiveFrameMs),
    ),
    p95ActiveFrameMs: median(summaries.map((summary) => summary.p95ActiveFrameMs)),
    maxActiveFrameMs: median(summaries.map((summary) => summary.maxActiveFrameMs)),
    meanChunkTotalMs: median(
      summaries.map((summary) => summary.meanChunkTotalMs),
    ),
    p95ChunkTotalMs: median(summaries.map((summary) => summary.p95ChunkTotalMs)),
    maxChunkTotalMs: median(summaries.map((summary) => summary.maxChunkTotalMs)),
    stageMeans,
    stageMaximums,
  };
}

class ChunkApplyBenchmark {
  constructor(mode, seed) {
    this.mode = mode;
    this.seed = seed;
    this.scene = new THREE.Scene();
    this.physicsWorld = new PhysicsWorld();
    this.chunks = new Map();
    this.lastChunkX = null;
    this.lastChunkZ = null;
    this._neededChunkKeys = new Set();
    this._pendingChunks = [];
    this._inFlight = [];
    this._readyPayloads = [];
    this._pendingFinalizations = [];
    this._pendingFinalizationKeys = new Set();
    this._activeFinalization = null;
    this._frameCosts = [];
    this._chunkSamples = [];
    this._rockGeometries = createRockGeometries();
    this._rockMaterial = new THREE.MeshBasicMaterial({ color: 0x888890 });
    this._terrainMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });
  }

  async init() {
    await this.physicsWorld.init();
  }

  dispose() {
    for (const mesh of this.chunks.values()) {
      this._disposeMesh(mesh);
    }
    this.chunks.clear();

    if (this._activeFinalization) {
      this._disposePendingFinalization(this._activeFinalization);
      this._activeFinalization = null;
    }

    for (const job of this._pendingFinalizations) {
      this._disposePendingFinalization(job);
    }
    this._pendingFinalizations = [];
    this._pendingFinalizationKeys.clear();
    this._readyPayloads = [];
    this._inFlight = [];

    for (const geometry of this._rockGeometries) {
      geometry.dispose();
    }
    this._rockMaterial.dispose();
    this._terrainMaterial.dispose();
    this.physicsWorld.dispose();
  }

  resetMetrics() {
    this._frameCosts = [];
    this._chunkSamples = [];
  }

  preloadPrepareAround(playerPos) {
    const cx = Math.round(playerPos.x / CHUNK_SIZE);
    const cz = Math.round(playerPos.z / CHUNK_SIZE);
    this.lastChunkX = cx;
    this.lastChunkZ = cz;
    this._rebuildPendingAround(cx, cz);
  }

  update(frameIndex, playerPos) {
    this._flushReadyPayloads(frameIndex);

    let frameCost = 0;
    if (this.mode === "legacy") {
      frameCost += this._applyReadyPayloads(1);
    } else {
      frameCost += this._drainFinalizationStages(
        MAX_FINALIZATION_STAGES_PER_SLICE,
        STREAM_FINALIZATION_BUDGET_MS,
      );
    }

    this._requestPendingChunks(REQUESTS_PER_FRAME, frameIndex);

    const cx = Math.round(playerPos.x / CHUNK_SIZE);
    const cz = Math.round(playerPos.z / CHUNK_SIZE);
    if (cx !== this.lastChunkX || cz !== this.lastChunkZ) {
      this.lastChunkX = cx;
      this.lastChunkZ = cz;
      this._rebuildPendingAround(cx, cz);
    }

    this._frameCosts.push(frameCost);
    return frameCost;
  }

  isSettled() {
    if (this._pendingChunks.length > 0) return false;
    if (this._inFlight.length > 0) return false;
    if (this._readyPayloads.length > 0) return false;
    if (this.mode === "current") {
      if (this._pendingFinalizations.length > 0) return false;
      if (this._activeFinalization) return false;
    }
    return true;
  }

  getSummary() {
    return summarizeSamples(this._frameCosts, this._chunkSamples);
  }

  _flushReadyPayloads(frameIndex) {
    if (this._inFlight.length === 0) return;

    const remaining = [];
    for (const entry of this._inFlight) {
      if (entry.readyFrame > frameIndex) {
        remaining.push(entry);
        continue;
      }

      if (!this._neededChunkKeys.has(entry.key) || this.chunks.has(entry.key)) {
        continue;
      }

      if (this.mode === "legacy") {
        this._readyPayloads.push(entry);
      } else if (!this._pendingFinalizationKeys.has(entry.key)) {
        this._enqueueFinalization(entry);
      }
    }

    this._inFlight = remaining;
  }

  _requestPendingChunks(maxCount, frameIndex) {
    let requested = 0;

    while (this._pendingChunks.length > 0 && requested < maxCount) {
      if (this._inFlight.length >= MAX_IN_FLIGHT) break;

      const next = this._pendingChunks.shift();
      if (!next) break;

      if (
        this.chunks.has(next.key) ||
        this._inFlight.some((entry) => entry.key === next.key) ||
        !this._neededChunkKeys.has(next.key)
      ) {
        continue;
      }

      if (
        this.mode === "current" &&
        this._pendingFinalizationKeys.has(next.key)
      ) {
        continue;
      }

      const payload = this._createPayload(next.cx, next.cz);
      this._inFlight.push({
        ...next,
        payload,
        readyFrame: frameIndex + WORKER_LATENCY_FRAMES,
      });
      requested += 1;
    }
  }

  _createPayload(cx, cz) {
    const chunkSeed = hashSeed(this.seed, cx, cz);
    return withSeededRandom(chunkSeed, () => {
      if (this.mode === "legacy") {
        return createLegacyTerrainPayload({
          cx,
          cz,
          chunkSize: CHUNK_SIZE,
          resolution: RESOLUTION,
        });
      }

      return createCurrentTerrainPayload({
        cx,
        cz,
        chunkSize: CHUNK_SIZE,
        resolution: RESOLUTION,
      });
    });
  }

  _enqueueFinalization(entry) {
    this._pendingFinalizationKeys.add(entry.key);
    this._pendingFinalizations.push({
      key: entry.key,
      cx: entry.cx,
      cz: entry.cz,
      payload: entry.payload,
      mesh: null,
      geometry: null,
      stageIndex: 0,
      stageTimings: createEmptyStageTimings(),
    });
  }

  _takeNextFinalization() {
    while (this._pendingFinalizations.length > 0) {
      const job = this._pendingFinalizations.shift();
      if (!job) break;

      if (!this._neededChunkKeys.has(job.key) || this.chunks.has(job.key)) {
        this._disposePendingFinalization(job);
        continue;
      }

      return job;
    }

    return null;
  }

  _drainFinalizationStages(maxStages, maxCostMs) {
    if (maxStages <= 0 || maxCostMs <= 0) return 0;

    let completedStages = 0;
    let frameCost = 0;
    const sliceStart = performance.now();

    while (completedStages < maxStages) {
      if (performance.now() - sliceStart >= maxCostMs) break;

      if (!this._activeFinalization) {
        this._activeFinalization = this._takeNextFinalization();
        if (!this._activeFinalization) break;
      }

      const job = this._activeFinalization;
      if (!this._neededChunkKeys.has(job.key) || this.chunks.has(job.key)) {
        this._disposePendingFinalization(job);
        this._activeFinalization = null;
        continue;
      }

      const stageName = CHUNK_FINALIZATION_STAGES[job.stageIndex];
      if (!stageName) {
        this._disposePendingFinalization(job);
        this._activeFinalization = null;
        continue;
      }

      measureStage(job.stageTimings, stageName, () => {
        this._runCurrentStage(job, stageName);
      });

      frameCost += job.stageTimings[stageName];
      job.stageIndex += 1;
      completedStages += 1;

      if (job.stageIndex >= CHUNK_FINALIZATION_STAGES.length) {
        this._recordChunkSample(job);
        this._pendingFinalizationKeys.delete(job.key);
        job.payload = null;
        this._activeFinalization = null;
      }
    }

    return frameCost;
  }

  _applyReadyPayloads(maxCount) {
    let applied = 0;
    let frameCost = 0;

    while (this._readyPayloads.length > 0 && applied < maxCount) {
      const next = this._readyPayloads.shift();
      if (!next) break;

      if (!this._neededChunkKeys.has(next.key) || this.chunks.has(next.key)) {
        continue;
      }

      const stageTimings = createEmptyStageTimings();

      const { geometry, mesh } = measureStage(stageTimings, "geometry", () => {
        const builtGeometry = new THREE.BufferGeometry();
        builtGeometry.setAttribute(
          "position",
          new THREE.BufferAttribute(next.payload.positions, 3),
        );
        builtGeometry.setAttribute(
          "color",
          new THREE.BufferAttribute(next.payload.colors, 3),
        );
        builtGeometry.setIndex(new THREE.BufferAttribute(next.payload.indices, 1));
        builtGeometry.computeVertexNormals();

        const builtMesh = new THREE.Mesh(builtGeometry, this._terrainMaterial);
        builtMesh.position.set(next.cx * CHUNK_SIZE, 0, next.cz * CHUNK_SIZE);
        builtMesh.receiveShadow = true;

        return { geometry: builtGeometry, mesh: builtMesh };
      });

      measureStage(stageTimings, "rocks", () => {
        this._addLegacyRockVisuals(mesh, next.payload);
      });

      measureStage(stageTimings, "terrainCollider", () => {
        this._createChunkCollider(mesh, next.payload.colliderVertices, next.payload.indices);
      });

      measureStage(stageTimings, "rockColliders", () => {
        this._createLegacyRockColliders(mesh, next.payload);
      });

      measureStage(stageTimings, "attach", () => {
        this.scene.add(mesh);
        this.chunks.set(next.key, mesh);
      });

      const totalMs = CHUNK_FINALIZATION_STAGES.reduce(
        (sum, stageName) => sum + stageTimings[stageName],
        0,
      );

      this._chunkSamples.push({
        key: next.key,
        totalMs,
        stages: stageTimings,
      });

      frameCost += totalMs;
      applied += 1;
      next.payload = null;
      void geometry;
    }

    return frameCost;
  }

  _runCurrentStage(job, stageName) {
    if (stageName === "geometry") {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(job.payload.positions, 3));
      geometry.setAttribute("normal", new THREE.BufferAttribute(job.payload.normals, 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(job.payload.colors, 3));
      geometry.setIndex(new THREE.BufferAttribute(job.payload.indices, 1));

      const mesh = new THREE.Mesh(geometry, this._terrainMaterial);
      mesh.position.set(job.cx * CHUNK_SIZE, 0, job.cz * CHUNK_SIZE);
      mesh.receiveShadow = true;

      job.geometry = geometry;
      job.mesh = mesh;
      return;
    }

    if (stageName === "rocks") {
      this._addCurrentRockVisuals(job.mesh, job.payload);
      return;
    }

    if (stageName === "terrainCollider") {
      this._createChunkCollider(job.mesh, job.payload.colliderVertices, job.payload.indices);
      return;
    }

    if (stageName === "rockColliders") {
      this._createCurrentRockColliders(job.mesh, job.payload);
      return;
    }

    if (stageName === "attach") {
      this.scene.add(job.mesh);
      this.chunks.set(job.key, job.mesh);
    }
  }

  _recordChunkSample(job) {
    const totalMs = CHUNK_FINALIZATION_STAGES.reduce(
      (sum, stageName) => sum + (job.stageTimings[stageName] || 0),
      0,
    );

    this._chunkSamples.push({
      key: job.key,
      totalMs,
      stages: { ...job.stageTimings },
    });
  }

  _createChunkCollider(mesh, vertices, indices) {
    const handle = this.physicsWorld.createTrimeshCollider(vertices, indices);
    const handles = mesh.userData.physicsColliderHandles || [];
    handles.push(handle);
    mesh.userData.physicsColliderHandles = handles;
  }

  _addLegacyRockVisuals(parent, payload) {
    const count = payload.rockTransforms.length / 9;
    if (count <= 0) return;

    const groups = Array.from({ length: this._rockGeometries.length }, () => []);
    for (let index = 0; index < count; index++) {
      const type = payload.rockTypes ? payload.rockTypes[index] % this._rockGeometries.length : index % this._rockGeometries.length;
      groups[type].push(index);
    }

    const dummy = new THREE.Object3D();
    const tempColor = new THREE.Color();

    for (let type = 0; type < groups.length; type++) {
      const indices = groups[type];
      if (indices.length === 0) continue;

      const instanced = new THREE.InstancedMesh(
        this._rockGeometries[type],
        this._rockMaterial,
        indices.length,
      );
      instanced.castShadow = true;
      instanced.receiveShadow = true;

      if (payload.rockColors) {
        instanced.instanceColor = new THREE.InstancedBufferAttribute(
          new Float32Array(indices.length * 3),
          3,
        );
      }

      for (let instanceIndex = 0; instanceIndex < indices.length; instanceIndex++) {
        const rockIndex = indices[instanceIndex];
        const transformIndex = rockIndex * 9;
        dummy.position.set(
          payload.rockTransforms[transformIndex],
          payload.rockTransforms[transformIndex + 1],
          payload.rockTransforms[transformIndex + 2],
        );
        dummy.scale.set(
          payload.rockTransforms[transformIndex + 3],
          payload.rockTransforms[transformIndex + 4],
          payload.rockTransforms[transformIndex + 5],
        );
        dummy.rotation.set(
          payload.rockTransforms[transformIndex + 6],
          payload.rockTransforms[transformIndex + 7],
          payload.rockTransforms[transformIndex + 8],
        );
        dummy.updateMatrix();
        instanced.setMatrixAt(instanceIndex, dummy.matrix);

        if (payload.rockColors) {
          const colorIndex = rockIndex * 3;
          tempColor.setRGB(
            payload.rockColors[colorIndex],
            payload.rockColors[colorIndex + 1],
            payload.rockColors[colorIndex + 2],
          );
          instanced.setColorAt(instanceIndex, tempColor);
        }
      }

      instanced.instanceMatrix.needsUpdate = true;
      if (instanced.instanceColor) {
        instanced.instanceColor.needsUpdate = true;
      }

      parent.add(instanced);
    }
  }

  _createLegacyRockColliders(parent, payload) {
    const count = payload.rockColliders.length / 4;
    if (count <= 0) return;

    const handles = parent.userData.physicsColliderHandles || [];
    for (let index = 0; index < count; index++) {
      const colliderIndex = index * 4;
      handles.push(
        this.physicsWorld.createSphereCollider(
          payload.rockColliders[colliderIndex],
          payload.rockColliders[colliderIndex + 1],
          payload.rockColliders[colliderIndex + 2],
          payload.rockColliders[colliderIndex + 3],
        ),
      );
    }
    parent.userData.physicsColliderHandles = handles;
  }

  _addCurrentRockVisuals(parent, payload) {
    const batches = payload.rockBatches || [];
    for (const batch of batches) {
      const geometry = this._rockGeometries[batch.type % this._rockGeometries.length];
      const count = batch.matrices.length / 16;
      if (!geometry || count <= 0) continue;

      const instanced = new THREE.InstancedMesh(geometry, this._rockMaterial, count);
      instanced.castShadow = true;
      instanced.receiveShadow = true;
      instanced.instanceMatrix.array.set(batch.matrices);
      instanced.instanceMatrix.needsUpdate = true;

      if (batch.colors && batch.colors.length > 0) {
        instanced.instanceColor = new THREE.InstancedBufferAttribute(batch.colors, 3);
        instanced.instanceColor.needsUpdate = true;
      }

      parent.add(instanced);
    }
  }

  _createCurrentRockColliders(parent, payload) {
    if (!payload.rockColliders || payload.rockColliders.length === 0) return;

    const handles = this.physicsWorld.createSphereColliders(payload.rockColliders);
    if (handles.length === 0) return;

    const colliderHandles = parent.userData.physicsColliderHandles || [];
    colliderHandles.push(...handles);
    parent.userData.physicsColliderHandles = colliderHandles;
  }

  _disposePendingFinalization(job) {
    if (!job) return;

    if (job.mesh?.userData?.physicsColliderHandles) {
      for (const handle of job.mesh.userData.physicsColliderHandles) {
        this.physicsWorld.removeCollider(handle);
      }
      job.mesh.userData.physicsColliderHandles = [];
    }

    if (job.mesh) {
      this.scene.remove(job.mesh);
      this._disposeMesh(job.mesh);
    }

    this._pendingFinalizationKeys.delete(job.key);
    job.payload = null;
  }

  _disposeMesh(mesh) {
    if (mesh.userData.physicsColliderHandles) {
      for (const handle of mesh.userData.physicsColliderHandles) {
        this.physicsWorld.removeCollider(handle);
      }
      mesh.userData.physicsColliderHandles = [];
    }

    this.scene.remove(mesh);
    mesh.geometry?.dispose();
    mesh.clear();
  }

  _rebuildPendingAround(cx, cz) {
    const needed = new Set();
    for (let dx = -VIEW_DISTANCE; dx <= VIEW_DISTANCE; dx++) {
      for (let dz = -VIEW_DISTANCE; dz <= VIEW_DISTANCE; dz++) {
        needed.add(`${cx + dx},${cz + dz}`);
      }
    }
    this._neededChunkKeys = needed;

    this._inFlight = this._inFlight.filter((entry) => needed.has(entry.key));
    this._readyPayloads = this._readyPayloads.filter((entry) => needed.has(entry.key));

    if (this._activeFinalization) {
      if (!needed.has(this._activeFinalization.key) || this.chunks.has(this._activeFinalization.key)) {
        this._disposePendingFinalization(this._activeFinalization);
        this._activeFinalization = null;
      }
    }

    const retainedFinalizations = [];
    for (const job of this._pendingFinalizations) {
      if (!needed.has(job.key) || this.chunks.has(job.key)) {
        this._disposePendingFinalization(job);
        continue;
      }
      retainedFinalizations.push(job);
    }
    this._pendingFinalizations = retainedFinalizations;

    for (const [key, mesh] of this.chunks) {
      if (!needed.has(key)) {
        this._disposeMesh(mesh);
        this.chunks.delete(key);
      }
    }

    this._pendingChunks = [];
    for (const key of needed) {
      if (this.chunks.has(key)) continue;
      if (this._inFlight.some((entry) => entry.key === key)) continue;
      if (this._readyPayloads.some((entry) => entry.key === key)) continue;
      if (this._pendingFinalizationKeys.has(key)) continue;

      const [chunkX, chunkZ] = key.split(",").map(Number);
      this._pendingChunks.push({ key, cx: chunkX, cz: chunkZ });
    }
  }
}

async function warmUpBenchmark() {
  for (const mode of ["legacy", "current"]) {
    const benchmark = new ChunkApplyBenchmark(mode, 0);
    await benchmark.init();

    try {
      const playerPos = { x: 0, z: 0 };
      benchmark.preloadPrepareAround(playerPos);
      let frameIndex = 0;
      while (
        (!benchmark.isSettled() || benchmark.chunks.size !== benchmark._neededChunkKeys.size) &&
        frameIndex < 400
      ) {
        benchmark.update(frameIndex, playerPos);
        frameIndex += 1;
      }
    } finally {
      benchmark.dispose();
    }
  }
}

async function runSeedAttempt(mode, seed) {
  const benchmark = new ChunkApplyBenchmark(mode, seed);
  await benchmark.init();

  try {
    const playerPos = { x: 0, z: 0 };
    benchmark.preloadPrepareAround(playerPos);

    let frameIndex = 0;
    while (
      (!benchmark.isSettled() || benchmark.chunks.size !== benchmark._neededChunkKeys.size) &&
      frameIndex < 2000
    ) {
      benchmark.update(frameIndex, playerPos);
      frameIndex += 1;
    }

    if (!benchmark.isSettled() || benchmark.chunks.size !== benchmark._neededChunkKeys.size) {
      throw new Error(`${mode} preload did not settle for seed ${seed}`);
    }

    benchmark.resetMetrics();

    const targetX = BOUNDARY_CROSSINGS * CHUNK_SIZE;
    let settledAfterTravelFrames = 0;

    while (frameIndex < 20000) {
      if (playerPos.x < targetX) {
        playerPos.x = Math.min(targetX, playerPos.x + STEADY_STATE_FORWARD_SPEED * FRAME_DT);
      }

      benchmark.update(frameIndex, playerPos);
      frameIndex += 1;

      if (playerPos.x >= targetX && benchmark.isSettled()) {
        settledAfterTravelFrames += 1;
        if (settledAfterTravelFrames >= 30) break;
      } else {
        settledAfterTravelFrames = 0;
      }
    }

    if (settledAfterTravelFrames < 30) {
      throw new Error(`${mode} traversal did not settle for seed ${seed}`);
    }

    return {
      seed,
      mode,
      summary: benchmark.getSummary(),
    };
  } finally {
    benchmark.dispose();
  }
}

async function runSeed(mode, seed) {
  const attempts = [];

  for (let attemptIndex = 0; attemptIndex < REPETITIONS_PER_SEED; attemptIndex++) {
    attempts.push(await runSeedAttempt(mode, seed));
  }

  return {
    seed,
    mode,
    attempts,
    summary: summarizeAttempts(attempts),
  };
}

function aggregateMode(seedRuns) {
  const stageMeans = {};
  const stageMaximums = {};

  for (const stageName of CHUNK_FINALIZATION_STAGES) {
    stageMeans[stageName] = mean(
      seedRuns.map((run) => run.summary.stageMeans[stageName]),
    );
    stageMaximums[stageName] = max(
      seedRuns.map((run) => run.summary.stageMaximums[stageName]),
    );
  }

  return {
    activeFrameCount: Math.round(
      mean(seedRuns.map((run) => run.summary.activeFrameCount)),
    ),
    completedChunks: Math.round(
      mean(seedRuns.map((run) => run.summary.completedChunks)),
    ),
    meanActiveFrameMs: mean(
      seedRuns.map((run) => run.summary.meanActiveFrameMs),
    ),
    p95ActiveFrameMs: mean(seedRuns.map((run) => run.summary.p95ActiveFrameMs)),
    maxActiveFrameMs: max(seedRuns.map((run) => run.summary.maxActiveFrameMs)),
    meanChunkTotalMs: mean(
      seedRuns.map((run) => run.summary.meanChunkTotalMs),
    ),
    p95ChunkTotalMs: mean(seedRuns.map((run) => run.summary.p95ChunkTotalMs)),
    maxChunkTotalMs: max(seedRuns.map((run) => run.summary.maxChunkTotalMs)),
    stageMeans,
    stageMaximums,
  };
}

function printReport(legacyRuns, currentRuns) {
  const legacy = aggregateMode(legacyRuns);
  const current = aggregateMode(currentRuns);
  const maxSeedSpikeReductions = legacyRuns.map((legacyRun, index) => {
    const currentRun = currentRuns[index];
    return {
      seed: legacyRun.seed,
      legacyMax: legacyRun.summary.maxActiveFrameMs,
      currentMax: currentRun.summary.maxActiveFrameMs,
      reduction: reductionPercent(
        legacyRun.summary.maxActiveFrameMs,
        currentRun.summary.maxActiveFrameMs,
      ),
    };
  });

  console.log("Terrain chunk-apply traversal profile");
  console.log("");
  console.log(`Seeds: ${BENCHMARK_SEEDS.join(", ")}`);
  console.log(`Repetitions per seed: ${REPETITIONS_PER_SEED} (median summary)`);
  console.log(
    `Scenario: high-tier view distance ${VIEW_DISTANCE}, steady +X traversal at ${STEADY_STATE_FORWARD_SPEED.toFixed(2)} m/s, ${BOUNDARY_CROSSINGS} chunk-boundary crossings, 60 FPS stream loop, ${WORKER_LATENCY_FRAMES}-frame worker delivery delay`,
  );
  console.log("");
  console.log("Aggregate traversal metrics");
  console.log(`- Legacy mean active-frame apply: ${formatMs(legacy.meanActiveFrameMs)}`);
  console.log(`- Current mean active-frame apply: ${formatMs(current.meanActiveFrameMs)}`);
  console.log(`- Legacy p95 active-frame apply: ${formatMs(legacy.p95ActiveFrameMs)}`);
  console.log(`- Current p95 active-frame apply: ${formatMs(current.p95ActiveFrameMs)}`);
  console.log(`- Legacy max active-frame spike: ${formatMs(legacy.maxActiveFrameMs)}`);
  console.log(`- Current max active-frame spike: ${formatMs(current.maxActiveFrameMs)}`);
  console.log(
    `- Max active-frame spike reduction: ${formatPercent(reductionPercent(legacy.maxActiveFrameMs, current.maxActiveFrameMs))}`,
  );
  console.log(`- Legacy mean completed-chunk total: ${formatMs(legacy.meanChunkTotalMs)}`);
  console.log(`- Current mean completed-chunk total: ${formatMs(current.meanChunkTotalMs)}`);
  console.log(
    `- Mean completed-chunk total reduction: ${formatPercent(reductionPercent(legacy.meanChunkTotalMs, current.meanChunkTotalMs))}`,
  );
  console.log("");
  console.log("Stage means per completed chunk");
  for (const stageName of CHUNK_FINALIZATION_STAGES) {
    console.log(
      `- ${stageName}: legacy ${formatMs(legacy.stageMeans[stageName])}, current ${formatMs(current.stageMeans[stageName])}`,
    );
  }
  console.log("");
  console.log("Per-seed max active-frame spikes");
  for (const entry of maxSeedSpikeReductions) {
    console.log(
      `- Seed ${entry.seed}: legacy ${formatMs(entry.legacyMax)}, current ${formatMs(entry.currentMax)}, reduction ${formatPercent(entry.reduction)}`,
    );
  }
}

async function main() {
  console.log("Warming terrain chunk-apply benchmark...");
  await warmUpBenchmark();
  console.log("Running representative chunk-boundary traversal profile...");

  const legacyRuns = [];
  const currentRuns = [];

  for (const seed of BENCHMARK_SEEDS) {
    console.log(`- Seed ${seed}`);
    legacyRuns.push(await runSeed("legacy", seed));
    currentRuns.push(await runSeed("current", seed));
  }

  console.log("");
  printReport(legacyRuns, currentRuns);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});