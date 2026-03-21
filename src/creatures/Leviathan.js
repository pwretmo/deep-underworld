import * as THREE from 'three';

export class Leviathan {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time = Math.random() * 100;
    this.orbitCenter = position.clone();
    this.orbitRadius = 80 + Math.random() * 60;
    this.orbitSpeed = 0.05 + Math.random() * 0.03;
    this.orbitAngle = Math.random() * Math.PI * 2;
    this.verticalAmplitude = 20 + Math.random() * 20;
    this.passing = false;
    this.passTimer = 0;

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  _buildModel() {
    const segmentCount = 20;
    const totalLength = 40;
    const segLen = totalLength / segmentCount;

    this.segments = [];

    // Giger biomechanical wet-black material
    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: 0x080610,
      roughness: 0.25,
      metalness: 0.6,
      clearcoat: 1.0,
      clearcoatRoughness: 0.15,
    });
    const boneMat = new THREE.MeshPhysicalMaterial({
      color: 0x2a2218,
      roughness: 0.35,
      metalness: 0.4,
      clearcoat: 0.8,
      clearcoatRoughness: 0.2,
    });
    const fleshMat = new THREE.MeshPhysicalMaterial({
      color: 0x1a0818,
      roughness: 0.3,
      metalness: 0.3,
      clearcoat: 0.9,
      clearcoatRoughness: 0.1,
      emissive: 0x0a0008,
      emissiveIntensity: 0.1,
    });

    // Head - elongated biomechanical skull
    const headGeo = new THREE.SphereGeometry(3, 24, 18);
    headGeo.scale(2.5, 0.8, 0.9);
    const hPos = headGeo.attributes.position;
    for (let i = 0; i < hPos.count; i++) {
      const x = hPos.getX(i), y = hPos.getY(i), z = hPos.getZ(i);
      // Giger ridges along the top
      const ridge = Math.abs(z) < 0.5 ? Math.sin(x * 2) * 0.3 : 0;
      hPos.setY(i, y + ridge + Math.sin(x * 4 + z * 3) * 0.08);
    }
    headGeo.computeVertexNormals();
    const head = new THREE.Mesh(headGeo, bodyMat);
    this.group.add(head);
    this.segments.push(head);

    // Cranial ridge - exposed spinal crest on skull
    const ridgeGeo = new THREE.BoxGeometry(8, 0.4, 0.15, 20, 1, 1);
    const rPos = ridgeGeo.attributes.position;
    for (let i = 0; i < rPos.count; i++) {
      const x = rPos.getX(i), y = rPos.getY(i);
      rPos.setY(i, y + Math.sin(x * 1.5) * 0.3 + 0.6);
    }
    ridgeGeo.computeVertexNormals();
    const ridge = new THREE.Mesh(ridgeGeo, boneMat);
    ridge.position.set(-1, 0.5, 0);
    this.group.add(ridge);

    // Massive biomechanical jaw with hydraulic hinges
    const jawGeo = new THREE.ConeGeometry(2.5, 5, 16);
    const jPos = jawGeo.attributes.position;
    for (let i = 0; i < jPos.count; i++) {
      const y = jPos.getY(i);
      if (y < 0) jPos.setX(i, jPos.getX(i) * (1 + Math.sin(y * 4) * 0.15));
    }
    jawGeo.computeVertexNormals();
    this.jaw = new THREE.Mesh(jawGeo, bodyMat);
    this.jaw.position.set(5, -1, 0);
    this.jaw.rotation.z = Math.PI / 2 + 0.3;
    this.group.add(this.jaw);

    // Jaw hydraulic pistons
    for (const side of [-1, 1]) {
      const pistonGeo = new THREE.CylinderGeometry(0.12, 0.08, 2.5, 8);
      const piston = new THREE.Mesh(pistonGeo, boneMat);
      piston.position.set(3.5, -0.3, side * 1.8);
      piston.rotation.z = 0.6 * side;
      this.group.add(piston);
    }

    // Teeth - metallic biomechanical fangs
    const toothGeo = new THREE.ConeGeometry(0.08, 0.6, 6);
    const toothMat = new THREE.MeshPhysicalMaterial({
      color: 0xbba880,
      roughness: 0.15,
      metalness: 0.7,
      clearcoat: 1.0,
    });
    for (let i = 0; i < 18; i++) {
      const angle = (i / 18) * Math.PI;
      const tooth = new THREE.Mesh(toothGeo, toothMat);
      tooth.position.set(
        4.5 + Math.cos(angle) * 1.5,
        -0.5 + Math.sin(angle) * 1.2,
        Math.cos(angle * 3) * 1.5
      );
      tooth.rotation.z = Math.PI + (Math.random() - 0.5) * 0.2;
      tooth.scale.y = 0.8 + Math.random() * 0.8;
      this.group.add(tooth);
    }

    // Glowing eyes - slit pupils
    const eyeGeo = new THREE.SphereGeometry(0.5, 16, 16);
    eyeGeo.scale(1, 0.5, 1);
    const eyeMat = new THREE.MeshPhysicalMaterial({
      color: 0xff2200,
      emissive: 0xff2200,
      emissiveIntensity: 3,
      roughness: 0.0,
      clearcoat: 1.0,
    });
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(3, 1.2, 2);
    this.group.add(leftEye);
    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(3, 1.2, -2);
    this.group.add(rightEye);

    this.eyeLight = new THREE.PointLight(0xff2200, 2, 30);
    this.eyeLight.position.set(3, 1.2, 0);
    this.group.add(this.eyeLight);

    // Body segments - biomechanical with exposed ribs & pipes
    for (let i = 1; i < segmentCount; i++) {
      const t = i / segmentCount;
      const radius = THREE.MathUtils.lerp(2.8, 0.3, t);
      const geo = new THREE.SphereGeometry(radius, 16, 12);
      geo.scale(1.5, 1, 1);
      const vPos = geo.attributes.position;
      for (let v = 0; v < vPos.count; v++) {
        const x = vPos.getX(v), y = vPos.getY(v), z = vPos.getZ(v);
        // Mechanical ribbing
        const ribbing = Math.sin(x * 8) * 0.05 * radius;
        vPos.setY(v, y + ribbing);
      }
      geo.computeVertexNormals();
      const seg = new THREE.Mesh(geo, bodyMat);
      seg.position.set(-i * segLen * 0.5, 0, 0);
      this.group.add(seg);
      this.segments.push(seg);

      // Exposed spinal vertebrae on top
      if (i % 2 === 0 && t < 0.85) {
        const vertGeo = new THREE.BoxGeometry(0.3, radius * 0.5, 0.4, 1, 1, 1);
        const vert = new THREE.Mesh(vertGeo, boneMat);
        vert.position.set(-i * segLen * 0.5, radius * 0.85, 0);
        this.group.add(vert);
      }

      // Dorsal spines - elongated biomechanical
      if (i % 3 === 0 && t < 0.7) {
        const spineGeo = new THREE.ConeGeometry(0.12, radius * 2, 6);
        const spine = new THREE.Mesh(spineGeo, boneMat);
        spine.position.set(-i * segLen * 0.5, radius * 1.1, 0);
        this.group.add(spine);
      }

      // Lateral pipes running along body
      if (i % 2 === 0 && t < 0.8) {
        for (const side of [-1, 1]) {
          const pipeGeo = new THREE.CylinderGeometry(0.08, 0.08, segLen * 0.6, 6);
          pipeGeo.rotateZ(Math.PI / 2);
          const pipe = new THREE.Mesh(pipeGeo, fleshMat);
          pipe.position.set(-i * segLen * 0.5, radius * 0.3, side * radius * 0.9);
          this.group.add(pipe);
        }
      }

      // Bioluminescent slits along body
      if (i % 3 === 0) {
        const slitGeo = new THREE.PlaneGeometry(0.6, 0.15);
        const slitMat = new THREE.MeshPhysicalMaterial({
          color: 0x6622ff,
          emissive: 0x6622ff,
          emissiveIntensity: 1.5,
          transparent: true,
          opacity: 0.8,
          side: THREE.DoubleSide,
        });
        for (const side of [-1, 1]) {
          const slit = new THREE.Mesh(slitGeo, slitMat);
          slit.position.set(-i * segLen * 0.5, 0, side * (radius + 0.01));
          slit.rotation.y = Math.PI / 2;
          this.group.add(slit);
        }

        if (i % 6 === 0) {
          const glow = new THREE.PointLight(0x6622ff, 0.8, 15);
          glow.position.set(-i * segLen * 0.5, 0, 0);
          this.group.add(glow);
        }
      }

      // Exposed rib arches on select segments
      if (i % 5 === 0 && t < 0.6) {
        for (const side of [-1, 1]) {
          const ribCurve = new THREE.QuadraticBezierCurve3(
            new THREE.Vector3(0, radius * 0.8, 0),
            new THREE.Vector3(0, radius * 1.2, side * radius * 0.8),
            new THREE.Vector3(0, 0, side * radius)
          );
          const ribGeo = new THREE.TubeGeometry(ribCurve, 8, 0.06, 6, false);
          const rib = new THREE.Mesh(ribGeo, boneMat);
          rib.position.set(-i * segLen * 0.5, 0, 0);
          this.group.add(rib);
        }
      }
    }

    // Tail - segmented biomechanical blade
    const tailGeo = new THREE.PlaneGeometry(5, 7, 6, 6);
    const tPos = tailGeo.attributes.position;
    for (let i = 0; i < tPos.count; i++) {
      const x = tPos.getX(i), y = tPos.getY(i);
      tPos.setZ(i, Math.sin(x * 2 + y) * 0.3);
    }
    tailGeo.computeVertexNormals();
    const tailMat = new THREE.MeshPhysicalMaterial({
      color: 0x080610,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.7,
      roughness: 0.3,
      metalness: 0.5,
      clearcoat: 0.6,
    });
    const tail = new THREE.Mesh(tailGeo, tailMat);
    tail.position.set(-segmentCount * segLen * 0.5 - 2, 0, 0);
    tail.rotation.y = Math.PI / 2;
    this.group.add(tail);

    this.group.scale.setScalar(1.5 + Math.random() * 1.5);
  }

  update(dt, playerPos) {
    this.time += dt;

    // Orbit in the deep
    this.orbitAngle += this.orbitSpeed * dt;
    const targetX = this.orbitCenter.x + Math.cos(this.orbitAngle) * this.orbitRadius;
    const targetZ = this.orbitCenter.z + Math.sin(this.orbitAngle) * this.orbitRadius;
    const targetY = this.orbitCenter.y + Math.sin(this.time * 0.2) * this.verticalAmplitude;

    this.group.position.set(targetX, targetY, targetZ);

    // Face movement direction
    const nextX = this.orbitCenter.x + Math.cos(this.orbitAngle + 0.1) * this.orbitRadius;
    const nextZ = this.orbitCenter.z + Math.sin(this.orbitAngle + 0.1) * this.orbitRadius;
    const angle = Math.atan2(nextX - targetX, nextZ - targetZ);
    this.group.rotation.y = angle + Math.PI / 2;

    // Undulate body segments
    for (let i = 1; i < this.segments.length; i++) {
      const seg = this.segments[i];
      const phase = this.time * 1.5 - i * 0.3;
      seg.position.z = Math.sin(phase) * i * 0.15;
      seg.position.y = Math.cos(phase * 0.7) * i * 0.08;
    }

    // Eye glow pulsing
    this.eyeLight.intensity = 2 + Math.sin(this.time * 2) * 0.5;

    // Jaw movement
    if (this.jaw) {
      this.jaw.rotation.z = Math.PI / 2 + 0.3 + Math.sin(this.time * 1.5) * 0.1;
    }

    // Occasional close pass near player
    const distToPlayer = this.group.position.distanceTo(playerPos);
    if (!this.passing && distToPlayer > 100 && Math.random() < 0.001) {
      this.passing = true;
      this.passTimer = 0;
      this.orbitCenter.copy(playerPos).add(new THREE.Vector3(0, -20, 0));
      this.orbitRadius = 25 + Math.random() * 20;
    }
    if (this.passing) {
      this.passTimer += dt;
      if (this.passTimer > 15) {
        this.passing = false;
        this.orbitCenter.set(
          playerPos.x + (Math.random() - 0.5) * 200,
          playerPos.y - 50 - Math.random() * 100,
          playerPos.z + (Math.random() - 0.5) * 200
        );
        this.orbitRadius = 80 + Math.random() * 60;
      }
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
