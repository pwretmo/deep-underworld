import * as THREE from 'three';

const LOD_NEAR_DISTANCE = 42;
const LOD_MEDIUM_DISTANCE = 86;

// Create a soft circular sprite texture for glow effects.
function createGlowTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.3, 'rgba(255,255,255,0.6)');
  gradient.addColorStop(0.7, 'rgba(255,255,255,0.1)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

const glowTexture = createGlowTexture();

const LOD_PROFILE = {
  near: {
    bellWidthSegments: 64,
    bellHeightSegments: 40,
    innerWidthSegments: 40,
    innerHeightSegments: 28,
    rimTubeSegments: 96,
    rimRadialSegments: 16,
    oralArmCount: 4,
    oralArmSegments: 14,
    oralArmRadialSegments: 10,
    oralArmRadiusScale: 1.0,
    tentacleMin: 10,
    tentacleMaxExtra: 4,
    tentacleSegments: 12,
    tentacleRadialSegments: 8,
    tentacleRadiusScale: 1.0,
    animationInterval: 4,
  },
  medium: {
    bellWidthSegments: 34,
    bellHeightSegments: 22,
    innerWidthSegments: 22,
    innerHeightSegments: 16,
    rimTubeSegments: 52,
    rimRadialSegments: 10,
    oralArmCount: 3,
    oralArmSegments: 8,
    oralArmRadialSegments: 6,
    oralArmRadiusScale: 0.85,
    tentacleMin: 7,
    tentacleMaxExtra: 3,
    tentacleSegments: 8,
    tentacleRadialSegments: 5,
    tentacleRadiusScale: 0.85,
    animationInterval: 8,
  },
  far: {
    bellWidthSegments: 18,
    bellHeightSegments: 12,
    innerWidthSegments: 12,
    innerHeightSegments: 10,
    rimTubeSegments: 24,
    rimRadialSegments: 6,
    oralArmCount: 2,
    oralArmSegments: 4,
    oralArmRadialSegments: 4,
    oralArmRadiusScale: 0.7,
    tentacleMin: 4,
    tentacleMaxExtra: 2,
    tentacleSegments: 4,
    tentacleRadialSegments: 3,
    tentacleRadiusScale: 0.7,
    animationInterval: 16,
  },
};

export class Jellyfish {
  constructor(scene, position, count = 6) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.jellies = [];
    this.time = Math.random() * 100;
    this._frameCount = 0;

    // More natural, muted bioluminescent palette.
    const colors = [
      0x2288cc, 0xcc3388, 0x33bb88, 0x8844cc, 0xcc6633, 0x3399bb,
      0x5566dd, 0xdd5577, 0x44ccaa, 0xbb55dd,
    ];

    for (let i = 0; i < count; i++) {
      const jelly = this._createJelly(colors[i % colors.length]);
      jelly.group.position.set(
        position.x + (Math.random() - 0.5) * 30,
        position.y + (Math.random() - 0.5) * 15,
        position.z + (Math.random() - 0.5) * 30
      );
      this.jellies.push(jelly);
      this.group.add(jelly.group);
    }

    scene.add(this.group);
  }

  _createBellGeometry(size, widthSegments, heightSegments) {
    const bellGeo = new THREE.SphereGeometry(size, widthSegments, heightSegments, 0, Math.PI * 2, 0, Math.PI * 0.55);
    const positions = bellGeo.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const z = positions.getZ(i);
      const rimFactor = 1 - y / size;
      const ripple = Math.sin(Math.atan2(z, x) * 8) * 0.03 * rimFactor * size;
      const bulge = Math.sin(Math.atan2(z, x) * 3) * 0.02 * size;
      positions.setX(i, x + (x / size) * (ripple + bulge));
      positions.setZ(i, z + (z / size) * (ripple + bulge));
    }
    bellGeo.computeVertexNormals();
    return bellGeo;
  }

  _createFlowingAppendages(group, color, size, profile) {
    const oralArms = [];
    const tentacles = [];

    for (let a = 0; a < profile.oralArmCount; a++) {
      const angle = (a / profile.oralArmCount) * Math.PI * 2;
      const armLen = size * 2 + Math.random() * size * 1.5;
      const points = [];
      for (let s = 0; s <= profile.oralArmSegments; s++) {
        const t = s / profile.oralArmSegments;
        points.push(new THREE.Vector3(
          Math.cos(angle) * size * 0.2 * (1 - t * 0.5),
          -t * armLen,
          Math.sin(angle) * size * 0.2 * (1 - t * 0.5)
        ));
      }
      const curve = new THREE.CatmullRomCurve3(points);
      const armGeo = new THREE.TubeGeometry(
        curve,
        profile.oralArmSegments,
        (0.04 * size + 0.01) * profile.oralArmRadiusScale,
        profile.oralArmRadialSegments,
        false
      );
      const armMat = new THREE.MeshPhysicalMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.4,
        transparent: true,
        opacity: 0.45,
        roughness: 0.3,
        depthWrite: false,
      });
      const arm = new THREE.Mesh(armGeo, armMat);
      group.add(arm);
      oralArms.push({
        mesh: arm,
        basePoints: points.map((p) => p.clone()),
        angle,
        segs: profile.oralArmSegments,
      });
    }

    const tentacleCount = profile.tentacleMin + Math.floor(Math.random() * profile.tentacleMaxExtra);
    for (let t = 0; t < tentacleCount; t++) {
      const angle = (t / tentacleCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.2;
      const radius = size * 0.75;
      const tentLen = size * 3 + Math.random() * size * 4;
      const points = [];
      for (let s = 0; s <= profile.tentacleSegments; s++) {
        const frac = s / profile.tentacleSegments;
        points.push(new THREE.Vector3(
          Math.cos(angle) * radius * (1 - frac * 0.4),
          -frac * tentLen,
          Math.sin(angle) * radius * (1 - frac * 0.4)
        ));
      }
      const curve = new THREE.CatmullRomCurve3(points);
      const tentGeo = new THREE.TubeGeometry(
        curve,
        profile.tentacleSegments,
        (0.015 * size + 0.005) * profile.tentacleRadiusScale,
        profile.tentacleRadialSegments,
        false
      );
      const tentMat = new THREE.MeshPhysicalMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.25,
        transparent: true,
        opacity: 0.3,
        roughness: 0.3,
        depthWrite: false,
      });
      const tentacle = new THREE.Mesh(tentGeo, tentMat);
      group.add(tentacle);
      tentacles.push({
        mesh: tentacle,
        basePoints: points.map((p) => p.clone()),
        segs: profile.tentacleSegments,
        phaseOffset: Math.random() * Math.PI * 2,
        swaySpeed: 0.5 + Math.random() * 0.5,
      });
    }

    return { oralArms, tentacles };
  }

  _createJellyTier(color, size, profile) {
    const group = new THREE.Group();

    const bellMat = new THREE.MeshPhysicalMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.3,
      transparent: true,
      opacity: 0.35,
      roughness: 0.15,
      metalness: 0,
      transmission: 0.6,
      thickness: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const bell = new THREE.Mesh(this._createBellGeometry(size, profile.bellWidthSegments, profile.bellHeightSegments), bellMat);
    group.add(bell);

    const innerGeo = new THREE.SphereGeometry(
      size * 0.65,
      profile.innerWidthSegments,
      profile.innerHeightSegments,
      0,
      Math.PI * 2,
      0,
      Math.PI * 0.5
    );
    const innerMat = new THREE.MeshPhysicalMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.8,
      transparent: true,
      opacity: 0.2,
      roughness: 0.3,
      transmission: 0.4,
      thickness: 0.3,
      depthWrite: false,
    });
    const inner = new THREE.Mesh(innerGeo, innerMat);
    inner.position.y = -0.05 * size;
    group.add(inner);

    const rimGeo = new THREE.TorusGeometry(size * 0.92, size * 0.06, profile.rimRadialSegments, profile.rimTubeSegments);
    const rimMat = new THREE.MeshPhysicalMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.5,
      transparent: true,
      opacity: 0.4,
      roughness: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.position.y = -size * 0.15;
    rim.rotation.x = Math.PI / 2;
    group.add(rim);

    const appendages = this._createFlowingAppendages(group, color, size, profile);

    return {
      group,
      bell,
      inner,
      rim,
      oralArms: appendages.oralArms,
      tentacles: appendages.tentacles,
      animationInterval: profile.animationInterval,
      profile,
    };
  }

  _createJelly(color) {
    const group = new THREE.Group();
    const size = 0.5 + Math.random() * 1.5;

    const nearTier = this._createJellyTier(color, size, LOD_PROFILE.near);
    const mediumTier = this._createJellyTier(color, size, LOD_PROFILE.medium);
    const farTier = this._createJellyTier(color, size, LOD_PROFILE.far);

    const lod = new THREE.LOD();
    lod.addLevel(nearTier.group, 0);
    lod.addLevel(mediumTier.group, LOD_NEAR_DISTANCE);
    lod.addLevel(farTier.group, LOD_MEDIUM_DISTANCE);
    group.add(lod);

    const spriteMat = new THREE.SpriteMaterial({
      map: glowTexture,
      color,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.setScalar(size * 3);
    sprite.position.y = -size * 0.1;
    group.add(sprite);

    const light = new THREE.PointLight(color, 1, 10);
    light.position.y = -0.1;
    group.add(light);

    return {
      group,
      size,
      lod,
      tiers: {
        near: nearTier,
        medium: mediumTier,
        far: farTier,
      },
      light,
      sprite,
      phase: Math.random() * Math.PI * 2,
      driftX: (Math.random() - 0.5) * 0.4,
      driftZ: (Math.random() - 0.5) * 0.4,
      pulseSpeed: 0.8 + Math.random() * 0.4,
      lastActiveTierName: null,
    };
  }

  _getLodTierName(distanceToPlayer) {
    if (distanceToPlayer < LOD_NEAR_DISTANCE) return 'near';
    if (distanceToPlayer < LOD_MEDIUM_DISTANCE) return 'medium';
    return 'far';
  }

  _animateTierAppendages(jelly, tier, pulse, t) {
    for (const tent of tier.tentacles) {
      const newPoints = [];
      for (let s = 0; s <= tent.segs; s++) {
        const frac = s / tent.segs;
        const base = tent.basePoints[s];
        const swayX = Math.sin(t * tent.swaySpeed + frac * 4 + tent.phaseOffset) * 0.3 * frac;
        const swayZ = Math.cos(t * tent.swaySpeed * 0.8 + frac * 3 + tent.phaseOffset) * 0.25 * frac;
        const pulseDrag = pulse * 0.2 * frac * frac;
        newPoints.push(new THREE.Vector3(
          base.x + swayX * jelly.size,
          base.y + pulseDrag * jelly.size,
          base.z + swayZ * jelly.size
        ));
      }
      const newCurve = new THREE.CatmullRomCurve3(newPoints);
      const newGeo = new THREE.TubeGeometry(
        newCurve,
        tent.segs,
        (0.015 * jelly.size + 0.005) * tier.profile.tentacleRadiusScale,
        tier.profile.tentacleRadialSegments,
        false
      );
      tent.mesh.geometry.dispose();
      tent.mesh.geometry = newGeo;
    }

    for (const arm of tier.oralArms) {
      const newPoints = [];
      for (let s = 0; s <= arm.segs; s++) {
        const frac = s / arm.segs;
        const base = arm.basePoints[s];
        const sway = Math.sin(t * 0.6 + frac * 3 + arm.angle) * 0.15 * frac;
        const drift = pulse * 0.15 * frac * frac;
        newPoints.push(new THREE.Vector3(
          base.x + sway * jelly.size,
          base.y + drift * jelly.size,
          base.z + Math.cos(t * 0.5 + frac * 2 + arm.angle) * 0.1 * frac * jelly.size
        ));
      }
      const newCurve = new THREE.CatmullRomCurve3(newPoints);
      const newGeo = new THREE.TubeGeometry(
        newCurve,
        arm.segs,
        (0.04 * jelly.size + 0.01) * tier.profile.oralArmRadiusScale,
        tier.profile.oralArmRadialSegments,
        false
      );
      arm.mesh.geometry.dispose();
      arm.mesh.geometry = newGeo;
    }
  }

  update(dt, playerPos) {
    this.time += dt;
    this._frameCount++;

    for (const jelly of this.jellies) {
      const t = this.time;

      const pulse = Math.sin(t * jelly.pulseSpeed + jelly.phase);
      const moveUp = pulse > 0 ? pulse * 0.4 : 0;

      jelly.group.position.y += (moveUp - 0.12) * dt;
      jelly.group.position.x += jelly.driftX * dt;
      jelly.group.position.z += jelly.driftZ * dt;

      const distToPlayer = jelly.group.position.distanceTo(playerPos);
      const activeTierName = this._getLodTierName(distToPlayer);
      const activeTier = jelly.tiers[activeTierName];

      // Keep newly visible tiers in sync so LOD transitions don't reveal stale appendage geometry.
      if (jelly.lastActiveTierName !== activeTierName) {
        this._animateTierAppendages(jelly, activeTier, pulse, t);
        jelly.lastActiveTierName = activeTierName;
      }

      const squishX = 1 + pulse * 0.12;
      const squishY = 1 - pulse * 0.1;
      for (const tier of Object.values(jelly.tiers)) {
        tier.bell.scale.set(squishX, squishY, squishX);
        tier.inner.scale.set(squishX * 0.98, squishY * 0.95, squishX * 0.98);
        tier.rim.scale.set(squishX, 1, squishX);
      }

      jelly.light.intensity = 0.6 + pulse * 0.5;
      jelly.sprite.material.opacity = 0.15 + pulse * 0.1;

      if (this._frameCount % activeTier.animationInterval === 0) {
        this._animateTierAppendages(jelly, activeTier, pulse, t);
      }

      jelly.group.rotation.y += dt * 0.08;

      if (distToPlayer > 120) {
        jelly.group.position.set(
          playerPos.x + (Math.random() - 0.5) * 80,
          playerPos.y + (Math.random() - 0.5) * 30 - 10,
          playerPos.z + (Math.random() - 0.5) * 80
        );
      }
    }
  }

  getPosition() {
    return this.group.position;
  }

  getPositions() {
    return this.jellies.map((j) => j.group.position);
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (child.material.map) child.material.map.dispose();
        child.material.dispose();
      }
    });
  }
}
