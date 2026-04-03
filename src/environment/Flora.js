import * as THREE from "three/webgpu";
import {
  abs,
  clamp,
  cos,
  dot,
  materialColor,
  materialEmissive,
  normalView,
  positionLocal,
  positionView,
  pow,
  sub,
  uniform,
  vec3,
} from "three/tsl";
import { qualityManager } from "../QualityManager.js";
import { expandGeometryBounds } from "../utils/geometryBounds.js";

const KELP_SWAY_FREQUENCY = 0.5;
const KELP_SWAY_DELTA = 0.3;
const KELP_SWAY_DISPLACEMENT_SCALE = KELP_SWAY_DELTA / KELP_SWAY_FREQUENCY;
const KELP_SWAY_BOUNDS_PADDING = KELP_SWAY_DISPLACEMENT_SCALE * 2;

export class Flora {
  constructor(scene, options = {}) {
    this.scene = scene;
    this._pointLightBudget = options.pointLightBudget ?? null;
    this.groups = new Map();
    this.chunkSize = 80;
    this.lastChunkX = null;
    this.lastChunkZ = null;
    this.time = 0;
    this._kelpTime = uniform(0);
    this._pendingChunks = []; // queue for staggered generation
    this._floraDensityScale = qualityManager.getSettings().floraDensityScale;
    this._neededChunkKeys = new Set();
    this._readyPayloads = [];
    this._requestSeq = 0;
    this._inFlightById = new Map();
    this._inFlightByKey = new Map();
    this._maxInFlight = 2;
    this._chunkWorker = new Worker(
      new URL("./chunkPayloadWorker.js", import.meta.url),
      { type: "module" },
    );
    this._chunkWorker.onmessage = (event) => {
      const data = event.data;
      if (!data || data.type !== "floraPayload") return;

      const request = this._inFlightById.get(data.requestId);
      if (!request) return;

      this._inFlightById.delete(data.requestId);
      if (this._inFlightByKey.get(request.key) === data.requestId) {
        this._inFlightByKey.delete(request.key);
      }

      if (
        request.cancelled ||
        !this._neededChunkKeys.has(request.key) ||
        this.groups.has(request.key)
      ) {
        return;
      }

      this._readyPayloads.push({
        key: request.key,
        cx: data.cx,
        cz: data.cz,
        payload: data.payload,
      });
    };

    // Shared geometry/materials for instanced bio-orbs
    this._orbGeo = new THREE.SphereGeometry(1, 8, 8);
    // Freshly attached flora chunks: temporarily disable frustum culling so
    // the WebGPU backend compiles their GPU pipeline on the next render frame
    // regardless of camera direction.
    this._freshAttachments = [];

    this._orbMat = new THREE.MeshStandardMaterial({
      emissive: 0xffffff,
      emissiveIntensity: 0.8,
      transparent: true,
      opacity: 0.7,
      roughness: 0.3,
    });

    // Shared geometry/materials for instanced tube worms — wet organic look
    this._tubeGeo = new THREE.CylinderGeometry(0.04, 0.06, 1, 6);
    this._tubeMat = new THREE.MeshStandardMaterial({
      color: 0x884422,
      roughness: 0.4,
      metalness: 0.05,
    });
    this._tipGeo = new THREE.SphereGeometry(0.12, 6, 6);
    this._tipMat = new THREE.MeshStandardMaterial({
      color: 0xff3300,
      emissive: 0xff2200,
      emissiveIntensity: 0.4,
      roughness: 0.25,
      metalness: 0.1,
    });

    // Shared geometry for kelp leaves (used in per-kelp InstancedMesh)
    this._leafGeo = new THREE.PlaneGeometry(0.8, 0.3);

    // Shared geometry and materials for batched coral branches.
    // A unit cylinder (radiusTop=0.6, radiusBottom=1, height=3) is scaled per
    // instance via the matrix so that all branches share a single draw call
    // per chunk instead of one draw call per branch mesh.
    this._coralBranchGeo = new THREE.CylinderGeometry(0.6, 1, 3, 5);
    this._coralMatShallow = new THREE.MeshStandardMaterial({
      roughness: 0.45,
      metalness: 0.05,
    });
    // Deep-zone coral gets a per-instance emissive derived from its base color.
    this._coralMatDeep = new THREE.MeshStandardNodeMaterial({
      roughness: 0.45,
      metalness: 0.05,
    });
    this._coralMatDeep.emissiveNode = materialColor.mul(0.1);

    // Matrix used to hide inactive global-pool instances (zero scale = invisible).
    this._zeroScaleMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

    // Global InstancedMesh pools for orbs, tubes, and tips.
    // Instead of creating per-chunk InstancedMesh objects (25 × 3 = 75 draw
    // calls), all visible instances share 3 global meshes = 3 draw calls total.
    const MAX_ORB_INSTANCES = 500;
    const MAX_TUBE_INSTANCES = 1200;
    const MAX_TIP_INSTANCES = 1200;

    this._orbPool = new THREE.InstancedMesh(
      this._orbGeo,
      this._orbMat,
      MAX_ORB_INSTANCES,
    );
    this._orbPool.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(MAX_ORB_INSTANCES * 3),
      3,
    );
    for (let i = 0; i < MAX_ORB_INSTANCES; i++)
      this._orbPool.setMatrixAt(i, this._zeroScaleMatrix);
    this._orbPool.instanceMatrix.needsUpdate = true;
    this._orbPool.instanceColor.needsUpdate = true;
    this._orbFreeSlots = Array.from(
      { length: MAX_ORB_INSTANCES },
      (_, i) => i,
    ).reverse();

