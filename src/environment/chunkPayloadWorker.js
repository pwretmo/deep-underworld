import { fbm2D, noise2D } from '../utils/noise.js';

const TERRAIN_COLORS = {
  shallow: [0.6, 0.5, 0.3],
  mid: [0.3, 0.25, 0.2],
  deep: [0.15, 0.12, 0.15],
  abyss: [0.08, 0.05, 0.1],
};

const ORB_COLORS = [0x00ffaa, 0x00aaff, 0x8844ff, 0xff00aa, 0x44ffaa];
const CORAL_SHALLOW_COLORS = [0xff6644, 0xff44aa, 0xffaa33, 0xff8866];
const CORAL_DEEP_COLORS = [0x664455, 0x554466, 0x445566, 0x556644];

const cancelledRequests = new Set();

function getTerrainHeight(x, z) {
  let h = fbm2D(x * 0.003, z * 0.003, 6) * 40;
  h += Math.abs(noise2D(x * 0.01, z * 0.01)) * 15;

  const trench = noise2D(x * 0.005 + 100, z * 0.005 + 100);
  if (trench > 0.3) {
    h -= (trench - 0.3) * 100;
  }

  return h;
}

function getTerrainBaseDepth(x, z) {
  return -80 - Math.abs(fbm2D(x * 0.001, z * 0.001)) * 600;
}

function createTerrainPayload({ cx, cz, chunkSize, resolution }) {
  const offsetX = cx * chunkSize;
  const offsetZ = cz * chunkSize;
  const vertsPerSide = resolution + 1;
  const vertCount = vertsPerSide * vertsPerSide;

  const positions = new Float32Array(vertCount * 3);
  const colors = new Float32Array(vertCount * 3);
  const colliderVertices = new Float32Array(vertCount * 3);

  const step = chunkSize / resolution;
  const half = chunkSize * 0.5;
  let writeIdx = 0;

  for (let iz = 0; iz <= resolution; iz++) {
    const localZ = iz * step - half;
    for (let ix = 0; ix <= resolution; ix++) {
      const localX = ix * step - half;
      const worldX = localX + offsetX;
      const worldZ = localZ + offsetZ;
      const h = getTerrainHeight(worldX, worldZ);
      const baseDepth = getTerrainBaseDepth(worldX, worldZ);
      const y = baseDepth + h;

      positions[writeIdx] = localX;
      positions[writeIdx + 1] = y;
      positions[writeIdx + 2] = localZ;

      colliderVertices[writeIdx] = worldX;
      colliderVertices[writeIdx + 1] = y;
      colliderVertices[writeIdx + 2] = worldZ;

      const depth = -y;
      let color;
      if (depth < 80) {
        color = TERRAIN_COLORS.shallow;
      } else if (depth < 200) {
        color = TERRAIN_COLORS.mid;
      } else if (depth < 500) {
        color = TERRAIN_COLORS.deep;
      } else {
        color = TERRAIN_COLORS.abyss;
      }

      const v = noise2D(worldX * 0.1, worldZ * 0.1) * 0.05;
      colors[writeIdx] = color[0] + v;
      colors[writeIdx + 1] = color[1] + v;
      colors[writeIdx + 2] = color[2] + v;

      writeIdx += 3;
    }
  }

  const triCount = resolution * resolution * 2;
  const indices = new Uint32Array(triCount * 3);
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

  for (let i = 0; i < rockCount; i++) {
    const localX = (Math.random() - 0.5) * chunkSize * 0.8;
    const localZ = (Math.random() - 0.5) * chunkSize * 0.8;
    const worldX = localX + offsetX;
    const worldZ = localZ + offsetZ;
    const h = getTerrainHeight(worldX, worldZ);
    const baseDepth = getTerrainBaseDepth(worldX, worldZ);

    const scaleX = 1 + Math.random() * 4;
    const scaleY = scaleX * (0.5 + Math.random() * 0.8);
    const scaleZ = scaleX;
    const localY = baseDepth + h + scaleX * 0.3;

    const transformIdx = i * 9;
    rockTransforms[transformIdx] = localX;
    rockTransforms[transformIdx + 1] = localY;
    rockTransforms[transformIdx + 2] = localZ;
    rockTransforms[transformIdx + 3] = scaleX;
    rockTransforms[transformIdx + 4] = scaleY;
    rockTransforms[transformIdx + 5] = scaleZ;
    rockTransforms[transformIdx + 6] = Math.random();
    rockTransforms[transformIdx + 7] = Math.random();
    rockTransforms[transformIdx + 8] = Math.random();

    const radius = (scaleX + scaleY + scaleZ) / 3;
    const colliderIdx = i * 4;
    rockColliders[colliderIdx] = worldX;
    rockColliders[colliderIdx + 1] = localY;
    rockColliders[colliderIdx + 2] = worldZ;
    rockColliders[colliderIdx + 3] = radius;
  }

  return {
    positions,
    colors,
    indices,
    colliderVertices,
    rockTransforms,
    rockColliders,
  };
}

