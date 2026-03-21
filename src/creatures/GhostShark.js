import * as THREE from 'three';

export class GhostShark {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time = Math.random() * 100;
    this.speed = 4 + Math.random() * 3;
    this.direction = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    this.turnTimer = 0;
    this.turnInterval = 5 + Math.random() * 10;

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  _buildModel() {
    // Giger materials
    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: 0x0a0a14,
      roughness: 0.2,
      metalness: 0.3,
      transparent: true,
      opacity: 0.75,
      clearcoat: 1.0,
      clearcoatRoughness: 0.1,
    });
    const boneMat = new THREE.MeshPhysicalMaterial({
      color: 0x2a2218,
      roughness: 0.3,
      metalness: 0.2,
      clearcoat: 0.8,
      clearcoatRoughness: 0.2,
    });
    const metalMat = new THREE.MeshPhysicalMaterial({
      color: 0x151515,
      roughness: 0.12,
      metalness: 0.9,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
    });

    // Streamlined body with biomechanical ribbing
    const bodyGeo = new THREE.SphereGeometry(1, 32, 24);
    bodyGeo.scale(2.5, 0.7, 0.8);
    const bPos = bodyGeo.attributes.position;
    for (let i = 0; i < bPos.count; i++) {
      const x = bPos.getX(i), y = bPos.getY(i), z = bPos.getZ(i);
      // Mechanical rib grooves along length
      const rib = Math.sin(x * 10) * 0.02;
      const panel = Math.sin(x * 18 + z * 15) * 0.008;
      const r = Math.sqrt(x * x + y * y + z * z) || 1;
      bPos.setX(i, x + x / r * (rib + panel));
      bPos.setY(i, y + y / r * (rib + panel));
      bPos.setZ(i, z + z / r * (rib + panel));
    }
    bodyGeo.computeVertexNormals();
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    this.group.add(body);

    // Exposed cranial structure – elongated snout
    const snoutGeo = new THREE.ConeGeometry(0.45, 1.6, 20);
    snoutGeo.rotateZ(-Math.PI / 2);
    const snout = new THREE.Mesh(snoutGeo, bodyMat);
    snout.position.set(2.3, 0, 0);
    this.group.add(snout);

    // Cranial ridge along top of head
    for (let i = 0; i < 6; i++) {
      const rGeo = new THREE.BoxGeometry(0.2, 0.08, 0.05);
      const r = new THREE.Mesh(rGeo, boneMat);
      r.position.set(2.0 - i * 0.35, 0.35 + Math.sin(i * 0.5) * 0.04, 0);
      this.group.add(r);
    }

    // Exposed spinal vertebrae running entire back
    for (let i = 0; i < 12; i++) {
      const t = (i / 11) * 4 - 1.8;
      const vGeo = new THREE.BoxGeometry(0.07, 0.12, 0.06);
      const v = new THREE.Mesh(vGeo, boneMat);
      v.position.set(t, 0.6 + Math.sin(i * 0.4) * 0.04, 0);
      this.group.add(v);
    }

    // Lateral pipes
    for (const side of [-1, 1]) {
      const pipeCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-1.8, 0, side * 0.65),
        new THREE.Vector3(-0.5, 0.1, side * 0.78),
        new THREE.Vector3(0.8, 0.08, side * 0.7),
        new THREE.Vector3(1.8, -0.05, side * 0.4),
      ]);
      const pipeGeo = new THREE.TubeGeometry(pipeCurve, 12, 0.03, 6, false);
      this.group.add(new THREE.Mesh(pipeGeo, metalMat));
    }

    // Ghostly slit eyes with ethereal glow
    const eyeGeo = new THREE.SphereGeometry(0.2, 24, 24);
    eyeGeo.scale(1, 0.35, 1);
    const eyeMat = new THREE.MeshPhysicalMaterial({
      color: 0x66ffaa,
      emissive: 0x66ffaa,
      emissiveIntensity: 1.5,
      roughness: 0.05,
      clearcoat: 1.0,
    });
    for (const side of [-1, 1]) {
      // Recessed socket
      const socketGeo = new THREE.SphereGeometry(0.28, 12, 12);
      const socket = new THREE.Mesh(socketGeo, new THREE.MeshPhysicalMaterial({
        color: 0x030303, roughness: 0.9, metalness: 0.1,
      }));
      socket.position.set(1.5, 0.28, side * 0.5);
      this.group.add(socket);
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(1.52, 0.28, side * 0.5);
      this.group.add(eye);
    }

    // Biomechanical dorsal fin with exposed struts
    const finGeo = new THREE.PlaneGeometry(1.2, 1.4, 6, 6);
    const finMat = new THREE.MeshPhysicalMaterial({
      color: 0x0a0a14,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.55,
      roughness: 0.3,
      clearcoat: 0.6,
    });
    const dorsal = new THREE.Mesh(finGeo, finMat);
    dorsal.position.set(0, 1.1, 0);
    dorsal.rotation.z = -0.2;
    this.group.add(dorsal);

    // Dorsal fin struts (exposed skeleton)
    for (let i = 0; i < 4; i++) {
      const strutGeo = new THREE.CylinderGeometry(0.015, 0.01, 1.0 - i * 0.15, 4);
      const strut = new THREE.Mesh(strutGeo, boneMat);
      strut.position.set(-0.3 + i * 0.3, 0.7 + i * 0.08, 0);
      strut.rotation.z = -0.2 + i * 0.05;
      this.group.add(strut);
    }

    // Pectoral fins with mechanical tendons
    for (const side of [-1, 1]) {
      const pGeo = new THREE.PlaneGeometry(1.6, 0.5, 4, 4);
      const pFin = new THREE.Mesh(pGeo, finMat);
      pFin.position.set(0.5, -0.2, side * 0.8);
      pFin.rotation.x = side * 0.3;
      pFin.rotation.z = side * 0.4;
      this.group.add(pFin);
      // Mechanical tendon line
      const tendonGeo = new THREE.CylinderGeometry(0.012, 0.012, 1.4, 4);
      const tendon = new THREE.Mesh(tendonGeo, metalMat);
      tendon.position.set(0.5, -0.22, side * 0.82);
      tendon.rotation.z = side * 0.4;
      this.group.add(tendon);
    }

    // Segmented tail with vertebrae
    const tailSegments = [];
    for (let i = 0; i < 8; i++) {
      const segGeo = new THREE.CylinderGeometry(
        0.18 - i * 0.018, 0.16 - i * 0.016, 0.6, 8
      );
      segGeo.rotateZ(Math.PI / 2);
      const seg = new THREE.Mesh(segGeo, i % 2 === 0 ? bodyMat : metalMat);
      seg.position.set(-2.0 - i * 0.55, Math.sin(i * 0.4) * 0.08, 0);
      this.group.add(seg);
      tailSegments.push(seg);
    }
    // Tail blade
    const bladeGeo = new THREE.ConeGeometry(0.15, 0.6, 4);
    bladeGeo.rotateZ(Math.PI / 2);
    const blade = new THREE.Mesh(bladeGeo, metalMat);
    blade.position.set(-6.3, 0, 0);
    this.group.add(blade);
    this.tailSegments = tailSegments;

    // Ethereal glow
    this.glow = new THREE.PointLight(0x66ffaa, 0.6, 18);
    this.group.add(this.glow);

    const scale = 1 + Math.random() * 0.8;
    this.group.scale.setScalar(scale);
  }

  update(dt, playerPos) {
    this.time += dt;
    this.turnTimer += dt;

    // Change direction periodically
    if (this.turnTimer > this.turnInterval) {
      this.turnTimer = 0;
      this.turnInterval = 5 + Math.random() * 10;

      // Sometimes head toward player
      if (Math.random() < 0.3) {
        this.direction.subVectors(playerPos, this.group.position).normalize();
        this.direction.y *= 0.3;
      } else {
        this.direction.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.2, Math.random() - 0.5).normalize();
      }
    }

    // Move
    this.group.position.add(this.direction.clone().multiplyScalar(this.speed * dt));

    // Face direction
    const angle = Math.atan2(this.direction.x, this.direction.z);
    this.group.rotation.y = THREE.MathUtils.lerp(this.group.rotation.y, angle + Math.PI / 2, dt * 2);

    // Body undulation
    this.group.rotation.z = Math.sin(this.time * 2) * 0.05;

    // Ghostly flicker
    this.glow.intensity = 0.3 + Math.sin(this.time * 3) * 0.2;

    // Respawn if too far
    const dist = this.group.position.distanceTo(playerPos);
    if (dist > 200) {
      const angle2 = Math.random() * Math.PI * 2;
      this.group.position.set(
        playerPos.x + Math.cos(angle2) * 80,
        playerPos.y + (Math.random() - 0.5) * 20,
        playerPos.z + Math.sin(angle2) * 80
      );
    }
  }

  getPosition() { return this.group.position; }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
  }
}
