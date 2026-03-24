import * as THREE from 'three';

// Tall stationary creature resembling biomechanical pipe organ - resonates and hums
export class PipeOrgan {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time = Math.random() * 100;
    this.pipes = [];

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  _buildModel() {
    const metalMat = new THREE.MeshStandardMaterial({
      color: 0x2a2838, roughness: 0.3, metalness: 0.4,
      emissive: 0x4a3870, emissiveIntensity: 0.4,
    });
    const boneMat = new THREE.MeshStandardMaterial({
      color: 0x504030, roughness: 0.4, metalness: 0.15,
      emissive: 0x6a5540, emissiveIntensity: 0.35,
    });
    const fleshMat = new THREE.MeshStandardMaterial({
      color: 0x3a1828, roughness: 0.5, metalness: 0.05,
      emissive: 0x6b2848, emissiveIntensity: 0.4,
    });

    // Base - fleshy organic mound
    const baseGeo = new THREE.SphereGeometry(1.5, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    const bpos = baseGeo.attributes.position;
    for (let i = 0; i < bpos.count; i++) {
      bpos.setX(i, bpos.getX(i) + Math.sin(bpos.getZ(i) * 5) * 0.05);
    }
    baseGeo.computeVertexNormals();
    const base = new THREE.Mesh(baseGeo, fleshMat);
    base.rotation.x = -Math.PI;
    this.group.add(base);

    // Array of pipes of varying heights
    const pipeCount = 9;
    for (let i = 0; i < pipeCount; i++) {
      const pipeGroup = new THREE.Group();
      const x = (i - Math.floor(pipeCount / 2)) * 0.35;
      const height = 2 + Math.sin(i * 0.7) * 1.5 + Math.random() * 0.5;
      const radius = 0.08 + Math.random() * 0.06;

      // Pipe body
      const pipeGeo = new THREE.CylinderGeometry(radius, radius * 1.1, height, 8, 6);
      const pp = pipeGeo.attributes.position;
      for (let v = 0; v < pp.count; v++) {
        const y = pp.getY(v);
        pp.setX(v, pp.getX(v) + Math.sin(y * 4) * 0.01);
      }
      pipeGeo.computeVertexNormals();
      const pipe = new THREE.Mesh(pipeGeo, metalMat);
      pipe.position.y = height * 0.5;
      pipeGroup.add(pipe);

      // Flared opening at top
      const flareGeo = new THREE.CylinderGeometry(radius * 1.8, radius * 1.0, 0.15, 8, 1, true);
      const flare = new THREE.Mesh(flareGeo, metalMat);
      flare.position.y = height;
      pipeGroup.add(flare);

      // Bone ring at base
      const ringGeo = new THREE.TorusGeometry(radius * 1.3, 0.02, 6, 8);
      const ring = new THREE.Mesh(ringGeo, boneMat);
      ring.position.y = 0.1;
      ring.rotation.x = Math.PI / 2;
      pipeGroup.add(ring);

      pipeGroup.position.set(x, 0, (Math.random() - 0.5) * 0.4);
      this.pipes.push({ group: pipeGroup, height, baseY: height * 0.5 });
      this.group.add(pipeGroup);
    }

    // Cross-connecting tubes between pipes
    for (let i = 0; i < pipeCount - 1; i += 2) {
      const connGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.35, 4);
      const conn = new THREE.Mesh(connGeo, metalMat);
      conn.position.set((i - Math.floor(pipeCount / 2) + 0.5) * 0.35, 0.8 + Math.random() * 1, 0);
      conn.rotation.z = Math.PI / 2;
      this.group.add(conn);
    }

    // Fleshy base tendrils anchoring to ground
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const tendrilGeo = new THREE.CylinderGeometry(0.04, 0.08, 1.5, 6);
      const tendril = new THREE.Mesh(tendrilGeo, fleshMat);
      tendril.position.set(Math.cos(angle) * 1.2, -0.5, Math.sin(angle) * 1.2);
      tendril.rotation.x = (Math.random() - 0.5) * 0.5;
      tendril.rotation.z = (Math.random() - 0.5) * 0.5;
      this.group.add(tendril);
    }

    // Eerie glow from pipe openings
    this.glow = new THREE.PointLight(0x4422ff, 1, 12);
    this.glow.position.y = 3;
    this.group.add(this.glow);

    const s = 2 + Math.random() * 2;
    this.group.scale.setScalar(s);
  }

  update(dt, playerPos) {
    this.time += dt;

    // Pipes oscillate slightly - as if resonating
    for (let i = 0; i < this.pipes.length; i++) {
      const phase = this.time * 1.5 + i * 0.8;
      const pipe = this.pipes[i];
      pipe.group.children[0].position.y = pipe.baseY + Math.sin(phase) * 0.05;
      pipe.group.rotation.z = Math.sin(phase * 0.5) * 0.015;
    }

    // Glow pulsation - like breathing
    this.glow.intensity = 0.8 + Math.sin(this.time * 0.8) * 0.5 + Math.sin(this.time * 3) * 0.2;

    if (this.group.position.distanceTo(playerPos) > 200) {
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
