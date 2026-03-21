import * as THREE from 'three';

// Floating elongated skull with trailing biomechanical membrane tendrils - siren of the deep
export class SirenSkull {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time = Math.random() * 100;
    this.speed = 1.5 + Math.random() * 1;
    this.direction = new THREE.Vector3(Math.random() - 0.5, -0.1, Math.random() - 0.5).normalize();
    this.turnTimer = 0;
    this.turnInterval = 12 + Math.random() * 15;
    this.bobPhase = Math.random() * Math.PI * 2;

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  _buildModel() {
    const boneMat = new THREE.MeshPhysicalMaterial({
      color: 0x302820, roughness: 0.3, metalness: 0.4,
      clearcoat: 0.9, clearcoatRoughness: 0.15,
    });

    // Elongated skull
    const skullGeo = new THREE.SphereGeometry(1, 20, 16);
    skullGeo.scale(1.8, 1, 0.85);
    const sPos = skullGeo.attributes.position;
    for (let i = 0; i < sPos.count; i++) {
      const x = sPos.getX(i), y = sPos.getY(i), z = sPos.getZ(i);
      // Cheekbone hollows
      if (y < 0 && Math.abs(z) > 0.3) sPos.setY(i, y - 0.15);
      // Brow ridge
      if (y > 0.5 && x > 0) sPos.setY(i, y + 0.1);
      // Surface detail
      sPos.setX(i, x + Math.sin(y * 8 + z * 5) * 0.03);
    }
    skullGeo.computeVertexNormals();
    const skull = new THREE.Mesh(skullGeo, boneMat);
    this.group.add(skull);

    // Cranial ridge
    const ridgeGeo = new THREE.BoxGeometry(2.5, 0.3, 0.12, 12, 1, 1);
    const rp = ridgeGeo.attributes.position;
    for (let i = 0; i < rp.count; i++) {
      const x = rp.getX(i);
      rp.setY(i, rp.getY(i) + Math.sin(x * 2) * 0.15 + 0.8);
    }
    ridgeGeo.computeVertexNormals();
    this.group.add(new THREE.Mesh(ridgeGeo, boneMat));

    // Eye sockets - deep dark voids with faint glow
    const socketMat = new THREE.MeshPhysicalMaterial({
      color: 0x000000, emissive: 0x330000, emissiveIntensity: 0.5,
      roughness: 1.0, metalness: 0,
    });
    for (const side of [-1, 1]) {
      const socketGeo = new THREE.SphereGeometry(0.22, 12, 12);
      const socket = new THREE.Mesh(socketGeo, socketMat);
      socket.position.set(1.0, 0.15, side * 0.4);
      this.group.add(socket);

      // Tiny ember in each socket
      const emberMat = new THREE.MeshPhysicalMaterial({
        color: 0xff2200, emissive: 0xff2200, emissiveIntensity: 3, roughness: 0,
      });
      const ember = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), emberMat);
      ember.position.set(1.0, 0.15, side * 0.4);
      this.group.add(ember);
    }

    this.eyeLight = new THREE.PointLight(0xff2200, 1, 12);
    this.eyeLight.position.set(1.0, 0.15, 0);
    this.group.add(this.eyeLight);

    // Jaw - hanging open
    const jawGeo = new THREE.SphereGeometry(0.5, 12, 8, 0, Math.PI * 2, Math.PI * 0.3, Math.PI * 0.5);
    jawGeo.scale(1.5, 0.6, 0.8);
    this.jawMesh = new THREE.Mesh(jawGeo, boneMat);
    this.jawMesh.position.set(0.6, -0.6, 0);
    this.group.add(this.jawMesh);

    // Trailing membrane tendrils from the back of skull
    const membraneMat = new THREE.MeshPhysicalMaterial({
      color: 0x180810, roughness: 0.25, metalness: 0.3,
      transparent: true, opacity: 0.4, side: THREE.DoubleSide,
      clearcoat: 0.5,
    });
    for (let i = 0; i < 5; i++) {
      const w = 0.3 + Math.random() * 0.5;
      const h = 3 + Math.random() * 4;
      const memGeo = new THREE.PlaneGeometry(w, h, 2, 8);
      const mp = memGeo.attributes.position;
      for (let v = 0; v < mp.count; v++) {
        const y = mp.getY(v);
        mp.setZ(v, Math.sin(y * 2 + i) * 0.2);
      }
      memGeo.computeVertexNormals();
      const mem = new THREE.Mesh(memGeo, membraneMat);
      mem.position.set(-1.5, -h * 0.3, (i - 2) * 0.3);
      mem.rotation.x = 0.2;
      this.group.add(mem);
    }

    this.group.scale.setScalar(1 + Math.random() * 1.5);
  }

  update(dt, playerPos) {
    this.time += dt;
    this.turnTimer += dt;

    if (this.turnTimer > this.turnInterval) {
      this.turnTimer = 0;
      this.turnInterval = 12 + Math.random() * 15;
      if (Math.random() < 0.4) {
        this.direction.subVectors(playerPos, this.group.position).normalize();
        this.direction.y *= 0.2;
      } else {
        this.direction.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.1, Math.random() - 0.5).normalize();
      }
    }

    this.group.position.add(this.direction.clone().multiplyScalar(this.speed * dt));
    this.group.position.y += Math.sin(this.time * 0.8 + this.bobPhase) * 0.3 * dt;

    // Slowly face forward
    const angle = Math.atan2(this.direction.x, this.direction.z);
    this.group.rotation.y = THREE.MathUtils.lerp(this.group.rotation.y, angle + Math.PI / 2, dt * 1);

    // Eerie rocking motion
    this.group.rotation.z = Math.sin(this.time * 0.5) * 0.08;
    this.group.rotation.x = Math.sin(this.time * 0.3) * 0.05;

    // Jaw sway
    this.jawMesh.rotation.x = Math.sin(this.time * 0.7) * 0.15 - 0.3;

    // Eye flicker
    this.eyeLight.intensity = 0.6 + Math.sin(this.time * 5) * 0.3 + Math.sin(this.time * 13) * 0.1;

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
