import * as THREE from 'three';

// Parasitic lamprey with circular mouth of rotating teeth, segmented metallic body
export class Lamprey {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time = Math.random() * 100;
    this.speed = 2.5 + Math.random() * 1.5;
    this.direction = new THREE.Vector3(Math.random() - 0.5, -0.1, Math.random() - 0.5).normalize();
    this.turnTimer = 0;
    this.turnInterval = 4 + Math.random() * 5;
    this.mouthRing = null;

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  _buildModel() {
    const metalMat = new THREE.MeshPhysicalMaterial({
      color: 0x0c0a08, roughness: 0.15, metalness: 0.8,
      clearcoat: 1.0, clearcoatRoughness: 0.05,
    });
    const fleshMat = new THREE.MeshPhysicalMaterial({
      color: 0x1a0810, roughness: 0.3, metalness: 0.3,
      clearcoat: 0.8,
    });
    const toothMat = new THREE.MeshPhysicalMaterial({
      color: 0x403028, roughness: 0.2, metalness: 0.5,
      clearcoat: 1.0,
    });

    // Segmented body
    const segments = 12;
    for (let i = 0; i < segments; i++) {
      const t = i / segments;
      const radius = 0.25 * (1 - t * 0.5);
      const segGeo = new THREE.CylinderGeometry(radius * 0.95, radius, 0.3, 10);
      const mat = i % 2 === 0 ? metalMat : fleshMat;
      const seg = new THREE.Mesh(segGeo, mat);
      seg.position.set(-i * 0.28, 0, 0);
      seg.rotation.z = Math.PI / 2;
      this.group.add(seg);

      // Lateral ridges
      if (i % 3 === 0) {
        for (const side of [-1, 1]) {
          const ridgeGeo = new THREE.BoxGeometry(0.08, 0.02, 0.03);
          const ridge = new THREE.Mesh(ridgeGeo, metalMat);
          ridge.position.set(-i * 0.28, side * radius, 0);
          this.group.add(ridge);
        }
      }
    }

    // Circular mouth with concentric tooth rings
    this.mouthRing = new THREE.Group();
    for (let ring = 0; ring < 3; ring++) {
      const r = 0.22 - ring * 0.05;
      const count = 10 - ring * 2;
      for (let t = 0; t < count; t++) {
        const angle = (t / count) * Math.PI * 2;
        const tGeo = new THREE.ConeGeometry(0.015, 0.08 + ring * 0.02, 4);
        const tooth = new THREE.Mesh(tGeo, toothMat);
        tooth.position.set(0, Math.cos(angle) * r, Math.sin(angle) * r);
        tooth.rotation.z = Math.PI / 2;
        this.mouthRing.add(tooth);
      }
    }
    this.mouthRing.position.set(0.3, 0, 0);
    this.group.add(this.mouthRing);

    // Fleshy lip ring
    const lipGeo = new THREE.TorusGeometry(0.24, 0.04, 8, 16);
    const lip = new THREE.Mesh(lipGeo, fleshMat);
    lip.position.set(0.3, 0, 0);
    lip.rotation.y = Math.PI / 2;
    this.group.add(lip);

    // Tiny sensor eyes ringing the mouth
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2;
      const eyeGeo = new THREE.SphereGeometry(0.02, 6, 6);
      const eye = new THREE.Mesh(eyeGeo, new THREE.MeshPhysicalMaterial({
        color: 0xff4400, emissive: 0xff2200, emissiveIntensity: 2, roughness: 0,
      }));
      eye.position.set(0.32, Math.cos(angle) * 0.28, Math.sin(angle) * 0.28);
      this.group.add(eye);
    }

    // Tail fin - mechanical blade
    const tailGeo = new THREE.BoxGeometry(0.02, 0.3, 0.15);
    const tail = new THREE.Mesh(tailGeo, metalMat);
    tail.position.set(-segments * 0.28, 0, 0);
    this.group.add(tail);

    const s = 2 + Math.random() * 2;
    this.group.scale.setScalar(s);
  }

  update(dt, playerPos) {
    this.time += dt;
    this.turnTimer += dt;

    if (this.turnTimer > this.turnInterval) {
      this.turnTimer = 0;
      this.turnInterval = 4 + Math.random() * 5;
      if (Math.random() < 0.5) {
        this.direction.subVectors(playerPos, this.group.position).normalize();
        this.direction.y *= 0.3;
      } else {
        this.direction.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.15, Math.random() - 0.5).normalize();
      }
    }

    this.group.position.add(this.direction.clone().multiplyScalar(this.speed * dt));

    // Face direction
    const angle = Math.atan2(this.direction.x, this.direction.z);
    this.group.rotation.y = THREE.MathUtils.lerp(this.group.rotation.y, angle + Math.PI / 2, dt * 4);

    // Sinusoidal body motion
    this.group.rotation.z = Math.sin(this.time * 4) * 0.1;

    // Rotating tooth ring
    this.mouthRing.rotation.x += dt * 3;

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