    this._tubePool = new THREE.InstancedMesh(
      this._tubeGeo,
      this._tubeMat,
      MAX_TUBE_INSTANCES,
    );
    for (let i = 0; i < MAX_TUBE_INSTANCES; i++)
      this._tubePool.setMatrixAt(i, this._zeroScaleMatrix);
    this._tubePool.instanceMatrix.needsUpdate = true;
    this._tubeFreeSlots = Array.from(
      { length: MAX_TUBE_INSTANCES },
      (_, i) => i,
    ).reverse();

    this._tipPool = new THREE.InstancedMesh(
      this._tipGeo,
      this._tipMat,
      MAX_TIP_INSTANCES,
    );
    for (let i = 0; i < MAX_TIP_INSTANCES; i++)
      this._tipPool.setMatrixAt(i, this._zeroScaleMatrix);
    this._tipPool.instanceMatrix.needsUpdate = true;
    this._tipFreeSlots = Array.from(
      { length: MAX_TIP_INSTANCES },
      (_, i) => i,
    ).reverse();

    // Add global pools to scene once; they persist for the lifetime of Flora.
    this.scene.add(this._orbPool);
    this.scene.add(this._tubePool);
    this.scene.add(this._tipPool);
    this._orbPool.frustumCulled = false;
    this._tubePool.frustumCulled = false;
    this._tipPool.frustumCulled = false;

    // Scratch color for pool slot allocation
    this._tmpColor = new THREE.Color();

    window.addEventListener("qualitychange", (/** @type {CustomEvent} */ e) => {
      this._floraDensityScale = e.detail.settings.floraDensityScale;
      // Mark all chunks for rebuild on next move
      if (this.lastChunkX !== null) {
        this._rebuildPendingAround(this.lastChunkX, this.lastChunkZ);
      }
    });
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
      type: "generateFlora",
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

