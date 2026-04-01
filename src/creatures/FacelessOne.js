import * as THREE from 'three';
import { LOD_NEAR_DISTANCE, LOD_MEDIUM_DISTANCE, toStandardMaterial } from './lodUtils.js';

const _tmpDir = new THREE.Vector3();
const _tmpVec = new THREE.Vector3();

const FACELESS_LOD = {
  near:   { headSegs: [32, 24], torsoSegs: [12, 8], armSegs: 8, tendrils: true, veins: true, spines: true, fingers: true },
  medium: { headSegs: [18, 14], torsoSegs: [8, 5],  armSegs: 6, tendrils: false, veins: false, spines: false, fingers: false },
  far:    { headSegs: [10, 8],  torsoSegs: [6, 3],  armSegs: 4, tendrils: false, veins: false, spines: false, fingers: false },
};

// Faceless humanoid - smooth featureless head, biomechanical limbs, uncanny floating presence
export class FacelessOne {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time = Math.random() * 100;
    this.speed = 0.5 + Math.random() * 0.3;
    this.direction = new THREE.Vector3(Math.random() - 0.5, -0.02, Math.random() - 0.5).normalize();
    this.turnTimer = 0;
    this.turnInterval = 15 + Math.random() * 15;
    this.tendrils = [];
    this.veinMeshes = [];

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  _buildModel() {
    this.tiers = {};
    const lod = new THREE.LOD();
    for (const [tierName, profile] of Object.entries(FACELESS_LOD)) {
      const tier = this._buildTier(profile, tierName === 'far');
      this.tiers[tierName] = tier;
      const dist = tierName === 'near' ? 0 : tierName === 'medium' ? LOD_NEAR_DISTANCE : LOD_MEDIUM_DISTANCE;
      lod.addLevel(tier.group, dist);
    }
    this.lod = lod;
    this.group.add(lod);

    // Light only on near tier
    this.glow = new THREE.PointLight(0x1a0a2e, 1.2, 18);
    this.glow.userData.duwCategory = 'creature_bio';
    this.glow.position.set(0, 1.5, 0);
    this.tiers.near.group.add(this.glow);

    const s = 2.5 + Math.random() * 1.5;
    this.group.scale.setScalar(s);
  }

