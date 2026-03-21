import * as THREE from 'three';

// Faceless humanoid - smooth featureless head, biomechanical limbs, uncanny floating presence
export class FacelessOne {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time = Math.random() * 100;
    this.speed = 0.5 + Math.random() * 0.3;
    this.direction = new THREE.Vector3(Math.random() - 0.5, -0.02, Math.random() - 0.5).normalize();
    this.turnTimer = 0;
    this.turnInterval = 15 + Math.random() * 15;
    this.arms = [];

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  _buildModel() {
    const skinMat = new THREE.MeshPhysicalMaterial({
      color: 0x0a0810, roughness: 0.2, metalness: 0.5,
      clearcoat: 1.0, clearcoatRoughness: 0.1,
      emissive: 0x0c0618, emissiveIntensity: 0.6,
    });
    const metalMat = new THREE.MeshPhysicalMaterial({
      color: 0x141414, roughness: 0.1, metalness: 0.9,
      clearcoat: 1.0,
      emissive: 0x0a0412, emissiveIntensity: 0.4,
    });
    const boneMat = new THREE.MeshPhysicalMaterial({
      color: 0x2a2218, roughness: 0.25, metalness: 0.4,
      clearcoat: 0.8,
    });

    // Head - perfectly smooth, elongated, no features
    const headGeo = new THREE.SphereGeometry(0.5, 20, 16);
    headGeo.scale(0.7, 1.1, 0.75);
    const head = new THREE.Mesh(headGeo, skinMat);
    head.position.y = 2.8;
    this.group.add(head);

    // Faint slit where a mouth might be
    const slitGeo = new THREE.PlaneGeometry(0.15, 0.02);
    const slitMat = new THREE.MeshPhysicalMaterial({
      color: 0x000000, emissive: 0x330808, emissiveIntensity: 1.5,
      roughness: 1, side: THREE.DoubleSide,
    });
    const slit = new THREE.Mesh(slitGeo, slitMat);
    slit.position.set(0.35, 2.55, 0);
    slit.rotation.y = Math.PI / 2;
    this.group.add(slit);

    // Neck - exposed vertebrae-like structure
    for (let i = 0; i < 4; i++) {
      const neckGeo = new THREE.CylinderGeometry(0.12, 0.14, 0.12, 8);
      const neck = new THREE.Mesh(neckGeo, boneMat);
      neck.position.y = 2.3 - i * 0.14;
      this.group.add(neck);
    }

    // Torso - ribbed biomechanical chest
    const torsoGeo = new THREE.CylinderGeometry(0.5, 0.35, 1.5, 12, 8);
    const tp = torsoGeo.attributes.position;
    for (let i = 0; i < tp.count; i++) {
      const y = tp.getY(i), x = tp.getX(i), z = tp.getZ(i);
      // Ribbing
      const ribFactor = Math.sin(y * 12) * 0.04;
      tp.setX(i, x * (1 + ribFactor));
      tp.setZ(i, z * (1 + ribFactor));
    }
    torsoGeo.computeVertexNormals();
    const torso = new THREE.Mesh(torsoGeo, skinMat);
    torso.position.y = 1.0;
    this.group.add(torso);

    // Exposed spinal ridge on back
    for (let i = 0; i < 6; i++) {
      const spineGeo = new THREE.ConeGeometry(0.03, 0.15, 4);
      const spine = new THREE.Mesh(spineGeo, boneMat);
      spine.position.set(-0.35, 0.5 + i * 0.25, 0);
      spine.rotation.z = Math.PI / 2;
      this.group.add(spine);
    }

    // Arms - segmented biomechanical, too long for the body
    for (const side of [-1, 1]) {
      const armGroup = new THREE.Group();

      // Upper arm
      const upperGeo = new THREE.CylinderGeometry(0.08, 0.06, 1.2, 6);
      const upper = new THREE.Mesh(upperGeo, metalMat);
      upper.position.y = -0.6;
      armGroup.add(upper);

      // Elbow joint
      const elbowGeo = new THREE.SphereGeometry(0.08, 6, 6);
      const elbow = new THREE.Mesh(elbowGeo, boneMat);
      elbow.position.y = -1.2;
      armGroup.add(elbow);

      // Forearm
      const foreGeo = new THREE.CylinderGeometry(0.06, 0.04, 1.4, 6);
      const fore = new THREE.Mesh(foreGeo, metalMat);
      fore.position.y = -2.0;
      armGroup.add(fore);

      // Elongated fingers
      for (let f = 0; f < 4; f++) {
        const fingerGeo = new THREE.CylinderGeometry(0.015, 0.008, 0.5, 4);
        const finger = new THREE.Mesh(fingerGeo, boneMat);
        finger.position.set((f - 1.5) * 0.03, -2.9, 0);
        armGroup.add(finger);
      }

      armGroup.position.set(0, 1.5, side * 0.55);
      armGroup.rotation.x = side * 0.1;
      this.arms.push(armGroup);
      this.group.add(armGroup);
    }

    // Legs - trailing, almost vestigial, fade into wisps
    for (const side of [-1, 1]) {
      const legGeo = new THREE.CylinderGeometry(0.1, 0.02, 1.5, 6);
      const leg = new THREE.Mesh(legGeo, skinMat);
      leg.position.set(0, -0.5, side * 0.2);
      this.group.add(leg);
    }

    // Trailing membrane/veil
    const veilMat = new THREE.MeshPhysicalMaterial({
      color: 0x080610, roughness: 0.3, metalness: 0.3,
      transparent: true, opacity: 0.25, side: THREE.DoubleSide,
    });
    const veilGeo = new THREE.PlaneGeometry(1.5, 2, 4, 8);
    const vp = veilGeo.attributes.position;
    for (let i = 0; i < vp.count; i++) {
      vp.setZ(i, Math.sin(vp.getY(i) * 3) * 0.1);
    }
    veilGeo.computeVertexNormals();
    const veil = new THREE.Mesh(veilGeo, veilMat);
    veil.position.set(-0.3, -0.5, 0);
    this.group.add(veil);

    // Eerie cold glow from chest area
    this.glow = new THREE.PointLight(0x1a0a2e, 1.2, 18);
    this.glow.position.set(0, 1.5, 0);
    this.group.add(this.glow);

    const s = 2 + Math.random() * 1.5;
    this.group.scale.setScalar(s);
  }

