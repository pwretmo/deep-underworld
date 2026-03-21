import * as THREE from 'three';

export class Anglerfish {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.alive = true;
    this.state = 'patrol'; // patrol, alert, chase
    this.speed = 3;
    this.alertDistance = 30;
    this.chaseDistance = 20;
    this.time = Math.random() * 100;
    this.patrolCenter = position.clone();
    this.patrolRadius = 15 + Math.random() * 15;
    this.patrolAngle = Math.random() * Math.PI * 2;
    this.verticalOffset = 0;

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  _buildModel() {
    // Shared Giger materials
    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: 0x080610,
      roughness: 0.25,
      metalness: 0.35,
      clearcoat: 1.0,
      clearcoatRoughness: 0.15,
    });
    const boneMat = new THREE.MeshPhysicalMaterial({
      color: 0x2a2218,
      roughness: 0.3,
      metalness: 0.2,
      clearcoat: 0.8,
      clearcoatRoughness: 0.2,
    });
    const metalMat = new THREE.MeshPhysicalMaterial({
      color: 0x181818,
      roughness: 0.15,
      metalness: 0.9,
      clearcoat: 1.0,
      clearcoatRoughness: 0.1,
    });
    const fleshMat = new THREE.MeshPhysicalMaterial({
      color: 0x1a0818,
      roughness: 0.35,
      metalness: 0.15,
      clearcoat: 0.9,
      clearcoatRoughness: 0.2,
    });

    // Body - biomechanical elongated mass with rib deformation
    const bodyGeo = new THREE.SphereGeometry(1, 32, 24);
    bodyGeo.scale(1.6, 0.75, 0.95);
    const bPos = bodyGeo.attributes.position;
    for (let i = 0; i < bPos.count; i++) {
      const x = bPos.getX(i), y = bPos.getY(i), z = bPos.getZ(i);
      // Mechanical ribbing grooves
      const rib = Math.sin(x * 12) * 0.025;
      // Giger panel-line texture
      const panel = Math.sin(x * 20 + z * 20) * 0.01;
      const r = Math.sqrt(x * x + y * y + z * z);
      bPos.setX(i, x + x / r * (rib + panel));
      bPos.setY(i, y + y / r * (rib + panel));
      bPos.setZ(i, z + z / r * (rib + panel));
    }
    bodyGeo.computeVertexNormals();
    this.body = new THREE.Mesh(bodyGeo, bodyMat);
    this.group.add(this.body);

    // Exposed dorsal spine ridge
    for (let i = 0; i < 8; i++) {
      const t = (i / 7) * 2.2 - 1.1;
      const vertGeo = new THREE.BoxGeometry(0.08, 0.18 + Math.sin(i * 0.6) * 0.06, 0.06);
      const vert = new THREE.Mesh(vertGeo, boneMat);
      vert.position.set(t, 0.7 + Math.sin(i * 0.8) * 0.05, 0);
      this.group.add(vert);
    }

    // Lateral pipes running along body
    for (const side of [-1, 1]) {
      const pipeCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-1.2, 0.1, side * 0.7),
        new THREE.Vector3(-0.3, 0.2, side * 0.85),
        new THREE.Vector3(0.5, 0.15, side * 0.8),
        new THREE.Vector3(1.2, 0, side * 0.55),
      ]);
      const pipeGeo = new THREE.TubeGeometry(pipeCurve, 12, 0.035, 6, false);
      this.group.add(new THREE.Mesh(pipeGeo, metalMat));
    }

    // Exposed rib arches (ventral)
    for (let i = 0; i < 5; i++) {
      const xPos = -0.6 + i * 0.35;
      for (const side of [-1, 1]) {
        const ribCurve = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(xPos, 0.3, 0),
          new THREE.Vector3(xPos, -0.5, side * 0.6),
          new THREE.Vector3(xPos, -0.15, side * 0.2)
        );
        const ribGeo = new THREE.TubeGeometry(ribCurve, 8, 0.025, 4, false);
        this.group.add(new THREE.Mesh(ribGeo, boneMat));
      }
    }

    // Jaw (lower) - biomechanical with hydraulic hinge
    const jawGeo = new THREE.ConeGeometry(0.55, 1.1, 16);
    this.jaw = new THREE.Mesh(jawGeo, bodyMat);
    this.jaw.position.set(1.2, -0.3, 0);
    this.jaw.rotation.z = Math.PI / 2 + 0.4;
    this.group.add(this.jaw);

    // Hydraulic jaw pistons
    for (const side of [-1, 1]) {
      const pistonGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.5, 6);
      const piston = new THREE.Mesh(pistonGeo, metalMat);
      piston.position.set(0.9, -0.1, side * 0.35);
      piston.rotation.z = 0.6;
      this.group.add(piston);
    }

    // Metallic fangs
    const toothGeo = new THREE.ConeGeometry(0.035, 0.3, 6);
    const toothMat = new THREE.MeshPhysicalMaterial({
      color: 0xddddc8,
      roughness: 0.15,
      metalness: 0.6,
      clearcoat: 1.0,
      clearcoatRoughness: 0.1,
    });
    for (let i = 0; i < 14; i++) {
      const angle = (i / 14) * Math.PI;
      const tooth = new THREE.Mesh(toothGeo, toothMat);
      tooth.position.set(
        1.0 + Math.cos(angle) * 0.4,
        -0.1 + Math.sin(angle) * 0.3,
        Math.cos(angle * 2.5) * 0.3
      );
      tooth.rotation.z = Math.PI + (Math.random() - 0.5) * 0.3;
      tooth.scale.y = 0.8 + Math.random() * 0.7;
      this.group.add(tooth);
    }

    // Recessed slit eyes with ember glow
    const eyeGeo = new THREE.SphereGeometry(0.1, 16, 16);
    eyeGeo.scale(1, 0.4, 1);
    const eyeMat = new THREE.MeshPhysicalMaterial({
      color: 0xff1100,
      emissive: 0xff2200,
      emissiveIntensity: 1.2,
      roughness: 0.05,
      clearcoat: 1.0,
    });
    for (const side of [-1, 1]) {
      // Eye socket recess
      const socketGeo = new THREE.SphereGeometry(0.16, 12, 12);
      const socket = new THREE.Mesh(socketGeo, new THREE.MeshPhysicalMaterial({
        color: 0x050505, roughness: 0.9, metalness: 0.1,
      }));
      socket.position.set(0.85, 0.3, side * 0.42);
      this.group.add(socket);
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(0.87, 0.3, side * 0.42);
      this.group.add(eye);
    }

    // Lure - biomechanical segmented stalk
    this.lureStem = new THREE.Group();
    const stemCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.8, 0),
      new THREE.Vector3(0.5, 1.8, 0),
      new THREE.Vector3(1.2, 2.2, 0),
      new THREE.Vector3(1.8, 2.0, 0),
    ]);
    const stemGeo = new THREE.TubeGeometry(stemCurve, 12, 0.04, 6, false);
    this.lureStem.add(new THREE.Mesh(stemGeo, metalMat));

    // Joint rings along stalk
    for (let i = 1; i <= 4; i++) {
      const t = i / 5;
      const p = stemCurve.getPoint(t);
      const ringGeo = new THREE.TorusGeometry(0.06, 0.015, 6, 8);
      const ring = new THREE.Mesh(ringGeo, boneMat);
      ring.position.copy(p);
      this.lureStem.add(ring);
    }

    // Lure bulb – sickly organic sac
    const bulbGeo = new THREE.SphereGeometry(0.18, 24, 24);
    const bulbMat = new THREE.MeshPhysicalMaterial({
      color: 0x33ff88,
      emissive: 0x33ff88,
      emissiveIntensity: 2.0,
      transparent: true,
      opacity: 0.8,
      roughness: 0.1,
      transmission: 0.3,
      thickness: 0.3,
    });
    this.lureBulb = new THREE.Mesh(bulbGeo, bulbMat);
    this.lureBulb.position.set(1.8, 2.0, 0);
    this.lureStem.add(this.lureBulb);

    this.lureLight = new THREE.PointLight(0x33ff88, 3, 25);
    this.lureLight.position.copy(this.lureBulb.position);
    this.lureStem.add(this.lureLight);
    this.group.add(this.lureStem);

    // Biomechanical tail – segmented blade
    for (let i = 0; i < 5; i++) {
      const segGeo = new THREE.BoxGeometry(0.35, 0.15 - i * 0.02, 0.12 - i * 0.015);
      const seg = new THREE.Mesh(segGeo, i % 2 === 0 ? metalMat : fleshMat);
      seg.position.set(-1.5 - i * 0.32, 0, 0);
      this.group.add(seg);
    }
    // Tail blade
    const bladeGeo = new THREE.ConeGeometry(0.12, 0.5, 4);
    bladeGeo.rotateZ(Math.PI / 2);
    const blade = new THREE.Mesh(bladeGeo, metalMat);
    blade.position.set(-3.2, 0, 0);
    this.group.add(blade);

    // Overall scale
    this.group.scale.setScalar(1.5 + Math.random() * 1);
  }

  update(dt, playerPos) {
    this.time += dt;

    const toPlayer = new THREE.Vector3().subVectors(playerPos, this.group.position);
    const distToPlayer = toPlayer.length();

    // State machine
    if (this.state === 'patrol') {
      if (distToPlayer < this.alertDistance) {
        this.state = 'alert';
      }
      // Circular patrol
      this.patrolAngle += dt * 0.3;
      this.verticalOffset = Math.sin(this.time * 0.5) * 2;
      const targetX = this.patrolCenter.x + Math.cos(this.patrolAngle) * this.patrolRadius;
      const targetZ = this.patrolCenter.z + Math.sin(this.patrolAngle) * this.patrolRadius;
      const targetY = this.patrolCenter.y + this.verticalOffset;

      this.group.position.lerp(new THREE.Vector3(targetX, targetY, targetZ), dt * 0.5);
    } else if (this.state === 'alert') {
      if (distToPlayer < this.chaseDistance) {
        this.state = 'chase';
      } else if (distToPlayer > this.alertDistance * 1.5) {
        this.state = 'patrol';
      }
      // Face player, move slowly closer
      this.group.position.add(toPlayer.normalize().multiplyScalar(dt * 1));
    } else if (this.state === 'chase') {
      if (distToPlayer > this.chaseDistance * 2) {
        this.state = 'patrol';
        this.patrolCenter.copy(this.group.position);
      }
      // Rush toward player
      const chaseSpeed = 8 + Math.sin(this.time * 3) * 3;
      this.group.position.add(toPlayer.normalize().multiplyScalar(dt * chaseSpeed));
    }

    // Face movement direction
    const lookTarget = playerPos.clone();
    lookTarget.y = this.group.position.y + (lookTarget.y - this.group.position.y) * 0.3;
    const dir = new THREE.Vector3().subVectors(lookTarget, this.group.position).normalize();
    const angle = Math.atan2(dir.x, dir.z);
    this.group.rotation.y = THREE.MathUtils.lerp(
      this.group.rotation.y,
      angle + Math.PI / 2,
      dt * 2
    );

    // Animate jaw
    this.jaw.rotation.z = Math.PI / 2 + 0.4 + Math.sin(this.time * 2) * 0.15;

    // Lure flicker
    const flicker = 0.7 + Math.sin(this.time * 8) * 0.15 + Math.sin(this.time * 13) * 0.1;
    this.lureLight.intensity = this.state === 'chase' ? flicker * 5 : flicker * 3;
    this.lureBulb.material.emissiveIntensity = flicker * 1.5;

    // Sway lure
    this.lureBulb.position.x = 1.8 + Math.sin(this.time * 1.5) * 0.2;
    this.lureBulb.position.y = 2.0 + Math.cos(this.time * 1.2) * 0.15;
    this.lureLight.position.copy(this.lureBulb.position);
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
