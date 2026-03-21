import * as THREE from 'three';

// Giant floating mouth/throat with concentric rings of teeth - biomechanical abyss gulper
export class AbyssalMaw {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time = Math.random() * 100;
    this.speed = 0.6 + Math.random() * 0.4;
    this.direction = new THREE.Vector3(Math.random() - 0.5, -0.15, Math.random() - 0.5).normalize();
    this.turnTimer = 0;
    this.turnInterval = 20 + Math.random() * 20;
    this.rings = [];

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  _buildModel() {
    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: 0x080610, roughness: 0.2, metalness: 0.6,
      clearcoat: 1.0, clearcoatRoughness: 0.1,
    });
    const fleshMat = new THREE.MeshPhysicalMaterial({
      color: 0x200818, roughness: 0.3, metalness: 0.3,
      clearcoat: 0.8,
    });
    const toothMat = new THREE.MeshPhysicalMaterial({
      color: 0x403028, roughness: 0.2, metalness: 0.5,
      clearcoat: 1.0,
    });

    // Throat tube - tapers inward
    const throatGeo = new THREE.CylinderGeometry(2.5, 0.8, 6, 24, 10, true);
    const tp = throatGeo.attributes.position;
    for (let i = 0; i < tp.count; i++) {
      const y = tp.getY(i);
      const x = tp.getX(i), z = tp.getZ(i);
      // Ribbed texture
      tp.setX(i, x * (1 + Math.sin(y * 6) * 0.08));
      tp.setZ(i, z * (1 + Math.sin(y * 6) * 0.08));
    }
    throatGeo.computeVertexNormals();
    const throat = new THREE.Mesh(throatGeo, fleshMat);
    throat.rotation.x = Math.PI / 2;
    this.group.add(throat);

    // Concentric tooth rings (3 rings)
    for (let ring = 0; ring < 3; ring++) {
      const ringGroup = new THREE.Group();
      const radius = 2.2 - ring * 0.5;
      const teethCount = 16 - ring * 4;
      const toothLen = 0.7 + ring * 0.25;
      for (let t = 0; t < teethCount; t++) {
        const angle = (t / teethCount) * Math.PI * 2;
        const toothGeo = new THREE.ConeGeometry(0.08, toothLen, 6);
        const tooth = new THREE.Mesh(toothGeo, toothMat);
        tooth.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
        tooth.rotation.x = Math.PI / 2;
        // Point inward
        tooth.lookAt(0, 0, 0.5);
        ringGroup.add(tooth);
      }
      ringGroup.position.z = -ring * 1.5;
      this.rings.push(ringGroup);
      this.group.add(ringGroup);
    }

    // Outer lip - fleshy biomechanical rim
    const lipGeo = new THREE.TorusGeometry(2.5, 0.4, 12, 24);
    const lip = new THREE.Mesh(lipGeo, bodyMat);
    lip.rotation.x = Math.PI / 2;
    this.group.add(lip);

    // Tubular tendrils hanging from the outer rim
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const tendrilGeo = new THREE.CylinderGeometry(0.06, 0.03, 3 + Math.random() * 2, 6);
      const tendril = new THREE.Mesh(tendrilGeo, bodyMat);
      tendril.position.set(Math.cos(angle) * 2.5, Math.sin(angle) * 2.5, 0.5);
      tendril.rotation.x = Math.PI / 2 + (Math.random() - 0.5) * 0.3;
      this.group.add(tendril);
    }

    // Internal bioluminescent glow
    const glowMat = new THREE.MeshPhysicalMaterial({
      color: 0xff0044, emissive: 0x660022, emissiveIntensity: 2,
      transparent: true, opacity: 0.5, roughness: 0,
    });
    const innerGlow = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 12), glowMat);
    innerGlow.position.z = -4;
    this.group.add(innerGlow);

    this.innerLight = new THREE.PointLight(0xff0033, 2, 15);
    this.innerLight.position.z = -2;
    this.group.add(this.innerLight);

    const s = 1.5 + Math.random() * 2;
    this.group.scale.setScalar(s);
  }

  update(dt, playerPos) {
    this.time += dt;
    this.turnTimer += dt;

    if (this.turnTimer > this.turnInterval) {
      this.turnTimer = 0;
      this.turnInterval = 20 + Math.random() * 20;
      if (Math.random() < 0.3) {
        this.direction.subVectors(playerPos, this.group.position).normalize();
        this.direction.y *= 0.15;
      } else {
        this.direction.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.08, Math.random() - 0.5).normalize();
      }
    }

    this.group.position.add(this.direction.clone().multiplyScalar(this.speed * dt));

    // Slowly rotate tooth rings in opposite directions
    for (let i = 0; i < this.rings.length; i++) {
      this.rings[i].rotation.z += (i % 2 === 0 ? 1 : -1) * dt * 0.3;
    }

    // Face direction of travel
    const target = this.group.position.clone().add(this.direction);
    this.group.lookAt(target);

    // Breathing pulse
    const pulse = 1 + Math.sin(this.time * 1.5) * 0.05;
    this.group.scale.x = this.group.scale.y = this.group.scale.z * pulse / (1 + Math.sin((this.time - dt) * 1.5) * 0.05);

    // Internal glow pulsing
    this.innerLight.intensity = 1.5 + Math.sin(this.time * 2) * 1;

    if (this.group.position.distanceTo(playerPos) > 200) {
      const a = Math.random() * Math.PI * 2;
      this.group.position.set(playerPos.x + Math.cos(a) * 80, playerPos.y - Math.random() * 20, playerPos.z + Math.sin(a) * 80);
    }
  }

  getPosition() { return this.group.position; }
  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); });
  }
}
