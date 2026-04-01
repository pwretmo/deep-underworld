import * as THREE from 'three';

const _tmpDir = new THREE.Vector3();

// Empty biomechanical exoskeleton husk that drifts and occasionally twitches
export class Husk {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time = Math.random() * 100;
    this.speed = 0.15 + Math.random() * 0.1;
    this.direction = new THREE.Vector3(Math.random() - 0.5, -0.03, Math.random() - 0.5).normalize();
    this.twitchTimer = 0;
    this.twitching = false;
    this.shellParts = [];

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  _buildModel() {
    const shellMat = new THREE.MeshPhysicalMaterial({
      color: 0x201810, roughness: 0.25, metalness: 0,
      clearcoat: 0.7, clearcoatRoughness: 0.2,
      emissive: 0x502040, emissiveIntensity: 0.7,
    });
    const innerMat = new THREE.MeshPhysicalMaterial({
      color: 0x100810, roughness: 0.3, metalness: 0,
      side: THREE.DoubleSide,
      emissive: 0x502040, emissiveIntensity: 0.8,
    });

    // Split shell halves - like a molted exoskeleton
    for (const side of [-1, 1]) {
      const halfGeo = new THREE.SphereGeometry(1, 14, 12, 0, Math.PI);
      halfGeo.scale(1.3, 1.0, 0.8);
      const hp = halfGeo.attributes.position;
      for (let i = 0; i < hp.count; i++) {
        const x = hp.getX(i), y = hp.getY(i), z = hp.getZ(i);
        hp.setX(i, x + Math.sin(y * 6 + z * 4) * 0.04);
      }
      halfGeo.computeVertexNormals();
      const half = new THREE.Mesh(halfGeo, shellMat);
      half.rotation.y = side * 0.1;
      half.position.z = side * 0.1;
      this.shellParts.push(half);
      this.group.add(half);
    }

    // Inner membrane remnants
    const memGeo = new THREE.PlaneGeometry(1.5, 1.8, 4, 6);
    const mp = memGeo.attributes.position;
    for (let i = 0; i < mp.count; i++) {
      mp.setZ(i, Math.sin(mp.getX(i) * 3 + mp.getY(i) * 2) * 0.1);
    }
    memGeo.computeVertexNormals();
    const membrane = new THREE.Mesh(memGeo, innerMat);
    this.group.add(membrane);

    // Trailing connective strands
    for (let i = 0; i < 4; i++) {
      const strandGeo = new THREE.CylinderGeometry(0.01, 0.005, 1.5 + Math.random() * 1, 4);
      const strand = new THREE.Mesh(strandGeo, shellMat);
      strand.position.set(
        (Math.random() - 0.5) * 0.8,
        -1 - Math.random() * 0.5,
        (Math.random() - 0.5) * 0.5
      );
      strand.rotation.x = (Math.random() - 0.5) * 0.3;
      this.group.add(strand);
    }

    // Broken mechanical joints still attached
    for (let i = 0; i < 3; i++) {
      const jointGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.5, 6);
      const joint = new THREE.Mesh(jointGeo, new THREE.MeshPhysicalMaterial({
        color: 0x101010, roughness: 0.1, metalness: 0.9, clearcoat: 1.0,
        emissive: 0x203848, emissiveIntensity: 0.3,
      }));
      joint.position.set(
        (Math.random() - 0.5) * 1.2,
        (Math.random() - 0.5) * 0.8,
        (Math.random() - 0.5) * 0.6
      );
      joint.rotation.set(Math.random(), Math.random(), Math.random());
      this.shellParts.push(joint);
      this.group.add(joint);
    }

    // Residual energy leak from cracked shell
    this.glow = new THREE.PointLight(0x1a0828, 0.6, 10);
    this.glow.userData.duwCategory = 'creature_bio';
    this.glow.position.set(0, 0, 0);
    this.group.add(this.glow);

    const s = 1.5 + Math.random() * 2;
    this.group.scale.setScalar(s);
  }

  update(dt, playerPos, distSq) {
    this.time += dt;
    this.twitchTimer += dt;

    // Very slow dead drift
    this.group.position.add(_tmpDir.copy(this.direction).multiplyScalar(this.speed * dt));
    this.group.position.y += Math.sin(this.time * 0.15) * 0.05 * dt;

    // Dead tumble
    this.group.rotation.x += dt * 0.01;
    this.group.rotation.z += dt * 0.008;

    // Occasional spasmic twitch
    if (this.twitchTimer > 8 + Math.random() * 15) {
      this.twitchTimer = 0;
      this.twitching = true;
    }
    if (this.twitching) {
      const twitchIntensity = Math.sin(this.time * 30) * 0.1;
      this.group.rotation.x += twitchIntensity;
      this.group.rotation.z += twitchIntensity * 0.5;
      if (Math.random() < dt * 2) this.twitching = false;
    }

    if (distSq > 40000) {
      const a = Math.random() * Math.PI * 2;
      this.group.position.set(playerPos.x + Math.cos(a) * 80, playerPos.y - Math.random() * 10, playerPos.z + Math.sin(a) * 80);
    }
  }

  getPosition() { return this.group.position; }
  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); });
  }
}
