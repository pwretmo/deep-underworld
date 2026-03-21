import * as THREE from 'three';

// Faceless humanoid - smooth featureless head, biomechanical limbs, uncanny floating presence
// Visual overhaul: improved silhouette, wet/organic materials, head tendrils, emissive veins
export class FacelessOne {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time = Math.random() * 100;
    this.speed = 0.5 + Math.random() * 0.3;
    this.direction = new THREE.Vector3(Math.random() - 0.5, -0.02, Math.random() - 0.5).normalize();
    this.turnTimer = 0;
    this.turnInterval = 15 + Math.random() * 15;
    this.arms = [];
    this.tendrils = [];
    this.veinMeshes = [];
    this.head = null;

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  _buildModel() {
    // --- Materials (reused across similar parts) ---
    const skinMat = new THREE.MeshPhysicalMaterial({
      color: 0x0a0810,
      roughness: 0.15,
      metalness: 0.3,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      emissive: 0x0c0618,
      emissiveIntensity: 0.6,
      sheen: 1.0,
      sheenColor: new THREE.Color(0x1a0a2e),
      sheenRoughness: 0.4,
      iridescence: 0.15,
      iridescenceIOR: 1.3,
    });
    const metalMat = new THREE.MeshPhysicalMaterial({
      color: 0x141414,
      roughness: 0.1,
      metalness: 0.9,
      clearcoat: 1.0,
      clearcoatRoughness: 0.03,
      emissive: 0x0a0412,
      emissiveIntensity: 0.4,
      sheen: 0.5,
      sheenColor: new THREE.Color(0x0a0818),
      sheenRoughness: 0.3,
    });
    const boneMat = new THREE.MeshPhysicalMaterial({
      color: 0x2a2218,
      roughness: 0.35,
      metalness: 0.4,
      clearcoat: 0.6,
      clearcoatRoughness: 0.15,
    });
    const tendrilMat = new THREE.MeshPhysicalMaterial({
      color: 0x0c0a14,
      roughness: 0.12,
      metalness: 0.25,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
      sheen: 1.0,
      sheenColor: new THREE.Color(0x1a0a2e),
      sheenRoughness: 0.3,
      iridescence: 0.2,
      iridescenceIOR: 1.3,
    });
    const veinMat = new THREE.MeshPhysicalMaterial({
      color: 0x1a0520,
      emissive: 0x2a0835,
      emissiveIntensity: 0.4,
      roughness: 0.3,
      metalness: 0.2,
      transparent: true,
      opacity: 0.7,
    });

    // --- Head - larger elongated teardrop, high-segment for smooth normals ---
    const headGeo = new THREE.SphereGeometry(0.6, 32, 24);
    headGeo.scale(0.75, 1.3, 0.8);
    // Forehead ridges via vertex displacement (sinusoidal along Y)
    const hp = headGeo.attributes.position;
    for (let i = 0; i < hp.count; i++) {
      const y = hp.getY(i);
      const x = hp.getX(i);
      const z = hp.getZ(i);
      if (y > 0.1) {
        const ridgeIntensity = Math.sin(y * 14) * 0.015 * Math.max(0, y);
        hp.setX(i, x + ridgeIntensity);
        hp.setZ(i, z + ridgeIntensity * 0.5);
      }
    }
    headGeo.computeVertexNormals();
    this.head = new THREE.Mesh(headGeo, skinMat);
    this.head.position.y = 2.9;
    this.group.add(this.head);

    // Cranial ridges / asymmetric horn-like protrusions for silhouette breaking
    const ridgeGeo = new THREE.ConeGeometry(0.04, 0.3, 6);
    const ridgePositions = [
      { pos: [0.15, 3.55, 0.2], rot: [0.3, 0, -0.2] },
      { pos: [-0.1, 3.5, -0.25], rot: [-0.25, 0, 0.15] },
      { pos: [0.05, 3.6, -0.1], rot: [-0.1, 0, 0.3] },
    ];
    for (const r of ridgePositions) {
      const ridge = new THREE.Mesh(ridgeGeo, boneMat);
      ridge.position.set(...r.pos);
      ridge.rotation.set(...r.rot);
      this.group.add(ridge);
    }

    // Faint slit where a mouth might be
    const slitGeo = new THREE.PlaneGeometry(0.18, 0.025);
    const slitMat2 = new THREE.MeshPhysicalMaterial({
      color: 0x000000, emissive: 0x330808, emissiveIntensity: 1.5,
      roughness: 1, side: THREE.DoubleSide,
    });
    const slit = new THREE.Mesh(slitGeo, slitMat2);
    slit.position.set(0.38, 2.6, 0);
    slit.rotation.y = Math.PI / 2;
    this.group.add(slit);

    // --- Jaw tendrils (CatmullRomCurve3 + TubeGeometry) ---
    const tendrilConfigs = [
      { origin: [0.3, 2.45, 0.12], length: 1.2, radius: 0.03, phase: 0 },
      { origin: [0.3, 2.45, -0.12], length: 1.4, radius: 0.025, phase: 1.2 },
      { origin: [0.25, 2.4, 0.22], length: 1.0, radius: 0.035, phase: 2.5 },
      { origin: [0.25, 2.4, -0.22], length: 1.6, radius: 0.02, phase: 3.8 },
      { origin: [0.35, 2.5, 0.0], length: 1.3, radius: 0.028, phase: 5.1 },
    ];
    for (const tc of tendrilConfigs) {
      const points = [];
      const segs = 8;
      for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        points.push(new THREE.Vector3(
          tc.origin[0] + Math.sin(t * 2 + tc.phase) * 0.05,
          tc.origin[1] - t * tc.length,
          tc.origin[2] + Math.cos(t * 3 + tc.phase) * 0.04,
        ));
      }
      const curve = new THREE.CatmullRomCurve3(points);
      const tubeGeo = new THREE.TubeGeometry(curve, 12, tc.radius, 6, false);
      // Taper the tube by scaling radial distance from curve center per Y
      const tPos = tubeGeo.attributes.position;
      for (let i = 0; i < tPos.count; i++) {
        const y = tPos.getY(i);
        const yNorm = Math.max(0, (tc.origin[1] - y) / tc.length);
        const taper = Math.max(0.2, 1.0 - yNorm * 0.8);
        const cx = tc.origin[0];
        const cz = tc.origin[2];
        tPos.setX(i, cx + (tPos.getX(i) - cx) * taper);
        tPos.setZ(i, cz + (tPos.getZ(i) - cz) * taper);
      }
      tubeGeo.computeVertexNormals();

      const tendril = new THREE.Mesh(tubeGeo, tendrilMat);
      tendril.userData.config = tc;
      tendril.userData.originalPositions = tubeGeo.attributes.position.array.slice();
      this.tendrils.push(tendril);
      this.group.add(tendril);
    }

