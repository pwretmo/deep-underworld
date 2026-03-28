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
    mesh.userData.physicsColliderHandles = [handle];
  }

  _addRocksFromPayload(parent, payload) {
    const count = payload.rockTransforms.length / 9;
    if (count <= 0) return;

    const numTypes = this._rockGeos.length;
    const groups = Array.from({ length: numTypes }, () => []);
    for (let i = 0; i < count; i++) {
      const t = payload.rockTypes ? payload.rockTypes[i] % numTypes : i % numTypes;
      groups[t].push(i);
    }

    const dummy = new THREE.Object3D();
    const tmpColor = new THREE.Color();

    for (let t = 0; t < numTypes; t++) {
      const ids = groups[t];
      if (ids.length === 0) continue;

      const inst = new THREE.InstancedMesh(this._rockGeos[t], this._rockMat, ids.length);
      inst.castShadow = true;
      inst.receiveShadow = true;

      if (payload.rockColors) {
        inst.instanceColor = new THREE.InstancedBufferAttribute(
          new Float32Array(ids.length * 3), 3
        );
      }

      for (let j = 0; j < ids.length; j++) {
        const i = ids[j];
        const idx = i * 9;
        dummy.position.set(
          payload.rockTransforms[idx],
          payload.rockTransforms[idx + 1],
          payload.rockTransforms[idx + 2]
        );
        dummy.scale.set(
          payload.rockTransforms[idx + 3],
          payload.rockTransforms[idx + 4],
          payload.rockTransforms[idx + 5]
        );
        dummy.rotation.set(
          payload.rockTransforms[idx + 6],
          payload.rockTransforms[idx + 7],
          payload.rockTransforms[idx + 8]
        );
        dummy.updateMatrix();
        inst.setMatrixAt(j, dummy.matrix);

        if (payload.rockColors) {
          const ci = i * 3;
          tmpColor.setRGB(
            payload.rockColors[ci],
            payload.rockColors[ci + 1],
            payload.rockColors[ci + 2]
          );
          inst.setColorAt(j, tmpColor);
        }
      }

      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      parent.add(inst);
    }

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

      const mat = this._terrainMat;

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

  update(playerPos, allowChunkWork = true) {
    const cx = Math.round(playerPos.x / this.chunkSize);
    const cz = Math.round(playerPos.z / this.chunkSize);

    if (allowChunkWork) {
      // Build/apply at most 1 chunk payload per streaming frame and request at most 1 new chunk
      this._applyReadyPayloads(1);
      this._requestPendingChunks(1);
    }

    if (cx === this.lastChunkX && cz === this.lastChunkZ) return;
    this.lastChunkX = cx;
    this.lastChunkZ = cz;
    this._rebuildPendingAround(cx, cz);
  }
}
