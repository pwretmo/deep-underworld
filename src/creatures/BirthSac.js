import * as THREE from 'three';

// Pulsating biomechanical egg sac cluster - occasionally releases small parasites
export class BirthSac {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time = Math.random() * 100;
    this.speed = 0.2 + Math.random() * 0.15;
    this.direction = new THREE.Vector3(Math.random() - 0.5, -0.02, Math.random() - 0.5).normalize();
    this.sacs = [];

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  _buildModel() {
    const sacMat = new THREE.MeshPhysicalMaterial({
      color: 0x201018, roughness: 0.2, metalness: 0,
      clearcoat: 0.9, transparent: true, opacity: 0.7,
      transmission: 0.3, thickness: 0.5,
      emissive: 0x502040, emissiveIntensity: 0.6,
    });
    const veinMat = new THREE.MeshPhysicalMaterial({
      color: 0x1a1018, roughness: 0.15, metalness: 0,
      clearcoat: 1.0,
      emissive: 0x602040, emissiveIntensity: 0.6,
    });
    const innerMat = new THREE.MeshPhysicalMaterial({
      color: 0x330011, emissive: 0x220008, emissiveIntensity: 1,
      roughness: 0.5, metalness: 0.1,
    });

    // Central mass - organic base
    const coreGeo = new THREE.SphereGeometry(0.6, 12, 10);
    const cp = coreGeo.attributes.position;
    for (let i = 0; i < cp.count; i++) {
      const x = cp.getX(i), y = cp.getY(i), z = cp.getZ(i);
      cp.setX(i, x * (1 + Math.sin(y * 5 + z * 4) * 0.12));
      cp.setY(i, y * (1 + Math.cos(x * 6) * 0.1));
      cp.setZ(i, z * (1 + Math.sin(x * 7 + y * 3) * 0.1));
    }
    coreGeo.computeVertexNormals();
    this.group.add(new THREE.Mesh(coreGeo, veinMat));

    // Egg sacs - translucent bulbs with visible embryos
    const sacCount = 5 + Math.floor(Math.random() * 4);
    for (let i = 0; i < sacCount; i++) {
      const sacGroup = new THREE.Group();
      const size = 0.3 + Math.random() * 0.4;

      // Outer membrane
      const outerGeo = new THREE.SphereGeometry(size, 12, 10);
      const op = outerGeo.attributes.position;
      for (let v = 0; v < op.count; v++) {
        const x = op.getX(v), y = op.getY(v), z = op.getZ(v);
        op.setX(v, x * (1 + Math.sin(y * 8 + z * 6) * 0.06));
      }
      outerGeo.computeVertexNormals();
      sacGroup.add(new THREE.Mesh(outerGeo, sacMat));

      // Inner embryo - curled dark shape
      const embryoGeo = new THREE.SphereGeometry(size * 0.4, 8, 8);
      embryoGeo.scale(1.3, 0.8, 0.7);
      const embryo = new THREE.Mesh(embryoGeo, innerMat);
      embryo.position.set(size * 0.1, -size * 0.1, 0);
      sacGroup.add(embryo);

      // Attachment stalk
      const stalkGeo = new THREE.CylinderGeometry(0.02, 0.04, size * 0.8, 4);
      const stalk = new THREE.Mesh(stalkGeo, veinMat);
      stalk.position.set(0, -size * 0.6, 0);
      sacGroup.add(stalk);

      // Position around core
      const phi = Math.random() * Math.PI * 2;
      const theta = Math.random() * Math.PI;
      const r = 0.5 + Math.random() * 0.5;
      sacGroup.position.set(
        Math.sin(theta) * Math.cos(phi) * r,
        Math.sin(theta) * Math.sin(phi) * r,
        Math.cos(theta) * r
      );

      this.sacs.push({ mesh: sacGroup, baseScale: size });
      this.group.add(sacGroup);
    }

    // Connective veins between sacs
    for (let i = 0; i < 6; i++) {
      const veinGeo = new THREE.CylinderGeometry(0.015, 0.015, 1 + Math.random() * 0.5, 4);
      const vein = new THREE.Mesh(veinGeo, veinMat);
      vein.position.set(
        (Math.random() - 0.5) * 0.8,
        (Math.random() - 0.5) * 0.8,
        (Math.random() - 0.5) * 0.8
      );
      vein.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
      this.group.add(vein);
    }

    // Dim eerie glow
    this.glow = new THREE.PointLight(0x660022, 0.8, 8);
    this.group.add(this.glow);

    const s = 2 + Math.random() * 2;
    this.group.scale.setScalar(s);
  }

  update(dt, playerPos) {
    this.time += dt;

    // Very slow drift
    this.group.position.add(this.direction.clone().multiplyScalar(this.speed * dt));
    this.group.position.y += Math.sin(this.time * 0.3) * 0.1 * dt;

    // Sac pulsation - breathing rhythm
    for (let i = 0; i < this.sacs.length; i++) {
      const phase = this.time * 1.2 + i * 0.7;
      const pulse = 1 + Math.sin(phase) * 0.1;
      this.sacs[i].mesh.scale.setScalar(pulse);
    }

    // Slow rotation
    this.group.rotation.y += dt * 0.03;
    this.group.rotation.x = Math.sin(this.time * 0.15) * 0.05;

    // Glow rhythm
    this.glow.intensity = 0.5 + Math.sin(this.time * 0.8) * 0.3;

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