    // Batch all coral branches in the chunk into at most two InstancedMesh
    // objects (one for shallow corals with no emissive, one for deep corals
    // with a per-instance emissive derived from the branch color).  This
    // replaces the old per-branch THREE.Mesh approach (~10-20 draw calls per
    // chunk for corals → 2 draw calls per chunk).
    {
      const shallowBranches = [];
      const deepBranches = [];
      for (const coralData of payload.corals) {
        const color = new THREE.Color(coralData.color);
        const target = coralData.emissiveFactor > 0 ? deepBranches : shallowBranches;
        for (const branchData of coralData.branches) {
          target.push({
            x: branchData.x,
            y: branchData.y,
            z: branchData.z,
            size: branchData.size,
            rx: branchData.rx,
            rz: branchData.rz,
            color,
          });
        }
      }

      const _buildCoralIM = (branches, mat) => {
        const im = new THREE.InstancedMesh(
          this._coralBranchGeo,
          mat,
          branches.length,
        );
        im.instanceColor = new THREE.InstancedBufferAttribute(
          new Float32Array(branches.length * 3),
          3,
        );
        // Geometry and material are shared — do not dispose them on group removal.
        im.userData.sharedResources = true;
        const dummy = new THREE.Object3D();
        for (let i = 0; i < branches.length; i++) {
          const d = branches[i];
          dummy.position.set(d.x, d.y, d.z);
          dummy.scale.setScalar(d.size);
          dummy.rotation.set(d.rx, 0, d.rz);
          dummy.updateMatrix();
          im.setMatrixAt(i, dummy.matrix);
          im.setColorAt(i, d.color);
        }
        im.instanceMatrix.needsUpdate = true;
        im.instanceColor.needsUpdate = true;
        group.add(im);
      };

      if (shallowBranches.length > 0)
        _buildCoralIM(shallowBranches, this._coralMatShallow);
      if (deepBranches.length > 0)
        _buildCoralIM(deepBranches, this._coralMatDeep);
    }

    // Allocate bio-orbs from the global pool instead of creating a new
    // InstancedMesh per chunk (25 per-chunk IMs → 1 global IM = 1 draw call).
    {
      const orbSlots = [];
      const dummy = new THREE.Object3D();
      for (const d of payload.orbs) {
        const slot = this._orbFreeSlots.pop();
        if (slot == null) break; // pool exhausted — skip gracefully
        dummy.position.set(d.x + offsetX, d.y, d.z + offsetZ);
        dummy.scale.setScalar(d.size);
        dummy.updateMatrix();
        this._orbPool.setMatrixAt(slot, dummy.matrix);
        this._tmpColor.setHex(d.color);
        this._orbPool.setColorAt(slot, this._tmpColor);
        orbSlots.push(slot);
      }
      if (orbSlots.length > 0) {
        this._orbPool.instanceMatrix.needsUpdate = true;
        this._orbPool.instanceColor.needsUpdate = true;
      }
      group.userData.orbSlots = orbSlots;
    }

    for (const lightData of payload.orbLights) {
      const light = new THREE.PointLight(
        lightData.color,
        lightData.intensity,
        lightData.distance,
      );
      light.userData.duwCategory = "flora_decor";
      light.position.set(lightData.x, lightData.y, lightData.z);
      group.add(light);
    }

    // Allocate tube worm cylinders from the global tube pool.
    {
      const tubeSlots = [];
      const dummy = new THREE.Object3D();
      for (const d of payload.tubes) {
        const slot = this._tubeFreeSlots.pop();
        if (slot == null) break;
        dummy.position.set(d.x + offsetX, d.y, d.z + offsetZ);
        dummy.scale.set(1, d.height, 1);
        dummy.rotation.set(d.rx, 0, d.rz);
        dummy.updateMatrix();
        this._tubePool.setMatrixAt(slot, dummy.matrix);
        tubeSlots.push(slot);
      }
      if (tubeSlots.length > 0) this._tubePool.instanceMatrix.needsUpdate = true;
      group.userData.tubeSlots = tubeSlots;
    }

    // Allocate tube worm tips from the global tip pool.
    {
      const tipSlots = [];
      const dummy = new THREE.Object3D();
      for (const d of payload.tubeTips) {
        const slot = this._tipFreeSlots.pop();
        if (slot == null) break;
        dummy.position.set(d.x + offsetX, d.y, d.z + offsetZ);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        this._tipPool.setMatrixAt(slot, dummy.matrix);
        tipSlots.push(slot);
      }
      if (tipSlots.length > 0) this._tipPool.instanceMatrix.needsUpdate = true;
      group.userData.tipSlots = tipSlots;
    }

