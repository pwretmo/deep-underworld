import * as THREE from 'three';

// Multi-armed industrial harvester - collects biomass, mechanical gripper arms
export class Harvester {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time = Math.random() * 100;
    this.speed = 0.8 + Math.random() * 0.6;
    this.direction = new THREE.Vector3(Math.random() - 0.5, -0.1, Math.random() - 0.5).normalize();
    this.turnTimer = 0;
    this.turnInterval = 10 + Math.random() * 12;
    this.arms = [];

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  _buildModel() {
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x2a2838, roughness: 0.3, metalness: 0,
      emissive: 0x203858, emissiveIntensity: 0.5,
    });
    const metalMat = new THREE.MeshStandardMaterial({
      color: 0x303040, roughness: 0.25, metalness: 0.4,
      emissive: 0x204060, emissiveIntensity: 0.4,
    });
    const organicMat = new THREE.MeshStandardMaterial({
      color: 0x352838, roughness: 0.45, metalness: 0,
      emissive: 0x203858, emissiveIntensity: 0.5,
    });

    // Central body - industrial oval with plating
    const bodyGeo = new THREE.SphereGeometry(1, 16, 12);
    bodyGeo.scale(1.3, 1.0, 0.9);
    const bp = bodyGeo.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i);
      // Panel lines
      bp.setX(i, x + Math.sin(y * 10 + z * 6) * 0.03);
    }
    bodyGeo.computeVertexNormals();
    this.group.add(new THREE.Mesh(bodyGeo, bodyMat));

    // Armor plating
    for (let i = 0; i < 4; i++) {
      const plateGeo = new THREE.BoxGeometry(0.5, 0.6, 0.04);
      const plate = new THREE.Mesh(plateGeo, metalMat);
      const angle = (i / 4) * Math.PI * 2;
      plate.position.set(Math.cos(angle) * 0.85, (i - 1.5) * 0.35, Math.sin(angle) * 0.65);
      plate.lookAt(0, plate.position.y, 0);
      this.group.add(plate);
    }

    // Six articulated gripper arms
    for (let i = 0; i < 6; i++) {
      const armGroup = new THREE.Group();
      const angle = (i / 6) * Math.PI * 2;

      // Shoulder joint
      const shoulderGeo = new THREE.SphereGeometry(0.1, 6, 6);
      armGroup.add(new THREE.Mesh(shoulderGeo, organicMat));

      // Upper arm
      const upperGeo = new THREE.CylinderGeometry(0.06, 0.05, 1.0, 6);
      const upper = new THREE.Mesh(upperGeo, metalMat);
      upper.position.y = -0.5;
      armGroup.add(upper);

      // Elbow hydraulics
      const elbowGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.12, 8);
      const elbow = new THREE.Mesh(elbowGeo, bodyMat);
      elbow.position.y = -1.0;
      armGroup.add(elbow);

      // Forearm
      const foreGeo = new THREE.CylinderGeometry(0.05, 0.04, 1.2, 6);
      const fore = new THREE.Mesh(foreGeo, metalMat);
      fore.position.y = -1.7;
      armGroup.add(fore);

      // Gripper - two-pronged claw
      for (const claw of [-1, 1]) {
        const clawGeo = new THREE.BoxGeometry(0.02, 0.3, 0.04);
        const clawMesh = new THREE.Mesh(clawGeo, metalMat);
        clawMesh.position.set(0, -2.4, claw * 0.05);
        clawMesh.rotation.z = claw * 0.15;
        armGroup.add(clawMesh);
      }

      armGroup.position.set(Math.cos(angle) * 0.9, 0, Math.sin(angle) * 0.7);
      armGroup.rotation.x = angle;
      this.arms.push(armGroup);
      this.group.add(armGroup);
    }

    // Central processing eye
    const eyeGeo = new THREE.SphereGeometry(0.15, 12, 12);
    const eye = new THREE.Mesh(eyeGeo, new THREE.MeshPhysicalMaterial({
      color: 0xffaa00, emissive: 0xffaa00, emissiveIntensity: 2,
      roughness: 0, clearcoat: 1.0,
    }));
    eye.position.set(1.1, 0.2, 0);
    this.group.add(eye);

    this.eyeLight = new THREE.PointLight(0xffaa00, 1, 12);
    this.eyeLight.userData.duwCategory = 'creature_bio';
    this.eyeLight.position.copy(eye.position);
    this.group.add(this.eyeLight);

    const s = 1.5 + Math.random() * 1.5;
    this.group.scale.setScalar(s);
  }

  update(dt, playerPos, distSq) {
    this.time += dt;
    this.turnTimer += dt;

    if (this.turnTimer > this.turnInterval) {
      this.turnTimer = 0;
      this.turnInterval = 10 + Math.random() * 12;
      if (Math.random() < 0.3) {
        this.direction.subVectors(playerPos, this.group.position).normalize();
        this.direction.y *= 0.2;
      } else {
        this.direction.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.1, Math.random() - 0.5).normalize();
      }
    }

    this.group.position.add(this.direction.clone().multiplyScalar(this.speed * dt));

    // Face forward
    const angle = Math.atan2(this.direction.x, this.direction.z);
    this.group.rotation.y = THREE.MathUtils.lerp(this.group.rotation.y, angle, dt * 2);

    // Arms perform harvesting/grasping animation
    for (let i = 0; i < this.arms.length; i++) {
      const phase = this.time * 1.5 + i * Math.PI / 3;
      this.arms[i].rotation.z = Math.sin(phase) * 0.25;
      this.arms[i].rotation.x = this.arms[i].rotation.x + Math.cos(phase * 0.7) * 0.01;
    }

    // Eye tracking
    this.eyeLight.intensity = 0.8 + Math.sin(this.time * 3) * 0.3;

    if (distSq > 40000) {
      const a = Math.random() * Math.PI * 2;
      this.group.position.set(playerPos.x + Math.cos(a) * 70, playerPos.y - Math.random() * 15, playerPos.z + Math.sin(a) * 70);
    }
  }

  getPosition() { return this.group.position; }
  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); });
  }
}
