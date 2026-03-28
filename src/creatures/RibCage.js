import * as THREE from 'three';

// Floating biomechanical ribcage structure with pulsing organs inside
export class RibCage {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time = Math.random() * 100;
    this.speed = 0.4 + Math.random() * 0.3;
    this.direction = new THREE.Vector3(Math.random() - 0.5, -0.05, Math.random() - 0.5).normalize();
    this.turnTimer = 0;
    this.turnInterval = 25 + Math.random() * 20;
    this.organs = [];

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  _buildModel() {
    const boneMat = new THREE.MeshPhysicalMaterial({
      color: 0x3a3228, roughness: 0.25, metalness: 0,
      clearcoat: 0.9, clearcoatRoughness: 0.15,
      emissive: 0x504030, emissiveIntensity: 0.5,
    });
    const organMat = new THREE.MeshPhysicalMaterial({
      color: 0x2a1020, roughness: 0.3, metalness: 0,
      clearcoat: 0.7, transparent: true, opacity: 0.7,
      emissive: 0x502040, emissiveIntensity: 0.6,
    });
    const metalMat = new THREE.MeshPhysicalMaterial({
      color: 0x101010, roughness: 0.15, metalness: 0.85,
      clearcoat: 1.0,
      emissive: 0x203858, emissiveIntensity: 0.3,
    });

    // Spinal column - central vertical support
    for (let i = 0; i < 10; i++) {
      const vertebraGeo = new THREE.BoxGeometry(0.2, 0.3, 0.25, 2, 2, 2);
      const vp = vertebraGeo.attributes.position;
      for (let v = 0; v < vp.count; v++) {
        vp.setX(v, vp.getX(v) + Math.sin(vp.getY(v) * 3) * 0.02);
      }
      vertebraGeo.computeVertexNormals();
      const vertebra = new THREE.Mesh(vertebraGeo, boneMat);
      vertebra.position.y = i * 0.35 - 1.5;
      this.group.add(vertebra);
    }

    // Ribs - sweeping curves on both sides
    for (let i = 0; i < 7; i++) {
      const y = i * 0.4 - 1;
      for (const side of [-1, 1]) {
        const curve = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(0, y, 0),
          new THREE.Vector3(side * 1.2, y + 0.1, 0.5),
          new THREE.Vector3(side * 0.6, y + 0.3, -0.3)
        );
        const ribGeo = new THREE.TubeGeometry(curve, 10, 0.04, 6, false);
        this.group.add(new THREE.Mesh(ribGeo, boneMat));
      }
    }

    // Mechanical reinforcement struts
    for (let i = 0; i < 3; i++) {
      const strutGeo = new THREE.CylinderGeometry(0.03, 0.03, 2.5, 6);
      const strut = new THREE.Mesh(strutGeo, metalMat);
      strut.position.set(0, 0, (i - 1) * 0.5);
      strut.rotation.x = Math.PI / 2;
      this.group.add(strut);
    }

    // Pulsing organs suspended inside
    for (let i = 0; i < 4; i++) {
      const organGeo = new THREE.SphereGeometry(0.15 + Math.random() * 0.2, 10, 10);
      // Lumpy deformation
      const op = organGeo.attributes.position;
      for (let v = 0; v < op.count; v++) {
        const x = op.getX(v), y = op.getY(v), z = op.getZ(v);
        const n = 1 + Math.sin(x * 8 + y * 6) * 0.15;
        op.setX(v, x * n);
        op.setY(v, y * n);
        op.setZ(v, z * n);
      }
      organGeo.computeVertexNormals();
      const organ = new THREE.Mesh(organGeo, organMat);
      organ.position.set((Math.random() - 0.5) * 0.5, i * 0.5 - 0.8, (Math.random() - 0.5) * 0.3);
      this.organs.push(organ);
      this.group.add(organ);
    }

    // Connective tendons - thin metallic threads between ribs
    for (let i = 0; i < 5; i++) {
      const tGeo = new THREE.CylinderGeometry(0.01, 0.01, 1.5, 4);
      const t = new THREE.Mesh(tGeo, metalMat);
      t.position.set((Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 0.5);
      t.rotation.set(Math.random(), Math.random(), Math.random());
      this.group.add(t);
    }

    // Dim inner glow
    this.glow = new THREE.PointLight(0x440022, 1, 10);
    this.glow.userData.duwCategory = 'creature_bio';
    this.group.add(this.glow);

    const s = 2.5 + Math.random() * 2;
    this.group.scale.setScalar(s);
  }

  update(dt, playerPos) {
    this.time += dt;
    this.turnTimer += dt;

    if (this.turnTimer > this.turnInterval) {
      this.turnTimer = 0;
      this.turnInterval = 25 + Math.random() * 20;
      this.direction.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.05, Math.random() - 0.5).normalize();
    }

    this.group.position.add(this.direction.clone().multiplyScalar(this.speed * dt));

    // Slow majestic rotation
    this.group.rotation.y += dt * 0.05;
    this.group.rotation.x = Math.sin(this.time * 0.2) * 0.05;

    // Organ pulsing
    for (let i = 0; i < this.organs.length; i++) {
      const p = 1 + Math.sin(this.time * 2 + i * 1.5) * 0.15;
      this.organs[i].scale.setScalar(p);
    }

    // Glow pulse
    this.glow.intensity = 0.8 + Math.sin(this.time * 1.5) * 0.5;

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
