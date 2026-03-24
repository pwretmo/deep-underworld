import * as THREE from 'three';
import { qualityManager } from '../QualityManager.js';

export class Ocean {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];
    this.time = 0;

    // Ambient light - dim for darker atmosphere
    this.ambientLight = new THREE.AmbientLight(0x223344, 0.2);
    scene.add(this.ambientLight);

    // Sun light from above (only visible near surface)
    this.sunLight = new THREE.DirectionalLight(0x6699aa, 0.4);
    this.sunLight.position.set(50, 100, 30);
    this.sunLight.castShadow = true;
    const shadowSize = qualityManager.getSettings().shadowMapSize || 1024;
    this.sunLight.shadow.mapSize.set(shadowSize, shadowSize);
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 150;
    this.sunLight.shadow.camera.left = -60;
    this.sunLight.shadow.camera.right = 60;
    this.sunLight.shadow.camera.top = 60;
    this.sunLight.shadow.camera.bottom = -60;
    scene.add(this.sunLight);
    scene.add(this.sunLight.target);

    // Water surface plane (visible from below)
    this._createWaterSurface();

    // Floating particles (marine snow, plankton)
    this.particleBaseSize = 0.15;
    this.particleBaseOpacity = 0.35;
    this._createParticles();

    // Caustics light cookies near surface
    this._createCausticLights();

    // God rays
    this._createGodRays();

    // Initial fog
    scene.fog = new THREE.Fog(0x006994, 5, 300);
    scene.background = new THREE.Color(0x006994);

    // React to quality tier changes for shadow map size
    window.addEventListener('qualitychange', (e) => {
      const size = e.detail.settings.shadowMapSize || 1024;
      this.sunLight.shadow.mapSize.set(size, size);
      if (this.sunLight.shadow.map) {
        this.sunLight.shadow.map.dispose();
        this.sunLight.shadow.map = null;
      }
    });
  }

  _createWaterSurface() {
    const geo = new THREE.PlaneGeometry(2000, 2000, 100, 100);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x4488bb,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
      metalness: 0.9,
      roughness: 0.1,
    });
    this.waterSurface = new THREE.Mesh(geo, mat);
    this.waterSurface.rotation.x = -Math.PI / 2;
    this.waterSurface.position.y = 0;
    this.scene.add(this.waterSurface);

    // Store original vertices for animation
    this.waterVertices = geo.attributes.position.array.slice();
  }

  _createParticles() {
    const count = 3000;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 200;
      positions[i * 3 + 1] = -Math.random() * 800;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 200;
      sizes[i] = Math.random() * 2 + 0.5;
      // Whitish particles for marine snow
      colors[i * 3] = 0.6 + Math.random() * 0.4;
      colors[i * 3 + 1] = 0.7 + Math.random() * 0.3;
      colors[i * 3 + 2] = 0.8 + Math.random() * 0.2;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    // Soft circular particle texture
    const pSize = 32;
    const canvas = document.createElement('canvas');
    canvas.width = pSize;
    canvas.height = pSize;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(pSize / 2, pSize / 2, 0, pSize / 2, pSize / 2, pSize / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.3, 'rgba(255,255,255,0.5)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, pSize, pSize);
    const snowTexture = new THREE.CanvasTexture(canvas);

    const mat = new THREE.PointsMaterial({
      size: this.particleBaseSize,
      map: snowTexture,
      vertexColors: true,
      transparent: true,
      opacity: this.particleBaseOpacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });

    this.particleSystem = new THREE.Points(geo, mat);
    this.scene.add(this.particleSystem);
  }

  _createCausticLights() {
    this.causticLights = [];
    for (let i = 0; i < 6; i++) {
      const light = new THREE.PointLight(0x88ccff, 0.3, 50);
      light.position.set(
        (Math.random() - 0.5) * 40,
        -5 - Math.random() * 15,
        (Math.random() - 0.5) * 40
      );
      this.scene.add(light);
      this.causticLights.push({
        light,
        offset: Math.random() * Math.PI * 2,
        speed: 0.5 + Math.random() * 1,
        baseIntensity: 0.2 + Math.random() * 0.3,
      });
    }
  }

  _createGodRays() {
    // Volumetric light shafts using simple cones
    this.godRays = [];
    for (let i = 0; i < 5; i++) {
      const geo = new THREE.CylinderGeometry(0.5, 8, 60, 8, 1, true);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x88bbdd,
        transparent: true,
        opacity: 0.02,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const ray = new THREE.Mesh(geo, mat);
      ray.position.set(
        (Math.random() - 0.5) * 80,
        -15,
        (Math.random() - 0.5) * 80
      );
      ray.rotation.z = (Math.random() - 0.5) * 0.3;
      this.scene.add(ray);
      this.godRays.push({ mesh: ray, baseOpacity: 0.015 + Math.random() * 0.015, phase: Math.random() * Math.PI * 2 });
    }
  }

  update(dt, depth, playerPos) {
    this.time += dt;
    const depthBlend = THREE.MathUtils.smoothstep(depth, 45, 320);
    const abyssBlend = THREE.MathUtils.smoothstep(depth, 380, 760);

    // Animate water surface
    const posAttr = this.waterSurface.geometry.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const baseY = this.waterVertices[i * 3 + 2]; // z in original is y after rotation
      const x = this.waterVertices[i * 3];
      const z = this.waterVertices[i * 3 + 1];
      posAttr.array[i * 3 + 2] = baseY +
        Math.sin(x * 0.05 + this.time * 0.5) * 0.5 +
        Math.cos(z * 0.03 + this.time * 0.3) * 0.3;
    }
    posAttr.needsUpdate = true;

    // Move particle system to follow player
    const ppos = this.particleSystem.geometry.attributes.position.array;
    for (let i = 0; i < ppos.length; i += 3) {
      // Slow drift
      ppos[i] += Math.sin(this.time * 0.1 + i) * dt * 0.05;
      ppos[i + 1] += dt * 0.2; // float up slowly
      ppos[i + 2] += Math.cos(this.time * 0.1 + i) * dt * 0.05;

      // Respawn particles that drift too far
      const dx = ppos[i] - playerPos.x;
      const dy = ppos[i + 1] - playerPos.y;
      const dz = ppos[i + 2] - playerPos.z;
      if (dx * dx + dy * dy + dz * dz > 10000 || ppos[i + 1] > 0) {
        const horizontalRadius = THREE.MathUtils.lerp(140, 85, depthBlend);
        const verticalSpan = THREE.MathUtils.lerp(95, 180, depthBlend);
        const abyssOffset = THREE.MathUtils.lerp(8, 30, abyssBlend);
        ppos[i] = playerPos.x + (Math.random() - 0.5) * horizontalRadius;
        ppos[i + 1] = playerPos.y - Math.random() * verticalSpan - abyssOffset;
        ppos[i + 2] = playerPos.z + (Math.random() - 0.5) * horizontalRadius;
      }
    }
    this.particleSystem.geometry.attributes.position.needsUpdate = true;

    // Denser, slightly larger snow in mid/deep water, then tighten in abyss for readability.
    const deepOpacity = THREE.MathUtils.lerp(this.particleBaseOpacity * 0.68, this.particleBaseOpacity * 1.55, depthBlend);
    const abyssFade = THREE.MathUtils.lerp(1.0, 0.86, abyssBlend);
    this.particleSystem.material.opacity = deepOpacity * abyssFade;

    const deepSize = THREE.MathUtils.lerp(this.particleBaseSize * 0.9, this.particleBaseSize * 1.45, depthBlend);
    const abyssSizeClamp = THREE.MathUtils.lerp(1.0, 0.9, abyssBlend);
    this.particleSystem.material.size = deepSize * abyssSizeClamp;

    // Animate caustic lights (only near surface)
    for (const c of this.causticLights) {
      c.light.intensity = depth < 80
        ? c.baseIntensity * (1 + Math.sin(this.time * c.speed + c.offset) * 0.5) * (1 - depth / 80)
        : 0;
      // Follow player horizontally
      c.light.position.x = playerPos.x + Math.sin(c.offset + this.time * 0.2) * 20;
      c.light.position.z = playerPos.z + Math.cos(c.offset + this.time * 0.15) * 20;
    }

    // God rays visibility
    for (const r of this.godRays) {
      r.mesh.material.opacity = depth < 60
        ? r.baseOpacity * (1 - depth / 60) * (0.8 + Math.sin(this.time * 0.5 + r.phase) * 0.2)
        : 0;
      r.mesh.position.x = playerPos.x + Math.sin(r.phase) * 40;
      r.mesh.position.z = playerPos.z + Math.cos(r.phase) * 40;
    }

    // Sun light follows player but fades with depth; disable shadows when too deep
    this.sunLight.position.set(playerPos.x + 50, 100, playerPos.z + 30);
    this.sunLight.target.position.set(playerPos.x, playerPos.y, playerPos.z);
    const sunFade = depth < 100 ? 0.6 * (1 - depth / 100) : 0;
    this.sunLight.intensity = sunFade;
    this.sunLight.castShadow = depth < 120;
  }
}
