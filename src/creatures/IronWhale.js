import * as THREE from 'three';
import { LOD_NEAR_DISTANCE, LOD_MEDIUM_DISTANCE, toStandardMaterial } from './lodUtils.js';

const _tmpDir = new THREE.Vector3();

const WHALE_LOD = {
  near:   { bodySegs: [24, 18], dorsalPlates: 8, barnacles: 15, baleen: 12 },
  medium: { bodySegs: [14, 10], dorsalPlates: 4, barnacles: 7,  baleen: 6 },
  far:    { bodySegs: [8, 6],   dorsalPlates: 2, barnacles: 3,  baleen: 4 },
};

// Colossal biomechanical whale - ancient, covered in barnacle-like pipes, mechanical baleen
export class IronWhale {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time = Math.random() * 100;
    this.speed = 0.8 + Math.random() * 0.4;
    this.direction = new THREE.Vector3(Math.random() - 0.5, -0.03, Math.random() - 0.5).normalize();
    this.turnTimer = 0;
    this.turnInterval = 25 + Math.random() * 20;

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  _buildModel() {
    const lod = new THREE.LOD();
    for (const [tierName, profile] of Object.entries(WHALE_LOD)) {
      const tierGroup = this._buildTier(profile, tierName === 'far');
      const dist = tierName === 'near' ? 0 : tierName === 'medium' ? LOD_NEAR_DISTANCE : LOD_MEDIUM_DISTANCE;
      lod.addLevel(tierGroup, dist);
    }
    this.lod = lod;
    this.group.add(lod);

    // Eye light on near tier only
    this.eyeLight = new THREE.PointLight(0x2244aa, 1.5, 25);
    this.eyeLight.userData.duwCategory = 'creature_bio';
    this.eyeLight.position.set(5, 0.5, 0);
    lod.levels[0].object.add(this.eyeLight);

    this.group.scale.setScalar(2 + Math.random() * 2);
  }

  _buildTier(profile, useFarMat) {
    const tierGroup = new THREE.Group();

    let hullMat = new THREE.MeshPhysicalMaterial({
      color: 0x0a0a0c, roughness: 0.2, metalness: 0.75,
      clearcoat: 1.0, clearcoatRoughness: 0.1,
      emissive: 0x203858, emissiveIntensity: 0.5,
    });
    let barnMat = new THREE.MeshPhysicalMaterial({
      color: 0x3a3228, roughness: 0.35, metalness: 0, clearcoat: 0.6,
      emissive: 0x504030, emissiveIntensity: 0.5,
    });
    let metalMat = new THREE.MeshPhysicalMaterial({
      color: 0x181818, roughness: 0.1, metalness: 0.92, clearcoat: 1.0,
      emissive: 0x204060, emissiveIntensity: 0.3,
    });
    if (useFarMat) {
      hullMat = toStandardMaterial(hullMat);
      barnMat = toStandardMaterial(barnMat);
      metalMat = toStandardMaterial(metalMat);
    }

    // Body
    const bodyGeo = new THREE.SphereGeometry(2.5, profile.bodySegs[0], profile.bodySegs[1]);
    bodyGeo.scale(3, 1, 1.2);
    const bp = bodyGeo.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i);
      const head = Math.max(0, x) * 0.08;
      bp.setY(i, y * (1 - head * 0.3) + Math.sin(x * 3 + z * 4) * 0.05);
    }
    bodyGeo.computeVertexNormals();
    tierGroup.add(new THREE.Mesh(bodyGeo, hullMat));

    // Dorsal ridge plates
    for (let i = 0; i < profile.dorsalPlates; i++) {
      const plateGeo = new THREE.BoxGeometry(0.8, 0.2, 0.1, 2, 1, 1);
      const plate = new THREE.Mesh(plateGeo, metalMat);
      plate.position.set(i * 0.7 - 2.5, 2.2, 0);
      plate.rotation.z = Math.sin(i * 0.3) * 0.1;
      tierGroup.add(plate);
    }

    // Barnacle clusters
    for (let i = 0; i < profile.barnacles; i++) {
      const barnGeo = new THREE.CylinderGeometry(0.05, 0.08, 0.2 + Math.random() * 0.2, useFarMat ? 4 : 6);
      const barn = new THREE.Mesh(barnGeo, barnMat);
      barn.position.set((Math.random() - 0.5) * 6, 1 + Math.random() * 1.2, (Math.random() - 0.5) * 2);
      barn.rotation.x = (Math.random() - 0.5) * 0.3;
      tierGroup.add(barn);
    }

    // Baleen plates
    const jawGroup = new THREE.Group();
    for (let i = 0; i < profile.baleen; i++) {
      const baleenGeo = new THREE.BoxGeometry(0.02, 0.6, 0.15);
      jawGroup.add(new THREE.Mesh(baleenGeo, metalMat)).position.x = i * 0.15;
    }
    jawGroup.position.set(4, -1.5, 0);
    tierGroup.add(jawGroup);

    // Eyes
    let eyeMat = new THREE.MeshPhysicalMaterial({
      color: 0x4488ff, emissive: 0x2244aa, emissiveIntensity: 1.5, roughness: 0.1,
    });
    if (useFarMat) eyeMat = toStandardMaterial(eyeMat);
    const eyeSegs = useFarMat ? 6 : 10;
    for (const side of [-1, 1]) {
      tierGroup.add(new THREE.Mesh(new THREE.SphereGeometry(0.15, eyeSegs, eyeSegs), eyeMat)).position.set(5, 0.5, side * 2);
    }

    // Tail flukes
    for (const side of [-1, 1]) {
      const fluke = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.5, 2), hullMat);
      fluke.position.set(-7, side * 0.3, 0);
      fluke.rotation.x = side * 0.3;
      tierGroup.add(fluke);
    }

    // Pectoral fins
    for (const side of [-1, 1]) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 0.8), metalMat);
      fin.position.set(1, -1, side * 2.5);
      fin.rotation.z = side * 0.2;
      tierGroup.add(fin);
    }

    // Exhaust vents (near + medium only)
    if (!useFarMat) {
      for (let i = 0; i < 3; i++) {
        const ventGeo = new THREE.CylinderGeometry(0.15, 0.2, 0.3, 8, 1, true);
        const vent = new THREE.Mesh(ventGeo, metalMat);
        vent.position.set(-6, (i - 1) * 0.5, 0);
        vent.rotation.z = Math.PI / 2;
        tierGroup.add(vent);
      }
    }

    return tierGroup;
  }

  update(dt, playerPos, distSq) {
    this.time += dt;
    this.turnTimer += dt;

    if (this.turnTimer > this.turnInterval) {
      this.turnTimer = 0;
      this.turnInterval = 25 + Math.random() * 20;
      this.direction.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.02, Math.random() - 0.5).normalize();
    }

    this.group.position.add(_tmpDir.copy(this.direction).multiplyScalar(this.speed * dt));
    this.group.position.y += Math.sin(this.time * 0.2) * 0.1 * dt;

    // Slow majestic turn
    const angle = Math.atan2(this.direction.x, this.direction.z);
    this.group.rotation.y = THREE.MathUtils.lerp(this.group.rotation.y, angle + Math.PI / 2, dt * 0.5);

    // Gentle roll
    this.group.rotation.z = Math.sin(this.time * 0.15) * 0.02;

    if (distSq > 62500) {
      const a = Math.random() * Math.PI * 2;
      this.group.position.set(playerPos.x + Math.cos(a) * 100, playerPos.y - Math.random() * 20, playerPos.z + Math.sin(a) * 100);
    }
  }

  getPosition() { return this.group.position; }
  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); });
  }
}
