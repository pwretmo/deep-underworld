import * as THREE from 'three/webgpu';
import {
  abs,
  attribute,
  cameraViewMatrix,
  clamp,
  dot,
  float,
  floor,
  fract,
  Fn,
  materialRoughness,
  max,
  mix,
  normalView,
  normalWorldGeometry,
  positionWorld,
  smoothstep,
  varying,
  vec3,
} from 'three/tsl';
import { qualityManager } from '../QualityManager.js';

const hash3D = Fn(([inputPosition]) => {
  const p = fract(vec3(inputPosition).mul(vec3(443.897, 441.423, 437.195))).toVar();
  const offset = dot(p, p.yzx.add(vec3(19.19)));
  p.addAssign(vec3(offset));

  return fract(p.x.add(p.y).mul(p.z));
});

const noise3D = Fn(([inputPosition]) => {
  const cell = floor(vec3(inputPosition)).toVar();
  const fraction = fract(vec3(inputPosition)).toVar();

  fraction.assign(fraction.mul(fraction).mul(vec3(3.0).sub(fraction.mul(2.0))));

  const n000 = hash3D(cell);
  const n100 = hash3D(cell.add(vec3(1.0, 0.0, 0.0)));
  const n010 = hash3D(cell.add(vec3(0.0, 1.0, 0.0)));
  const n110 = hash3D(cell.add(vec3(1.0, 1.0, 0.0)));
  const n001 = hash3D(cell.add(vec3(0.0, 0.0, 1.0)));
  const n101 = hash3D(cell.add(vec3(1.0, 0.0, 1.0)));
  const n011 = hash3D(cell.add(vec3(0.0, 1.0, 1.0)));
  const n111 = hash3D(cell.add(vec3(1.0, 1.0, 1.0)));

  const nx00 = mix(n000, n100, fraction.x);
  const nx10 = mix(n010, n110, fraction.x);
  const nx01 = mix(n001, n101, fraction.x);
  const nx11 = mix(n011, n111, fraction.x);

  const nxy0 = mix(nx00, nx10, fraction.y);
  const nxy1 = mix(nx01, nx11, fraction.y);

  return mix(nxy0, nxy1, fraction.z);
});

function fbm3D(inputPosition) {
  return noise3D(inputPosition)
    .add(noise3D(inputPosition.mul(2.0)).mul(0.5))
    .add(noise3D(inputPosition.mul(4.0)).mul(0.25))
    .add(noise3D(inputPosition.mul(8.0)).mul(0.125))
    .div(1.875);
}

const CHUNK_FINALIZATION_STAGES = [
  'geometry',
  'rocks',
  'terrainColliderPrepare',
  'terrainColliderBuild',
  'rockColliders',
  'attach',
];
const STREAM_FINALIZATION_BUDGET_MS = 4;
const PRELOAD_FINALIZATION_BUDGET_MS = 8;
const MAX_FINALIZATION_STAGES_PER_SLICE = 8;
const PROFILE_EMA_ALPHA = 0.2;
const SLOW_FINALIZATION_STAGE_MS = 2.5;
const SLOW_FINALIZATION_TOTAL_MS = 6;
const PROFILE_HISTORY_LIMIT = 24;
const TERRAIN_CHUNK_PROFILE_QUERY_KEY = 'terrainChunkProfile';
const SLOW_FINALIZATION_LOG_INTERVAL_MS = 5000;

function updateEma(current, next) {
  return current === 0 ? next : current + (next - current) * PROFILE_EMA_ALPHA;
}

function trimHistory(history, maxEntries) {
  if (history.length > maxEntries) {
    history.splice(0, history.length - maxEntries);
  }
}

function isChunkApplyDiagnosticsEnabled() {
  if (typeof window === 'undefined') return false;

  try {
    return new URLSearchParams(window.location.search).has(TERRAIN_CHUNK_PROFILE_QUERY_KEY);
  } catch {
    return false;
  }
}

