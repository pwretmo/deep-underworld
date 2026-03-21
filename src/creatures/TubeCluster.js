import * as THREE from 'three';

// Stationary biomechanical tube cluster - industrial worm colony fused with pipes and valves
export class TubeCluster {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time = Math.random() * 100;
    this.worms = [];

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  _buildModel() {
    const metalMat = new THREE.MeshPhysicalMaterial({
      color: 0x0c0c0c, roughness: 0.1, metalness: 0.9,
      clearcoat: 1.0, clearcoatRoughness: 0.05,
    });
    const organicMat = new THREE.MeshPhysicalMaterial({
      color: 0x150810, roughness: 0.3, metalness: 0.25,
      clearcoat: 0.7,
    });
    const glowMat = new THREE.MeshPhysicalMaterial({
      color: 0x00ffaa, emissive: 0x00aa66, emissiveIntensity: 1.5,
      roughness: 0.5, metalness: 0,
    });

    const tubeCount = 7 + Math.floor(Math.random() * 5);
    for (let i = 0; i < tubeCount; i++) {
      const tubeGroup = new THREE.Group();
      const height = 1.5 + Math.random() * 3;
      const radius = 0.08 + Math.random() * 0.1;
      const isMechanical = Math.random() > 0.4;

      // Tube body
      const tubeGeo = new THREE.CylinderGeometry(radius, radius * 1.2, height, 8, 6);
      if (!isMechanical) {
        const tp = tubeGeo.attributes.position;
        for (let v = 0; v < tp.count; v++) {
          const y = tp.getY(v);
          tp.setX(v, tp.getX(v) + Math.sin(y * 5 + i) * 0.02);
          tp.setZ(v, tp.getZ(v) + Math.cos(y * 4 + i) * 0.02);
        }
        tubeGeo.computeVertexNormals();
      }
      tubeGroup.add(new THREE.Mesh(tubeGeo, isMechanical ? metalMat : organicMat));

      // Opening at top
      const openGeo = new THREE.TorusGeometry(radius * 1.1, radius * 0.2, 6, 8);
      const open = new THREE.Mesh(openGeo, isMechanical ? metalMat : organicMat);
      open.position.y = height * 0.5;
      open.rotation.x = Math.PI / 2;
      tubeGroup.add(open);

      // Some tubes have valve wheels
      if (isMechanical && Math.random() > 0.5) {
        const valveGeo = new THREE.TorusGeometry(0.1, 0.015, 6, 12);
        const valve = new THREE.Mesh(valveGeo, metalMat);
        valve.position.set(radius + 0.05, height * 0.3, 0);
        tubeGroup.add(valve);
      }

      // Worm creatures emerging from some
      if (Math.random() > 0.4) {
        const wormGeo = new THREE.CylinderGeometry(radius * 0.6, radius * 0.3, 0.5, 6);
        const worm = new THREE.Mesh(wormGeo, organicMat);
        worm.position.y = height * 0.5 + 0.2;
        this.worms.push(worm);
        tubeGroup.add(worm);

        // Glow tip
        const tipGeo = new THREE.SphereGeometry(radius * 0.4, 6, 6);
        const tip = new THREE.Mesh(tipGeo, glowMat);
        tip.position.y = height * 0.5 + 0.45;
        tubeGroup.add(tip);
      }

      // Position in cluster
      const angle = (i / tubeCount) * Math.PI * 2;
      const r = 0.3 + Math.random() * 0.6;
      tubeGroup.position.set(Math.cos(angle) * r, height * 0.5, Math.sin(angle) * r);
      this.group.add(tubeGroup);
    }

    // Cross-connecting pipes at base
    for (let i = 0; i < 4; i++) {
      const connGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.8 + Math.random() * 0.5, 4);
      const conn = new THREE.Mesh(connGeo, metalMat);
      conn.position.set(
        (Math.random() - 0.5) * 0.8,
        0.3 + Math.random() * 0.4,
        (Math.random() - 0.5) * 0.8
      );
      conn.rotation.z = Math.PI / 2;
      conn.rotation.y = Math.random() * Math.PI;
      this.group.add(conn);
    }

    this.glow = new THREE.PointLight(0x00aa66, 0.5, 8);
    this.glow.position.y = 2;
    this.group.add(this.glow);

    const s = 1.5 + Math.random() * 1.5;
    this.group.scale.setScalar(s);
  }

  update(dt, playerPos) {
    this.time += dt;

    // Worms pulsate in and out of tubes
    for (let i = 0; i < this.worms.length; i++) {
      const phase = this.time * 0.8 + i * 1.5;
      this.worms[i].position.y += Math.sin(phase) * 0.1 * dt;
    }

    // Glow flicker
    this.glow.intensity = 0.3 + Math.sin(this.time * 1.5) * 0.2;

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
