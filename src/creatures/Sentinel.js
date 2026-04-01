import * as THREE from 'three';

// Tall thin sentinel - single cyclopean eye, watches from distance, biomechanical stilt creature
export class Sentinel {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time = Math.random() * 100;
    this.speed = 0.4 + Math.random() * 0.3;
    this.direction = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    this.turnTimer = 0;
    this.turnInterval = 20 + Math.random() * 20;
    this.stiltLegs = [];

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  _buildModel() {
    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: 0x182028, roughness: 0.15, metalness: 0,
      clearcoat: 1.0, clearcoatRoughness: 0.08,
      emissive: 0x203858, emissiveIntensity: 0.6,
    });
    const boneMat = new THREE.MeshPhysicalMaterial({
      color: 0x3a3228, roughness: 0.25, metalness: 0,
      clearcoat: 0.8,
      emissive: 0x504030, emissiveIntensity: 0.5,
    });

    // Head/eye pod - smooth sphere with massive single eye
    const headGeo = new THREE.SphereGeometry(0.5, 16, 12);
    headGeo.scale(0.8, 1.0, 0.7);
    const head = new THREE.Mesh(headGeo, bodyMat);
    head.position.y = 6;
    this.group.add(head);

    // Cyclopean eye
    const eyeGeo = new THREE.SphereGeometry(0.25, 16, 16);
    const eyeMat = new THREE.MeshPhysicalMaterial({
      color: 0xeedd00, emissive: 0xffcc00, emissiveIntensity: 3,
      roughness: 0, clearcoat: 1.0,
    });
    this.eye = new THREE.Mesh(eyeGeo, eyeMat);
    this.eye.position.set(0.3, 6, 0);
    this.group.add(this.eye);

    // Pupil slit
    const pupilGeo = new THREE.PlaneGeometry(0.05, 0.35);
    const pupilMat = new THREE.MeshPhysicalMaterial({
      color: 0x000000, roughness: 1, side: THREE.DoubleSide,
    });
    const pupil = new THREE.Mesh(pupilGeo, pupilMat);
    pupil.position.set(0.5, 6, 0);
    pupil.rotation.y = Math.PI / 2;
    this.group.add(pupil);

    this.eyeLight = new THREE.PointLight(0xffcc00, 2, 20);
    this.eyeLight.userData.duwCategory = 'creature_bio';
    this.eyeLight.position.set(0.3, 6, 0);
    this.group.add(this.eyeLight);

    // Neck - thin stalk with vertebrae
    for (let i = 0; i < 8; i++) {
      const nGeo = new THREE.CylinderGeometry(0.06, 0.07, 0.2, 6);
      const neck = new THREE.Mesh(nGeo, boneMat);
      neck.position.y = 5.5 - i * 0.22;
      this.group.add(neck);
    }

    // Narrow torso
    const torsoGeo = new THREE.CylinderGeometry(0.25, 0.15, 1.5, 8);
    const tp = torsoGeo.attributes.position;
    for (let i = 0; i < tp.count; i++) {
      const y = tp.getY(i);
      tp.setX(i, tp.getX(i) * (1 + Math.sin(y * 8) * 0.08));
    }
    torsoGeo.computeVertexNormals();
    const torso = new THREE.Mesh(torsoGeo, bodyMat);
    torso.position.y = 3.2;
    this.group.add(torso);

    // Three stilt legs - biomechanical, extremely long
    for (let i = 0; i < 3; i++) {
      const legGroup = new THREE.Group();
      const angle = (i / 3) * Math.PI * 2;

      // Upper segment
      const upperGeo = new THREE.CylinderGeometry(0.05, 0.04, 2, 6);
      const upper = new THREE.Mesh(upperGeo, bodyMat);
      upper.position.y = -1;
      legGroup.add(upper);

      // Joint
      const jointGeo = new THREE.SphereGeometry(0.06, 6, 6);
      const joint = new THREE.Mesh(jointGeo, boneMat);
      joint.position.y = -2;
      legGroup.add(joint);

      // Lower segment
      const lowerGeo = new THREE.CylinderGeometry(0.04, 0.03, 2.5, 6);
      const lower = new THREE.Mesh(lowerGeo, bodyMat);
      lower.position.y = -3.3;
      legGroup.add(lower);

      legGroup.position.set(Math.cos(angle) * 0.15, 2.5, Math.sin(angle) * 0.15);
      legGroup.rotation.z = Math.cos(angle) * 0.15;
      legGroup.rotation.x = Math.sin(angle) * 0.15;
      this.stiltLegs.push(legGroup);
      this.group.add(legGroup);
    }

    const s = 1.5 + Math.random() * 1;
    this.group.scale.setScalar(s);
  }

  update(dt, playerPos, distSq) {
    this.time += dt;
    this.turnTimer += dt;

    if (this.turnTimer > this.turnInterval) {
      this.turnTimer = 0;
      this.turnInterval = 20 + Math.random() * 20;
      this.direction.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    }

    this.group.position.add(this.direction.clone().multiplyScalar(this.speed * dt));

    // Always face the player (watching)
    const toPlayer = new THREE.Vector3().subVectors(playerPos, this.group.position);
    const targetAngle = Math.atan2(toPlayer.x, toPlayer.z);
    this.group.rotation.y = THREE.MathUtils.lerp(this.group.rotation.y, targetAngle, dt * 1);

    // Subtle swaying
    this.group.rotation.z = Math.sin(this.time * 0.3) * 0.02;

    // Stilt leg walking animation
    for (let i = 0; i < this.stiltLegs.length; i++) {
      this.stiltLegs[i].rotation.x = Math.sin(this.time * 1.5 + i * Math.PI * 2 / 3) * 0.05;
    }

    // Eye intensity varies with distance to player
    const dist = Math.sqrt(distSq);
    this.eyeLight.intensity = Math.max(0.5, 4 - dist * 0.05);

    if (dist > 200) {
      const a = Math.random() * Math.PI * 2;
      this.group.position.set(playerPos.x + Math.cos(a) * 80, playerPos.y, playerPos.z + Math.sin(a) * 80);
    }
  }

  getPosition() { return this.group.position; }
  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); });
  }
}
