import * as THREE from 'three';
import { qualityManager } from '../QualityManager.js';

export class Flora {
  constructor(scene) {
    this.scene = scene;
    this.groups = new Map();
    this.chunkSize = 80;
    this.lastChunkX = null;
    this.lastChunkZ = null;
    this.time = 0;
    this.kelps = [];
    this._pendingChunks = []; // queue for staggered generation
    this._floraDensityScale = qualityManager.getSettings().floraDensityScale;
    this._neededChunkKeys = new Set();
    this._readyPayloads = [];
    this._requestSeq = 0;
    this._inFlightById = new Map();
    this._inFlightByKey = new Map();
    this._maxInFlight = 2;
    this._chunkWorker = new Worker(new URL('./chunkPayloadWorker.js', import.meta.url), { type: 'module' });
    this._chunkWorker.onmessage = (event) => {
      const data = event.data;
      if (!data || data.type !== 'floraPayload') return;

      const request = this._inFlightById.get(data.requestId);
      if (!request) return;

      this._inFlightById.delete(data.requestId);
      if (this._inFlightByKey.get(request.key) === data.requestId) {
        this._inFlightByKey.delete(request.key);
      }

      if (request.cancelled || !this._neededChunkKeys.has(request.key) || this.groups.has(request.key)) {
        return;
      }

      this._readyPayloads.push({ key: request.key, cx: data.cx, cz: data.cz, payload: data.payload });
    };

    // Shared geometry/materials for instanced bio-orbs
    this._orbGeo = new THREE.SphereGeometry(1, 8, 8);
    this._orbMat = new THREE.MeshStandardMaterial({
      emissive: 0xffffff,
      emissiveIntensity: 0.8,
      transparent: true,
      opacity: 0.7,
    });

    // Shared geometry/materials for instanced tube worms
    this._tubeGeo = new THREE.CylinderGeometry(0.04, 0.06, 1, 6);
    this._tubeMat = new THREE.MeshStandardMaterial({
      color: 0x884422,
      roughness: 0.9,
    });
    this._tipGeo = new THREE.SphereGeometry(0.12, 6, 6);
    this._tipMat = new THREE.MeshStandardMaterial({
      color: 0xff3300,
      emissive: 0xff2200,
      emissiveIntensity: 0.3,
    });

    window.addEventListener('qualitychange', (e) => {
      this._floraDensityScale = e.detail.settings.floraDensityScale;
      // Mark all chunks for rebuild on next move
      if (this.lastChunkX !== null) {
        this._rebuildPendingAround(this.lastChunkX, this.lastChunkZ);
      }
    });
  }

