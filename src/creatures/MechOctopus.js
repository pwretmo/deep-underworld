import * as THREE from 'three';

// Biomechanical octopus with industrial tentacles, riveted dome, suction cups as mechanical clamps
export class MechOctopus {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time = Math.random() * 100;
    this.speed = 1.2 + Math.random() * 0.8;
    this.direction = new THREE.Vector3(Math.random() - 0.5, -0.1, Math.random() - 0.5).normalize();
    this.turnTimer = 0;
    this.turnInterval = 8 + Math.random() * 8;
    this.tentacles = [];

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  _buildModel() {
    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: 0x182028, roughness: 0.15, metalness: 0,
      clearcoat: 1.0, clearcoatRoughness: 0.08,
      emissive: 0x203858, emissiveIntensity: 0.6,
    });
    const metalMat = new THREE.MeshPhysicalMaterial({
      color: 0x141414, roughness: 0.1, metalness: 0.9,
      clearcoat: 1.0,
      emissive: 0x204060, emissiveIntensity: 0.3,
    });
    const organicMat = new THREE.MeshPhysicalMaterial({
      color: 0x201828, roughness: 0.3, metalness: 0,
      clearcoat: 0.7,
      emissive: 0x203858, emissiveIntensity: 0.5,
    });

    // Mantle dome - riveted industrial look
    const mantleGeo = new THREE.SphereGeometry(1.2, 18, 14);
    mantleGeo.scale(1, 1.3, 0.9);
    const mp = mantleGeo.attributes.position;
    for (let i = 0; i < mp.count; i++) {
      const x = mp.getX(i), y = mp.getY(i), z = mp.getZ(i);
      // Panel seam lines
      mp.setX(i, x + Math.sin(y * 10) * 0.02);
    }
    mantleGeo.computeVertexNormals();
    this.group.add(new THREE.Mesh(mantleGeo, bodyMat));

    // Rivet dots on mantle
    for (let i = 0; i < 16; i++) {
      const phi = Math.random() * Math.PI * 2;
      const theta = Math.random() * Math.PI * 0.6;
      const rivetGeo = new THREE.SphereGeometry(0.03, 4, 4);
      const rivet = new THREE.Mesh(rivetGeo, metalMat);
      rivet.position.set(
        Math.sin(theta) * Math.cos(phi) * 1.15,
        Math.cos(theta) * 1.5 + 0.2,
        Math.sin(theta) * Math.sin(phi) * 1.05
      );
      this.group.add(rivet);
    }

    // Eyes - large, amber
    for (const side of [-1, 1]) {
      const eyeGeo = new THREE.SphereGeometry(0.2, 12, 12);
      eyeGeo.scale(1.3, 1, 1);
      const eye = new THREE.Mesh(eyeGeo, new THREE.MeshPhysicalMaterial({
        color: 0xffaa00, emissive: 0xcc8800, emissiveIntensity: 2, roughness: 0.1,
        clearcoat: 1.0,
      }));
      eye.position.set(0.5, 0, side * 0.9);
      this.group.add(eye);
    }

    this.eyeLight = new THREE.PointLight(0xffaa00, 0.8, 10);
    this.eyeLight.position.set(0.5, 0, 0);
    this.group.add(this.eyeLight);

    // 8 segmented mechanical tentacles
    for (let t = 0; t < 8; t++) {
      const tentGroup = new THREE.Group();
      const angle = (t / 8) * Math.PI * 2;
      const segCount = 8;

      for (let s = 0; s < segCount; s++) {
        const r = 0.08 * (1 - s / segCount * 0.6);

        // Segment - alternating metal/organic
        const segGeo = new THREE.CylinderGeometry(r * 0.9, r, 0.35, 6);
        const seg = new THREE.Mesh(segGeo, s % 2 === 0 ? metalMat : organicMat);
        seg.position.y = -s * 0.32;
        tentGroup.add(seg);

        // Mechanical suction clamp (every 2nd segment)
        if (s % 2 === 0 && s > 0) {
          const clampGeo = new THREE.TorusGeometry(r * 1.3, 0.01, 4, 6);
          const clamp = new THREE.Mesh(clampGeo, metalMat);
          clamp.position.y = -s * 0.32;
          clamp.rotation.x = Math.PI / 2;
          tentGroup.add(clamp);
        }
      }

      tentGroup.position.set(Math.cos(angle) * 0.6, -0.8, Math.sin(angle) * 0.5);
      this.tentacles.push(tentGroup);
      this.group.add(tentGroup);
    }

    // Siphon jet at back
    const siphonGeo = new THREE.CylinderGeometry(0.1, 0.15, 0.4, 8, 1, true);
    const siphon = new THREE.Mesh(siphonGeo, metalMat);
    siphon.position.set(-0.8, -0.3, 0);
    siphon.rotation.z = Math.PI / 4;
    this.group.add(siphon);

    const s = 2 + Math.random() * 1.5;
    this.group.scale.setScalar(s);
  }

  update(dt, playerPos) {
    this.time += dt;
    this.turnTimer += dt;

    if (this.turnTimer > this.turnInterval) {
      this.turnTimer = 0;
      this.turnInterval = 8 + Math.random() * 8;
      if (Math.random() < 0.35) {
        this.direction.subVectors(playerPos, this.group.position).normalize();
        this.direction.y *= 0.2;
      } else {
        this.direction.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.1, Math.random() - 0.5).normalize();
      }
    }

    // Jet-pulse movement
    const pulse = Math.max(0, Math.sin(this.time * 2));
    this.group.position.add(this.direction.clone().multiplyScalar((this.speed + pulse * 2) * dt));

    // Face direction
    const angle = Math.atan2(this.direction.x, this.direction.z);
    this.group.rotation.y = THREE.MathUtils.lerp(this.group.rotation.y, angle + Math.PI / 2, dt * 2);

    // Tentacle animation - undulating
    for (let i = 0; i < this.tentacles.length; i++) {
      const phase = this.time * 2 + i * Math.PI / 4;
      this.tentacles[i].rotation.x = Math.sin(phase) * 0.3;
      this.tentacles[i].rotation.z = Math.cos(phase * 0.6) * 0.2;
    }

    if (this.group.position.distanceTo(playerPos) > 200) {
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
