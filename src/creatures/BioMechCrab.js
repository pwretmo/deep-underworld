import * as THREE from 'three';

// Biomechanical crab with hydraulic-piston legs, industrial carapace, and pipe vents
export class BioMechCrab {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time = Math.random() * 100;
    this.speed = 1.2 + Math.random() * 0.8;
    this.direction = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    this.turnTimer = 0;
    this.turnInterval = 8 + Math.random() * 12;
    this.legs = [];

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  _buildModel() {
    const shellMat = new THREE.MeshPhysicalMaterial({
      color: 0x0c0a08, roughness: 0.2, metalness: 0.7,
      clearcoat: 1.0, clearcoatRoughness: 0.1,
      emissive: 0x0a0402, emissiveIntensity: 0.4,
    });
    const metalMat = new THREE.MeshPhysicalMaterial({
      color: 0x181818, roughness: 0.15, metalness: 0.9,
      clearcoat: 1.0,
    });
    const jointMat = new THREE.MeshPhysicalMaterial({
      color: 0x201810, roughness: 0.3, metalness: 0.5,
      clearcoat: 0.8,
    });

    // Carapace - flattened dome with industrial ribbing
    const carapaceGeo = new THREE.SphereGeometry(1.2, 20, 14);
    carapaceGeo.scale(1.6, 0.6, 1.2);
    const cp = carapaceGeo.attributes.position;
    for (let i = 0; i < cp.count; i++) {
      const x = cp.getX(i), z = cp.getZ(i), y = cp.getY(i);
      // Industrial ribbing
      cp.setY(i, y + Math.sin(x * 5 + z * 4) * 0.04);
      // Flatten bottom
      if (y < 0) cp.setY(i, y * 0.3);
    }
    carapaceGeo.computeVertexNormals();
    this.group.add(new THREE.Mesh(carapaceGeo, shellMat));

    // Dorsal pipes
    for (const side of [-1, 1]) {
      const pipeGeo = new THREE.CylinderGeometry(0.06, 0.06, 2.2, 8);
      const pipe = new THREE.Mesh(pipeGeo, metalMat);
      pipe.position.set(0, 0.35, side * 0.5);
      pipe.rotation.z = Math.PI / 2;
      this.group.add(pipe);
    }

    // Exhaust vents on rear
    for (let i = 0; i < 3; i++) {
      const ventGeo = new THREE.CylinderGeometry(0.08, 0.12, 0.15, 8, 1, true);
      const vent = new THREE.Mesh(ventGeo, metalMat);
      vent.position.set(-1.6, 0.1, (i - 1) * 0.3);
      vent.rotation.z = Math.PI / 2;
      this.group.add(vent);
    }

    // Eight hydraulic legs - 4 per side
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < 4; i++) {
        const legGroup = new THREE.Group();
        const angle = (i / 4) * Math.PI * 0.6 - 0.3;

        // Upper leg segment
        const upperGeo = new THREE.CylinderGeometry(0.08, 0.05, 1.4, 6);
        const upper = new THREE.Mesh(upperGeo, metalMat);
        upper.position.y = -0.5;
        upper.rotation.z = side * 0.6;
        legGroup.add(upper);

        // Hydraulic piston at joint
        const pistonGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.4, 6);
        const piston = new THREE.Mesh(pistonGeo, jointMat);
        piston.position.set(side * 0.3, -1, 0);
        legGroup.add(piston);

        // Lower leg segment
        const lowerGeo = new THREE.CylinderGeometry(0.05, 0.03, 1.2, 6);
        const lower = new THREE.Mesh(lowerGeo, metalMat);
        lower.position.set(side * 0.5, -1.5, 0);
        lower.rotation.z = side * 1.2;
        legGroup.add(lower);

        // Mechanical foot / claw tip
        const footGeo = new THREE.ConeGeometry(0.04, 0.25, 4);
        const foot = new THREE.Mesh(footGeo, jointMat);
        foot.position.set(side * 1.0, -2.0, 0);
        legGroup.add(foot);

        legGroup.position.set(Math.cos(angle) * 0.8, 0, side * (0.6 + i * 0.2));
        this.legs.push(legGroup);
        this.group.add(legGroup);
      }
    }

    // Eye stalks with small red eyes
    for (const side of [-1, 1]) {
      const stalkGeo = new THREE.CylinderGeometry(0.04, 0.05, 0.5, 6);
      const stalk = new THREE.Mesh(stalkGeo, shellMat);
      stalk.position.set(1.3, 0.3, side * 0.25);
      stalk.rotation.z = -0.4;
      this.group.add(stalk);

      const eyeGeo = new THREE.SphereGeometry(0.06, 8, 8);
      const eye = new THREE.Mesh(eyeGeo, new THREE.MeshPhysicalMaterial({
        color: 0xff1100, emissive: 0xff1100, emissiveIntensity: 2,
        clearcoat: 1.0, roughness: 0,
      }));
      eye.position.set(1.5, 0.5, side * 0.25);
      this.group.add(eye);
    }

    // Pincers
    for (const side of [-1, 1]) {
      const clawGroup = new THREE.Group();
      const armGeo = new THREE.CylinderGeometry(0.08, 0.06, 1.5, 6);
      const arm = new THREE.Mesh(armGeo, metalMat);
      arm.rotation.z = Math.PI / 2;
      clawGroup.add(arm);

      // Pincer halves
      for (const half of [-1, 1]) {
        const pinGeo = new THREE.BoxGeometry(0.6, 0.04, 0.15);
        const pin = new THREE.Mesh(pinGeo, shellMat);
        pin.position.set(0.9, half * 0.08, 0);
        pin.rotation.z = half * 0.15;
        clawGroup.add(pin);
      }

      clawGroup.position.set(1.4, -0.1, side * 1.0);
      clawGroup.rotation.y = side * -0.3;
      this.group.add(clawGroup);
    }

    // Industrial red glow from eye stalks
    this.eyeLight = new THREE.PointLight(0xff4400, 1.0, 14);
    this.eyeLight.position.set(1.3, 0.4, 0);
    this.group.add(this.eyeLight);

    const s = 1.5 + Math.random() * 1.5;
    this.group.scale.setScalar(s);
  }

  update(dt, playerPos) {
    this.time += dt;
    this.turnTimer += dt;

    if (this.turnTimer > this.turnInterval) {
      this.turnTimer = 0;
      this.turnInterval = 8 + Math.random() * 12;
      if (Math.random() < 0.3) {
        this.direction.subVectors(playerPos, this.group.position).normalize();
        this.direction.y = 0;
      } else {
        this.direction.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
      }
    }

    this.group.position.add(this.direction.clone().multiplyScalar(this.speed * dt));

    // Animate legs - mechanical stepping
    for (let i = 0; i < this.legs.length; i++) {
      const phase = this.time * 6 + i * Math.PI * 0.5;
      this.legs[i].rotation.x = Math.sin(phase) * 0.2;
    }

    // Face movement direction
    const angle = Math.atan2(this.direction.x, this.direction.z);
    this.group.rotation.y = THREE.MathUtils.lerp(this.group.rotation.y, angle, dt * 2);

    if (this.group.position.distanceTo(playerPos) > 200) {
      const a = Math.random() * Math.PI * 2;
      this.group.position.set(playerPos.x + Math.cos(a) * 70, playerPos.y, playerPos.z + Math.sin(a) * 70);
    }
  }

  getPosition() { return this.group.position; }
  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); });
  }
}
