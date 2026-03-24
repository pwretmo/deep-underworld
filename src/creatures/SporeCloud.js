import * as THREE from 'three';

// Cloud of tiny biomechanical spores that move as a swarm with individual jitter
export class SporeCloud {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time = Math.random() * 100;
    this.speed = 0.5 + Math.random() * 0.3;
    this.direction = new THREE.Vector3(Math.random() - 0.5, -0.05, Math.random() - 0.5).normalize();
    this.turnTimer = 0;
    this.turnInterval = 12 + Math.random() * 10;
    this.spores = [];

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  _buildModel() {
    const sporeMat = new THREE.MeshPhysicalMaterial({
      color: 0x102018, roughness: 0.2, metalness: 0,
      clearcoat: 0.8, transparent: true, opacity: 0.7,
      emissive: 0x105020, emissiveIntensity: 0.7,
    });
    const coreMat = new THREE.MeshPhysicalMaterial({
      color: 0x00ff44, emissive: 0x00aa22, emissiveIntensity: 2,
      roughness: 0, transparent: true, opacity: 0.8,
    });

    const count = 30 + Math.floor(Math.random() * 20);
    for (let i = 0; i < count; i++) {
      const sporeGroup = new THREE.Group();
      const size = 0.03 + Math.random() * 0.06;

      // Outer shell
      const shellGeo = new THREE.SphereGeometry(size, 6, 6);
      sporeGroup.add(new THREE.Mesh(shellGeo, sporeMat));

      // Inner glowing core
      const coreGeo = new THREE.SphereGeometry(size * 0.4, 4, 4);
      sporeGroup.add(new THREE.Mesh(coreGeo, coreMat));

      // Small whisker filaments
      for (let f = 0; f < 3; f++) {
        const filGeo = new THREE.CylinderGeometry(0.002, 0.001, size * 3, 3);
        const fil = new THREE.Mesh(filGeo, sporeMat);
        const a = (f / 3) * Math.PI * 2;
        fil.position.set(Math.cos(a) * size * 0.5, 0, Math.sin(a) * size * 0.5);
        fil.rotation.set(Math.random(), Math.random(), Math.random());
        sporeGroup.add(fil);
      }

      // Scatter in a rough cloud shape
      const r = 1 + Math.random() * 2;
      const phi = Math.random() * Math.PI * 2;
      const theta = Math.random() * Math.PI;
      sporeGroup.position.set(
        Math.sin(theta) * Math.cos(phi) * r,
        Math.sin(theta) * Math.sin(phi) * r,
        Math.cos(theta) * r
      );

      this.spores.push({
        mesh: sporeGroup,
        offset: new THREE.Vector3(sporeGroup.position.x, sporeGroup.position.y, sporeGroup.position.z),
        phase: Math.random() * Math.PI * 2,
        freq: 0.5 + Math.random() * 1.5,
        amp: 0.05 + Math.random() * 0.15,
      });
      this.group.add(sporeGroup);
    }

    // Central dim glow
    this.glow = new THREE.PointLight(0x00aa22, 0.5, 8);
    this.group.add(this.glow);
  }

  update(dt, playerPos) {
    this.time += dt;
    this.turnTimer += dt;

    if (this.turnTimer > this.turnInterval) {
      this.turnTimer = 0;
      this.turnInterval = 12 + Math.random() * 10;
      this.direction.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.05, Math.random() - 0.5).normalize();
    }

    this.group.position.add(this.direction.clone().multiplyScalar(this.speed * dt));

    // Individual spore jitter
    for (let i = 0; i < this.spores.length; i++) {
      const s = this.spores[i];
      const t = this.time * s.freq + s.phase;
      s.mesh.position.x = s.offset.x + Math.sin(t) * s.amp;
      s.mesh.position.y = s.offset.y + Math.cos(t * 1.3) * s.amp;
      s.mesh.position.z = s.offset.z + Math.sin(t * 0.7) * s.amp;
    }

    // Glow throb
    this.glow.intensity = 0.3 + Math.sin(this.time * 1.2) * 0.2;

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
