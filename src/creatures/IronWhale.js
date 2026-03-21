import * as THREE from 'three';

// Colossal biomechanical whale - ancient, covered in barnacle-like pipes, mechanical baleen
export class IronWhale {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time = Math.random() * 100;
    this.speed = 0.8 + Math.random() * 0.4;
    this.direction = new THREE.Vector3(Math.random() - 0.5, -0.03, Math.random() - 0.5).normalize();
    this.turnTimer = 0;
    this.turnInterval = 25 + Math.random() * 20;

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  _buildModel() {
    const hullMat = new THREE.MeshPhysicalMaterial({
      color: 0x0a0a0c, roughness: 0.2, metalness: 0.75,
      clearcoat: 1.0, clearcoatRoughness: 0.1,
      emissive: 0x040610, emissiveIntensity: 0.3,
    });
    const barnMat = new THREE.MeshPhysicalMaterial({
      color: 0x2a2218, roughness: 0.35, metalness: 0.4,
      clearcoat: 0.6,
    });
    const metalMat = new THREE.MeshPhysicalMaterial({
      color: 0x181818, roughness: 0.1, metalness: 0.92,
      clearcoat: 1.0,
    });

    // Massive body
    const bodyGeo = new THREE.SphereGeometry(2.5, 24, 18);
    bodyGeo.scale(3, 1, 1.2);
    const bp = bodyGeo.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i);
      // Whale-like shape - taper head and tail
      const head = Math.max(0, x) * 0.08;
      bp.setY(i, y * (1 - head * 0.3));
      // Plate ribbing
      bp.setY(i, bp.getY(i) + Math.sin(x * 3 + z * 4) * 0.05);
    }
    bodyGeo.computeVertexNormals();
    this.group.add(new THREE.Mesh(bodyGeo, hullMat));

    // Dorsal ridge - industrial plating
    for (let i = 0; i < 8; i++) {
      const plateGeo = new THREE.BoxGeometry(0.8, 0.2, 0.1, 2, 1, 1);
      const plate = new THREE.Mesh(plateGeo, metalMat);
      plate.position.set(i * 0.7 - 2.5, 2.2, 0);
      plate.rotation.z = Math.sin(i * 0.3) * 0.1;
      this.group.add(plate);
    }

    // Barnacle/pipe clusters on hull
    for (let i = 0; i < 15; i++) {
      const barnGeo = new THREE.CylinderGeometry(0.05, 0.08, 0.2 + Math.random() * 0.2, 6);
      const barn = new THREE.Mesh(barnGeo, barnMat);
      barn.position.set(
        (Math.random() - 0.5) * 6,
        1 + Math.random() * 1.2,
        (Math.random() - 0.5) * 2
      );
      barn.rotation.x = (Math.random() - 0.5) * 0.3;
      this.group.add(barn);
    }

    // Mechanical baleen plates hanging from jaw
    const jawGroup = new THREE.Group();
    for (let i = 0; i < 12; i++) {
      const baleenGeo = new THREE.BoxGeometry(0.02, 0.6, 0.15);
      const baleen = new THREE.Mesh(baleenGeo, metalMat);
      baleen.position.set(i * 0.15, 0, 0);
      jawGroup.add(baleen);
    }
    jawGroup.position.set(4, -1.5, 0);
    this.group.add(jawGroup);

    // Eyes - small relative to body, deep set
    for (const side of [-1, 1]) {
      const eyeGeo = new THREE.SphereGeometry(0.15, 10, 10);
      const eye = new THREE.Mesh(eyeGeo, new THREE.MeshPhysicalMaterial({
        color: 0x4488ff, emissive: 0x2244aa, emissiveIntensity: 1.5, roughness: 0.1,
      }));
      eye.position.set(5, 0.5, side * 2);
      this.group.add(eye);
    }

    // Tail flukes - flat mechanical blades
    for (const side of [-1, 1]) {
      const flukeGeo = new THREE.BoxGeometry(0.05, 1.5, 2);
      const fluke = new THREE.Mesh(flukeGeo, hullMat);
      fluke.position.set(-7, side * 0.3, 0);
      fluke.rotation.x = side * 0.3;
      this.group.add(fluke);
    }

    // Pectoral fins - mechanical
    for (const side of [-1, 1]) {
      const finGeo = new THREE.BoxGeometry(1.5, 0.05, 0.8);
      const fin = new THREE.Mesh(finGeo, metalMat);
      fin.position.set(1, -1, side * 2.5);
      fin.rotation.z = side * 0.2;
      this.group.add(fin);
    }

    // Exhaust vents at rear
    for (let i = 0; i < 3; i++) {
      const ventGeo = new THREE.CylinderGeometry(0.15, 0.2, 0.3, 8, 1, true);
      const vent = new THREE.Mesh(ventGeo, metalMat);
      vent.position.set(-6, (i - 1) * 0.5, 0);
      vent.rotation.z = Math.PI / 2;
      this.group.add(vent);
    }

    // Deep blue bioluminescent glow from eyes
    this.eyeLight = new THREE.PointLight(0x2244aa, 1.5, 25);
    this.eyeLight.position.set(5, 0.5, 0);
    this.group.add(this.eyeLight);

    this.group.scale.setScalar(2 + Math.random() * 2);
  }

  update(dt, playerPos) {
    this.time += dt;
    this.turnTimer += dt;

    if (this.turnTimer > this.turnInterval) {
      this.turnTimer = 0;
      this.turnInterval = 25 + Math.random() * 20;
      this.direction.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.02, Math.random() - 0.5).normalize();
    }

    this.group.position.add(this.direction.clone().multiplyScalar(this.speed * dt));
    this.group.position.y += Math.sin(this.time * 0.2) * 0.1 * dt;

    // Slow majestic turn
    const angle = Math.atan2(this.direction.x, this.direction.z);
    this.group.rotation.y = THREE.MathUtils.lerp(this.group.rotation.y, angle + Math.PI / 2, dt * 0.5);

    // Gentle roll
    this.group.rotation.z = Math.sin(this.time * 0.15) * 0.02;

    if (this.group.position.distanceTo(playerPos) > 250) {
      const a = Math.random() * Math.PI * 2;
      this.group.position.set(playerPos.x + Math.cos(a) * 100, playerPos.y - Math.random() * 20, playerPos.z + Math.sin(a) * 100);
    }
  }

  getPosition() { return this.group.position; }
  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); });
  }
}
