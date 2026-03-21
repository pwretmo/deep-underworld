import * as THREE from 'three';
import { noise2D } from '../utils/noise.js';

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
  }

  _getChunkKey(cx, cz) { return `${cx},${cz}`; }

  _createFloraChunk(cx, cz) {
    const group = new THREE.Group();
    const size = this.chunkSize;
    const offsetX = cx * size;
    const offsetZ = cz * size;

    // Use noise to determine flora placement
    const floraCount = 12 + Math.floor(Math.random() * 10);

    for (let i = 0; i < floraCount; i++) {
      const fx = (Math.random() - 0.5) * size * 0.9;
      const fz = (Math.random() - 0.5) * size * 0.9;
      const worldX = fx + offsetX;
      const worldZ = fz + offsetZ;

      // Estimate terrain height at this position
      const terrainVal = noise2D(worldX * 0.003, worldZ * 0.003) * 40;
      const baseDepth = -80 - Math.abs(noise2D(worldX * 0.001, worldZ * 0.001)) * 400;
      const groundY = baseDepth + terrainVal;
      const depth = -groundY;

      const type = Math.random();

      if (depth < 150 && type < 0.4) {
        // Kelp strands
        this._addKelp(group, fx, groundY, fz);
      } else if (depth < 300 && type < 0.6) {
        // Coral formations
        this._addCoral(group, fx, groundY, fz, depth);
      } else if (depth > 100 && type < 0.8) {
        // Bioluminescent orbs
        this._addBioOrb(group, fx, groundY, fz, depth);
      } else if (depth > 200) {
        // Deep sea tube worms
        this._addTubeWorms(group, fx, groundY, fz);
      }
    }

    group.position.set(offsetX, 0, offsetZ);
    return group;
  }

  _addKelp(parent, x, y, z) {
    const segments = 8 + Math.floor(Math.random() * 6);
    const height = 6 + Math.random() * 10;
    const segHeight = height / segments;

    const points = [];
    for (let i = 0; i <= segments; i++) {
      points.push(new THREE.Vector3(0, i * segHeight, 0));
    }

    const curve = new THREE.CatmullRomCurve3(points);
    const geo = new THREE.TubeGeometry(curve, segments, 0.08 + Math.random() * 0.05, 4, false);
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0.1, 0.3 + Math.random() * 0.2, 0.05),
      roughness: 0.8,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
    });

    const kelp = new THREE.Mesh(geo, mat);
    kelp.position.set(x, y, z);
    parent.add(kelp);

    // Store for animation
    this.kelps.push({ mesh: kelp, curve, segHeight, segments, phase: Math.random() * Math.PI * 2 });

    // Kelp leaves
    for (let i = 2; i < segments; i += 2) {
      const leafGeo = new THREE.PlaneGeometry(0.8, 0.3);
      const leaf = new THREE.Mesh(leafGeo, mat);
      leaf.position.set(x + 0.3, y + i * segHeight, z);
      leaf.rotation.y = Math.random() * Math.PI;
      leaf.rotation.z = Math.PI / 4;
      parent.add(leaf);
    }
  }

  _addCoral(parent, x, y, z, depth) {
    const colorChoices = depth < 100
      ? [0xff6644, 0xff44aa, 0xffaa33, 0xff8866]  // Shallow: vibrant
      : [0x664455, 0x554466, 0x445566, 0x556644];  // Deep: muted

    const color = colorChoices[Math.floor(Math.random() * colorChoices.length)];

    // Branching coral structure
    const create = (px, py, pz, size, depth_r) => {
      if (depth_r > 3 || size < 0.15) return;
      const geo = new THREE.CylinderGeometry(size * 0.6, size, size * 3, 5);
      const mat = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.7,
        emissive: depth > 200 ? new THREE.Color(color).multiplyScalar(0.1) : new THREE.Color(0),
      });
      const branch = new THREE.Mesh(geo, mat);
      branch.position.set(px, py + size * 1.5, pz);
      branch.rotation.x = (Math.random() - 0.5) * 0.5;
      branch.rotation.z = (Math.random() - 0.5) * 0.5;
      parent.add(branch);

      const branches = 2 + Math.floor(Math.random() * 2);
      for (let i = 0; i < branches; i++) {
        const angle = (i / branches) * Math.PI * 2 + Math.random() * 0.5;
        create(
          px + Math.cos(angle) * size,
          py + size * 3,
          pz + Math.sin(angle) * size,
          size * 0.65,
          depth_r + 1
        );
      }
    };

    create(x, y, z, 0.4 + Math.random() * 0.4, 0);
  }

  _addBioOrb(parent, x, y, z, depth) {
    const colors = [0x00ffaa, 0x00aaff, 0x8844ff, 0xff00aa, 0x44ffaa];
    const color = colors[Math.floor(Math.random() * colors.length)];
    const size = 0.1 + Math.random() * 0.3;

    const geo = new THREE.SphereGeometry(size, 8, 8);
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.8,
      transparent: true,
      opacity: 0.7,
    });

    const orb = new THREE.Mesh(geo, mat);
    orb.position.set(x, y + 1 + Math.random() * 5, z);
    parent.add(orb);

    // Point light for glow
    if (Math.random() < 0.3) {
      const light = new THREE.PointLight(color, 1, 10);
      light.position.copy(orb.position);
      parent.add(light);
    }
  }

  _addTubeWorms(parent, x, y, z) {
    const count = 3 + Math.floor(Math.random() * 5);
    for (let i = 0; i < count; i++) {
      const height = 1 + Math.random() * 3;
      const geo = new THREE.CylinderGeometry(0.04, 0.06, height, 6);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x884422,
        roughness: 0.9,
      });
      const tube = new THREE.Mesh(geo, mat);
      tube.position.set(
        x + (Math.random() - 0.5) * 0.5,
        y + height / 2,
        z + (Math.random() - 0.5) * 0.5
      );
      tube.rotation.x = (Math.random() - 0.5) * 0.15;
      tube.rotation.z = (Math.random() - 0.5) * 0.15;
      parent.add(tube);

      // Red/orange tip
      const tipGeo = new THREE.SphereGeometry(0.12, 6, 6);
      const tipMat = new THREE.MeshStandardMaterial({
        color: 0xff3300,
        emissive: 0xff2200,
        emissiveIntensity: 0.3,
      });
      const tip = new THREE.Mesh(tipGeo, tipMat);
      tip.position.set(tube.position.x, y + height, tube.position.z);
      parent.add(tip);
    }
  }

  update(dt, playerPos) {
    this.time += dt;

    // Build at most 1 pending flora chunk per frame to avoid frame spikes
    if (this._pendingChunks.length > 0) {
      const { key, x, z } = this._pendingChunks.shift();
      if (!this.groups.has(key)) {
        const chunk = this._createFloraChunk(x, z);
        this.scene.add(chunk);
        this.groups.set(key, chunk);
      }
    }

    // Chunk management
    const cx = Math.round(playerPos.x / this.chunkSize);
    const cz = Math.round(playerPos.z / this.chunkSize);

    if (cx !== this.lastChunkX || cz !== this.lastChunkZ) {
      this.lastChunkX = cx;
      this.lastChunkZ = cz;

      const needed = new Set();
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          needed.add(this._getChunkKey(cx + dx, cz + dz));
        }
      }

      for (const [key, group] of this.groups) {
        if (!needed.has(key)) {
          this.scene.remove(group);
          this.groups.delete(key);
          // Clean up kelp refs
          this.kelps = this.kelps.filter(k => k.mesh.parent !== group);
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