function createChunkApplyProfile() {
  const stages = {};
  for (const stageName of CHUNK_FINALIZATION_STAGES) {
    stages[stageName] = {
      lastMs: 0,
      avgMs: 0,
      maxMs: 0,
    };
  }

  return {
    sampleCount: 0,
    lastTotalMs: 0,
    avgTotalMs: 0,
    maxTotalMs: 0,
    lastSample: null,
    slowSamples: [],
    stages,
  };
}

export class Terrain {
  constructor(scene) {
    this.scene = scene;
    this.chunks = new Map();
    this.chunkSize = 80;
    this.resolution = 40;
    this.lastChunkX = null;
    this.lastChunkZ = null;
    this.viewDistance = qualityManager.getSettings().terrainViewDistance;
    this._pendingChunks = []; // queue for staggered worker requests
    this._physicsWorld = null;
    this._neededChunkKeys = new Set();
    this._pendingFinalizations = [];
    this._pendingFinalizationKeys = new Set();
    this._activeFinalization = null;
    this._requestSeq = 0;
    this._inFlightById = new Map();
    this._inFlightByKey = new Map();
    this._maxInFlight = 2;
    this._chunkApplyProfile = createChunkApplyProfile();
    this._chunkApplyLoggingEnabled = isChunkApplyDiagnosticsEnabled();
    this._lastChunkApplyLogMs = Number.NEGATIVE_INFINITY;
    this._lastPlayerPos = null;
    this._chunkWorker = new Worker(new URL('./chunkPayloadWorker.js', import.meta.url), { type: 'module' });
    this._chunkWorker.onmessage = (event) => {
      const data = event.data;
      if (!data || data.type !== 'terrainPayload') return;

      const request = this._inFlightById.get(data.requestId);
      if (!request) return;

      this._inFlightById.delete(data.requestId);
      if (this._inFlightByKey.get(request.key) === data.requestId) {
        this._inFlightByKey.delete(request.key);
      }

      if (
        request.cancelled ||
        !this._neededChunkKeys.has(request.key) ||
        this.chunks.has(request.key) ||
        this._pendingFinalizationKeys.has(request.key)
      ) {
        return;
      }

      this._enqueueFinalization(request.key, data.cx, data.cz, data.payload);
    };

    window.addEventListener('qualitychange', (e) => {
      this.viewDistance = e.detail.settings.terrainViewDistance;
      if (this.lastChunkX !== null) {
        this._rebuildPendingAround(this.lastChunkX, this.lastChunkZ);
      }
    });

    // Multiple rock geometries for visual variety + wet PBR materials
    this._rockGeos = this._createRockGeometries();
    this._rockMat = this._createRockMaterial();
    this._terrainMat = this._createTerrainMaterial();
  }

  /**
   * Attach physics world for collision generation.
   * @param {import('../physics/PhysicsWorld.js').PhysicsWorld} physicsWorld
   */
  setPhysicsWorld(physicsWorld) {
    this._physicsWorld = physicsWorld;
  }

  _createRockGeometries() {
    const geos = [];
    geos.push(this._distortGeo(new THREE.DodecahedronGeometry(1, 1), 0.15));
    geos.push(this._distortGeo(new THREE.IcosahedronGeometry(1, 2), 0.10));
    const slab = new THREE.DodecahedronGeometry(1, 0);
    const sp = slab.attributes.position;
    for (let i = 0; i < sp.count; i++) sp.setY(i, sp.getY(i) * 0.4);
    geos.push(this._distortGeo(slab, 0.08));
    const spire = new THREE.OctahedronGeometry(1, 1);
    const pp = spire.attributes.position;
    for (let i = 0; i < pp.count; i++) pp.setY(i, pp.getY(i) * 1.6);
    geos.push(this._distortGeo(spire, 0.12));
    return geos;
  }

