import * as THREE from 'three';

// Segmented biomechanical worm with exposed vertebral spine, translucent flesh pulsing between segments
export class BoneWorm {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time = Math.random() * 100;
    this.speed = 2 + Math.random() * 2;
    this.direction = new THREE.Vector3(Math.random() - 0.5, (Math.random() - 0.5) * 0.3, Math.random() - 0.5).normalize();
    this.turnTimer = 0;
    this.turnInterval = 8 + Math.random() * 12;
    this.segments = [];

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  _buildModel() {
    const segCount = 14;
    const boneMat = new THREE.MeshPhysicalMaterial({
      color: 0x2a2218, roughness: 0.3, metalness: 0.5,
      clearcoat: 1.0, clearcoatRoughness: 0.15,
    });
    const fleshMat = new THREE.MeshPhysicalMaterial({
      color: 0x1a0a18, roughness: 0.2, metalness: 0.3,
      clearcoat: 0.9, clearcoatRoughness: 0.1,
      transparent: true, opacity: 0.7,
    });

    for (let i = 0; i < segCount; i++) {
      const t = i / segCount;
      const r = THREE.MathUtils.lerp(0.6, 0.15, t);

      // Vertebra
      const vertGeo = new THREE.CylinderGeometry(r * 0.5, r * 0.5, 0.25, 8);
      const vert = new THREE.Mesh(vertGeo, boneMat);
      vert.position.set(-i * 0.9, 0, 0);
      vert.rotation.z = Math.PI / 2;
      this.group.add(vert);

      // Dorsal spine process
      const spineGeo = new THREE.ConeGeometry(0.04, r * 0.8, 4);
      const spine = new THREE.Mesh(spineGeo, boneMat);
      spine.position.set(-i * 0.9, r * 0.5, 0);
      this.group.add(spine);

      // Flesh between segments
      if (i < segCount - 1) {
        const fleshGeo = new THREE.SphereGeometry(r * 0.85, 12, 10);
        fleshGeo.scale(1.2, 1, 1);
        const flesh = new THREE.Mesh(fleshGeo, fleshMat);
        flesh.position.set(-i * 0.9 - 0.45, 0, 0);
        this.group.add(flesh);
      }

      this.segments.push({ x: -i * 0.9, r });
    }

    // Head - eyeless biomechanical maw
    const headGeo = new THREE.SphereGeometry(0.7, 16, 12);
    headGeo.scale(1.4, 0.9, 0.9);
    const head = new THREE.Mesh(headGeo, new THREE.MeshPhysicalMaterial({
      color: 0x100810, roughness: 0.2, metalness: 0.6,
      clearcoat: 1.0, clearcoatRoughness: 0.1,
    }));
    head.position.set(0.5, 0, 0);
    this.group.add(head);

    // Mouth ring of teeth
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const tGeo = new THREE.ConeGeometry(0.03, 0.3, 4);
      const tMat = new THREE.MeshPhysicalMaterial({ color: 0xaa9970, roughness: 0.2, metalness: 0.6, clearcoat: 0.8 });
      const tooth = new THREE.Mesh(tGeo, tMat);
      tooth.position.set(1.1, Math.sin(a) * 0.35, Math.cos(a) * 0.35);
      tooth.rotation.z = Math.PI / 2;
      this.group.add(tooth);
    }

    const scale = 1.5 + Math.random() * 2;
    this.group.scale.setScalar(scale);
  }

  update(dt, playerPos) {
    this.time += dt;
    this.turnTimer += dt;

    if (this.turnTimer > this.turnInterval) {
      this.turnTimer = 0;
      this.turnInterval = 8 + Math.random() * 12;
      if (Math.random() < 0.25) {
        this.direction.subVectors(playerPos, this.group.position).normalize();
        this.direction.y *= 0.3;
      } else {
        this.direction.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.2, Math.random() - 0.5).normalize();
      }
    }

    this.group.position.add(this.direction.clone().multiplyScalar(this.speed * dt));

    // Undulating motion
    this.group.rotation.z = Math.sin(this.time * 2.5) * 0.1;
    this.group.rotation.x = Math.sin(this.time * 1.8) * 0.05;

    const angle = Math.atan2(this.direction.x, this.direction.z);
    this.group.rotation.y = THREE.MathUtils.lerp(this.group.rotation.y, angle + Math.PI / 2, dt * 2);

    // Respawn if too far
    if (this.group.position.distanceTo(playerPos) > 200) {
      const a = Math.random() * Math.PI * 2;
      this.group.position.set(
        playerPos.x + Math.cos(a) * 80, playerPos.y + (Math.random() - 0.5) * 20,
        playerPos.z + Math.sin(a) * 80
      );
    }
  }

  getPosition() { return this.group.position; }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); });
  }
}