    // --- Neck - exposed vertebrae-like structure ---
    for (let i = 0; i < 4; i++) {
      const neckGeo = new THREE.CylinderGeometry(0.12, 0.14, 0.12, 8);
      const neck = new THREE.Mesh(neckGeo, boneMat);
      neck.position.y = 2.35 - i * 0.14;
      this.group.add(neck);
    }

    // --- Torso - ribbed biomechanical chest ---
    const torsoGeo = new THREE.CylinderGeometry(0.5, 0.35, 1.5, 12, 8);
    const tp = torsoGeo.attributes.position;
    for (let i = 0; i < tp.count; i++) {
      const y = tp.getY(i), x = tp.getX(i), z = tp.getZ(i);
      const ribFactor = Math.sin(y * 12) * 0.04;
      tp.setX(i, x * (1 + ribFactor));
      tp.setZ(i, z * (1 + ribFactor));
    }
    torsoGeo.computeVertexNormals();
    const torso = new THREE.Mesh(torsoGeo, skinMat);
    torso.position.y = 1.0;
    this.group.add(torso);

    // --- Emissive pulsing veins along the torso ---
    for (let i = 0; i < 4; i++) {
      const veinGeo = new THREE.CylinderGeometry(0.008, 0.005, 0.6 + Math.random() * 0.4, 4);
      const vein = new THREE.Mesh(veinGeo, veinMat.clone());
      const angle = (i / 4) * Math.PI * 2 + 0.3;
      vein.position.set(
        Math.cos(angle) * 0.38,
        0.7 + i * 0.2,
        Math.sin(angle) * 0.38,
      );
      vein.rotation.z = (Math.random() - 0.5) * 0.3;
      vein.rotation.x = (Math.random() - 0.5) * 0.3;
      vein.userData.phaseOffset = Math.random() * Math.PI * 2;
      this.veinMeshes.push(vein);
      this.group.add(vein);
    }

    // --- Exposed spinal ridge on back ---
    for (let i = 0; i < 6; i++) {
      const spineGeo = new THREE.ConeGeometry(0.035, 0.18, 4);
      const spine = new THREE.Mesh(spineGeo, boneMat);
      spine.position.set(-0.35, 0.5 + i * 0.25, 0);
      spine.rotation.z = Math.PI / 2;
      this.group.add(spine);
    }

    // --- Arms - longer, more segments, spider-like ---
    for (const side of [-1, 1]) {
      const armGroup = new THREE.Group();

      // Upper arm (longer)
      const upperGeo = new THREE.CylinderGeometry(0.08, 0.055, 1.4, 8);
      const upper = new THREE.Mesh(upperGeo, metalMat);
      upper.position.y = -0.7;
      armGroup.add(upper);

      // Elbow joint
      const elbowGeo = new THREE.SphereGeometry(0.08, 8, 8);
      const elbow = new THREE.Mesh(elbowGeo, boneMat);
      elbow.position.y = -1.4;
      armGroup.add(elbow);

      // Forearm (longer)
      const foreGeo = new THREE.CylinderGeometry(0.06, 0.035, 1.6, 8);
      const fore = new THREE.Mesh(foreGeo, metalMat);
      fore.position.y = -2.3;
      armGroup.add(fore);

      // Wrist joint
      const wristGeo = new THREE.SphereGeometry(0.05, 6, 6);
      const wrist = new THREE.Mesh(wristGeo, boneMat);
      wrist.position.y = -3.1;
      armGroup.add(wrist);

      // Elongated fingers (5 per hand, longer + thinner)
      for (let f = 0; f < 5; f++) {
        const fingerGeo = new THREE.CylinderGeometry(0.012, 0.005, 0.65, 4);
        const finger = new THREE.Mesh(fingerGeo, boneMat);
        finger.position.set((f - 2) * 0.025, -3.55, 0);
        finger.rotation.z = (f - 2) * 0.06 * side;
        armGroup.add(finger);
      }

      armGroup.position.set(0, 1.5, side * 0.55);
      armGroup.rotation.x = side * 0.1;
      this.arms.push(armGroup);
      this.group.add(armGroup);
    }