    group.position.set(offsetX, 0, offsetZ);
    return group;
  }

  _createKelpMaterial(color, emissive) {
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.5,
      metalness: 0.02,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      emissive,
      emissiveIntensity: 0.5,
    });
    const viewDir = positionView.negate().normalize();
    const NdV = abs(dot(normalView, viewDir));
    const rim = pow(sub(1.0, NdV), 2.0);
    material.emissiveNode = materialEmissive.add(
      materialColor.mul(rim).mul(0.15),
    );
    return material;
  }

  _addKelpFromData(parent, kelpData) {
    const segHeight = kelpData.height / kelpData.segments;

    const points = [];
    for (let i = 0; i <= kelpData.segments; i++) {
      points.push(new THREE.Vector3(0, i * segHeight, 0));
    }

    const curve = new THREE.CatmullRomCurve3(points);
    const geo = new THREE.TubeGeometry(
      curve,
      kelpData.segments,
      kelpData.radius,
      4,
      false,
    );
    expandGeometryBounds(geo, "x", KELP_SWAY_BOUNDS_PADDING);

    const color = new THREE.Color(0.1, kelpData.green, 0.05);
    const emissive = new THREE.Color(0.02, kelpData.green * 0.15, 0.01);
    const kelpHeight = uniform(Math.max(kelpData.height, 0.001));
    const kelpPhase = uniform(kelpData.phase);
    const heightRatio = clamp(positionLocal.y.div(kelpHeight), 0.0, 1.0);
    const swayOffset = cos(kelpPhase)
      .sub(cos(this._kelpTime.mul(KELP_SWAY_FREQUENCY).add(kelpPhase)))
      .mul(KELP_SWAY_DISPLACEMENT_SCALE)
      .mul(heightRatio);

    const mat = this._createKelpMaterial(color, emissive);
    // Match the previous integrated CPU sway from a fixed rest pose without mutating vertex buffers.
    mat.positionNode = vec3(
      positionLocal.x.add(swayOffset),
      positionLocal.y,
      positionLocal.z,
    );
    mat.needsUpdate = true;

    const kelp = new THREE.Mesh(geo, mat);
    kelp.position.set(kelpData.x, kelpData.y, kelpData.z);
    parent.add(kelp);

    // Batch all leaves belonging to this kelp stalk into a single InstancedMesh
    // using the shared leaf geometry.  Each stalk still needs its own material
    // (because the sway animation embeds per-stalk uniforms via positionNode),
    // so this saves N−1 draw calls per stalk (N leaves → 1 draw call).
    if (kelpData.leafRotations.length > 0) {
      const leafMat2 = this._createKelpMaterial(color, emissive);
      leafMat2.positionNode = vec3(
        positionLocal.x.add(swayOffset),
        positionLocal.y,
        positionLocal.z,
      );
      leafMat2.needsUpdate = true;

      const leafIM = new THREE.InstancedMesh(
        this._leafGeo,
        leafMat2,
        kelpData.leafRotations.length,
      );
      // Geometry is shared across all kelp stalks — do not dispose on group unload.
      leafIM.userData.sharedGeometry = true;
      const dummy = new THREE.Object3D();
      for (let i = 0; i < kelpData.leafRotations.length; i++) {
        const leafData = kelpData.leafRotations[i];
        dummy.position.set(
          kelpData.x + 0.3,
          kelpData.y + leafData.y,
          kelpData.z,
        );
        dummy.rotation.set(0, leafData.ry, Math.PI / 4);
        dummy.updateMatrix();
        leafIM.setMatrixAt(i, dummy.matrix);
      }
      leafIM.instanceMatrix.needsUpdate = true;
      parent.add(leafIM);
    }
  }

  _addCoralFromData(parent, coralData) {
    const emissive =
      coralData.emissiveFactor > 0
        ? new THREE.Color(coralData.color).multiplyScalar(
            coralData.emissiveFactor,
          )
        : new THREE.Color(0);
    const mat = new THREE.MeshStandardMaterial({
      color: coralData.color,
      roughness: 0.45,
      metalness: 0.05,
      emissive,
    });

    for (const branchData of coralData.branches) {
      const geo = new THREE.CylinderGeometry(
        branchData.size * 0.6,
        branchData.size,
        branchData.size * 3,
        5,
      );
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
      this._pointLightBudget?.registerObjectLights(chunk);
      this.groups.set(key, chunk);
      // Temporarily disable frustum culling on new flora meshes so the WebGPU
      // backend compiles their GPU pipelines on the next render regardless of
      // camera direction.
      const affectedMeshes = [];
      chunk.traverse((obj) => {
        if ((obj.isMesh || obj.isInstancedMesh) && obj.frustumCulled) {
          obj.frustumCulled = false;
          affectedMeshes.push(obj);
        }
      });
      if (affectedMeshes.length > 0) {
        this._freshAttachments.push({ meshes: affectedMeshes, framesLeft: 3 });
      }
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
      if (
        this.groups.has(key) ||
        this._inFlightByKey.has(key) ||
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

  _disposeGroup(group) {
    this._pointLightBudget?.unregisterObjectLights(group);
    group.traverse((child) => {
      // Skip meshes whose geometry/material is shared across chunks — only
      // dispose resources that belong exclusively to this group.
      if (child.userData?.sharedResources) return;
      if (child.geometry && !child.userData?.sharedGeometry)
        child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });

    // Return orb, tube, and tip instances to the global pools so that their
    // slots can be reused by newly-loaded chunks.
    const zeroM = this._zeroScaleMatrix;

    const orbSlots = group.userData.orbSlots;
    if (orbSlots?.length) {
      for (const slot of orbSlots) {
        this._orbPool.setMatrixAt(slot, zeroM);
        this._orbFreeSlots.push(slot);
      }
      this._orbPool.instanceMatrix.needsUpdate = true;
    }

    const tubeSlots = group.userData.tubeSlots;
    if (tubeSlots?.length) {
      for (const slot of tubeSlots) {
        this._tubePool.setMatrixAt(slot, zeroM);
        this._tubeFreeSlots.push(slot);
      }
      this._tubePool.instanceMatrix.needsUpdate = true;
    }

    const tipSlots = group.userData.tipSlots;
    if (tipSlots?.length) {
      for (const slot of tipSlots) {
        this._tipPool.setMatrixAt(slot, zeroM);
        this._tipFreeSlots.push(slot);
      }
      this._tipPool.instanceMatrix.needsUpdate = true;
    }

    this.scene.remove(group);
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
    this._readyPayloads = this._readyPayloads.filter((entry) =>
      needed.has(entry.key),
    );

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
    return (
      this._pendingChunks.length +
      this._inFlightById.size +
      this._readyPayloads.length
    );
  }

  getChunkCount() {
    return this.groups.size;
  }

  update(dt, playerPos, allowChunkWork = true) {
    this.time += dt;

    // Restore frustum culling on recently attached flora once they've been
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

    if (allowChunkWork) {
      // Build/apply at most 1 payload per streaming frame and request at most 1 new chunk
      this._applyReadyPayloads(1);
      this._requestPendingChunks(1);
    }

    // Chunk management
    const cx = Math.round(playerPos.x / this.chunkSize);
    const cz = Math.round(playerPos.z / this.chunkSize);

    if (cx !== this.lastChunkX || cz !== this.lastChunkZ) {
      this.lastChunkX = cx;
      this.lastChunkZ = cz;
      this._rebuildPendingAround(cx, cz);
    }

    this._kelpTime.value = this.time;
  }
}
