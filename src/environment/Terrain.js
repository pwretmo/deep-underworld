import * as THREE from 'three';
import { fbm2D, noise2D } from '../utils/noise.js';

export class Terrain {
  constructor(scene) {
    this.scene = scene;
    this.chunks = new Map();
    this.chunkSize = 80;
    this.resolution = 40;
    this.lastChunkX = null;
    this.lastChunkZ = null;
    this.viewDistance = 3; // chunks in each direction
    this._pendingChunks = []; // queue for staggered generation
  }

  _getChunkKey(cx, cz) {
    return `${cx},${cz}`;
  }

  _getTerrainHeight(x, z) {
    // Multi-layered terrain
    let h = fbm2D(x * 0.003, z * 0.003, 6) * 40;
    // Add ridges
    h += Math.abs(noise2D(x * 0.01, z * 0.01)) * 15;
    // Deep trenches
    const trench = noise2D(x * 0.005 + 100, z * 0.005 + 100);
    if (trench > 0.3) {
      h -= (trench - 0.3) * 100;
    }
    return h;
  }

  _createChunk(cx, cz) {
    const size = this.chunkSize;
    const res = this.resolution;
    const geo = new THREE.PlaneGeometry(size, size, res, res);
    geo.rotateX(-Math.PI / 2);

    const positions = geo.attributes.position.array;
    const colors = new Float32Array(positions.length);

    const offsetX = cx * size;
    const offsetZ = cz * size;

    for (let i = 0; i < positions.length; i += 3) {
      const worldX = positions[i] + offsetX;
      const worldZ = positions[i + 2] + offsetZ;
      const h = this._getTerrainHeight(worldX, worldZ);

      // Terrain depth base: -50 to -800 depending on position
      const baseDepth = -80 - Math.abs(fbm2D(worldX * 0.001, worldZ * 0.001)) * 600;
      positions[i + 1] = baseDepth + h;

      // Color based on depth
      const depth = -positions[i + 1];
      if (depth < 80) {
        // Sandy/coral
        colors[i] = 0.6; colors[i + 1] = 0.5; colors[i + 2] = 0.3;
      } else if (depth < 200) {
        // Darker sand/rock
        colors[i] = 0.3; colors[i + 1] = 0.25; colors[i + 2] = 0.2;
      } else if (depth < 500) {
        // Dark rock
        colors[i] = 0.15; colors[i + 1] = 0.12; colors[i + 2] = 0.15;
      } else {
        // Abyss - dark with slight purple
        colors[i] = 0.08; colors[i + 1] = 0.05; colors[i + 2] = 0.1;
      }

      // Small color variation
      const v = noise2D(worldX * 0.1, worldZ * 0.1) * 0.05;
      colors[i] += v; colors[i + 1] += v; colors[i + 2] += v;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0.1,
      flatShading: true,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(offsetX, 0, offsetZ);
    mesh.receiveShadow = true;

    // Add rocks
    this._addRocks(mesh, offsetX, offsetZ, size);

    return mesh;
  }

  _addRocks(parent, offsetX, offsetZ, size) {
    const rockGeo = new THREE.DodecahedronGeometry(1, 1);
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x333340,
      roughness: 0.95,
      metalness: 0.05,
      flatShading: true,
    });

    const count = 8 + Math.floor(Math.random() * 8);
    for (let i = 0; i < count; i++) {
      const rx = (Math.random() - 0.5) * size * 0.8;
      const rz = (Math.random() - 0.5) * size * 0.8;
      const worldX = rx + offsetX;
      const worldZ = rz + offsetZ;
      const h = this._getTerrainHeight(worldX, worldZ);
      const baseDepth = -80 - Math.abs(fbm2D(worldX * 0.001, worldZ * 0.001)) * 600;

      const scale = 1 + Math.random() * 4;
      const rock = new THREE.Mesh(rockGeo, rockMat);
      rock.position.set(rx, baseDepth + h + scale * 0.3, rz);
      rock.scale.set(scale, scale * (0.5 + Math.random() * 0.8), scale);
      rock.rotation.set(Math.random(), Math.random(), Math.random());
      rock.castShadow = true;
      rock.receiveShadow = true;
      parent.add(rock);
    }
  }

  update(playerPos) {
    const cx = Math.round(playerPos.x / this.chunkSize);
    const cz = Math.round(playerPos.z / this.chunkSize);

    // Build at most 1 pending chunk per frame to avoid frame spikes
    if (this._pendingChunks.length > 0) {
      const { key, x, z } = this._pendingChunks.shift();
      if (!this.chunks.has(key)) {
        const chunk = this._createChunk(x, z);
        this.scene.add(chunk);
        this.chunks.set(key, chunk);
      }
    }

    if (cx === this.lastChunkX && cz === this.lastChunkZ) return;
    this.lastChunkX = cx;
    this.lastChunkZ = cz;

    const needed = new Set();
    for (let dx = -this.viewDistance; dx <= this.viewDistance; dx++) {
      for (let dz = -this.viewDistance; dz <= this.viewDistance; dz++) {
        needed.add(this._getChunkKey(cx + dx, cz + dz));
      }
    }

    // Remove distant chunks
    for (const [key, mesh] of this.chunks) {
      if (!needed.has(key)) {
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
}