  update(dt, playerPos) {
    this.time += dt;
    this.turnTimer += dt;

    if (this.turnTimer > this.turnInterval) {
      this.turnTimer = 0;
      this.turnInterval = 15 + Math.random() * 15;
      if (Math.random() < 0.35) {
        this.direction.subVectors(playerPos, this.group.position).normalize();
        this.direction.y *= 0.1;
      } else {
        this.direction.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.03, Math.random() - 0.5).normalize();
      }
    }

    this.group.position.add(this.direction.clone().multiplyScalar(this.speed * dt));

    // Face player slowly - always watching
    const toPlayer = new THREE.Vector3().subVectors(playerPos, this.group.position);
    const targetY = Math.atan2(toPlayer.x, toPlayer.z);
    this.group.rotation.y = THREE.MathUtils.lerp(this.group.rotation.y, targetY + Math.PI / 2, dt * 0.5);

    // Gentle sway
    this.group.rotation.z = Math.sin(this.time * 0.3) * 0.03;

    // Arms drift eerily
    for (let i = 0; i < this.arms.length; i++) {
      this.arms[i].rotation.z = Math.sin(this.time * 0.5 + i * Math.PI) * 0.15;
      this.arms[i].rotation.x = Math.sin(this.time * 0.3 + i) * 0.1;
    }

    if (this.group.position.distanceTo(playerPos) > 200) {
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
