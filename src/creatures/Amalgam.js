import * as THREE from 'three';
import { LOD_NEAR_DISTANCE, LOD_MEDIUM_DISTANCE, toStandardMaterial } from './lodUtils.js';

const AMALGAM_LOD = {
  near:   { coreSegs: [16, 14], skulls: 3, limbs: 6, pipes: 4 },
  medium: { coreSegs: [10, 8],  skulls: 2, limbs: 3, pipes: 2 },
  far:    { coreSegs: [6, 4],   skulls: 1, limbs: 2, pipes: 0 },
};

// Fused mass of multiple creature bodies merged together - biomechanical horror amalgamation
export class Amalgam {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time = Math.random() * 100;
    this.speed = 0.3 + Math.random() * 0.2;
    this.direction = new THREE.Vector3(Math.random() - 0.5, -0.05, Math.random() - 0.5).normalize();

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  _buildModel() {
    this.tiers = {};
    const lod = new THREE.LOD();
    for (const [tierName, profile] of Object.entries(AMALGAM_LOD)) {
      const tier = this._buildTier(profile, tierName === 'far');
      this.tiers[tierName] = tier;
      const dist = tierName === 'near' ? 0 : tierName === 'medium' ? LOD_NEAR_DISTANCE : LOD_MEDIUM_DISTANCE;
      lod.addLevel(tier.group, dist);
    }
    this.lod = lod;
    this.group.add(lod);

    this.glow = new THREE.PointLight(0xffaa00, 0.8, 12);
    this.tiers.near.group.add(this.glow);

    const s = 2 + Math.random() * 2;
    this.group.scale.setScalar(s);
  }

  _buildTier(profile, useFarMat) {
    const tierGroup = new THREE.Group();
    const limbs = [];

    let fleshMat = new THREE.MeshPhysicalMaterial({
      color: 0x120810, roughness: 0.25, metalness: 0.3,
      clearcoat: 0.9, clearcoatRoughness: 0.15,
    });
    let metalMat = new THREE.MeshPhysicalMaterial({
      color: 0x0a0a0a, roughness: 0.12, metalness: 0.85, clearcoat: 1.0,
    });
    let boneMat = new THREE.MeshPhysicalMaterial({
      color: 0x2a2218, roughness: 0.25, metalness: 0.4, clearcoat: 0.8,
    });
    if (useFarMat) {
      fleshMat = toStandardMaterial(fleshMat);
      metalMat = toStandardMaterial(metalMat);
      boneMat = toStandardMaterial(boneMat);
    }

    // Core mass
    const coreGeo = new THREE.SphereGeometry(1.5, profile.coreSegs[0], profile.coreSegs[1]);
    const cp = coreGeo.attributes.position;
    for (let i = 0; i < cp.count; i++) {
      const x = cp.getX(i), y = cp.getY(i), z = cp.getZ(i);
      const n = 1 + Math.sin(x * 3 + y * 4) * 0.2 + Math.cos(z * 5 + x * 2) * 0.15;
      cp.setX(i, x * n); cp.setY(i, y * n); cp.setZ(i, z * n);
    }
    coreGeo.computeVertexNormals();
    tierGroup.add(new THREE.Mesh(coreGeo, fleshMat));

    // Skulls
    const skullSegs = useFarMat ? 6 : 10;
    for (let i = 0; i < profile.skulls; i++) {
      const skullGeo = new THREE.SphereGeometry(0.3, skullSegs, Math.max(4, skullSegs - 2), 0, Math.PI);
      skullGeo.scale(1.3, 0.8, 0.7);
      const skull = new THREE.Mesh(skullGeo, boneMat);
      const phi = Math.random() * Math.PI * 2;
      const theta = Math.random() * Math.PI;
      skull.position.set(
        Math.sin(theta) * Math.cos(phi) * 1.3,
        Math.sin(theta) * Math.sin(phi) * 1.3,
        Math.cos(theta) * 1.3
      );
      skull.lookAt(0, 0, 0);
      tierGroup.add(skull);

      let eyeMat = new THREE.MeshPhysicalMaterial({
        color: 0xffcc00, emissive: 0xffaa00, emissiveIntensity: 2, roughness: 0,
      });
      if (useFarMat) eyeMat = toStandardMaterial(eyeMat);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), eyeMat);
      eye.position.copy(skull.position);
      eye.position.y += 0.1;
      tierGroup.add(eye);
    }

    // Limbs
    for (let i = 0; i < profile.limbs; i++) {
      const limbGroup = new THREE.Group();
      const len = 0.5 + Math.random() * 1.5;
      const limbGeo = new THREE.CylinderGeometry(0.06, 0.03, len, useFarMat ? 4 : 6);
      limbGroup.add(new THREE.Mesh(limbGeo, i % 2 === 0 ? metalMat : fleshMat));
      if (Math.random() > 0.5) {
        const knob = new THREE.Mesh(new THREE.SphereGeometry(0.06, useFarMat ? 4 : 6, useFarMat ? 4 : 6), boneMat);
        knob.position.y = -len * 0.5;
        limbGroup.add(knob);
      }
      const phi = Math.random() * Math.PI * 2;
      const theta = Math.random() * Math.PI;
      limbGroup.position.set(
        Math.sin(theta) * Math.cos(phi) * 1.2,
        Math.sin(theta) * Math.sin(phi) * 1.2,
        Math.cos(theta) * 1.2
      );
      limbGroup.lookAt(0, 0, 0);
      limbs.push(limbGroup);
      tierGroup.add(limbGroup);
    }

    // Pipes
    for (let i = 0; i < profile.pipes; i++) {
      const pipeGeo = new THREE.CylinderGeometry(0.03, 0.03, 3 + Math.random(), useFarMat ? 4 : 6);
      const pipe = new THREE.Mesh(pipeGeo, metalMat);
      pipe.position.set((Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5);
      pipe.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
      tierGroup.add(pipe);
    }

    return { group: tierGroup, limbs };
  }

  update(dt, playerPos) {
    this.time += dt;

    // Slow agonized drift
    this.group.position.add(this.direction.clone().multiplyScalar(this.speed * dt));
    this.group.position.y += Math.sin(this.time * 0.2) * 0.08 * dt;

    // Slow tumbling rotation
    this.group.rotation.x += dt * 0.02;
    this.group.rotation.z += dt * 0.015;

    // Limbs twitch
    for (const tier of Object.values(this.tiers)) {
      for (let i = 0; i < tier.limbs.length; i++) {
        const phase = this.time * 2 + i * 1.3;
        tier.limbs[i].rotation.x += Math.sin(phase) * 0.01;
        tier.limbs[i].rotation.z += Math.cos(phase * 0.7) * 0.005;
      }
    }

    // Glow pulses
    this.glow.intensity = 0.5 + Math.sin(this.time * 1.2) * 0.3 + Math.sin(this.time * 5) * 0.15;

    if (this.group.position.distanceTo(playerPos) > 200) {
      const a = Math.random() * Math.PI * 2;
      this.group.position.set(playerPos.x + Math.cos(a) * 80, playerPos.y - Math.random() * 15, playerPos.z + Math.sin(a) * 80);
    }
  }

  getPosition() { return this.group.position; }
  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); });
  }
}
