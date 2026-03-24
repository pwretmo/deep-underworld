import * as THREE from 'three';
import { LOD_NEAR_DISTANCE, LOD_MEDIUM_DISTANCE, toStandardMaterial } from './lodUtils.js';

const MAW_LOD = {
  near:   { throatSegs: [24, 10], lipSegs: [12, 24], toothRings: 3, teethPer: [16, 12, 8], tendrils: 8 },
  medium: { throatSegs: [14, 6],  lipSegs: [8, 14],  toothRings: 2, teethPer: [10, 6],     tendrils: 4 },
  far:    { throatSegs: [8, 3],   lipSegs: [6, 8],   toothRings: 2, teethPer: [6, 4],       tendrils: 0 },
};

// Giant floating mouth/throat with concentric rings of teeth - biomechanical abyss gulper
export class AbyssalMaw {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time = Math.random() * 100;
    this.speed = 0.6 + Math.random() * 0.4;
    this.direction = new THREE.Vector3(Math.random() - 0.5, -0.15, Math.random() - 0.5).normalize();
    this.turnTimer = 0;
    this.turnInterval = 20 + Math.random() * 20;

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  _buildModel() {
    this.tiers = {};
    const lod = new THREE.LOD();
    for (const [tierName, profile] of Object.entries(MAW_LOD)) {
      const tier = this._buildTier(profile, tierName === 'far');
      this.tiers[tierName] = tier;
      const dist = tierName === 'near' ? 0 : tierName === 'medium' ? LOD_NEAR_DISTANCE : LOD_MEDIUM_DISTANCE;
      lod.addLevel(tier.group, dist);
    }
    this.lod = lod;
    this.group.add(lod);

    // Light only on near tier
    this.innerLight = new THREE.PointLight(0xff0033, 2, 15);
    this.innerLight.position.z = -2;
    this.tiers.near.group.add(this.innerLight);

    const s = 1.5 + Math.random() * 2;
    this._baseScale = s;
    this.group.scale.setScalar(s);
  }

  _buildTier(profile, useFarMat) {
    const tierGroup = new THREE.Group();
    const rings = [];

    let bodyMat = new THREE.MeshPhysicalMaterial({
      color: 0x080610, roughness: 0.2, metalness: 0.6,
      clearcoat: 1.0, clearcoatRoughness: 0.1,
    });
    let fleshMat = new THREE.MeshPhysicalMaterial({
      color: 0x200818, roughness: 0.3, metalness: 0.3, clearcoat: 0.8,
    });
    let toothMat = new THREE.MeshPhysicalMaterial({
      color: 0x403028, roughness: 0.2, metalness: 0.5, clearcoat: 1.0,
    });
    if (useFarMat) {
      bodyMat = toStandardMaterial(bodyMat);
      fleshMat = toStandardMaterial(fleshMat);
      toothMat = toStandardMaterial(toothMat);
    }

    // Throat
    const throatGeo = new THREE.CylinderGeometry(2.5, 0.8, 6, profile.throatSegs[0], profile.throatSegs[1], true);
    const tp = throatGeo.attributes.position;
    for (let i = 0; i < tp.count; i++) {
      const y = tp.getY(i), x = tp.getX(i), z = tp.getZ(i);
      tp.setX(i, x * (1 + Math.sin(y * 6) * 0.08));
      tp.setZ(i, z * (1 + Math.sin(y * 6) * 0.08));
    }
    throatGeo.computeVertexNormals();
    const throat = new THREE.Mesh(throatGeo, fleshMat);
    throat.rotation.x = Math.PI / 2;
    tierGroup.add(throat);

    // Concentric tooth rings
    for (let ring = 0; ring < profile.toothRings; ring++) {
      const ringGroup = new THREE.Group();
      const radius = 2.2 - ring * 0.5;
      const teethCount = profile.teethPer[ring] || 4;
      const toothLen = 0.7 + ring * 0.25;
      const toothGeo = new THREE.ConeGeometry(0.08, toothLen, useFarMat ? 4 : 6);
      for (let t = 0; t < teethCount; t++) {
        const angle = (t / teethCount) * Math.PI * 2;
        const tooth = new THREE.Mesh(toothGeo, toothMat);
        tooth.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
        tooth.rotation.x = Math.PI / 2;
        tooth.lookAt(0, 0, 0.5);
        ringGroup.add(tooth);
      }
      ringGroup.position.z = -ring * 1.5;
      rings.push(ringGroup);
      tierGroup.add(ringGroup);
    }

    // Outer lip
    const lipGeo = new THREE.TorusGeometry(2.5, 0.4, profile.lipSegs[0], profile.lipSegs[1]);
    const lip = new THREE.Mesh(lipGeo, bodyMat);
    lip.rotation.x = Math.PI / 2;
    tierGroup.add(lip);

    // Tendrils
    for (let i = 0; i < profile.tendrils; i++) {
      const angle = (i / profile.tendrils) * Math.PI * 2;
      const tendrilGeo = new THREE.CylinderGeometry(0.06, 0.03, 3 + Math.random() * 2, useFarMat ? 4 : 6);
      const tendril = new THREE.Mesh(tendrilGeo, bodyMat);
      tendril.position.set(Math.cos(angle) * 2.5, Math.sin(angle) * 2.5, 0.5);
      tendril.rotation.x = Math.PI / 2 + (Math.random() - 0.5) * 0.3;
      tierGroup.add(tendril);
    }

    // Inner glow sphere
    let glowMat = new THREE.MeshPhysicalMaterial({
      color: 0xff0044, emissive: 0x660022, emissiveIntensity: 2,
      transparent: true, opacity: 0.5, roughness: 0,
    });
    if (useFarMat) glowMat = toStandardMaterial(glowMat);
    const glowSegs = useFarMat ? 6 : 12;
    tierGroup.add(new THREE.Mesh(new THREE.SphereGeometry(0.5, glowSegs, glowSegs), glowMat)).position.z = -4;

    return { group: tierGroup, rings };
  }

  update(dt, playerPos) {
    this.time += dt;
    this.turnTimer += dt;

    if (this.turnTimer > this.turnInterval) {
      this.turnTimer = 0;
      this.turnInterval = 20 + Math.random() * 20;
      if (Math.random() < 0.3) {
        this.direction.subVectors(playerPos, this.group.position).normalize();
        this.direction.y *= 0.15;
      } else {
        this.direction.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.08, Math.random() - 0.5).normalize();
      }
    }

    this.group.position.add(this.direction.clone().multiplyScalar(this.speed * dt));

    // Slowly rotate tooth rings in opposite directions
    for (const tier of Object.values(this.tiers)) {
      for (let i = 0; i < tier.rings.length; i++) {
        tier.rings[i].rotation.z += (i % 2 === 0 ? 1 : -1) * dt * 0.3;
      }
    }

    // Face direction of travel
    const target = this.group.position.clone().add(this.direction);
    this.group.lookAt(target);

    // Breathing pulse
    const pulse = 1 + Math.sin(this.time * 1.5) * 0.05;
    this.group.scale.setScalar(this._baseScale * pulse);

    // Internal glow pulsing
    this.innerLight.intensity = 1.5 + Math.sin(this.time * 2) * 1;

    if (this.group.position.distanceTo(playerPos) > 200) {
      const a = Math.random() * Math.PI * 2;
      this.group.position.set(playerPos.x + Math.cos(a) * 80, playerPos.y - Math.random() * 20, playerPos.z + Math.sin(a) * 80);
    }
  }

  getPosition() { return this.group.position; }
  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); });
  }
}