  _buildTier(profile, useFarMat) {
    const tierGroup = new THREE.Group();
    const arms = [];

    // --- Materials ---
    let skinMat = new THREE.MeshPhysicalMaterial({
      color: 0x1a1020, roughness: 0.15, metalness: 0,
      clearcoat: 1.0, clearcoatRoughness: 0.05,
      emissive: 0x502040, emissiveIntensity: 0.7,
      sheen: 1.0, sheenColor: new THREE.Color(0x1a0a2e), sheenRoughness: 0.4,
      iridescence: 0.15, iridescenceIOR: 1.3,
    });
    let metalMat = new THREE.MeshPhysicalMaterial({
      color: 0x141414, roughness: 0.1, metalness: 0.9,
      clearcoat: 1.0, clearcoatRoughness: 0.03,
      emissive: 0x203858, emissiveIntensity: 0.3,
      sheen: 0.5, sheenColor: new THREE.Color(0x0a0818), sheenRoughness: 0.3,
    });
    let boneMat = new THREE.MeshPhysicalMaterial({
      color: 0x3a3228, roughness: 0.35, metalness: 0,
      clearcoat: 0.6, clearcoatRoughness: 0.15,
      emissive: 0x504030, emissiveIntensity: 0.5,
    });
    if (useFarMat) {
      skinMat = toStandardMaterial(skinMat);
      metalMat = toStandardMaterial(metalMat);
      boneMat = toStandardMaterial(boneMat);
    }

    // --- Head ---
    const headGeo = new THREE.SphereGeometry(0.6, profile.headSegs[0], profile.headSegs[1]);
    headGeo.scale(0.75, 1.3, 0.8);
    if (!useFarMat) {
      const hp = headGeo.attributes.position;
      for (let i = 0; i < hp.count; i++) {
        const y = hp.getY(i), x = hp.getX(i), z = hp.getZ(i);
        if (y > 0.1) {
          const ri = Math.sin(y * 14) * 0.015 * Math.max(0, y);
          hp.setX(i, x + ri);
          hp.setZ(i, z + ri * 0.5);
        }
      }
      headGeo.computeVertexNormals();
    }
    const head = new THREE.Mesh(headGeo, skinMat);
    head.position.y = 2.9;
    tierGroup.add(head);

    // --- Torso ---
    const torsoGeo = new THREE.CylinderGeometry(0.5, 0.35, 1.5, profile.torsoSegs[0], profile.torsoSegs[1]);
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
    tierGroup.add(torso);

    // --- Arms ---
    for (const side of [-1, 1]) {
      const armGroup = new THREE.Group();
      const upperGeo = new THREE.CylinderGeometry(0.08, 0.055, 1.4, profile.armSegs);
      armGroup.add(new THREE.Mesh(upperGeo, metalMat)).position.y = -0.7;

      const elbowGeo = new THREE.SphereGeometry(0.08, profile.armSegs, profile.armSegs);
      armGroup.add(new THREE.Mesh(elbowGeo, boneMat)).position.y = -1.4;

      const foreGeo = new THREE.CylinderGeometry(0.06, 0.035, 1.6, profile.armSegs);
      armGroup.add(new THREE.Mesh(foreGeo, metalMat)).position.y = -2.3;

      if (profile.fingers) {
        const wristGeo = new THREE.SphereGeometry(0.05, 6, 6);
        armGroup.add(new THREE.Mesh(wristGeo, boneMat)).position.y = -3.1;
        for (let f = 0; f < 5; f++) {
          const fingerGeo = new THREE.CylinderGeometry(0.012, 0.005, 0.65, 4);
          const finger = new THREE.Mesh(fingerGeo, boneMat);
          finger.position.set((f - 2) * 0.025, -3.55, 0);
          finger.rotation.z = (f - 2) * 0.06 * side;
          armGroup.add(finger);
        }
      }

      armGroup.position.set(0, 1.5, side * 0.55);
      armGroup.rotation.x = side * 0.1;
      arms.push(armGroup);
      tierGroup.add(armGroup);
    }

    // --- Legs ---
    for (const side of [-1, 1]) {
      const legGeo = new THREE.CylinderGeometry(0.1, 0.02, 1.5, profile.armSegs);
      tierGroup.add(new THREE.Mesh(legGeo, skinMat)).position.set(0, -0.5, side * 0.2);
    }

    // --- Near-only details ---
    if (profile.tendrils) {
      let tendrilMat = new THREE.MeshPhysicalMaterial({
        color: 0x1c1828, roughness: 0.12, metalness: 0,
        clearcoat: 1.0, clearcoatRoughness: 0.04,
        sheen: 1.0, sheenColor: new THREE.Color(0x1a0a2e), sheenRoughness: 0.3,
        iridescence: 0.2, iridescenceIOR: 1.3,
        emissive: 0x502040, emissiveIntensity: 0.5,
      });
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
        const tPos = tubeGeo.attributes.position;
        for (let i = 0; i < tPos.count; i++) {
          const y = tPos.getY(i);
          const yNorm = Math.max(0, (tc.origin[1] - y) / tc.length);
          const taper = Math.max(0.2, 1.0 - yNorm * 0.8);
          const cx = tc.origin[0], cz = tc.origin[2];
          tPos.setX(i, cx + (tPos.getX(i) - cx) * taper);
          tPos.setZ(i, cz + (tPos.getZ(i) - cz) * taper);
        }
        tubeGeo.computeVertexNormals();
        const tendril = new THREE.Mesh(tubeGeo, tendrilMat);
        tendril.userData.config = tc;
        tendril.userData.originalPositions = tubeGeo.attributes.position.array.slice();
        this.tendrils.push(tendril);
        tierGroup.add(tendril);
      }

      // Cranial ridges
      const ridgeGeo = new THREE.ConeGeometry(0.04, 0.3, 6);
      for (const r of [
        { pos: [0.15, 3.55, 0.2], rot: [0.3, 0, -0.2] },
        { pos: [-0.1, 3.5, -0.25], rot: [-0.25, 0, 0.15] },
        { pos: [0.05, 3.6, -0.1], rot: [-0.1, 0, 0.3] },
      ]) {
        const ridge = new THREE.Mesh(ridgeGeo, boneMat);
        ridge.position.set(...r.pos);
        ridge.rotation.set(...r.rot);
        tierGroup.add(ridge);
      }

      // Mouth slit
      let slitMat2 = new THREE.MeshPhysicalMaterial({
        color: 0x000000, emissive: 0x330808, emissiveIntensity: 1.5,
        roughness: 1, side: THREE.DoubleSide,
      });
      const slit = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.025), slitMat2);
      slit.position.set(0.38, 2.6, 0);
      slit.rotation.y = Math.PI / 2;
      tierGroup.add(slit);

      // Neck vertebrae
      for (let i = 0; i < 4; i++) {
        const neckGeo = new THREE.CylinderGeometry(0.12, 0.14, 0.12, 8);
        tierGroup.add(new THREE.Mesh(neckGeo, boneMat)).position.y = 2.35 - i * 0.14;
      }
    }

    if (profile.veins) {
      const veinMat = new THREE.MeshPhysicalMaterial({
        color: 0x1a0520, emissive: 0x502040, emissiveIntensity: 0.5,
        roughness: 0.3, metalness: 0, transparent: true, opacity: 0.7,
      });
      for (let i = 0; i < 4; i++) {
        const veinGeo = new THREE.CylinderGeometry(0.008, 0.005, 0.6 + Math.random() * 0.4, 4);
        const vein = new THREE.Mesh(veinGeo, veinMat.clone());
        const angle = (i / 4) * Math.PI * 2 + 0.3;
        vein.position.set(Math.cos(angle) * 0.38, 0.7 + i * 0.2, Math.sin(angle) * 0.38);
        vein.rotation.z = (Math.random() - 0.5) * 0.3;
        vein.rotation.x = (Math.random() - 0.5) * 0.3;
        vein.userData.phaseOffset = Math.random() * Math.PI * 2;
        this.veinMeshes.push(vein);
        tierGroup.add(vein);
      }
    }

    if (profile.spines) {
      for (let i = 0; i < 6; i++) {
        const spineGeo = new THREE.ConeGeometry(0.035, 0.18, 4);
        tierGroup.add(new THREE.Mesh(spineGeo, boneMat)).position.set(-0.35, 0.5 + i * 0.25, 0);
      }
    }

    // Trailing veil
    let veilMat = new THREE.MeshPhysicalMaterial({
      color: 0x181428, roughness: 0.3, metalness: 0,
      transparent: true, opacity: 0.25, side: THREE.DoubleSide,
      emissive: 0x502040, emissiveIntensity: 0.5,
    });
    if (useFarMat) veilMat = toStandardMaterial(veilMat);
    const veilGeo = new THREE.PlaneGeometry(1.5, 2, useFarMat ? 2 : 4, useFarMat ? 4 : 8);
    const vp = veilGeo.attributes.position;
    for (let i = 0; i < vp.count; i++) vp.setZ(i, Math.sin(vp.getY(i) * 3) * 0.1);
    veilGeo.computeVertexNormals();
    tierGroup.add(new THREE.Mesh(veilGeo, veilMat)).position.set(-0.3, -0.5, 0);

    return { group: tierGroup, head, arms };
  }

  update(dt, playerPos, distSq) {
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

    this.group.position.add(_tmpDir.copy(this.direction).multiplyScalar(this.speed * dt));

    // Face player slowly - always watching
    const toPlayer = _tmpVec.subVectors(playerPos, this.group.position);
    const targetY = Math.atan2(toPlayer.x, toPlayer.z);
    this.group.rotation.y = THREE.MathUtils.lerp(this.group.rotation.y, targetY + Math.PI / 2, dt * 0.5);

    // Gentle sway
    this.group.rotation.z = Math.sin(this.time * 0.3) * 0.03;

    // Head tilt/bob animation (all tiers)
    for (const tier of Object.values(this.tiers)) {
      if (tier.head) {
        tier.head.rotation.x = Math.sin(this.time * 0.4) * 0.04;
        tier.head.rotation.z = Math.sin(this.time * 0.25 + 1.0) * 0.03;
      }
      for (let i = 0; i < tier.arms.length; i++) {
        tier.arms[i].rotation.z = Math.sin(this.time * 0.5 + i * Math.PI) * 0.22;
        tier.arms[i].rotation.x = Math.sin(this.time * 0.3 + i) * 0.15;
      }
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

    if (distSq > 40000) {
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