  _getChunkKey(cx, cz) { return `${cx},${cz}`; }

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
      type: 'generateFlora',
      requestId,
      key,
      cx,
      cz,
      chunkSize: this.chunkSize,
      floraDensityScale: this._floraDensityScale,
    });
    return true;
  }

  _createFloraChunkFromPayload(cx, cz, payload) {
    const group = new THREE.Group();
    const offsetX = cx * this.chunkSize;
    const offsetZ = cz * this.chunkSize;

    for (const kelp of payload.kelps) {
      this._addKelpFromData(group, kelp);
    }

    for (const coral of payload.corals) {
      this._addCoralFromData(group, coral);
    }

    // Batch bio-orbs into InstancedMesh
    if (payload.orbs.length > 0) {
      const instancedOrbs = new THREE.InstancedMesh(this._orbGeo, this._orbMat, payload.orbs.length);
      instancedOrbs.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(payload.orbs.length * 3), 3
      );
      const dummy = new THREE.Object3D();
      const tmpColor = new THREE.Color();
      for (let i = 0; i < payload.orbs.length; i++) {
        const d = payload.orbs[i];
        dummy.position.set(d.x, d.y, d.z);
        dummy.scale.setScalar(d.size);
        dummy.updateMatrix();
        instancedOrbs.setMatrixAt(i, dummy.matrix);
        tmpColor.setHex(d.color);
        instancedOrbs.setColorAt(i, tmpColor);
      }
      instancedOrbs.instanceMatrix.needsUpdate = true;
      instancedOrbs.instanceColor.needsUpdate = true;
      group.add(instancedOrbs);
    }

    for (const lightData of payload.orbLights) {
      const light = new THREE.PointLight(lightData.color, lightData.intensity, lightData.distance);
      light.position.set(lightData.x, lightData.y, lightData.z);
      group.add(light);
    }

    // Batch tube worm cylinders into InstancedMesh
    if (payload.tubes.length > 0) {
      const instancedTubes = new THREE.InstancedMesh(this._tubeGeo, this._tubeMat, payload.tubes.length);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < payload.tubes.length; i++) {
        const d = payload.tubes[i];
        dummy.position.set(d.x, d.y, d.z);
        dummy.scale.set(1, d.height, 1);
        dummy.rotation.set(d.rx, 0, d.rz);
        dummy.updateMatrix();
        instancedTubes.setMatrixAt(i, dummy.matrix);
      }
      instancedTubes.instanceMatrix.needsUpdate = true;
      group.add(instancedTubes);
    }

    // Batch tube worm tips into InstancedMesh
    if (payload.tubeTips.length > 0) {
      const instancedTips = new THREE.InstancedMesh(this._tipGeo, this._tipMat, payload.tubeTips.length);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < payload.tubeTips.length; i++) {
        const d = payload.tubeTips[i];
        dummy.position.set(d.x, d.y, d.z);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        instancedTips.setMatrixAt(i, dummy.matrix);
      }
      instancedTips.instanceMatrix.needsUpdate = true;
      group.add(instancedTips);
    }

    group.position.set(offsetX, 0, offsetZ);
    return group;
  }

  _addKelpFromData(parent, kelpData) {
    const segHeight = kelpData.height / kelpData.segments;

    const points = [];
    for (let i = 0; i <= kelpData.segments; i++) {
      points.push(new THREE.Vector3(0, i * segHeight, 0));
    }

    const curve = new THREE.CatmullRomCurve3(points);
    const geo = new THREE.TubeGeometry(curve, kelpData.segments, kelpData.radius, 4, false);
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0.1, kelpData.green, 0.05),
      roughness: 0.8,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
    });

    const kelp = new THREE.Mesh(geo, mat);
    kelp.position.set(kelpData.x, kelpData.y, kelpData.z);
    parent.add(kelp);

    this.kelps.push({
      mesh: kelp,
      curve,
      segHeight,
      segments: kelpData.segments,
      phase: kelpData.phase,
    });

    for (const leafData of kelpData.leafRotations) {
      const leafGeo = new THREE.PlaneGeometry(0.8, 0.3);
      const leaf = new THREE.Mesh(leafGeo, mat);
      leaf.position.set(kelpData.x + 0.3, kelpData.y + leafData.y, kelpData.z);
      leaf.rotation.y = leafData.ry;
      leaf.rotation.z = Math.PI / 4;
      parent.add(leaf);
    }
  }

  _addCoralFromData(parent, coralData) {
    const emissive = coralData.emissiveFactor > 0
      ? new THREE.Color(coralData.color).multiplyScalar(coralData.emissiveFactor)
      : new THREE.Color(0);
    const mat = new THREE.MeshStandardMaterial({
      color: coralData.color,
      roughness: 0.7,
      emissive,
    });

    for (const branchData of coralData.branches) {
      const geo = new THREE.CylinderGeometry(branchData.size * 0.6, branchData.size, branchData.size * 3, 5);
      const branch = new THREE.Mesh(geo, mat);
      branch.position.set(branchData.x, branchData.y, branchData.z);
      branch.rotation.x = branchData.rx;
      branch.rotation.z = branchData.rz;
      parent.add(branch);
    }
  }

  _applyReadyPayloads(maxCount, cancelToken) {
    let applied = 0;
    while (this._readyPayloads.length > 0 && applied < maxCount) {
      if (cancelToken?.cancelled) break;
      const next = this._readyPayloads.shift();
      if (!next) break;

      const { key, cx, cz, payload } = next;
      if (!this._neededChunkKeys.has(key) || this.groups.has(key)) {
        continue;
      }

      const chunk = this._createFloraChunkFromPayload(cx, cz, payload);
      this.scene.add(chunk);
      this.groups.set(key, chunk);
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
      if (this.groups.has(key) || this._inFlightByKey.has(key) || !this._neededChunkKeys.has(key)) {
        continue;
      }

      if (this._requestChunkPayload(key, x, z)) {
        requested++;
      }
    }
    return requested;
  }

  _disposeGroup(group) {
    group.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
    this.scene.remove(group);
    this.kelps = this.kelps.filter(k => k.mesh.parent !== group);
  }

  _rebuildPendingAround(cx, cz) {
    const needed = new Set();
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        needed.add(this._getChunkKey(cx + dx, cz + dz));
      }
    }
    this._neededChunkKeys = needed;

    for (const [requestId, req] of this._inFlightById) {
      if (!needed.has(req.key)) {
        this._cancelInFlightRequest(requestId);
      }
    }
    this._readyPayloads = this._readyPayloads.filter(entry => needed.has(entry.key));

    for (const [key, group] of this.groups) {
      if (!needed.has(key)) {
        this._disposeGroup(group);
        this.groups.delete(key);
      }
    }

    // Queue new chunks for staggered creation (1 per frame)
    this._pendingChunks = [];
    for (const key of needed) {
      if (!this.groups.has(key)) {
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
    return this.groups.size;
  }

  update(dt, playerPos) {
    this.time += dt;

    // Build/apply at most 1 payload per frame and request at most 1 new chunk
    this._applyReadyPayloads(1);
    this._requestPendingChunks(1);

    // Chunk management
    const cx = Math.round(playerPos.x / this.chunkSize);
    const cz = Math.round(playerPos.z / this.chunkSize);

    if (cx !== this.lastChunkX || cz !== this.lastChunkZ) {
      this.lastChunkX = cx;
      this.lastChunkZ = cz;
      this._rebuildPendingAround(cx, cz);
    }

    // Animate kelp swaying
    for (const kelp of this.kelps) {
      const posArr = kelp.mesh.geometry.attributes.position.array;
      const sway = Math.sin(this.time * 0.5 + kelp.phase) * 0.3;
      // Simple vertex displacement for swaying effect
      for (let i = 0; i < posArr.length; i += 3) {
        const heightRatio = posArr[i + 1] / (kelp.segments * kelp.segHeight);
        posArr[i] += sway * heightRatio * dt;
      }
      kelp.mesh.geometry.attributes.position.needsUpdate = true;
    }
  }
}
