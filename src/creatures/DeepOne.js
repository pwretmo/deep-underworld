import * as THREE from 'three';

export class DeepOne {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.position.copy(position);

    this.scale = 8 + Math.random() * 12; // Massive - 8x to 20x player size
    this.group.scale.setScalar(this.scale);

    this._buildBody();
    this._buildTentacles();
    this._buildEyes();

    scene.add(this.group);

    // Movement - slow, ominous drifting
    this.speed = 1.5 + Math.random() * 1.5;
    this.direction = new THREE.Vector3(
      Math.random() - 0.5, Math.random() * 0.1 - 0.05, Math.random() - 0.5
    ).normalize();
    this.turnTimer = 0;
    this.turnInterval = 20 + Math.random() * 30;

    // Lurking behavior
    this.state = 'drift'; // drift, approach, loom
    this.loomTimer = 0;
    this.approachTarget = null;
    this._frameCount = 0;
  }

  _buildBody() {
    // Massive bulbous head/mantle
    const headGeo = new THREE.SphereGeometry(1.2, 16, 12);
    // Elongate and distort the head
    const positions = headGeo.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const y = positions.getY(i);
      const x = positions.getX(i);
      const z = positions.getZ(i);
      // Make it taller and slightly irregular
      positions.setY(i, y * 1.8 + Math.sin(x * 3 + z * 2) * 0.15);
      positions.setX(i, x * (1 + Math.sin(y * 2) * 0.2));
      positions.setZ(i, z * (1 + Math.cos(y * 3) * 0.15));
    }
    headGeo.computeVertexNormals();

    const headMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a2e,
      roughness: 0.9,
      metalness: 0.1,
      emissive: 0x203858,
      emissiveIntensity: 0.6,
    });
    this.head = new THREE.Mesh(headGeo, headMat);
    this.head.position.y = 1.5;
    this.group.add(this.head);

    // Body/torso - larger lower mass
    const bodyGeo = new THREE.SphereGeometry(1, 12, 10);
    const bodyPos = bodyGeo.attributes.position;
    for (let i = 0; i < bodyPos.count; i++) {
      const y = bodyPos.getY(i);
      // Taper toward bottom, widen at top to connect to head
      const widthFactor = y > 0 ? 1.2 : 0.7 + y * 0.3;
      bodyPos.setX(i, bodyPos.getX(i) * widthFactor);
      bodyPos.setZ(i, bodyPos.getZ(i) * widthFactor);
    }
    bodyGeo.computeVertexNormals();

    const body = new THREE.Mesh(bodyGeo, headMat);
    body.position.y = 0;
    this.group.add(body);

    // Wing-like fins on the sides
    for (let side = -1; side <= 1; side += 2) {
      const finShape = new THREE.Shape();
      finShape.moveTo(0, 0);
      finShape.bezierCurveTo(0.5 * side, 0.3, 1.5 * side, 0.1, 2 * side, -0.5);
      finShape.bezierCurveTo(1.2 * side, -0.2, 0.4 * side, -0.1, 0, 0);

      const finGeo = new THREE.ShapeGeometry(finShape, 8);
      const fin = new THREE.Mesh(finGeo, new THREE.MeshStandardMaterial({
        color: 0x1a1a38,
        roughness: 0.95,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.8,
        emissive: 0x203858,
        emissiveIntensity: 0.3,
      }));
      fin.position.set(side * 0.8, 0.5, 0);
      fin.rotation.z = side * 0.3;
      this.group.add(fin);
    }
  }

  _buildTentacles() {
    this.tentacles = [];
    const tentacleCount = 8 + Math.floor(Math.random() * 5);

    for (let i = 0; i < tentacleCount; i++) {
      const angle = (i / tentacleCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
      const radius = 0.5 + Math.random() * 0.4;
      const length = 3 + Math.random() * 5; // Very long tentacles
      const segments = 20;

      const points = [];
      for (let j = 0; j <= segments; j++) {
        const t = j / segments;
        points.push(new THREE.Vector3(
          Math.cos(angle) * radius * (1 - t * 0.5),
          -t * length,
          Math.sin(angle) * radius * (1 - t * 0.5)
        ));
      }

      const curve = new THREE.CatmullRomCurve3(points);
      const tubeGeo = new THREE.TubeGeometry(curve, segments, 0.12 * (1 - 0), 6, false);

      // Taper the tentacle by modifying vertex positions
      const pos = tubeGeo.attributes.position;
      for (let j = 0; j < pos.count; j++) {
        const y = pos.getY(j);
        const taper = Math.max(0.1, 1 - Math.abs(y) / length * 0.8);
        // Only taper the radius (x and z relative to curve center)
        pos.setX(j, pos.getX(j) * taper);
        pos.setZ(j, pos.getZ(j) * taper);
      }

      const tentacleMat = new THREE.MeshStandardMaterial({
        color: 0x1a1a30,
        roughness: 0.85,
        metalness: 0.05,
        emissive: 0x203858,
        emissiveIntensity: 0.5,
      });

      const tentacle = new THREE.Mesh(tubeGeo, tentacleMat);
      tentacle.position.y = -0.5;
      this.group.add(tentacle);

      this.tentacles.push({
        mesh: tentacle,
        basePoints: points.map(p => p.clone()),
        curve,
        segments,
        length,
        angle,
        phaseOffset: Math.random() * Math.PI * 2,
        swaySpeed: 0.3 + Math.random() * 0.4,
        swayAmount: 0.3 + Math.random() * 0.3,
      });
    }
  }

  _buildEyes() {
    // Multiple dim, unsettling eyes
    const eyePositions = [
      { x: 0.5, y: 2.0, z: 0.9 },
      { x: -0.5, y: 2.0, z: 0.9 },
      { x: 0.3, y: 2.4, z: 0.7 },
      { x: -0.3, y: 2.4, z: 0.7 },
    ];

    const eyeMat = new THREE.MeshStandardMaterial({
      color: 0x330000,
      emissive: 0x440000,
      emissiveIntensity: 2,
    });

    for (const pos of eyePositions) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), eyeMat);
      eye.position.set(pos.x, pos.y, pos.z);
      this.group.add(eye);
    }

    // Faint red glow from face area
    this.eyeLight = new THREE.PointLight(0x330000, 0.5, 4 * this.scale);
    this.eyeLight.position.set(0, 2.0, 0.8);
    this.group.add(this.eyeLight);
  }

  update(dt, playerPos) {
    const time = performance.now() * 0.001;
    this.turnTimer += dt;

    const distToPlayer = this.group.position.distanceTo(playerPos);

    // State transitions
    if (this.state === 'drift') {
      if (distToPlayer < 80 * this.scale * 0.1 && Math.random() < 0.005) {
        this.state = 'approach';
        this.approachTarget = playerPos.clone();
      }
    } else if (this.state === 'approach') {
      if (distToPlayer < 30 * this.scale * 0.1) {
        this.state = 'loom';
        this.loomTimer = 0;
      }
      if (distToPlayer > 120 * this.scale * 0.1) {
        this.state = 'drift';
      }
    } else if (this.state === 'loom') {
      this.loomTimer += dt;
      if (this.loomTimer > 20) {
        this.state = 'drift';
        this.direction = new THREE.Vector3(
          Math.random() - 0.5, Math.random() * 0.1 - 0.05, Math.random() - 0.5
        ).normalize();
      }
    }

    // Movement based on state
    if (this.state === 'drift') {
      if (this.turnTimer > this.turnInterval) {
        this.turnTimer = 0;
        this.turnInterval = 20 + Math.random() * 30;
        this.direction.lerp(
          new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.1 - 0.05, Math.random() - 0.5).normalize(),
          0.3
        ).normalize();
      }
      this.group.position.add(this.direction.clone().multiplyScalar(this.speed * dt));
    } else if (this.state === 'approach') {
      const toPlayer = playerPos.clone().sub(this.group.position).normalize();
      this.direction.lerp(toPlayer, 0.02).normalize();
      this.group.position.add(this.direction.clone().multiplyScalar(this.speed * 0.7 * dt));
    } else if (this.state === 'loom') {
      // Slowly orbit near the player
      const offset = this.group.position.clone().sub(playerPos);
      const orbitAngle = Math.atan2(offset.z, offset.x) + dt * 0.05;
      const orbitDist = 20 + Math.sin(this.loomTimer * 0.2) * 10;
      this.group.position.x = playerPos.x + Math.cos(orbitAngle) * orbitDist;
      this.group.position.z = playerPos.z + Math.sin(orbitAngle) * orbitDist;
      this.group.position.y += (playerPos.y - 15 - this.group.position.y) * dt * 0.3;
    }

    // Slowly rotate to face movement direction
    const targetQuat = new THREE.Quaternion();
    const lookDir = this.state === 'loom'
      ? playerPos.clone().sub(this.group.position).normalize()
      : this.direction;
    const lookMat = new THREE.Matrix4().lookAt(
      new THREE.Vector3(), lookDir, new THREE.Vector3(0, 1, 0)
    );
    targetQuat.setFromRotationMatrix(lookMat);
    this.group.quaternion.slerp(targetQuat, dt * 0.3);

    // Animate tentacles with organic sway (throttled to reduce GC)
    this._frameCount++;
    if (this._frameCount % 6 === 0) {
      for (const t of this.tentacles) {
        const newPoints = [];
        for (let j = 0; j <= t.segments; j++) {
          const frac = j / t.segments;
          const base = t.basePoints[j];
          const swayX = Math.sin(time * t.swaySpeed + frac * 3 + t.phaseOffset) * t.swayAmount * frac;
          const swayZ = Math.cos(time * t.swaySpeed * 0.7 + frac * 2.5 + t.phaseOffset) * t.swayAmount * frac * 0.8;
          const curlingY = Math.sin(time * 0.2 + t.phaseOffset) * 0.3 * frac * frac;
          newPoints.push(new THREE.Vector3(
            base.x + swayX,
            base.y + curlingY,
            base.z + swayZ
          ));
        }

        const newCurve = new THREE.CatmullRomCurve3(newPoints);
        const newGeo = new THREE.TubeGeometry(newCurve, t.segments, 0.12, 6, false);
        // Taper
        const pos = newGeo.attributes.position;
        for (let j = 0; j < pos.count; j++) {
          const y = pos.getY(j);
          const taper = Math.max(0.1, 1 - Math.abs(y) / t.length * 0.8);
          pos.setX(j, pos.getX(j) * taper);
          pos.setZ(j, pos.getZ(j) * taper);
        }
        t.mesh.geometry.dispose();
        t.mesh.geometry = newGeo;
      }
    }

    // Eye glow flicker
    this.eyeLight.intensity = 0.3 + Math.sin(time * 0.5) * 0.2;

    // Respawn far away if player leaves
    if (distToPlayer > 300) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 100 + Math.random() * 80;
      this.group.position.set(
        playerPos.x + Math.cos(angle) * dist,
        playerPos.y - 20 - Math.random() * 40,
        playerPos.z + Math.sin(angle) * dist
      );
      this.state = 'drift';
    }
  }

  getPosition() {
    return this.group.position.clone();
  }

  dispose() {
    this.group.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
    this.scene.remove(this.group);
  }
}
