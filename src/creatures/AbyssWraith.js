import * as THREE from 'three';

const _tmpDir = new THREE.Vector3();

// Spectral wraith of the abyss - elongated skull, trailing shadow membrane, inner jaw
export class AbyssWraith {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time = Math.random() * 100;
    this.speed = 2.0 + Math.random() * 1.5;
    this.direction = new THREE.Vector3(Math.random() - 0.5, -0.1, Math.random() - 0.5).normalize();
    this.turnTimer = 0;
    this.turnInterval = 5 + Math.random() * 6;
    this.innerJaw = null;
    this.tailFins = [];

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  _buildModel() {
    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: 0x181030, roughness: 0.1, metalness: 0,
      clearcoat: 1.0, clearcoatRoughness: 0.05,
      emissive: 0x281848, emissiveIntensity: 0.7,
    });
    const boneMat = new THREE.MeshPhysicalMaterial({
      color: 0x3a3228, roughness: 0.2, metalness: 0,
      clearcoat: 0.9,
      emissive: 0x504030, emissiveIntensity: 0.5,
    });
    const shadowMat = new THREE.MeshPhysicalMaterial({
      color: 0x101020, roughness: 0.3, metalness: 0,
      transparent: true, opacity: 0.3, side: THREE.DoubleSide,
      emissive: 0x282050, emissiveIntensity: 0.5,
    });

    // Elongated skull
    const skullGeo = new THREE.SphereGeometry(0.6, 16, 12);
    skullGeo.scale(2.5, 0.8, 0.7);
    const sp = skullGeo.attributes.position;
    for (let i = 0; i < sp.count; i++) {
      const x = sp.getX(i), y = sp.getY(i), z = sp.getZ(i);
      // Ridge along top
      if (y > 0.3) sp.setY(i, y + 0.15);
      // Biomechanical surface texture
      sp.setX(i, x + Math.sin(y * 10 + z * 8) * 0.02);
    }
    skullGeo.computeVertexNormals();
    this.group.add(new THREE.Mesh(skullGeo, bodyMat));

    // Outer jaw with teeth
    const jawGeo = new THREE.SphereGeometry(0.4, 12, 8, 0, Math.PI * 2, Math.PI * 0.4, Math.PI * 0.4);
    jawGeo.scale(1.8, 0.5, 0.6);
    const jaw = new THREE.Mesh(jawGeo, bodyMat);
    jaw.position.set(0.5, -0.35, 0);
    this.group.add(jaw);

    // Outer teeth
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI - Math.PI * 0.5;
      const toothGeo = new THREE.ConeGeometry(0.02, 0.15, 4);
      const tooth = new THREE.Mesh(toothGeo, boneMat);
      tooth.position.set(0.8 + Math.cos(angle) * 0.3, -0.2, Math.sin(angle) * 0.35);
      this.group.add(tooth);
    }

    // Inner jaw - pharyngeal jaw mechanism
    this.innerJaw = new THREE.Group();
    const innerJawGeo = new THREE.SphereGeometry(0.15, 8, 6);
    innerJawGeo.scale(1.5, 0.8, 0.8);
    this.innerJaw.add(new THREE.Mesh(innerJawGeo, boneMat));

    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const itGeo = new THREE.ConeGeometry(0.01, 0.08, 3);
      const innerTooth = new THREE.Mesh(itGeo, boneMat);
      innerTooth.position.set(0.12, Math.cos(a) * 0.1, Math.sin(a) * 0.1);
      innerTooth.rotation.z = -Math.PI / 2;
      this.innerJaw.add(innerTooth);
    }
    this.innerJaw.position.set(0.4, -0.1, 0);
    this.group.add(this.innerJaw);

    // Eyes - red slits
    for (const side of [-1, 1]) {
      const eyeGeo = new THREE.SphereGeometry(0.08, 8, 8);
      eyeGeo.scale(1.5, 0.5, 1);
      const eye = new THREE.Mesh(eyeGeo, new THREE.MeshPhysicalMaterial({
        color: 0xff2200, emissive: 0xff1100, emissiveIntensity: 3, roughness: 0,
      }));
      eye.position.set(0.8, 0.15, side * 0.4);
      this.group.add(eye);
    }

    // Elongated body serpent - segmented ridges
    for (let i = 0; i < 10; i++) {
      const t = i / 10;
      const radius = 0.3 * (1 - t * 0.5);
      const segGeo = new THREE.CylinderGeometry(radius * 0.9, radius, 0.4, 8);
      const seg = new THREE.Mesh(segGeo, bodyMat);
      seg.position.set(-1 - i * 0.4, 0, 0);
      seg.rotation.z = Math.PI / 2;
      this.group.add(seg);

      // Dorsal ridge
      const ridgeGeo = new THREE.ConeGeometry(0.02, 0.15, 4);
      const ridge = new THREE.Mesh(ridgeGeo, boneMat);
      ridge.position.set(-1 - i * 0.4, radius + 0.05, 0);
      this.group.add(ridge);
    }

    // Trailing shadow membranes
    for (let i = 0; i < 3; i++) {
      const memGeo = new THREE.PlaneGeometry(2 + Math.random() * 2, 0.8 + Math.random() * 0.5, 4, 4);
      const mp = memGeo.attributes.position;
      for (let v = 0; v < mp.count; v++) {
        mp.setZ(v, Math.sin(mp.getX(v) * 2 + mp.getY(v) * 3) * 0.1);
      }
      memGeo.computeVertexNormals();
      const mem = new THREE.Mesh(memGeo, shadowMat);
      mem.position.set(-3, (i - 1) * 0.3, 0);
      mem.rotation.y = (Math.random() - 0.5) * 0.3;
      this.tailFins.push(mem);
      this.group.add(mem);
    }

    // Tail blade
    const bladeGeo = new THREE.BoxGeometry(0.02, 0.5, 0.3);
    const blade = new THREE.Mesh(bladeGeo, bodyMat);
    blade.position.set(-5, 0, 0);
    this.group.add(blade);

    this.eyeLight = new THREE.PointLight(0xff2200, 1.5, 12);
    this.eyeLight.userData.duwCategory = 'creature_bio';
    this.eyeLight.position.set(0.8, 0.15, 0);
    this.group.add(this.eyeLight);

    const s = 1.5 + Math.random() * 1.5;
    this.group.scale.setScalar(s);
  }

  update(dt, playerPos, distSq) {
    this.time += dt;
    this.turnTimer += dt;

    if (this.turnTimer > this.turnInterval) {
      this.turnTimer = 0;
      this.turnInterval = 5 + Math.random() * 6;
      if (Math.random() < 0.5) {
        this.direction.subVectors(playerPos, this.group.position).normalize();
        this.direction.y *= 0.25;
      } else {
        this.direction.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.1, Math.random() - 0.5).normalize();
      }
    }

    this.group.position.add(_tmpDir.copy(this.direction).multiplyScalar(this.speed * dt));

    // Face direction
    const angle = Math.atan2(this.direction.x, this.direction.z);
    this.group.rotation.y = THREE.MathUtils.lerp(this.group.rotation.y, angle + Math.PI / 2, dt * 3);

    // Inner jaw extends and retracts
    this.innerJaw.position.x = 0.4 + Math.sin(this.time * 2) * 0.2;

    // Tail membrane flutter
    for (let i = 0; i < this.tailFins.length; i++) {
      this.tailFins[i].rotation.z = Math.sin(this.time * 2 + i * 1.5) * 0.1;
    }

    // Eye flicker
    this.eyeLight.intensity = 1 + Math.sin(this.time * 6) * 0.4;

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
