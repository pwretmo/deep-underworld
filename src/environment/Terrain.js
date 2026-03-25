import * as THREE from 'three';
import { qualityManager } from '../QualityManager.js';

export class Terrain {
  constructor(scene) {
    this.scene = scene;
    this.chunks = new Map();
    this.chunkSize = 80;
    this.resolution = 40;
    this.lastChunkX = null;
    this.lastChunkZ = null;
    this.viewDistance = qualityManager.getSettings().terrainViewDistance;
    this._pendingChunks = []; // queue for staggered generation
    this._physicsWorld = null;
    this._neededChunkKeys = new Set();
    this._readyPayloads = [];
    this._requestSeq = 0;
    this._inFlightById = new Map();
    this._inFlightByKey = new Map();
    this._maxInFlight = 2;
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

      if (request.cancelled || !this._neededChunkKeys.has(request.key) || this.chunks.has(request.key)) {
        return;
      }

      this._readyPayloads.push({ key: request.key, cx: data.cx, cz: data.cz, payload: data.payload });
    };

    window.addEventListener('qualitychange', (e) => {
      this.viewDistance = e.detail.settings.terrainViewDistance;
      if (this.lastChunkX !== null) {
        this._rebuildPendingAround(this.lastChunkX, this.lastChunkZ);
      }
    });

    // Shared geometry and material for rocks (avoids per-chunk allocation)
    this._rockGeo = new THREE.DodecahedronGeometry(1, 1);
    this._rockMat = new THREE.MeshStandardMaterial({
      color: 0x333340,
      roughness: 0.95,
      metalness: 0.05,
      flatShading: true,
    });
  }

  /**
   * Attach physics world for collision generation.
   * @param {import('../physics/PhysicsWorld.js').PhysicsWorld} physicsWorld
   */
  setPhysicsWorld(physicsWorld) {
    this._physicsWorld = physicsWorld;
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
    mesh.userData.physicsColliderHandles = [handle];
  }

  _addRocksFromPayload(parent, payload) {
    const count = payload.rockTransforms.length / 9;
    if (count <= 0) return;

    const dummy = new THREE.Object3D();
    const instancedRocks = new THREE.InstancedMesh(this._rockGeo, this._rockMat, count);
    instancedRocks.castShadow = true;
    instancedRocks.receiveShadow = true;

    for (let i = 0; i < count; i++) {
      const idx = i * 9;
      dummy.position.set(payload.rockTransforms[idx], payload.rockTransforms[idx + 1], payload.rockTransforms[idx + 2]);
      dummy.scale.set(payload.rockTransforms[idx + 3], payload.rockTransforms[idx + 4], payload.rockTransforms[idx + 5]);
      dummy.rotation.set(payload.rockTransforms[idx + 6], payload.rockTransforms[idx + 7], payload.rockTransforms[idx + 8]);
      dummy.updateMatrix();
      instancedRocks.setMatrixAt(i, dummy.matrix);
    }

    instancedRocks.instanceMatrix.needsUpdate = true;
    parent.add(instancedRocks);

    // Create physics sphere colliders for each rock from worker payload
    if (this._physicsWorld) {
      const handles = parent.userData.physicsColliderHandles || [];
      for (let i = 0; i < count; i++) {
        const idx = i * 4;
        const wx = payload.rockColliders[idx];
        const wy = payload.rockColliders[idx + 1];
        const wz = payload.rockColliders[idx + 2];
        const radius = payload.rockColliders[idx + 3];
        const handle = this._physicsWorld.createSphereCollider(wx, wy, wz, radius);
        handles.push(handle);
      }
      parent.userData.physicsColliderHandles = handles;
    }
  }

  _applyReadyPayloads(maxCount, cancelToken) {
    let applied = 0;
    while (this._readyPayloads.length > 0 && applied < maxCount) {
      if (cancelToken?.cancelled) break;
      const next = this._readyPayloads.shift();
      if (!next) break;

      const { key, cx, cz, payload } = next;
      if (!this._neededChunkKeys.has(key) || this.chunks.has(key)) {
        continue;
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(payload.positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(payload.colors, 3));
      geo.setIndex(new THREE.BufferAttribute(payload.indices, 1));
      geo.computeVertexNormals();

      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.9,
        metalness: 0.1,
        flatShading: true,
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(cx * this.chunkSize, 0, cz * this.chunkSize);
      mesh.receiveShadow = true;

      this._addRocksFromPayload(mesh, payload);
      if (this._physicsWorld) {
        this._createChunkCollider(mesh, payload.colliderVertices, payload.indices);
      }

      this.scene.add(mesh);
      this.chunks.set(key, mesh);
      applied++;
    }
    return applied;
  }

  _requestPendingChunks(maxCount, cancelToken) {
    let requested = 0;
    while (this._pendingChunks.length > 0 && requested < maxCount) {
      if (cancelToken?.cancelled) break;
      if (this._inFlightByKey.size >= this._maxInFlight) break;

      const { key, x, z } = this._pendingChunks.shift();
      if (this.chunks.has(key) || this._inFlightByKey.has(key) || !this._neededChunkKeys.has(key)) {
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
    this._readyPayloads = this._readyPayloads.filter(entry => needed.has(entry.key));

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
        mesh.material.dispose();
        this.chunks.delete(key);
      }
    }

    // Queue new chunks for staggered creation (1 per frame)
    this._pendingChunks = [];
    for (const key of needed) {
      if (!this.chunks.has(key)) {
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
    let progress = 0;
    while (progress < maxCount) {
      if (cancelToken?.cancelled) break;

      const applied = this._applyReadyPayloads(1, cancelToken);
      if (applied > 0) {
        progress += applied;
        continue;
      }

      const requested = this._requestPendingChunks(1, cancelToken);
      if (requested > 0) {
        progress += requested;
        continue;
      }

      break;
    }
    return progress;
  }

  getPendingCount() {
    return this._pendingChunks.length + this._inFlightById.size + this._readyPayloads.length;
  }

  getChunkCount() {
    return this.chunks.size;
  }

  update(playerPos) {
    const cx = Math.round(playerPos.x / this.chunkSize);
    const cz = Math.round(playerPos.z / this.chunkSize);

    // Build/apply at most 1 chunk payload per frame and request at most 1 new chunk
    this._applyReadyPayloads(1);
    this._requestPendingChunks(1);

    if (cx === this.lastChunkX && cz === this.lastChunkZ) return;
    this.lastChunkX = cx;
    this.lastChunkZ = cz;
    this._rebuildPendingAround(cx, cz);
  }
}
