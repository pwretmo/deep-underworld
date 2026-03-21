import * as THREE from 'three';

// Create a soft circular sprite texture for glow effects
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

export class Jellyfish {
  constructor(scene, position, count = 6) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.jellies = [];
    this.time = Math.random() * 100;
    this._frameCount = 0;

    // More natural, muted bioluminescent palette
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

  _createJelly(color) {
    const group = new THREE.Group();
    const size = 0.5 + Math.random() * 1.5;

    // High-poly bell dome with organic distortion
    const bellGeo = new THREE.SphereGeometry(size, 48, 32, 0, Math.PI * 2, 0, Math.PI * 0.55);
    const positions = bellGeo.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const z = positions.getZ(i);
      // Add organic ripples along the rim
      const rimFactor = 1 - y / size;
      const ripple = Math.sin(Math.atan2(z, x) * 8) * 0.03 * rimFactor * size;
      const bulge = Math.sin(Math.atan2(z, x) * 3) * 0.02 * size;
      positions.setX(i, x + (x / size) * (ripple + bulge));
      positions.setZ(i, z + (z / size) * (ripple + bulge));
    }
    bellGeo.computeVertexNormals();

    // Translucent physical material for realistic jelly look
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
    const bell = new THREE.Mesh(bellGeo, bellMat);
    group.add(bell);

    // Inner bell membrane - visible organs/structure
    const innerGeo = new THREE.SphereGeometry(size * 0.65, 32, 24, 0, Math.PI * 2, 0, Math.PI * 0.5);
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

    // Rim frills - delicate ruffled edge
    const rimGeo = new THREE.TorusGeometry(size * 0.92, size * 0.06, 12, 64);
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

    // Oral arms (thick central tentacles)
    const oralArmCount = 4;
    const oralArms = [];
    for (let a = 0; a < oralArmCount; a++) {
      const angle = (a / oralArmCount) * Math.PI * 2;
      const armLen = size * 2 + Math.random() * size * 1.5;
      const segs = 10;
      const points = [];
      for (let s = 0; s <= segs; s++) {
        const t = s / segs;
        points.push(new THREE.Vector3(
          Math.cos(angle) * size * 0.2 * (1 - t * 0.5),
          -t * armLen,
          Math.sin(angle) * size * 0.2 * (1 - t * 0.5)
        ));
      }
      const curve = new THREE.CatmullRomCurve3(points);
      const armGeo = new THREE.TubeGeometry(curve, segs, 0.04 * size + 0.01, 8, false);
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
      oralArms.push({ mesh: arm, basePoints: points.map(p => p.clone()), angle, length: armLen, segs });
    }

    // Marginal tentacles (thin trailing ones)
    const tentacleCount = 6 + Math.floor(Math.random() * 4);
    const tentacles = [];
    for (let t = 0; t < tentacleCount; t++) {
      const angle = (t / tentacleCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.2;
      const radius = size * 0.75;
      const tentLen = size * 3 + Math.random() * size * 4;
      const segs = 10;
      const points = [];
      for (let s = 0; s <= segs; s++) {
        const frac = s / segs;
        points.push(new THREE.Vector3(
          Math.cos(angle) * radius * (1 - frac * 0.4),
          -frac * tentLen,
          Math.sin(angle) * radius * (1 - frac * 0.4)
        ));
      }
      const curve = new THREE.CatmullRomCurve3(points);
      const tentGeo = new THREE.TubeGeometry(curve, segs, 0.015 * size + 0.005, 6, false);
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
        mesh: tentacle, basePoints: points.map(p => p.clone()), angle, length: tentLen, segs,
        phaseOffset: Math.random() * Math.PI * 2,
        swaySpeed: 0.5 + Math.random() * 0.5,
      });
    }

    // Soft glow sprite at center
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

    // Point light for illumination
    const light = new THREE.PointLight(color, 1, 10);
    light.position.y = -0.1;
    group.add(light);

    return {
      group, bell, inner, rim, size, tentacles, oralArms, light, sprite,
      phase: Math.random() * Math.PI * 2,
      driftX: (Math.random() - 0.5) * 0.4,
      driftZ: (Math.random() - 0.5) * 0.4,
      pulseSpeed: 0.8 + Math.random() * 0.4,
    };
  }

  update(dt, playerPos) {
    this.time += dt;
    this._frameCount++;
    const rebuildTentacles = this._frameCount % 6 === 0;

    for (const jelly of this.jellies) {
      const t = this.time;
      // Pulsing movement
      const pulse = Math.sin(t * jelly.pulseSpeed + jelly.phase);
      const moveUp = pulse > 0 ? pulse * 0.4 : 0;

      jelly.group.position.y += (moveUp - 0.12) * dt;
      jelly.group.position.x += jelly.driftX * dt;
      jelly.group.position.z += jelly.driftZ * dt;

      // Bell squish animation - more organic deformation
      const squishX = 1 + pulse * 0.12;
      const squishY = 1 - pulse * 0.1;
      jelly.bell.scale.set(squishX, squishY, squishX);
      jelly.inner.scale.set(squishX * 0.98, squishY * 0.95, squishX * 0.98);
      jelly.rim.scale.set(squishX, 1, squishX);

      // Glow pulsing
      jelly.light.intensity = 0.6 + pulse * 0.5;
      jelly.sprite.material.opacity = 0.15 + pulse * 0.1;

      // Animate tentacles with flowing motion (throttled to reduce GC pressure)
      if (rebuildTentacles) {
        for (const tent of jelly.tentacles) {
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
          const newGeo = new THREE.TubeGeometry(newCurve, tent.segs, 0.015 * jelly.size + 0.005, 4, false);
          tent.mesh.geometry.dispose();
          tent.mesh.geometry = newGeo;
        }

        // Animate oral arms
        for (const arm of jelly.oralArms) {
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
          const newGeo = new THREE.TubeGeometry(newCurve, arm.segs, 0.04 * jelly.size + 0.01, 6, false);
          arm.mesh.geometry.dispose();
          arm.mesh.geometry = newGeo;
        }
      }

      // Slow rotation
      jelly.group.rotation.y += dt * 0.08;

      // Respawn if too far
      const dist = jelly.group.position.distanceTo(playerPos);
      if (dist > 120) {
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
    return this.jellies.map(j => j.group.position);
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (child.material.map) child.material.map.dispose();
        child.material.dispose();
      }
    });
  }
}
