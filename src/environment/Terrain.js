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
    const mat = new THREE.MeshStandardMaterial({
      color: 0x888890,
      roughness: 0.55,
      metalness: 0.08,
    });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWPos;`
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec4 _wp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            _wp = instanceMatrix * _wp;
          #endif
          _wp = modelMatrix * _wp;
          vWPos = _wp.xyz;
        }`
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWPos;
        float _rh(vec3 p) {
          p = fract(p * vec3(443.897, 441.423, 437.195));
          p += dot(p, p.yzx + 19.19);
          return fract((p.x + p.y) * p.z);
        }
        float _rn(vec3 p) {
          vec3 i = floor(p); vec3 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mix(_rh(i), _rh(i+vec3(1,0,0)), f.x),
                mix(_rh(i+vec3(0,1,0)), _rh(i+vec3(1,1,0)), f.x), f.y),
            mix(mix(_rh(i+vec3(0,0,1)), _rh(i+vec3(1,0,1)), f.x),
                mix(_rh(i+vec3(0,1,1)), _rh(i+vec3(1,1,1)), f.x), f.y), f.z);
        }`
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          float eps = 0.08, sc = 2.0;
          float h0 = _rn(vWPos * sc);
          float hx = _rn((vWPos + vec3(eps,0,0)) * sc);
          float hz = _rn((vWPos + vec3(0,0,eps)) * sc);
          vec3 grad = vec3((hx - h0) / eps, 0.0, (hz - h0) / eps);
          normal = normalize(normal - grad * 0.4);
        }`
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        {
          float depth = -vWPos.y;
          float wetness = smoothstep(500.0, 60.0, depth);
          roughnessFactor *= mix(1.0, 0.35, wetness);
          roughnessFactor += _rn(vWPos * 8.0) * 0.08 - 0.04;
          roughnessFactor = clamp(roughnessFactor, 0.1, 1.0);
        }`
      );
    };
    return mat;
  }

  _createTerrainMaterial() {
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0.05,
    });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWPos;
        varying float vSlope;`
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec4 _wp = modelMatrix * vec4(transformed, 1.0);
          vWPos = _wp.xyz;
          vec3 wNrm = normalize(mat3(modelMatrix) * objectNormal);
          vSlope = 1.0 - abs(wNrm.y);
        }`
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWPos;
        varying float vSlope;
        float _th(vec3 p) {
          p = fract(p * vec3(443.897, 441.423, 437.195));
          p += dot(p, p.yzx + 19.19);
          return fract((p.x + p.y) * p.z);
        }
        float _tn(vec3 p) {
          vec3 i = floor(p); vec3 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mix(_th(i), _th(i+vec3(1,0,0)), f.x),
                mix(_th(i+vec3(0,1,0)), _th(i+vec3(1,1,0)), f.x), f.y),
            mix(mix(_th(i+vec3(0,0,1)), _th(i+vec3(1,0,1)), f.x),
                mix(_th(i+vec3(0,1,1)), _th(i+vec3(1,1,1)), f.x), f.y), f.z);
        }
        float _tfbm(vec3 p) {
          float s = 0.0, a = 1.0, f = 1.0, m = 0.0;
          for (int i = 0; i < 4; i++) {
            s += _tn(p * f) * a; m += a; f *= 2.0; a *= 0.5;
          }
          return s / m;
        }`
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          float depth = -vWPos.y;
          vec3 rockCol = vec3(0.25, 0.22, 0.2) + _tn(vWPos * 0.5) * 0.06;
          vec3 siltCol = vec3(0.18, 0.15, 0.13) + _tn(vWPos * 0.3 + 100.0) * 0.04;
          vec3 algaeCol = vec3(0.12, 0.2, 0.08) + _tn(vWPos * 0.8 + 200.0) * 0.05;
          float algaeMask = smoothstep(200.0, 80.0, depth) * (1.0 - vSlope);
          float rockMask = smoothstep(0.3, 0.7, vSlope);
          float siltMask = max(1.0 - rockMask - algaeMask, 0.0);
          vec3 layered = rockCol * rockMask + siltCol * siltMask + algaeCol * algaeMask;
          diffuseColor.rgb = mix(layered, diffuseColor.rgb, 0.4);
          diffuseColor.rgb *= 0.9 + _tfbm(vWPos * 4.0) * 0.2;
        }`
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          float eps = 0.1, sc = 1.5;
          float h0 = _tfbm(vWPos * sc);
          float hx = _tfbm((vWPos + vec3(eps,0,0)) * sc);
          float hz = _tfbm((vWPos + vec3(0,0,eps)) * sc);
          vec3 grad = vec3((hx - h0) / eps, 0.0, (hz - h0) / eps);
          normal = normalize(normal - grad * 0.35);
        }`
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        {
          float depth = -vWPos.y;
          float wetness = smoothstep(500.0, 60.0, depth);
          roughnessFactor *= mix(1.0, 0.45, wetness);
          roughnessFactor += vSlope * 0.1;
          roughnessFactor += _tn(vWPos * 6.0) * 0.1 - 0.05;
          roughnessFactor = clamp(roughnessFactor, 0.15, 1.0);
        }`
      );
    };
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
