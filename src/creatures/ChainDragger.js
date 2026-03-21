import * as THREE from 'three';

// Creature trailing chain-like segmented appendages that drag through the water
export class ChainDragger {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time = Math.random() * 100;
    this.speed = 1.0 + Math.random() * 0.8;
    this.direction = new THREE.Vector3(Math.random() - 0.5, -0.08, Math.random() - 0.5).normalize();
    this.turnTimer = 0;
    this.turnInterval = 10 + Math.random() * 10;
    this.chains = [];

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  _buildModel() {
    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: 0x0a0810, roughness: 0.2, metalness: 0.65,
      clearcoat: 1.0, clearcoatRoughness: 0.1,
    });
    const chainMat = new THREE.MeshPhysicalMaterial({
      color: 0x151515, roughness: 0.1, metalness: 0.92,
      clearcoat: 1.0, clearcoatRoughness: 0.05,
    });

    // Compact biomechanical body
    const bodyGeo = new THREE.SphereGeometry(0.8, 14, 12);
    bodyGeo.scale(1.4, 0.9, 0.8);
    const bp = bodyGeo.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      const y = bp.getY(i), x = bp.getX(i);
      bp.setX(i, x + Math.sin(y * 7) * 0.04);
    }
    bodyGeo.computeVertexNormals();
    this.group.add(new THREE.Mesh(bodyGeo, bodyMat));

    // Armored head cowl
    const cowlGeo = new THREE.SphereGeometry(0.5, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5);
    cowlGeo.scale(1.2, 0.7, 0.9);
    const cowl = new THREE.Mesh(cowlGeo, bodyMat);
    cowl.position.set(0.6, 0.4, 0);
    this.group.add(cowl);

    // Eyes - dim amber
    for (const side of [-1, 1]) {
      const eyeGeo = new THREE.SphereGeometry(0.06, 8, 8);
      const eye = new THREE.Mesh(eyeGeo, new THREE.MeshPhysicalMaterial({
        color: 0xdd8800, emissive: 0xaa6600, emissiveIntensity: 1.5, roughness: 0,
      }));
      eye.position.set(1.0, 0.3, side * 0.3);
      this.group.add(eye);
    }

    // 4 trailing chain appendages from underside
    for (let c = 0; c < 4; c++) {
      const chainGroup = new THREE.Group();
      const linkCount = 8 + Math.floor(Math.random() * 6);

      for (let l = 0; l < linkCount; l++) {
        const linkGeo = new THREE.TorusGeometry(0.06, 0.015, 6, 8);
        const link = new THREE.Mesh(linkGeo, chainMat);
        link.position.y = -l * 0.14;
        // Alternate link orientation
        link.rotation.x = l % 2 === 0 ? 0 : Math.PI / 2;
        chainGroup.add(link);
      }

      // Weight/anchor at end
      const weightGeo = new THREE.SphereGeometry(0.08, 8, 8);
      const weight = new THREE.Mesh(weightGeo, chainMat);
      weight.position.y = -linkCount * 0.14 - 0.1;
      chainGroup.add(weight);

      chainGroup.position.set(c * 0.4 - 0.6, -0.6, (c % 2 === 0 ? -1 : 1) * 0.2);
      this.chains.push(chainGroup);
      this.group.add(chainGroup);
    }

    const s = 2 + Math.random() * 1.5;
    this.group.scale.setScalar(s);
  }

  update(dt, playerPos) {
    this.time += dt;
    this.turnTimer += dt;

    if (this.turnTimer > this.turnInterval) {
      this.turnTimer = 0;
      this.turnInterval = 10 + Math.random() * 10;
      if (Math.random() < 0.3) {
        this.direction.subVectors(playerPos, this.group.position).normalize();
        this.direction.y *= 0.15;
      } else {
        this.direction.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.05, Math.random() - 0.5).normalize();
      }
    }

    this.group.position.add(this.direction.clone().multiplyScalar(this.speed * dt));

    // Face direction
    const angle = Math.atan2(this.direction.x, this.direction.z);
    this.group.rotation.y = THREE.MathUtils.lerp(this.group.rotation.y, angle, dt * 2);

    // Chain sway - pendulum physics approximation
    for (let i = 0; i < this.chains.length; i++) {
      const phase = this.time * 1.5 + i * 1.2;
      this.chains[i].rotation.x = Math.sin(phase) * 0.2;
      this.chains[i].rotation.z = Math.cos(phase * 0.6) * 0.15;
    }

    if (this.group.position.distanceTo(playerPos) > 200) {
      const a = Math.random() * Math.PI * 2;
      this.group.position.set(playerPos.x + Math.cos(a) * 70, playerPos.y - Math.random() * 10, playerPos.z + Math.sin(a) * 70);
    }
  }

  getPosition() { return this.group.position; }
  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); });
  }
}
