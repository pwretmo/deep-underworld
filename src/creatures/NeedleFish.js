import * as THREE from 'three';

// Extremely thin, fast needle fish with metallic spike protrusions
export class NeedleFish {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time = Math.random() * 100;
    this.speed = 4 + Math.random() * 3;
    this.direction = new THREE.Vector3(Math.random() - 0.5, -0.05, Math.random() - 0.5).normalize();
    this.turnTimer = 0;
    this.turnInterval = 3 + Math.random() * 4;

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  _buildModel() {
    const metalMat = new THREE.MeshPhysicalMaterial({
      color: 0x101018, roughness: 0.1, metalness: 0.9,
      clearcoat: 1.0, clearcoatRoughness: 0.05,
      emissive: 0x080210, emissiveIntensity: 0.4,
    });
    const spineMat = new THREE.MeshPhysicalMaterial({
      color: 0x302820, roughness: 0.2, metalness: 0.5,
      clearcoat: 0.9,
    });

    // Ultra-thin elongated body
    const bodyGeo = new THREE.CylinderGeometry(0.06, 0.02, 4, 8, 10);
    const bp = bodyGeo.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      const y = bp.getY(i);
      const bulge = Math.max(0, 1 - Math.abs(y) * 0.5) * 0.04;
      bp.setX(i, bp.getX(i) + bulge);
      bp.setZ(i, bp.getZ(i) + bulge);
    }
    bodyGeo.computeVertexNormals();
    const body = new THREE.Mesh(bodyGeo, metalMat);
    body.rotation.z = Math.PI / 2;
    this.group.add(body);

    // Needle snout
    const snoutGeo = new THREE.ConeGeometry(0.04, 1.5, 6);
    const snout = new THREE.Mesh(snoutGeo, metalMat);
    snout.rotation.z = -Math.PI / 2;
    snout.position.x = 2.7;
    this.group.add(snout);

    // Dorsal needle spines
    for (let i = 0; i < 8; i++) {
      const spineGeo = new THREE.ConeGeometry(0.008, 0.3 + Math.random() * 0.2, 4);
      const spine = new THREE.Mesh(spineGeo, spineMat);
      spine.position.set(i * 0.4 - 1.5, 0.06 + i * 0.002, 0);
      this.group.add(spine);
    }

    // Ventral spines
    for (let i = 0; i < 6; i++) {
      const spineGeo = new THREE.ConeGeometry(0.006, 0.2, 4);
      const spine = new THREE.Mesh(spineGeo, spineMat);
      spine.position.set(i * 0.5 - 1, -0.06, 0);
      spine.rotation.z = Math.PI;
      this.group.add(spine);
    }

    // Lateral barbs
    for (let i = 0; i < 5; i++) {
      for (const side of [-1, 1]) {
        const barbGeo = new THREE.ConeGeometry(0.005, 0.15, 3);
        const barb = new THREE.Mesh(barbGeo, spineMat);
        barb.position.set(i * 0.5 - 0.8, 0, side * 0.07);
        barb.rotation.x = side * -Math.PI / 3;
        this.group.add(barb);
      }
    }

    // Small red eyes
    for (const side of [-1, 1]) {
      const eyeGeo = new THREE.SphereGeometry(0.015, 6, 6);
      const eye = new THREE.Mesh(eyeGeo, new THREE.MeshPhysicalMaterial({
        color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 3, roughness: 0,
      }));
      eye.position.set(1.8, 0.02, side * 0.05);
      this.group.add(eye);
    }

    // Thin tail fin
    const tailGeo = new THREE.PlaneGeometry(0.3, 0.15, 1, 1);
    const tailMat = new THREE.MeshPhysicalMaterial({
      color: 0x101018, roughness: 0.1, metalness: 0.8,
      clearcoat: 1.0, side: THREE.DoubleSide,
    });
    const tail = new THREE.Mesh(tailGeo, tailMat);
    tail.position.x = -2.1;
    this.group.add(tail);

    // Red warning glow from eye area
    this.eyeLight = new THREE.PointLight(0xff2200, 0.6, 10);
    this.eyeLight.position.set(1.8, 0, 0);
    this.group.add(this.eyeLight);

    const s = 1.5 + Math.random() * 1;
    this.group.scale.setScalar(s);
  }

  update(dt, playerPos) {
    this.time += dt;
    this.turnTimer += dt;

    if (this.turnTimer > this.turnInterval) {
      this.turnTimer = 0;
      this.turnInterval = 3 + Math.random() * 4;
      if (Math.random() < 0.4) {
        this.direction.subVectors(playerPos, this.group.position).normalize();
        this.direction.y *= 0.2;
      } else {
        this.direction.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.1, Math.random() - 0.5).normalize();
      }
    }

    this.group.position.add(this.direction.clone().multiplyScalar(this.speed * dt));

    // Face direction of travel
    const angle = Math.atan2(this.direction.x, this.direction.z);
    this.group.rotation.y = THREE.MathUtils.lerp(this.group.rotation.y, angle + Math.PI / 2, dt * 6);

    // Fast darting motion
    this.group.rotation.z = Math.sin(this.time * 12) * 0.03;

    if (this.group.position.distanceTo(playerPos) > 200) {
      const a = Math.random() * Math.PI * 2;
      this.group.position.set(playerPos.x + Math.cos(a) * 60, playerPos.y - Math.random() * 10, playerPos.z + Math.sin(a) * 60);
    }
  }

  getPosition() { return this.group.position; }
  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); });
  }
}
