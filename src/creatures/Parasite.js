import * as THREE from 'three';

// Parasitic creature that attaches to surfaces - pulsing sacs with mechanical tendrils
export class Parasite {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time = Math.random() * 100;
    this.speed = 0.8 + Math.random() * 1;
    this.direction = new THREE.Vector3(Math.random() - 0.5, -0.05, Math.random() - 0.5).normalize();
    this.turnTimer = 0;
    this.turnInterval = 7 + Math.random() * 8;
    this.sacs = [];
    this.proboscis = null;

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  _buildModel() {
    const sacMat = new THREE.MeshPhysicalMaterial({
      color: 0x1a0810, roughness: 0.2, metalness: 0.2,
      clearcoat: 0.9, transparent: true, opacity: 0.8,
      transmission: 0.2, thickness: 0.3,
    });
    const metalMat = new THREE.MeshPhysicalMaterial({
      color: 0x101010, roughness: 0.1, metalness: 0.85,
      clearcoat: 1.0,
    });
    const veinMat = new THREE.MeshPhysicalMaterial({
      color: 0x0a0608, roughness: 0.2, metalness: 0.5,
      clearcoat: 0.8,
    });

    // Main body sac
    const bodyGeo = new THREE.SphereGeometry(0.4, 12, 10);
    const bp = bodyGeo.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i);
      bp.setX(i, x * (1 + Math.sin(y * 6 + z * 5) * 0.1));
    }
    bodyGeo.computeVertexNormals();
    const body = new THREE.Mesh(bodyGeo, sacMat);
    this.sacs.push(body);
    this.group.add(body);

    // Secondary sacs
    for (let i = 0; i < 3; i++) {
      const size = 0.15 + Math.random() * 0.15;
      const secGeo = new THREE.SphereGeometry(size, 8, 8);
      const sec = new THREE.Mesh(secGeo, sacMat);
      sec.position.set(
        (Math.random() - 0.5) * 0.4,
        (Math.random() - 0.5) * 0.3,
        (Math.random() - 0.5) * 0.4
      );
      this.sacs.push(sec);
      this.group.add(sec);
    }

    // Proboscis - feeding tube
    this.proboscis = new THREE.Group();
    const probeGeo = new THREE.CylinderGeometry(0.04, 0.02, 0.8, 6);
    this.proboscis.add(new THREE.Mesh(probeGeo, metalMat));
    // Barbed tip
    for (let i = 0; i < 3; i++) {
      const barbGeo = new THREE.ConeGeometry(0.01, 0.1, 3);
      const barb = new THREE.Mesh(barbGeo, metalMat);
      barb.position.y = -0.4;
      barb.rotation.z = (i / 3) * Math.PI * 2;
      this.proboscis.add(barb);
    }
    this.proboscis.position.set(0.3, 0, 0);
    this.proboscis.rotation.z = -Math.PI / 4;
    this.group.add(this.proboscis);

    // Grasping tendrils
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const tGeo = new THREE.CylinderGeometry(0.015, 0.008, 0.5, 4);
      const tendril = new THREE.Mesh(tGeo, veinMat);
      tendril.position.set(
        Math.cos(angle) * 0.3,
        -0.3,
        Math.sin(angle) * 0.3
      );
      tendril.rotation.set(Math.cos(angle) * 0.5, 0, Math.sin(angle) * 0.5);
      this.group.add(tendril);
    }

    // Visible veins on surface
    for (let i = 0; i < 4; i++) {
      const veinGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.4, 3);
      const vein = new THREE.Mesh(veinGeo, veinMat);
      vein.position.set(
        (Math.random() - 0.5) * 0.3,
        (Math.random() - 0.5) * 0.2,
        (Math.random() - 0.5) * 0.3
      );
      vein.rotation.set(Math.random(), Math.random(), Math.random());
      this.group.add(vein);
    }

    const s = 1.5 + Math.random() * 1.5;
    this.group.scale.setScalar(s);
  }

  update(dt, playerPos) {
    this.time += dt;
    this.turnTimer += dt;

    if (this.turnTimer > this.turnInterval) {
      this.turnTimer = 0;
      this.turnInterval = 7 + Math.random() * 8;
      if (Math.random() < 0.4) {
        this.direction.subVectors(playerPos, this.group.position).normalize();
        this.direction.y *= 0.2;
      } else {
        this.direction.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.08, Math.random() - 0.5).normalize();
      }
    }

    this.group.position.add(this.direction.clone().multiplyScalar(this.speed * dt));

    // Pulsating sacs
    for (let i = 0; i < this.sacs.length; i++) {
      const pulse = 1 + Math.sin(this.time * 2 + i * 1.5) * 0.1;
      this.sacs[i].scale.setScalar(pulse);
    }

    // Proboscis probes
    this.proboscis.rotation.z = -Math.PI / 4 + Math.sin(this.time * 1.5) * 0.2;
    this.proboscis.rotation.y = Math.sin(this.time * 0.8) * 0.3;

    if (this.group.position.distanceTo(playerPos) > 200) {
      const a = Math.random() * Math.PI * 2;
      this.group.position.set(playerPos.x + Math.cos(a) * 60, playerPos.y - Math.random() * 8, playerPos.z + Math.sin(a) * 60);
    }
  }

  getPosition() { return this.group.position; }
  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); });
  }
}
