import * as THREE from 'three';
import { noise2D } from '../utils/noise.js';

const PICKUP_RADIUS = 5;
const OXYGEN_RESTORE = 30;
const BATTERY_RESTORE = 40;
const PULSE_SPEED = 2;
const GLOW_COLOR = 0x22ffaa;
const CACHE_SPACING_MIN = 50;
const CACHE_SPACING_MAX = 100;
const HORIZONTAL_SPREAD = 120;

export class SupplyCache {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.caches = [];
    this._time = 0;
    this._spawnCaches();
  }

  _spawnCaches() {
    // Create cache geometry + materials (shared)
    const geo = new THREE.CylinderGeometry(0.4, 0.5, 0.8, 6);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x115533,
      emissive: GLOW_COLOR,
      emissiveIntensity: 0.4,
      roughness: 0.3,
      metalness: 0.6,
      transparent: true,
      opacity: 0.85,
    });

    // Place caches across depth range, scattered horizontally
    // Roughly one cache every 50-100m of depth, spread across terrain
    let depth = 30;
    while (depth < 900) {
      const count = 2 + Math.floor(Math.random() * 2); // 2-3 caches per depth band
      for (let i = 0; i < count; i++) {
        const x = (Math.random() - 0.5) * HORIZONTAL_SPREAD * 2;
        const z = (Math.random() - 0.5) * HORIZONTAL_SPREAD * 2;

        // Use terrain height to place on ocean floor
        const terrainY = this.terrain._getTerrainHeight(x, z);
        // Terrain positions follow: baseDepth + h pattern from Terrain.js
        const baseDepth = -80 - Math.abs(noise2D(x * 0.001, z * 0.001)) * 600;
        const y = baseDepth + terrainY + 0.5; // slightly above ground

        const mesh = new THREE.Mesh(geo, mat.clone());
        mesh.position.set(x, y, z);
        mesh.castShadow = true;

        // Add a point light for eerie glow
        const light = new THREE.PointLight(GLOW_COLOR, 0.6, 12);
        light.position.set(0, 0.6, 0);
        mesh.add(light);

        this.group.add(mesh);
        this.caches.push({
          mesh,
          light,
          collected: false,
          flashTimer: 0,
        });
      }

      depth += CACHE_SPACING_MIN + Math.random() * (CACHE_SPACING_MAX - CACHE_SPACING_MIN);
    }
  }

  /**
   * Update caches — pulse glow and check for player pickups.
   * Returns an array of pickup events (usually 0 or 1 per frame).
   */
  update(dt, playerPosition) {
    this._time += dt;
    const pickups = [];

    for (const cache of this.caches) {
      if (cache.collected) {
        // Animate flash-out
        if (cache.flashTimer > 0) {
          cache.flashTimer -= dt;
          const s = cache.flashTimer / 0.4;
          cache.mesh.scale.setScalar(1 + (1 - s) * 2);
          cache.mesh.material.opacity = s;
          cache.light.intensity = s * 3;
          if (cache.flashTimer <= 0) {
            cache.mesh.visible = false;
            cache.light.visible = false;
          }
        }
        continue;
      }

      // Pulsing glow
      const pulse = 0.3 + Math.sin(this._time * PULSE_SPEED + cache.mesh.position.x) * 0.15;
      cache.mesh.material.emissiveIntensity = pulse;
      cache.light.intensity = 0.4 + Math.sin(this._time * PULSE_SPEED + cache.mesh.position.z) * 0.2;

      // Slow rotation
      cache.mesh.rotation.y += dt * 0.5;

      // Check pickup distance
      const dist = playerPosition.distanceTo(cache.mesh.position);
      if (dist < PICKUP_RADIUS) {
        cache.collected = true;
        cache.flashTimer = 0.4;
        // Bright flash on pickup
        cache.mesh.material.emissive.setHex(0xffffff);
        cache.mesh.material.emissiveIntensity = 2;
        cache.light.intensity = 3;
        cache.light.color.setHex(0xffffff);

        pickups.push({ oxygen: OXYGEN_RESTORE, battery: BATTERY_RESTORE });
      }
    }

    return pickups;
  }

  reset() {
    for (const cache of this.caches) {
      cache.collected = false;
      cache.flashTimer = 0;
      cache.mesh.visible = true;
      cache.mesh.scale.setScalar(1);
      cache.mesh.material.opacity = 0.85;
      cache.mesh.material.emissive.setHex(GLOW_COLOR);
      cache.mesh.material.emissiveIntensity = 0.4;
      cache.light.visible = true;
      cache.light.intensity = 0.6;
      cache.light.color.setHex(GLOW_COLOR);
    }
  }

  dispose() {
    for (const cache of this.caches) {
      cache.mesh.geometry.dispose();
      cache.mesh.material.dispose();
    }
    this.scene.remove(this.group);
  }
}
