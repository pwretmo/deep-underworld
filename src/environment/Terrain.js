import * as THREE from "three/webgpu";
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
  vec4,
} from "three/tsl";
import { qualityManager } from "../QualityManager.js";

const hash3D = Fn(([inputPosition]) => {
  const p = fract(
    vec3(inputPosition).mul(vec3(443.897, 441.423, 437.195)),
  ).toVar();
  const offset = dot(p, p.yzx.add(vec3(19.19)));
  p.addAssign(vec3(offset));

  return fract(p.x.add(p.y).mul(p.z));
});

const hash3D_grad = Fn(([inputPosition]) => {
  const p = fract(
    vec3(inputPosition).mul(vec3(443.897, 441.423, 437.195)),
  ).toVar();
  p.addAssign(dot(p, p.yzx.add(19.19)));
  return fract(
    vec3(p.x.mul(p.z), p.y.mul(p.x), p.z.mul(p.y)),
  ).mul(2.0).sub(1.0);
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

const noised3D = Fn(([inputPosition]) => {
  const i = floor(vec3(inputPosition)).toVar();
  const f = fract(vec3(inputPosition)).toVar();
  const u = f.mul(f).mul(f).mul(f.mul(f.mul(6.0).sub(15.0)).add(10.0)).toVar();
  const du = f.mul(f).mul(30.0).mul(f.mul(f.sub(2.0)).add(1.0)).toVar();

  const ga = hash3D_grad(i).toVar();
  const gb = hash3D_grad(i.add(vec3(1, 0, 0))).toVar();
  const gc = hash3D_grad(i.add(vec3(0, 1, 0))).toVar();
  const gd = hash3D_grad(i.add(vec3(1, 1, 0))).toVar();
  const ge = hash3D_grad(i.add(vec3(0, 0, 1))).toVar();
  const gf = hash3D_grad(i.add(vec3(1, 0, 1))).toVar();
  const gg = hash3D_grad(i.add(vec3(0, 1, 1))).toVar();
  const ghv = hash3D_grad(i.add(vec3(1, 1, 1))).toVar();

  const va = dot(ga, f).toVar();
  const vb = dot(gb, f.sub(vec3(1, 0, 0))).toVar();
  const vc = dot(gc, f.sub(vec3(0, 1, 0))).toVar();
  const vd = dot(gd, f.sub(vec3(1, 1, 0))).toVar();
  const ve = dot(ge, f.sub(vec3(0, 0, 1))).toVar();
  const vfv = dot(gf, f.sub(vec3(1, 0, 1))).toVar();
  const vg = dot(gg, f.sub(vec3(0, 1, 1))).toVar();
  const vh = dot(ghv, f.sub(vec3(1, 1, 1))).toVar();

  const k0 = va.sub(vb).sub(vc).add(vd).toVar();
  const k1 = va.sub(vc).sub(ve).add(vg).toVar();
  const k2 = va.sub(vb).sub(ve).add(vfv).toVar();
  const k3 = va.negate().add(vb).add(vc).sub(vd).add(ve).sub(vfv).sub(vg).add(vh).toVar();

  const v = va
    .add(u.x.mul(vb.sub(va)))
    .add(u.y.mul(vc.sub(va)))
    .add(u.z.mul(ve.sub(va)))
    .add(u.x.mul(u.y).mul(k0))
    .add(u.y.mul(u.z).mul(k1))
    .add(u.z.mul(u.x).mul(k2))
    .add(u.x.mul(u.y).mul(u.z).mul(k3));

  const d = ga
    .add(gb.sub(ga).mul(u.x))
    .add(gc.sub(ga).mul(u.y))
    .add(ge.sub(ga).mul(u.z))
    .add(ga.sub(gb).sub(gc).add(gd).mul(u.x.mul(u.y)))
    .add(ga.sub(gc).sub(ge).add(gg).mul(u.y.mul(u.z)))
    .add(ga.sub(gb).sub(ge).add(gf).mul(u.z.mul(u.x)))
    .add(
      ga.negate().add(gb).add(gc).sub(gd).add(ge).sub(gf).sub(gg).add(ghv)
        .mul(u.x.mul(u.y).mul(u.z)),
    )
    .add(
      du.mul(
        vec3(vb.sub(va), vc.sub(va), ve.sub(va))
          .add(u.yzx.mul(vec3(k0, k1, k2)))
          .add(u.zxy.mul(vec3(k2, k0, k1)))
          .add(u.yzx.mul(u.zxy).mul(k3)),
      ),
    );

  return vec4(v, d.x, d.y, d.z);
});

function fbm3D(inputPosition) {
  return noise3D(inputPosition)
    .add(noise3D(inputPosition.mul(2.0)).mul(0.5))
    .add(noise3D(inputPosition.mul(4.0)).mul(0.25))
    .add(noise3D(inputPosition.mul(8.0)).mul(0.125))
    .div(1.875);
}

function fbm3D_deriv(inputPosition) {
  const n0 = noised3D(inputPosition);
  const n1 = noised3D(vec3(inputPosition).mul(2.0));
  const n2 = noised3D(vec3(inputPosition).mul(4.0));
  const n3 = noised3D(vec3(inputPosition).mul(8.0));
  return vec4(
    n0.x.add(n1.x.mul(0.5)).add(n2.x.mul(0.25)).add(n3.x.mul(0.125)).div(1.875),
    n0.y.add(n1.y).add(n2.y).add(n3.y).div(1.875),
    n0.z.add(n1.z).add(n2.z).add(n3.z).div(1.875),
    n0.w.add(n1.w).add(n2.w).add(n3.w).div(1.875),
  );
}

const CHUNK_FINALIZATION_STAGES = [
  "geometry",
  "rocks",
  "terrainColliderPrepare",
  "terrainColliderBuild",
  "rockColliders",
  "attach",
];
const STREAM_FINALIZATION_BUDGET_MS = 4;
const PRELOAD_FINALIZATION_BUDGET_MS = 8;
const MAX_FINALIZATION_STAGES_PER_SLICE = 8;
const MAX_SUPPORTED_TERRAIN_VIEW_DISTANCE = 4;
const TERRAIN_BATCH_STREAMING_BUFFER = 48;
const TERRAIN_BATCH_GROWTH_CHUNKS = 16;
const PROFILE_EMA_ALPHA = 0.2;
const SLOW_FINALIZATION_STAGE_MS = 2.5;
const SLOW_FINALIZATION_TOTAL_MS = 6;
const PROFILE_HISTORY_LIMIT = 24;
const TERRAIN_CHUNK_PROFILE_QUERY_KEY = "terrainChunkProfile";
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
  if (typeof window === "undefined") return false;

  try {
    return new URLSearchParams(window.location.search).has(
      TERRAIN_CHUNK_PROFILE_QUERY_KEY,
    );
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
    this._terrainChunkVertexCount =
      (this.resolution + 1) * (this.resolution + 1);
    this._terrainChunkIndexCount = this.resolution * this.resolution * 6;
    this._terrainBatchChunkCapacity =
      (MAX_SUPPORTED_TERRAIN_VIEW_DISTANCE * 2 + 1) ** 2 +
      TERRAIN_BATCH_STREAMING_BUFFER;
    this._terrainBatchMaxVertexCount =
      this._terrainBatchChunkCapacity * this._terrainChunkVertexCount;
    this._terrainBatchMaxIndexCount =
      this._terrainBatchChunkCapacity * this._terrainChunkIndexCount;
    this._terrainBatchNeedsOptimize = false;
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
    // Freshly attached meshes: temporarily disable frustum culling so the
    // WebGPU backend compiles their GPU render pipelines on the next few render
    // frames regardless of camera direction.  Without this, looking at a new
    // angle triggers synchronous pipeline compilation stalls for all newly
    // visible chunks at once.
    this._freshAttachments = [];
    this._chunkWorker = new Worker(
      new URL("./chunkPayloadWorker.js", import.meta.url),
      { type: "module" },
    );
    this._chunkWorker.onmessage = (event) => {
      const data = event.data;
      if (!data || data.type !== "terrainPayload") return;

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

    window.addEventListener("qualitychange", (e) => {
      this.viewDistance = e.detail.settings.terrainViewDistance;
      if (this.lastChunkX !== null) {
        this._rebuildPendingAround(this.lastChunkX, this.lastChunkZ);
      }
    });

    // Multiple rock geometries for visual variety + wet PBR materials
    this._rockGeos = this._createRockGeometries();
    this._rockMat = this._createRockMaterial();
    this._terrainMat = this._createTerrainMaterial();

    // BatchedMesh for terrain chunks — all visible chunks share one draw call.
    // three.js BatchedMesh does not reclaim deleted geometry ranges until
    // optimize() is called, so keep extra streaming headroom and grow on demand.
    this._terrainBatchedMesh = new THREE.BatchedMesh(
      this._terrainBatchChunkCapacity,
      this._terrainBatchMaxVertexCount,
      this._terrainBatchMaxIndexCount,
      this._terrainMat,
    );
    this._terrainBatchedMesh.receiveShadow = true;
    this.scene.add(this._terrainBatchedMesh);

    // Global InstancedMesh pools for rocks — one per rock type.
    // Instead of creating a new InstancedMesh per chunk per type (~49×4=196
    // draw calls at medium quality), we maintain four persistent meshes = 4
    // draw calls regardless of chunk count.
    const MAX_ROCKS_PER_TYPE = 400; // 100 chunks × ~4 rocks per type per chunk
    this._rockPoolMeshes = this._rockGeos.map((geo) => {
      const im = new THREE.InstancedMesh(geo, this._rockMat, MAX_ROCKS_PER_TYPE);
      im.castShadow = true;
      im.receiveShadow = true;
      // Pre-allocate instanceColor — rock material tints per-instance.
      im.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(MAX_ROCKS_PER_TYPE * 3),
        3,
      );
      // Hide all slots initially (zero scale = invisible).
      const zeroM = new THREE.Matrix4().makeScale(0, 0, 0);
      const neutralColor = new THREE.Color(0.3, 0.28, 0.25);
      for (let i = 0; i < MAX_ROCKS_PER_TYPE; i++) {
        im.setMatrixAt(i, zeroM);
        im.setColorAt(i, neutralColor);
      }
      im.instanceMatrix.needsUpdate = true;
      im.instanceColor.needsUpdate = true;
      this.scene.add(im);
      return im;
    });
    for (const rm of this._rockPoolMeshes) rm.frustumCulled = false;
    // Free-slot stacks — pop to allocate, push to free.
    this._rockFreeLists = this._rockGeos.map(() =>
      Array.from({ length: MAX_ROCKS_PER_TYPE }, (_, i) => i).reverse(),
    );
    // Reusable scratch objects to avoid per-frame allocations.
    this._rockScratchMatrix = new THREE.Matrix4();
    this._rockScratchColor = new THREE.Color();
  }

  _growTerrainBatchCapacity(
    chunkCountIncrease = TERRAIN_BATCH_GROWTH_CHUNKS,
  ) {
    this._terrainBatchChunkCapacity += chunkCountIncrease;
    this._terrainBatchMaxVertexCount =
      this._terrainBatchChunkCapacity * this._terrainChunkVertexCount;
    this._terrainBatchMaxIndexCount =
      this._terrainBatchChunkCapacity * this._terrainChunkIndexCount;

    this._terrainBatchedMesh.setGeometrySize(
      this._terrainBatchMaxVertexCount,
      this._terrainBatchMaxIndexCount,
    );
    this._terrainBatchedMesh.setInstanceCount(this._terrainBatchChunkCapacity);
  }

  _ensureTerrainBatchCapacity(vertexCount, indexCount) {
    if (
      vertexCount <= this._terrainBatchedMesh.unusedVertexCount &&
      indexCount <= this._terrainBatchedMesh.unusedIndexCount
    ) {
      return;
    }

    if (this._terrainBatchNeedsOptimize) {
      this._terrainBatchedMesh.optimize();
      this._terrainBatchNeedsOptimize = false;
    }

    while (
      vertexCount > this._terrainBatchedMesh.unusedVertexCount ||
      indexCount > this._terrainBatchedMesh.unusedIndexCount
    ) {
      this._growTerrainBatchCapacity();
    }
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
    geos.push(this._distortGeo(new THREE.IcosahedronGeometry(1, 2), 0.1));
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
      const x = pos.getX(i),
        y = pos.getY(i),
        z = pos.getZ(i);
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
    const vertexColor = varying(attribute("color", "vec3"));
    const depth = worldPos.y.negate();
    const slope = float(1.0).sub(abs(normalWorldGeometry.y));
    const rockColor = vec3(0.25, 0.22, 0.2).add(
      vec3(noise3D(worldPos.mul(0.5)).mul(0.06)),
    );
    const siltColor = vec3(0.18, 0.15, 0.13).add(
      vec3(noise3D(worldPos.mul(0.3).add(vec3(100.0))).mul(0.04)),
    );
    const algaeColor = vec3(0.12, 0.2, 0.08).add(
      vec3(noise3D(worldPos.mul(0.8).add(vec3(200.0))).mul(0.05)),
    );
    const algaeMask = float(1.0)
      .sub(smoothstep(80.0, 200.0, depth))
      .mul(float(1.0).sub(slope));
    const rockMask = smoothstep(0.3, 0.7, slope);
    const siltMask = max(float(1.0).sub(rockMask).sub(algaeMask), 0.0);
    const layered = rockColor
      .mul(rockMask)
      .add(siltColor.mul(siltMask))
      .add(algaeColor.mul(algaeMask));
    const scale = 1.5;
    const fbmResult = fbm3D_deriv(worldPos.mul(scale));
    const height = fbmResult.x;
    const detail = float(0.9).add(height.mul(0.2));
    const gradWorld = vec3(
      fbmResult.y.mul(scale), float(0.0), fbmResult.w.mul(scale),
    );
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
    this._chunkWorker.postMessage({ type: "cancel", requestId });
  }

  _requestChunkPayload(key, cx, cz) {
    if (this._inFlightByKey.has(key)) return false;
    const requestId = ++this._requestSeq;
    this._inFlightById.set(requestId, { key, cancelled: false });
    this._inFlightByKey.set(key, requestId);
    this._chunkWorker.postMessage({
      type: "generateTerrain",
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
    const handle = this._physicsWorld.createTrimeshCollider(
      colliderVertices,
      indices,
    );
    const handles = mesh.userData.physicsColliderHandles || [];
    handles.push(handle);
    mesh.userData.physicsColliderHandles = handles;
    return handle;
  }

  _addRockVisualsFromPayload(parent, payload, cx, cz) {
    // Allocate rock instances from the global per-type pools instead of
    // creating a new InstancedMesh per chunk per rock type.  This reduces rock
    // draw calls from ~(chunks × 4) to exactly 4, one per rock geometry type.
    const batches = payload.rockBatches || [];
    const rockSlots = {};
    const chunkOffsetX = cx * this.chunkSize;
    const chunkOffsetZ = cz * this.chunkSize;

    for (const batch of batches) {
      const typeIdx = batch.type % this._rockGeos.length;
      const rm = this._rockPoolMeshes[typeIdx];
      const freeList = this._rockFreeLists[typeIdx];
      const count = batch.matrices.length / 16;
      if (count <= 0) continue;

      const slotsForType = [];
      for (let i = 0; i < count; i++) {
        const slot = freeList.pop();
        if (slot == null) break; // pool exhausted — skip gracefully

        this._rockScratchMatrix.fromArray(batch.matrices, i * 16);
        // Payload matrices are in chunk-local space; translate to world space
        // by adding the chunk's world origin offset.
        this._rockScratchMatrix.elements[12] += chunkOffsetX;
        this._rockScratchMatrix.elements[14] += chunkOffsetZ;
        rm.setMatrixAt(slot, this._rockScratchMatrix);

        if (batch.colors && batch.colors.length >= (i + 1) * 3) {
          this._rockScratchColor.setRGB(
            batch.colors[i * 3],
            batch.colors[i * 3 + 1],
            batch.colors[i * 3 + 2],
          );
          rm.setColorAt(slot, this._rockScratchColor);
        }

        slotsForType.push(slot);
      }

      if (slotsForType.length > 0) {
        rm.instanceMatrix.needsUpdate = true;
        if (rm.instanceColor) rm.instanceColor.needsUpdate = true;
        if (rockSlots[typeIdx]) {
          rockSlots[typeIdx].push(...slotsForType);
        } else {
          rockSlots[typeIdx] = slotsForType;
        }
      }
    }

    // Store slot IDs on the tracking mesh so _freeChunkRockSlots can find them.
    parent.userData.rockSlots = rockSlots;
  }

  _createRockCollidersFromPayload(parent, payload) {
    if (
      !this._physicsWorld ||
      !payload.rockColliders ||
      payload.rockColliders.length === 0
    ) {
      return;
    }

    const handles = this._physicsWorld.createSphereColliders(
      payload.rockColliders,
    );
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

    // If the geometry stage completed it was added to the BatchedMesh;
    // remove both the instance and the geometry slot now.
    if (job.mesh?.userData?.batchedInstanceId != null) {
      this._terrainBatchedMesh.deleteInstance(
        job.mesh.userData.batchedInstanceId,
      );
      this._terrainBatchedMesh.deleteGeometry(
        job.mesh.userData.batchedGeomId,
      );
      this._terrainBatchNeedsOptimize = true;
      job.mesh.userData.batchedInstanceId = null;
      job.mesh.userData.batchedGeomId = null;
    }

    // Free any rock pool slots that were already allocated during the rocks stage.
    if (job.mesh?.userData?.rockSlots) {
      this._freeChunkRockSlots(job.mesh.userData.rockSlots);
      job.mesh.userData.rockSlots = null;
    }

    // geometry is null after BatchedMesh upload (disposed in _createChunkMeshFromPayload).
    if (job.geometry) {
      job.geometry.dispose();
    }

    if (job.mesh) {
      job.mesh.clear();
    }

    this._pendingFinalizationKeys.delete(job.key);
    job.payload = null;
  }

  // Free rock pool slots back to their free-lists and hide those instances.
  _freeChunkRockSlots(rockSlots) {
    if (!rockSlots) return;
    const zeroM = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const [typeIdxStr, slots] of Object.entries(rockSlots)) {
      const typeIdx = parseInt(typeIdxStr, 10);
      const rm = this._rockPoolMeshes[typeIdx];
      const freeList = this._rockFreeLists[typeIdx];
      if (!rm || !slots.length) continue;
      for (const slot of slots) {
        rm.setMatrixAt(slot, zeroM);
        freeList.push(slot);
      }
      rm.instanceMatrix.needsUpdate = true;
    }
  }

  _createChunkMeshFromPayload(cx, cz, payload) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(payload.positions, 3),
    );
    geometry.setAttribute(
      "normal",
      new THREE.BufferAttribute(payload.normals, 3),
    );
    geometry.setAttribute(
      "color",
      new THREE.BufferAttribute(payload.colors, 3),
    );
    geometry.setIndex(new THREE.BufferAttribute(payload.indices, 1));

    this._ensureTerrainBatchCapacity(
      geometry.getAttribute("position").count,
      geometry.getIndex().count,
    );

    // Upload the geometry into the shared BatchedMesh.  addGeometry() copies
    // the data into the BatchedMesh’s internal buffers, so we can (and must)
    // dispose the local geometry afterwards to free CPU-side memory.
    const geomId = this._terrainBatchedMesh.addGeometry(geometry);
    const instanceId = this._terrainBatchedMesh.addInstance(geomId);
    const posMatrix = new THREE.Matrix4().setPosition(
      cx * this.chunkSize,
      0,
      cz * this.chunkSize,
    );
    this._terrainBatchedMesh.setMatrixAt(instanceId, posMatrix);
    geometry.dispose();

    // Use a plain Object3D as a non-rendered tracking container for physics
    // collider handles and BatchedMesh IDs.  It is never added to the scene.
    const mesh = new THREE.Object3D();
    mesh.userData.batchedGeomId = geomId;
    mesh.userData.batchedInstanceId = instanceId;

    return { geometry: null, mesh };
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

        const breakdown = CHUNK_FINALIZATION_STAGES.map(
          (stageName) => `${stageName}=${stages[stageName].toFixed(2)}ms`,
        ).join(", ");
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

    if (stageName === "geometry") {
      const { geometry, mesh } = this._createChunkMeshFromPayload(
        job.cx,
        job.cz,
        job.payload,
      );
      job.geometry = geometry;
      job.mesh = mesh;
    } else if (stageName === "rocks") {
      this._addRockVisualsFromPayload(job.mesh, job.payload, job.cx, job.cz);
    } else if (stageName === "terrainColliderPrepare") {
      // Cache collider data references so terrainColliderBuild can run in a later frame
      if (
        this._physicsWorld &&
        job.payload.colliderVertices &&
        job.payload.indices
      ) {
        job._colliderVertices = job.payload.colliderVertices;
        job._colliderIndices = job.payload.indices;
      }
    } else if (stageName === "terrainColliderBuild") {
      if (this._physicsWorld && job._colliderVertices && job._colliderIndices) {
        // Skip detailed collider for chunks beyond 2x view distance.
        // Use the chunk's world position from cx/cz since job.mesh is now a
        // non-positioned tracking Object3D.
        let skip = false;
        if (this._lastPlayerPos) {
          const chunkWorldX = job.cx * this.chunkSize;
          const chunkWorldZ = job.cz * this.chunkSize;
          const dx = chunkWorldX - this._lastPlayerPos.x;
          const dz = chunkWorldZ - this._lastPlayerPos.z;
          const distSq = dx * dx + dz * dz;
          const viewDist = this.chunkSize * (this.viewDistance || 3);
          if (distSq > viewDist * viewDist * 4) {
            skip = true;
          }
        }
        if (!skip) {
          this._createChunkCollider(
            job.mesh,
            job._colliderVertices,
            job._colliderIndices,
          );
        }
      }
      // Clean up cached data
      job._colliderVertices = null;
      job._colliderIndices = null;
    } else if (stageName === "rockColliders") {
      if (this._physicsWorld) {
        this._createRockCollidersFromPayload(job.mesh, job.payload);
      }
    } else if (stageName === "attach") {
      // The BatchedMesh is already in the scene; just register the chunk.
      // job.mesh is a non-rendered tracking Object3D and must NOT be scene.add().
      this.chunks.set(job.key, job.mesh);
      // Temporarily disable frustum culling on the chunk and all its children
      // (rock InstancedMeshes) so they are included in the next render pass
      // regardless of camera angle — this compiles their material's GPU
      // pipeline ahead of the player ever looking at them.
      const affectedMeshes = [];
      job.mesh.traverse((obj) => {
        if ((obj.isMesh || obj.isInstancedMesh) && obj.frustumCulled) {
          obj.frustumCulled = false;
          affectedMeshes.push(obj);
        }
      });
      if (affectedMeshes.length > 0) {
        this._freshAttachments.push({ meshes: affectedMeshes, framesLeft: 3 });
      }
    }

    const elapsedMs = performance.now() - stageStart;
    job.stageTimings[stageName] = elapsedMs;
    this._recordChunkApplyStage(stageName, elapsedMs);
    job.stageIndex += 1;
    return true;
  }

  _drainFinalizationStages(
    maxStages,
    maxCostMs,
    cancelToken,
    options = undefined,
  ) {
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
      if (
        progressedKeys &&
        progressedKeys.size >= maxChunks &&
        !progressedKeys.has(job.key)
      ) {
        break;
      }

      if (!this._neededChunkKeys.has(job.key) || this.chunks.has(job.key)) {
        this._disposePendingFinalization(job);
        this._activeFinalization = null;
        continue;
      }

      // terrainColliderPrepare is cheap (<1ms) and always runs in the current
      // frame.  terrainColliderBuild hosts the expensive createTrimeshCollider
      // call (10-30ms for large chunks) and is deferred to the NEXT frame
      // whenever any budget has been consumed (>1ms elapsed).  This ensures it
      // always gets a fresh slice with full budget, so even though its cost may
      // exceed the per-frame target, it runs in isolation without compounding
      // with other stages in the same slice.
      const nextStage = CHUNK_FINALIZATION_STAGES[job.stageIndex];
      if (
        nextStage === "terrainColliderBuild" &&
        performance.now() - sliceStart > 1
      ) {
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
      (!needed.has(this._activeFinalization.key) ||
        this.chunks.has(this._activeFinalization.key))
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
        // Remove terrain geometry from BatchedMesh.
        this._terrainBatchedMesh.deleteInstance(
          mesh.userData.batchedInstanceId,
        );
        this._terrainBatchedMesh.deleteGeometry(mesh.userData.batchedGeomId);
        this._terrainBatchNeedsOptimize = true;
        // Return rock instances to their global pools.
        this._freeChunkRockSlots(mesh.userData.rockSlots);
        // The tracking mesh was never added to the scene — no scene.remove needed.
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
        const [x, z] = key.split(",").map(Number);
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
    return (
      this._pendingChunks.length +
      this._inFlightById.size +
      this._pendingFinalizationKeys.size
    );
  }

  getChunkCount() {
    return this.chunks.size;
  }

  update(playerPos, allowChunkWork = true) {
    this._lastPlayerPos = playerPos;

    // Restore frustum culling on recently attached chunks once they've been
    // through enough render frames to compile their GPU pipelines.
    for (let i = this._freshAttachments.length - 1; i >= 0; i--) {
      const entry = this._freshAttachments[i];
      entry.framesLeft--;
      if (entry.framesLeft <= 0) {
        for (const mesh of entry.meshes) {
          mesh.frustumCulled = true;
        }
        this._freshAttachments.splice(i, 1);
      }
    }

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
