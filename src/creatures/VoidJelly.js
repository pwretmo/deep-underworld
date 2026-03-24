import * as THREE from 'three';

// Black jellyfish that absorbs light - inverse bioluminescence with void tendrils
export class VoidJelly {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time = Math.random() * 100;
    this.speed = 0.6 + Math.random() * 0.4;
    this.direction = new THREE.Vector3(Math.random() - 0.5, -0.08, Math.random() - 0.5).normalize();
    this.turnTimer = 0;
    this.turnInterval = 15 + Math.random() * 15;
    this.tendrils = [];

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  _buildModel() {
    const voidMat = new THREE.MeshStandardMaterial({
      color: 0x0a0a18, roughness: 0.2, metalness: 0.2,
      emissive: 0x180828, emissiveIntensity: 0.4,
    });
    const membraneMat = new THREE.MeshStandardMaterial({
      color: 0x100818, roughness: 0.3, metalness: 0.1,
      transparent: true, opacity: 0.6,
      side: THREE.DoubleSide,
      emissive: 0x1a0a30, emissiveIntensity: 0.35,
    });

    // Bell - dark, light-absorbing dome
    const bellGeo = new THREE.SphereGeometry(1, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.6);
    const bp = bellGeo.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i);
      // Biomechanical ribbing on bell
      const ribbing = Math.sin(Math.atan2(z, x) * 8) * 0.03;
      bp.setX(i, x * (1 + ribbing));
      bp.setZ(i, z * (1 + ribbing));
    }
    bellGeo.computeVertexNormals();
    this.group.add(new THREE.Mesh(bellGeo, voidMat));

    // Under-bell structure - mechanical ribs
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const ribGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.8, 4);
      const rib = new THREE.Mesh(ribGeo, voidMat);
      rib.position.set(Math.cos(angle) * 0.7, -0.2, Math.sin(angle) * 0.7);
      rib.rotation.x = Math.cos(angle) * 0.3;
      rib.rotation.z = Math.sin(angle) * 0.3;
      this.group.add(rib);
    }

    // Dark tendrils - absorb light around them
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const len = 3 + Math.random() * 4;
      const tendrilGeo = new THREE.CylinderGeometry(0.03, 0.008, len, 4, 6);
      const tendril = new THREE.Mesh(tendrilGeo, membraneMat);
      tendril.position.set(Math.cos(angle) * 0.6, -len * 0.5 - 0.3, Math.sin(angle) * 0.6);
      this.tendrils.push(tendril);
      this.group.add(tendril);
    }

    // Anti-glow: negative light to darken surroundings
    this.voidLight = new THREE.PointLight(0x000000, 0, 8);
    this.group.add(this.voidLight);

    // Just a faint purple edge glow
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0x000000, emissive: 0x4422aa, emissiveIntensity: 0.8,
      transparent: true, opacity: 0.6,
    });
    const rimGeo = new THREE.TorusGeometry(1.0, 0.05, 6, 20);
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = -0.15;
    this.group.add(rim);

    // Faint point light for minimal visibility
    this.glow = new THREE.PointLight(0x2a1155, 0.8, 8);
    this.group.add(this.glow);

    const s = 1.5 + Math.random() * 2;
    this.group.scale.setScalar(s);
  }

  update(dt, playerPos) {
    this.time += dt;
    this.turnTimer += dt;

    if (this.turnTimer > this.turnInterval) {
      this.turnTimer = 0;
      this.turnInterval = 15 + Math.random() * 15;
      this.direction.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.05, Math.random() - 0.5).normalize();
    }

    this.group.position.add(this.direction.clone().multiplyScalar(this.speed * dt));

    // Pulsating swim motion
    const pulse = Math.sin(this.time * 1.2);
    this.group.scale.y = this.group.scale.x * (1 + pulse * 0.06);

    // Tendril sway
    for (let i = 0; i < this.tendrils.length; i++) {
      this.tendrils[i].rotation.x = Math.sin(this.time * 0.8 + i * 0.7) * 0.15;
      this.tendrils[i].rotation.z = Math.cos(this.time * 0.6 + i * 0.5) * 0.1;
    }

    // Slow rotation
    this.group.rotation.y += dt * 0.08;

    if (this.group.position.distanceTo(playerPos) > 200) {
      const a = Math.random() * Math.PI * 2;
      this.group.position.set(playerPos.x + Math.cos(a) * 80, playerPos.y - Math.random() * 15, playerPos.z + Math.sin(a) * 80);
    }
  }

  getPosition() { return this.group.position; }
  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); });
  }
}