function createCoralBranches(baseX, baseY, baseZ, size, out) {
  function grow(px, py, pz, branchSize, depth) {
    if (depth > 3 || branchSize < 0.15) return;

    out.push({
      x: px,
      y: py + branchSize * 1.5,
      z: pz,
      size: branchSize,
      rx: (Math.random() - 0.5) * 0.5,
      rz: (Math.random() - 0.5) * 0.5,
    });

    const branches = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < branches; i++) {
      const angle = (i / branches) * Math.PI * 2 + Math.random() * 0.5;
      grow(
        px + Math.cos(angle) * branchSize,
        py + branchSize * 3,
        pz + Math.sin(angle) * branchSize,
        branchSize * 0.65,
        depth + 1
      );
    }
  }

  grow(baseX, baseY, baseZ, size, 0);
}

function createFloraPayload({ cx, cz, chunkSize, floraDensityScale }) {
  const offsetX = cx * chunkSize;
  const offsetZ = cz * chunkSize;

  const kelps = [];
  const corals = [];
  const orbs = [];
  const orbLights = [];
  const tubes = [];
  const tubeTips = [];

  const floraCount = Math.round((12 + Math.floor(Math.random() * 10)) * floraDensityScale);
  let lightsInChunk = 0;

  for (let i = 0; i < floraCount; i++) {
    const x = (Math.random() - 0.5) * chunkSize * 0.9;
    const z = (Math.random() - 0.5) * chunkSize * 0.9;
    const worldX = x + offsetX;
    const worldZ = z + offsetZ;

    const terrainVal = noise2D(worldX * 0.003, worldZ * 0.003) * 40;
    const baseDepth = -80 - Math.abs(noise2D(worldX * 0.001, worldZ * 0.001)) * 400;
    const groundY = baseDepth + terrainVal;
    const depth = -groundY;

    const type = Math.random();

    if (depth < 150 && type < 0.4) {
      const segments = 8 + Math.floor(Math.random() * 6);
      const height = 6 + Math.random() * 10;
      const segHeight = height / segments;
      const leafRotations = [];
      for (let seg = 2; seg < segments; seg += 2) {
        leafRotations.push({
          y: seg * segHeight,
          ry: Math.random() * Math.PI,
        });
      }

      kelps.push({
        x,
        y: groundY,
        z,
        segments,
        height,
        radius: 0.08 + Math.random() * 0.05,
        green: 0.3 + Math.random() * 0.2,
        phase: Math.random() * Math.PI * 2,
        leafRotations,
      });
    } else if (depth < 300 && type < 0.6) {
      const palette = depth < 100 ? CORAL_SHALLOW_COLORS : CORAL_DEEP_COLORS;
      const color = palette[Math.floor(Math.random() * palette.length)];
      const baseSize = 0.4 + Math.random() * 0.4;
      const branches = [];
      createCoralBranches(x, groundY, z, baseSize, branches);
      corals.push({
        color,
        emissiveFactor: depth > 200 ? 0.1 : 0,
        branches,
      });
    } else if (depth > 100 && type < 0.8) {
      const color = ORB_COLORS[Math.floor(Math.random() * ORB_COLORS.length)];
      const oy = groundY + 1 + Math.random() * 5;
      orbs.push({
        x,
        y: oy,
        z,
        size: 0.1 + Math.random() * 0.3,
        color,
      });

      if (lightsInChunk < 2 && Math.random() < 0.1) {
        orbLights.push({
          x,
          y: oy,
          z,
          color,
          intensity: 0.8,
          distance: 25,
        });
        lightsInChunk++;
      }
    } else if (depth > 200) {
      const count = 3 + Math.floor(Math.random() * 5);
      for (let j = 0; j < count; j++) {
        const height = 1 + Math.random() * 3;
        const tx = x + (Math.random() - 0.5) * 0.5;
        const tz = z + (Math.random() - 0.5) * 0.5;
        const rx = (Math.random() - 0.5) * 0.15;
        const rz = (Math.random() - 0.5) * 0.15;

        tubes.push({ x: tx, y: groundY + height * 0.5, z: tz, height, rx, rz });
        tubeTips.push({ x: tx, y: groundY + height, z: tz });
      }
    }
  }

  return {
    kelps,
    corals,
    orbs,
    orbLights,
    tubes,
    tubeTips,
  };
}

self.onmessage = (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  if (data.type === 'cancel') {
    cancelledRequests.add(data.requestId);
    return;
  }

  const { requestId } = data;
  if (cancelledRequests.has(requestId)) {
    cancelledRequests.delete(requestId);
    return;
  }

  if (data.type === 'generateTerrain') {
    const payload = createTerrainPayload(data);
    if (cancelledRequests.has(requestId)) {
      cancelledRequests.delete(requestId);
      return;
    }

    self.postMessage({
      type: 'terrainPayload',
      requestId,
      key: data.key,
      cx: data.cx,
      cz: data.cz,
      payload,
    });
    return;
  }

  if (data.type === 'generateFlora') {
    const payload = createFloraPayload(data);
    if (cancelledRequests.has(requestId)) {
      cancelledRequests.delete(requestId);
      return;
    }

    self.postMessage({
      type: 'floraPayload',
      requestId,
      key: data.key,
      cx: data.cx,
      cz: data.cz,
      payload,
    });
  }
};