    // --- Legs - trailing, almost vestigial, fade into wisps ---
    for (const side of [-1, 1]) {
      const legGeo = new THREE.CylinderGeometry(0.1, 0.02, 1.5, 6);
      const leg = new THREE.Mesh(legGeo, skinMat);
      leg.position.set(0, -0.5, side * 0.2);
      this.group.add(leg);
    }

    // --- Trailing membrane/veil ---
    const veilMat2 = new THREE.MeshPhysicalMaterial({
      color: 0x080610, roughness: 0.3, metalness: 0.3,
      transparent: true, opacity: 0.25, side: THREE.DoubleSide,
    });
    const veilGeo = new THREE.PlaneGeometry(1.5, 2, 4, 8);
    const vp = veilGeo.attributes.position;
    for (let i = 0; i < vp.count; i++) {
      vp.setZ(i, Math.sin(vp.getY(i) * 3) * 0.1);
    }
    veilGeo.computeVertexNormals();
    const veil = new THREE.Mesh(veilGeo, veilMat2);
    veil.position.set(-0.3, -0.5, 0);
    this.group.add(veil);

    // Eerie cold glow from chest area
    this.glow = new THREE.PointLight(0x1a0a2e, 1.2, 18);
    this.glow.position.set(0, 1.5, 0);
    this.group.add(this.glow);

    // Scale slightly larger for "massive" silhouette read
    const s = 2.5 + Math.random() * 1.5;
    this.group.scale.setScalar(s);
  }

  update(dt, playerPos) {
    this.time += dt;
    this.turnTimer += dt;

    if (this.turnTimer > this.turnInterval) {
      this.turnTimer = 0;
      this.turnInterval = 15 + Math.random() * 15;
      if (Math.random() < 0.35) {
        this.direction.subVectors(playerPos, this.group.position).normalize();
        this.direction.y *= 0.1;
      } else {
        this.direction.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.03, Math.random() - 0.5).normalize();
      }
    }

    this.group.position.add(this.direction.clone().multiplyScalar(this.speed * dt));

    // Face player slowly - always watching
    const toPlayer = new THREE.Vector3().subVectors(playerPos, this.group.position);
    const targetY = Math.atan2(toPlayer.x, toPlayer.z);
    this.group.rotation.y = THREE.MathUtils.lerp(this.group.rotation.y, targetY + Math.PI / 2, dt * 0.5);

    // Gentle sway
    this.group.rotation.z = Math.sin(this.time * 0.3) * 0.03;

    // Head tilt/bob animation
    if (this.head) {
      this.head.rotation.x = Math.sin(this.time * 0.4) * 0.04;
      this.head.rotation.z = Math.sin(this.time * 0.25 + 1.0) * 0.03;
    }

    // Arms drift eerily (amplified sway)
    for (let i = 0; i < this.arms.length; i++) {
      this.arms[i].rotation.z = Math.sin(this.time * 0.5 + i * Math.PI) * 0.22;
      this.arms[i].rotation.x = Math.sin(this.time * 0.3 + i) * 0.15;
    }

    // Tendril sway with independent phase offsets (absolute displacement from rest positions)
    for (const tendril of this.tendrils) {
      const cfg = tendril.userData.config;
      const pos = tendril.geometry.attributes.position;
      const orig = tendril.userData.originalPositions;
      for (let i = 0; i < pos.count; i++) {
        const origX = orig[i * 3];
        const origY = orig[i * 3 + 1];
        const origZ = orig[i * 3 + 2];
        const depth = Math.max(0, (cfg.origin[1] - origY) / cfg.length);
        const swayX = Math.sin(this.time * 0.8 + cfg.phase + depth * 4) * 0.03 * depth;
        const swayZ = Math.cos(this.time * 0.6 + cfg.phase * 1.3 + depth * 3) * 0.025 * depth;
        pos.setX(i, origX + swayX);
        pos.setZ(i, origZ + swayZ);
      }
      pos.needsUpdate = true;
    }

    // Pulsing emissive veins
    for (const vein of this.veinMeshes) {
      const pulse = 0.2 + 0.4 * Math.abs(Math.sin(this.time * 1.5 + vein.userData.phaseOffset));
      vein.material.emissiveIntensity = pulse;
    }

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
