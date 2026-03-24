import * as THREE from 'three';
import { LOD_NEAR_DISTANCE, LOD_MEDIUM_DISTANCE, toStandardMaterial } from './lodUtils.js';

const LEVIATHAN_LOD = {
  near:   { segmentCount: 20, headSegs: [24, 18], bodySegs: [16, 12], teethCount: 18, details: true },
  medium: { segmentCount: 10, headSegs: [14, 10], bodySegs: [10, 8],  teethCount: 9,  details: false },
  far:    { segmentCount: 6,  headSegs: [8, 6],   bodySegs: [6, 4],   teethCount: 6,  details: false },
};

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
    this.tiers = {};
    const lod = new THREE.LOD();
    for (const [tierName, profile] of Object.entries(LEVIATHAN_LOD)) {
      const tier = this._buildTier(profile, tierName === 'far');
      this.tiers[tierName] = tier;
      const dist = tierName === 'near' ? 0 : tierName === 'medium' ? LOD_NEAR_DISTANCE : LOD_MEDIUM_DISTANCE;
      lod.addLevel(tier.group, dist);
    }
    this.lod = lod;
    this.group.add(lod);

    // Eye light only on near tier
    this.eyeLight = new THREE.PointLight(0xff2200, 2, 30);
    this.eyeLight.position.set(3, 1.2, 0);
    this.tiers.near.group.add(this.eyeLight);

    this.group.scale.setScalar(1.5 + Math.random() * 1.5);
  }

  _buildTier(profile, useFarMat) {
    const tierGroup = new THREE.Group();
    const segments = [];
    const totalLength = 40;
    const segLen = totalLength / profile.segmentCount;

    // Materials
    let bodyMat = new THREE.MeshPhysicalMaterial({
      color: 0x1a1028, roughness: 0.25, metalness: 0,
      clearcoat: 1.0, clearcoatRoughness: 0.15,
      emissive: 0x502040, emissiveIntensity: 0.6,
    });
    let boneMat = new THREE.MeshPhysicalMaterial({
      color: 0x3a3228, roughness: 0.35, metalness: 0,
      clearcoat: 0.8, clearcoatRoughness: 0.2,
      emissive: 0x504030, emissiveIntensity: 0.5,
    });
    let fleshMat = new THREE.MeshPhysicalMaterial({
      color: 0x1a1020, roughness: 0.3, metalness: 0,
      clearcoat: 0.9, clearcoatRoughness: 0.1,
      emissive: 0x602040, emissiveIntensity: 0.7,
    });

    if (useFarMat) {
      const origBody = bodyMat; bodyMat = toStandardMaterial(bodyMat); origBody.dispose();
      const origBone = boneMat; boneMat = toStandardMaterial(boneMat); origBone.dispose();
      const origFlesh = fleshMat; fleshMat = toStandardMaterial(fleshMat); origFlesh.dispose();
    }

    // Head
    const headGeo = new THREE.SphereGeometry(3, profile.headSegs[0], profile.headSegs[1]);
    headGeo.scale(2.5, 0.8, 0.9);
    const hPos = headGeo.attributes.position;
    for (let i = 0; i < hPos.count; i++) {
      const x = hPos.getX(i), y = hPos.getY(i), z = hPos.getZ(i);
      const ridge = Math.abs(z) < 0.5 ? Math.sin(x * 2) * 0.3 : 0;
      hPos.setY(i, y + ridge + Math.sin(x * 4 + z * 3) * 0.08);
    }
    headGeo.computeVertexNormals();
    const head = new THREE.Mesh(headGeo, bodyMat);
    tierGroup.add(head);
    segments.push(head);

    // Jaw
    const jawGeo = new THREE.ConeGeometry(2.5, 5, Math.max(8, Math.round(16 * profile.headSegs[0] / 24)));
    const jPos = jawGeo.attributes.position;
    for (let i = 0; i < jPos.count; i++) {
      const y = jPos.getY(i);
      if (y < 0) jPos.setX(i, jPos.getX(i) * (1 + Math.sin(y * 4) * 0.15));
    }
    jawGeo.computeVertexNormals();
    const jaw = new THREE.Mesh(jawGeo, bodyMat);
    jaw.position.set(5, -1, 0);
    jaw.rotation.z = Math.PI / 2 + 0.3;
    tierGroup.add(jaw);

    // Teeth
    const toothGeo = new THREE.ConeGeometry(0.08, 0.6, 6);
    let toothMat = new THREE.MeshPhysicalMaterial({
      color: 0xbba880, roughness: 0.15, metalness: 0.7, clearcoat: 1.0,
    });
    if (useFarMat) { const orig = toothMat; toothMat = toStandardMaterial(toothMat); orig.dispose(); }
    for (let i = 0; i < profile.teethCount; i++) {
      const angle = (i / profile.teethCount) * Math.PI;
      const tooth = new THREE.Mesh(toothGeo, toothMat);
      tooth.position.set(4.5 + Math.cos(angle) * 1.5, -0.5 + Math.sin(angle) * 1.2, Math.cos(angle * 3) * 1.5);
      tooth.rotation.z = Math.PI + (Math.random() - 0.5) * 0.2;
      tooth.scale.y = 0.8 + Math.random() * 0.8;
      tierGroup.add(tooth);
    }

    // Eyes
    const eyeGeo = new THREE.SphereGeometry(0.5, Math.max(8, Math.round(16 * profile.headSegs[0] / 24)), Math.max(8, Math.round(16 * profile.headSegs[0] / 24)));
    eyeGeo.scale(1, 0.5, 1);
    let eyeMat = new THREE.MeshPhysicalMaterial({
      color: 0xff2200, emissive: 0xff2200, emissiveIntensity: 3, roughness: 0.0, clearcoat: 1.0,
    });
    if (useFarMat) { const orig = eyeMat; eyeMat = toStandardMaterial(eyeMat); orig.dispose(); }
    tierGroup.add(new THREE.Mesh(eyeGeo, eyeMat)).position.set(3, 1.2, 2);
    tierGroup.add(new THREE.Mesh(eyeGeo, eyeMat)).position.set(3, 1.2, -2);

    // Body segments
    for (let i = 1; i < profile.segmentCount; i++) {
      const t = i / profile.segmentCount;
      const radius = THREE.MathUtils.lerp(2.8, 0.3, t);
      const geo = new THREE.SphereGeometry(radius, profile.bodySegs[0], profile.bodySegs[1]);
      geo.scale(1.5, 1, 1);
      if (profile.details) {
        const vPos = geo.attributes.position;
        for (let v = 0; v < vPos.count; v++) {
          const x = vPos.getX(v), y = vPos.getY(v);
          vPos.setY(v, y + Math.sin(x * 8) * 0.05 * radius);
        }
        geo.computeVertexNormals();
      }
      const seg = new THREE.Mesh(geo, bodyMat);
      seg.position.set(-i * segLen * 0.5, 0, 0);
      tierGroup.add(seg);
      segments.push(seg);

      // Details only for near tier
      if (profile.details) {
        if (i % 2 === 0 && t < 0.85) {
          const vertGeo = new THREE.BoxGeometry(0.3, radius * 0.5, 0.4, 1, 1, 1);
          tierGroup.add(new THREE.Mesh(vertGeo, boneMat)).position.set(-i * segLen * 0.5, radius * 0.85, 0);
        }
        if (i % 3 === 0 && t < 0.7) {
          const spineGeo = new THREE.ConeGeometry(0.12, radius * 2, 6);
          tierGroup.add(new THREE.Mesh(spineGeo, boneMat)).position.set(-i * segLen * 0.5, radius * 1.1, 0);
        }
        if (i % 2 === 0 && t < 0.8) {
          for (const side of [-1, 1]) {
            const pipeGeo = new THREE.CylinderGeometry(0.08, 0.08, segLen * 0.6, 6);
            pipeGeo.rotateZ(Math.PI / 2);
            tierGroup.add(new THREE.Mesh(pipeGeo, fleshMat)).position.set(-i * segLen * 0.5, radius * 0.3, side * radius * 0.9);
          }
        }
        if (i % 3 === 0) {
          const slitGeo = new THREE.PlaneGeometry(0.6, 0.15);
          let slitMat = new THREE.MeshPhysicalMaterial({
            color: 0x6622ff, emissive: 0x6622ff, emissiveIntensity: 1.5,
            transparent: true, opacity: 0.8, side: THREE.DoubleSide,
          });
          if (useFarMat) { const orig = slitMat; slitMat = toStandardMaterial(slitMat); orig.dispose(); }
          for (const side of [-1, 1]) {
            const slit = new THREE.Mesh(slitGeo, slitMat);
            slit.position.set(-i * segLen * 0.5, 0, side * (radius + 0.01));
            slit.rotation.y = Math.PI / 2;
            tierGroup.add(slit);
          }
        }
        if (i % 5 === 0 && t < 0.6) {
          for (const side of [-1, 1]) {
            const ribCurve = new THREE.QuadraticBezierCurve3(
              new THREE.Vector3(0, radius * 0.8, 0),
              new THREE.Vector3(0, radius * 1.2, side * radius * 0.8),
              new THREE.Vector3(0, 0, side * radius)
            );
            const ribGeo = new THREE.TubeGeometry(ribCurve, 8, 0.06, 6, false);
            tierGroup.add(new THREE.Mesh(ribGeo, boneMat)).position.set(-i * segLen * 0.5, 0, 0);
          }
        }
      }
    }

    // Tail
    const tailGeo = new THREE.PlaneGeometry(5, 7, profile.details ? 6 : 3, profile.details ? 6 : 3);
    const tPos = tailGeo.attributes.position;
    for (let i = 0; i < tPos.count; i++) {
      tPos.setZ(i, Math.sin(tPos.getX(i) * 2 + tPos.getY(i)) * 0.3);
    }
    tailGeo.computeVertexNormals();
    let tailMat = new THREE.MeshPhysicalMaterial({
      color: 0x080610, side: THREE.DoubleSide, transparent: true, opacity: 0.7,
      roughness: 0.3, metalness: 0.5, clearcoat: 0.6,
    });
    if (useFarMat) { const orig = tailMat; tailMat = toStandardMaterial(tailMat); orig.dispose(); }
    const tail = new THREE.Mesh(tailGeo, tailMat);
    tail.position.set(-profile.segmentCount * segLen * 0.5 - 2, 0, 0);
    tail.rotation.y = Math.PI / 2;
    tierGroup.add(tail);

    return { group: tierGroup, segments, jaw };
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

    // Undulate body segments across all tiers
    for (const tier of Object.values(this.tiers)) {
      for (let i = 1; i < tier.segments.length; i++) {
        const seg = tier.segments[i];
        const phase = this.time * 1.5 - i * 0.3;
        seg.position.z = Math.sin(phase) * i * 0.15;
        seg.position.y = Math.cos(phase * 0.7) * i * 0.08;
      }
      // Jaw movement
      if (tier.jaw) {
        tier.jaw.rotation.z = Math.PI / 2 + 0.3 + Math.sin(this.time * 1.5) * 0.1;
      }
    }

    // Eye glow pulsing
    if (this.eyeLight) {
      this.eyeLight.intensity = 2 + Math.sin(this.time * 2) * 0.5;
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
