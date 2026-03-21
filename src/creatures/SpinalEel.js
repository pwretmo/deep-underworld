import * as THREE from 'three';

// Long eel with visible spinal column glowing through translucent biomechanical flesh
export class SpinalEel {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time = Math.random() * 100;
    this.speed = 5 + Math.random() * 3;
    this.direction = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    this.turnTimer = 0;
    this.turnInterval = 6 + Math.random() * 8;

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  _buildModel() {
    const segCount = 18;
    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: 0x0c0818, roughness: 0.2, metalness: 0.4,
      clearcoat: 1.0, clearcoatRoughness: 0.1,
      transparent: true, opacity: 0.6,
    });
    const spineMat = new THREE.MeshPhysicalMaterial({
      color: 0x88ffaa, emissive: 0x44ff66, emissiveIntensity: 0.8,
      roughness: 0.1, metalness: 0.3, clearcoat: 1.0,
    });

    this.segments = [];
    for (let i = 0; i < segCount; i++) {
      const t = i / segCount;
      const r = THREE.MathUtils.lerp(0.4, 0.08, Math.pow(t, 0.7));

      // Body segment
      const geo = new THREE.SphereGeometry(r, 12, 10);
      geo.scale(1.8, 1, 1);
      const seg = new THREE.Mesh(geo, bodyMat);
      seg.position.set(-i * 0.7, 0, 0);
      this.group.add(seg);
      this.segments.push(seg);

      // Internal spine glow
      const spGeo = new THREE.SphereGeometry(r * 0.25, 8, 6);
      const sp = new THREE.Mesh(spGeo, spineMat);
      sp.position.set(-i * 0.7, 0, 0);
      this.group.add(sp);
    }

    // Head
    const headGeo = new THREE.SphereGeometry(0.5, 16, 12);
    headGeo.scale(1.8, 0.8, 0.8);
    const headMat = new THREE.MeshPhysicalMaterial({
      color: 0x0a0610, roughness: 0.15, metalness: 0.5,
      clearcoat: 1.0, clearcoatRoughness: 0.1,
    });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.set(0.6, 0, 0);
    this.group.add(head);

    // Eyes
    const eyeMat = new THREE.MeshPhysicalMaterial({
      color: 0x44ff88, emissive: 0x44ff88, emissiveIntensity: 2,
      roughness: 0.0, clearcoat: 1.0,
    });
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 12), eyeMat);
      eye.position.set(0.9, 0.15, s * 0.3);
      this.group.add(eye);
    }

    this.glow = new THREE.PointLight(0x44ff66, 1, 15);
    this.group.add(this.glow);

    this.group.scale.setScalar(2 + Math.random() * 2);
  }

  update(dt, playerPos) {
    this.time += dt;
    this.turnTimer += dt;

    if (this.turnTimer > this.turnInterval) {
      this.turnTimer = 0;
      this.turnInterval = 6 + Math.random() * 8;
      this.direction.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.2, Math.random() - 0.5).normalize();
    }

    this.group.position.add(this.direction.clone().multiplyScalar(this.speed * dt));

    const angle = Math.atan2(this.direction.x, this.direction.z);
    this.group.rotation.y = THREE.MathUtils.lerp(this.group.rotation.y, angle + Math.PI / 2, dt * 3);

    // Sinusoidal body undulation
    for (let i = 1; i < this.segments.length; i++) {
      this.segments[i].position.y = Math.sin(this.time * 3 - i * 0.4) * i * 0.02;
      this.segments[i].position.z = Math.sin(this.time * 2.5 - i * 0.5) * i * 0.03;
    }

    this.glow.intensity = 0.8 + Math.sin(this.time * 4) * 0.3;

    if (this.group.position.distanceTo(playerPos) > 200) {
      const a = Math.random() * Math.PI * 2;
      this.group.position.set(playerPos.x + Math.cos(a) * 80, playerPos.y + (Math.random() - 0.5) * 20, playerPos.z + Math.sin(a) * 80);
    }
  }

  getPosition() { return this.group.position; }
  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); });
  }
}