  _distortGeo(geo, amount) {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const h = Math.sin(x * 12.9898 + y * 78.233 + z * 45.164) * 43758.5453;
      const d = (h - Math.floor(h)) * amount;
      const len = Math.sqrt(x * x + y * y + z * z) || 1;
      pos.setXYZ(i, x + (x / len) * d, y + (y / len) * d, z + (z / len) * d);
    }
    geo.computeVertexNormals();
    return geo;
  }

  _createRockMaterial() {
    const mat = new THREE.MeshStandardNodeMaterial({
      color: 0x888890,
      roughness: 0.55,
      metalness: 0.08,
    });
    const worldPos = varying(positionWorld);
    const depth = worldPos.y.negate();
    const wetness = float(1.0).sub(smoothstep(60.0, 500.0, depth));
    const eps = 0.08;
    const scale = 2.0;
    const h0 = noise3D(worldPos.mul(scale));
    const hx = noise3D(worldPos.add(vec3(eps, 0.0, 0.0)).mul(scale));
    const hz = noise3D(worldPos.add(vec3(0.0, 0.0, eps)).mul(scale));
    const gradWorld = vec3(hx.sub(h0).div(eps), 0.0, hz.sub(h0).div(eps));
    const gradView = cameraViewMatrix.transformDirection(gradWorld);

    mat.normalNode = normalView.sub(gradView.mul(0.4)).normalize();
    mat.roughnessNode = clamp(
      materialRoughness
        .mul(mix(1.0, 0.35, wetness))
        .add(noise3D(worldPos.mul(8.0)).mul(0.08))
        .sub(0.04),
      0.1,
      1.0,
    );

    return mat;
  }

  _createTerrainMaterial() {
    const mat = new THREE.MeshStandardNodeMaterial({
      roughness: 0.85,
      metalness: 0.05,
    });
    const worldPos = varying(positionWorld);
    const vertexColor = varying(attribute('color', 'vec3'));
    const depth = worldPos.y.negate();
    const slope = float(1.0).sub(abs(normalWorldGeometry.y));
    const rockColor = vec3(0.25, 0.22, 0.2).add(vec3(noise3D(worldPos.mul(0.5)).mul(0.06)));
    const siltColor = vec3(0.18, 0.15, 0.13).add(vec3(noise3D(worldPos.mul(0.3).add(vec3(100.0))).mul(0.04)));
    const algaeColor = vec3(0.12, 0.2, 0.08).add(vec3(noise3D(worldPos.mul(0.8).add(vec3(200.0))).mul(0.05)));
    const algaeMask = float(1.0)
      .sub(smoothstep(80.0, 200.0, depth))
      .mul(float(1.0).sub(slope));
    const rockMask = smoothstep(0.3, 0.7, slope);
    const siltMask = max(float(1.0).sub(rockMask).sub(algaeMask), 0.0);
    const layered = rockColor.mul(rockMask)
      .add(siltColor.mul(siltMask))
      .add(algaeColor.mul(algaeMask));
    const detail = float(0.9).add(fbm3D(worldPos.mul(4.0)).mul(0.2));
    const eps = 0.1;
    const scale = 1.5;
    const h0 = fbm3D(worldPos.mul(scale));
    const hx = fbm3D(worldPos.add(vec3(eps, 0.0, 0.0)).mul(scale));
    const hz = fbm3D(worldPos.add(vec3(0.0, 0.0, eps)).mul(scale));
    const gradWorld = vec3(hx.sub(h0).div(eps), 0.0, hz.sub(h0).div(eps));
    const gradView = cameraViewMatrix.transformDirection(gradWorld);
    const wetness = float(1.0).sub(smoothstep(60.0, 500.0, depth));

    mat.colorNode = mix(layered, vertexColor, 0.4).mul(detail);
    mat.normalNode = normalView.sub(gradView.mul(0.35)).normalize();
    mat.roughnessNode = clamp(
      materialRoughness
        .mul(mix(1.0, 0.45, wetness))
        .add(slope.mul(0.1))
        .add(noise3D(worldPos.mul(6.0)).mul(0.1))
        .sub(0.05),
      0.15,
      1.0,
    );

    return mat;
  }

  _getChunkKey(cx, cz) {
    return `${cx},${cz}`;
  }

  _cancelInFlightRequest(requestId) {
    const req = this._inFlightById.get(requestId);
    if (!req) return;

    req.cancelled = true;
    this._inFlightById.delete(requestId);
    if (this._inFlightByKey.get(req.key) === requestId) {
      this._inFlightByKey.delete(req.key);
    }
    this._chunkWorker.postMessage({ type: 'cancel', requestId });
  }

  _requestChunkPayload(key, cx, cz) {
    if (this._inFlightByKey.has(key)) return false;
    const requestId = ++this._requestSeq;
    this._inFlightById.set(requestId, { key, cancelled: false });
    this._inFlightByKey.set(key, requestId);
    this._chunkWorker.postMessage({
      type: 'generateTerrain',
      requestId,
      key,
      cx,
      cz,
      chunkSize: this.chunkSize,
      resolution: this.resolution,
    });
    return true;
  }

  /**
   * Build a trimesh collider from worker-generated world-space vertices.
   */
  _createChunkCollider(mesh, colliderVertices, indices) {
    const handle = this._physicsWorld.createTrimeshCollider(colliderVertices, indices);
    const handles = mesh.userData.physicsColliderHandles || [];
    handles.push(handle);
    mesh.userData.physicsColliderHandles = handles;
    return handle;
  }

  _addRockVisualsFromPayload(parent, payload) {
    const batches = payload.rockBatches || [];
    for (const batch of batches) {
      const geometry = this._rockGeos[batch.type % this._rockGeos.length];
      const count = batch.matrices.length / 16;
      if (!geometry || count <= 0) continue;

      const inst = new THREE.InstancedMesh(geometry, this._rockMat, count);
      inst.castShadow = true;
      inst.receiveShadow = true;

      inst.instanceMatrix = new THREE.InstancedBufferAttribute(batch.matrices, 16);
      inst.instanceMatrix.needsUpdate = true;

      if (batch.colors && batch.colors.length > 0) {
        inst.instanceColor = new THREE.InstancedBufferAttribute(batch.colors, 3);
        inst.instanceColor.needsUpdate = true;
      }

      parent.add(inst);
    }
  }

  _createRockCollidersFromPayload(parent, payload) {
    if (!this._physicsWorld || !payload.rockColliders || payload.rockColliders.length === 0) {
      return;
    }

    const handles = this._physicsWorld.createSphereColliders(payload.rockColliders);
    if (handles.length === 0) return;

    const colliderHandles = parent.userData.physicsColliderHandles || [];
    colliderHandles.push(...handles);
    parent.userData.physicsColliderHandles = colliderHandles;
  }

  _enqueueFinalization(key, cx, cz, payload) {
    this._pendingFinalizationKeys.add(key);
    this._pendingFinalizations.push({
      key,
      cx,
      cz,
      payload,
      mesh: null,
      geometry: null,
      stageIndex: 0,
      stageTimings: {},
    });
  }

  _disposePendingFinalization(job) {
    if (!job) return;

    if (this._physicsWorld && job.mesh?.userData?.physicsColliderHandles) {
      for (const handle of job.mesh.userData.physicsColliderHandles) {
        this._physicsWorld.removeCollider(handle);
      }
      job.mesh.userData.physicsColliderHandles = [];
    }

    if (job.geometry) {
      job.geometry.dispose();
    }

    if (job.mesh) {
      job.mesh.clear();
    }

    this._pendingFinalizationKeys.delete(job.key);
    job.payload = null;
  }

  _createChunkMeshFromPayload(cx, cz, payload) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(payload.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(payload.normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(payload.colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(payload.indices, 1));

    const mesh = new THREE.Mesh(geometry, this._terrainMat);
    mesh.position.set(cx * this.chunkSize, 0, cz * this.chunkSize);
    mesh.receiveShadow = true;

    return { geometry, mesh };
  }

  _recordChunkApplyStage(stageName, elapsedMs) {
    const stats = this._chunkApplyProfile.stages[stageName];
    if (!stats) return;

    stats.lastMs = elapsedMs;
    stats.avgMs = updateEma(stats.avgMs, elapsedMs);
    stats.maxMs = Math.max(stats.maxMs, elapsedMs);
  }

  _recordChunkApplySample(job) {
    const stages = {};
    let totalMs = 0;

    for (const stageName of CHUNK_FINALIZATION_STAGES) {
      const elapsedMs = job.stageTimings[stageName] || 0;
      stages[stageName] = elapsedMs;
      totalMs += elapsedMs;
    }

    const sample = {
      key: job.key,
      totalMs,
      stages,
    };
    const profile = this._chunkApplyProfile;
    profile.sampleCount += 1;
    profile.lastTotalMs = totalMs;
    profile.avgTotalMs = updateEma(profile.avgTotalMs, totalMs);
    profile.maxTotalMs = Math.max(profile.maxTotalMs, totalMs);
    profile.lastSample = sample;

    const hasSlowStage = CHUNK_FINALIZATION_STAGES.some(
      (stageName) => stages[stageName] >= SLOW_FINALIZATION_STAGE_MS,
    );

    if (totalMs >= SLOW_FINALIZATION_TOTAL_MS || hasSlowStage) {
      profile.slowSamples.push(sample);
      trimHistory(profile.slowSamples, PROFILE_HISTORY_LIMIT);

      const now = performance.now();
      if (
        this._chunkApplyLoggingEnabled &&
        now - this._lastChunkApplyLogMs >= SLOW_FINALIZATION_LOG_INTERVAL_MS
      ) {
        this._lastChunkApplyLogMs = now;

        const breakdown = CHUNK_FINALIZATION_STAGES
          .map((stageName) => `${stageName}=${stages[stageName].toFixed(2)}ms`)
          .join(', ');
        console.warn(
          `[Terrain] Slow chunk finalization ${job.key}: total=${totalMs.toFixed(2)}ms (${breakdown})`,
        );
      }
    }
  }

  getChunkApplyProfile() {
    const stages = {};
    for (const stageName of CHUNK_FINALIZATION_STAGES) {
      stages[stageName] = { ...this._chunkApplyProfile.stages[stageName] };
    }

    return {
      sampleCount: this._chunkApplyProfile.sampleCount,
      lastTotalMs: this._chunkApplyProfile.lastTotalMs,
      avgTotalMs: this._chunkApplyProfile.avgTotalMs,
      maxTotalMs: this._chunkApplyProfile.maxTotalMs,
      lastSample: this._chunkApplyProfile.lastSample
        ? {
            ...this._chunkApplyProfile.lastSample,
            stages: { ...this._chunkApplyProfile.lastSample.stages },
          }
        : null,
      slowSamples: this._chunkApplyProfile.slowSamples.map((sample) => ({
        ...sample,
        stages: { ...sample.stages },
      })),
      stages,
    };
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

  _runFinalizationStage(job) {
    const stageName = CHUNK_FINALIZATION_STAGES[job.stageIndex];
    if (!stageName) return false;

    const stageStart = performance.now();

    if (stageName === 'geometry') {
      const { geometry, mesh } = this._createChunkMeshFromPayload(job.cx, job.cz, job.payload);
      job.geometry = geometry;
      job.mesh = mesh;
    } else if (stageName === 'rocks') {
      this._addRockVisualsFromPayload(job.mesh, job.payload);
    } else if (stageName === 'terrainColliderPrepare') {
      // Cache collider data references so terrainColliderBuild can run in a later frame
      if (this._physicsWorld && job.payload.colliderVertices && job.payload.indices) {
        job._colliderVertices = job.payload.colliderVertices;
        job._colliderIndices = job.payload.indices;
      }
    } else if (stageName === 'terrainColliderBuild') {
      if (this._physicsWorld && job._colliderVertices && job._colliderIndices) {
        // Skip detailed collider for chunks beyond 2x view distance
        let skip = false;
        if (this._lastPlayerPos && job.mesh) {
          const chunkPos = job.mesh.position;
          const dx = chunkPos.x - this._lastPlayerPos.x;
          const dz = chunkPos.z - this._lastPlayerPos.z;
          const distSq = dx * dx + dz * dz;
          const viewDist = this.chunkSize * (this.viewDistance || 3);
          if (distSq > viewDist * viewDist * 4) {
            skip = true;
          }
        }
        if (!skip) {
          this._createChunkCollider(job.mesh, job._colliderVertices, job._colliderIndices);
        }
      }
      // Clean up cached data
      job._colliderVertices = null;
      job._colliderIndices = null;
    } else if (stageName === 'rockColliders') {
      if (this._physicsWorld) {
        this._createRockCollidersFromPayload(job.mesh, job.payload);
      }
    } else if (stageName === 'attach') {
      this.scene.add(job.mesh);
      this.chunks.set(job.key, job.mesh);
    }

    const elapsedMs = performance.now() - stageStart;
    job.stageTimings[stageName] = elapsedMs;
    this._recordChunkApplyStage(stageName, elapsedMs);
    job.stageIndex += 1;
    return true;
  }

  _drainFinalizationStages(maxStages, maxCostMs, cancelToken, options = undefined) {
    if (maxStages <= 0 || maxCostMs <= 0) return 0;

    const progressedKeys = options?.progressedKeys;
    const maxChunks = options?.maxChunks ?? Infinity;
    let completedStages = 0;
    const sliceStart = performance.now();

    while (completedStages < maxStages) {
      if (cancelToken?.cancelled) break;
      if (performance.now() - sliceStart >= maxCostMs) break;

      if (!this._activeFinalization) {
        if (progressedKeys && progressedKeys.size >= maxChunks) break;
        this._activeFinalization = this._takeNextFinalization();
        if (!this._activeFinalization) break;
      }

      const job = this._activeFinalization;
      if (progressedKeys && progressedKeys.size >= maxChunks && !progressedKeys.has(job.key)) {
        break;
      }

      if (!this._neededChunkKeys.has(job.key) || this.chunks.has(job.key)) {
        this._disposePendingFinalization(job);
        this._activeFinalization = null;
        continue;
      }

      // Defer expensive collider build if budget is already half consumed
      const nextStage = CHUNK_FINALIZATION_STAGES[job.stageIndex];
      if (nextStage === 'terrainColliderBuild' && (performance.now() - sliceStart) > maxCostMs * 0.5) {
        break;
      }

      if (!this._runFinalizationStage(job)) {
        this._disposePendingFinalization(job);
        this._activeFinalization = null;
        continue;
      }

      completedStages += 1;
      progressedKeys?.add(job.key);
      if (job.stageIndex >= CHUNK_FINALIZATION_STAGES.length) {
        this._recordChunkApplySample(job);
        this._pendingFinalizationKeys.delete(job.key);
        job.payload = null;
        this._activeFinalization = null;
      }
    }

    return completedStages;
  }

  _requestPendingChunks(maxCount, cancelToken) {
    let requested = 0;
    while (this._pendingChunks.length > 0 && requested < maxCount) {
      if (cancelToken?.cancelled) break;
      if (this._inFlightByKey.size >= this._maxInFlight) break;

      const { key, x, z } = this._pendingChunks.shift();
      if (
        this.chunks.has(key) ||
        this._inFlightByKey.has(key) ||
        this._pendingFinalizationKeys.has(key) ||
        !this._neededChunkKeys.has(key)
      ) {
        continue;
      }

      if (this._requestChunkPayload(key, x, z)) {
        requested++;
      }
    }
    return requested;
  }

  _rebuildPendingAround(cx, cz) {
    const needed = new Set();
    for (let dx = -this.viewDistance; dx <= this.viewDistance; dx++) {
      for (let dz = -this.viewDistance; dz <= this.viewDistance; dz++) {
        needed.add(this._getChunkKey(cx + dx, cz + dz));
      }
    }
    this._neededChunkKeys = needed;

    // Cancel worker requests and drop ready payloads for chunks no longer needed
    for (const [requestId, req] of this._inFlightById) {
      if (!needed.has(req.key)) {
        this._cancelInFlightRequest(requestId);
      }
    }

    if (
      this._activeFinalization &&
      (!needed.has(this._activeFinalization.key) || this.chunks.has(this._activeFinalization.key))
    ) {
      this._disposePendingFinalization(this._activeFinalization);
      this._activeFinalization = null;
    }

    const pendingFinalizations = [];
    for (const job of this._pendingFinalizations) {
      if (!needed.has(job.key) || this.chunks.has(job.key)) {
        this._disposePendingFinalization(job);
        continue;
      }

      pendingFinalizations.push(job);
    }
    this._pendingFinalizations = pendingFinalizations;

    // Remove distant chunks
    for (const [key, mesh] of this.chunks) {
      if (!needed.has(key)) {
        // Remove physics colliders
        if (this._physicsWorld && mesh.userData.physicsColliderHandles) {
          for (const handle of mesh.userData.physicsColliderHandles) {
            this._physicsWorld.removeCollider(handle);
          }
        }
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        this.chunks.delete(key);
      }
    }

    // Queue new chunks for staggered creation (1 per frame)
    this._pendingChunks = [];
    for (const key of needed) {
      if (
        !this.chunks.has(key) &&
        !this._inFlightByKey.has(key) &&
        !this._pendingFinalizationKeys.has(key)
      ) {
        const [x, z] = key.split(',').map(Number);
        this._pendingChunks.push({ key, x, z });
      }
    }
  }

  preloadPrepareAround(playerPos) {
    const cx = Math.round(playerPos.x / this.chunkSize);
    const cz = Math.round(playerPos.z / this.chunkSize);
    this.lastChunkX = cx;
    this.lastChunkZ = cz;
    this._rebuildPendingAround(cx, cz);
  }

  preloadDrain(maxCount, cancelToken) {
    if (maxCount <= 0) return 0;
    const progressedKeys = new Set();
    this._drainFinalizationStages(
      maxCount * CHUNK_FINALIZATION_STAGES.length,
      PRELOAD_FINALIZATION_BUDGET_MS,
      cancelToken,
      {
        progressedKeys,
        maxChunks: maxCount,
      },
    );

    let progress = progressedKeys.size;
    while (progress < maxCount) {
      if (cancelToken?.cancelled) break;

      const requested = this._requestPendingChunks(1, cancelToken);
      if (requested <= 0) break;
      progress += requested;
    }

    return progress;
  }

  getPendingCount() {
    return this._pendingChunks.length + this._inFlightById.size + this._pendingFinalizationKeys.size;
  }

  getChunkCount() {
    return this.chunks.size;
  }

  update(playerPos, allowChunkWork = true) {
    this._lastPlayerPos = playerPos;
    const cx = Math.round(playerPos.x / this.chunkSize);
    const cz = Math.round(playerPos.z / this.chunkSize);

    if (allowChunkWork) {
      // Finalize chunk stages within a small streaming budget so terrain apply
      // no longer lands as one opaque main-thread block.
      this._drainFinalizationStages(
        MAX_FINALIZATION_STAGES_PER_SLICE,
        STREAM_FINALIZATION_BUDGET_MS,
      );
      this._requestPendingChunks(1);
    }

    if (cx === this.lastChunkX && cz === this.lastChunkZ) return;
    this.lastChunkX = cx;
    this.lastChunkZ = cz;
    this._rebuildPendingAround(cx, cz);
  }
}
