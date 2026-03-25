import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
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
    const seeds = new Float32Array(count);
    const phases = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 200;
      positions[i * 3 + 1] = -Math.random() * 800;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 200;
      sizes[i] = Math.random() * 2 + 0.5;
      seeds[i] = Math.random() * 1000;
      phases[i] = Math.random() * Math.PI * 2;
      // Whitish particles for marine snow
      colors[i * 3] = 0.6 + Math.random() * 0.4;
      colors[i * 3 + 1] = 0.7 + Math.random() * 0.3;
      colors[i * 3 + 2] = 0.8 + Math.random() * 0.2;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
    geo.setAttribute('phase', new THREE.BufferAttribute(phases, 1));

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

    // GPU-driven ShaderMaterial: drift computed in vertex shader
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        baseSize: { value: this.particleBaseSize },
        baseOpacity: { value: this.particleBaseOpacity },
        map: { value: snowTexture },
      },
      vertexShader: /* glsl */ `
        attribute float size;
        attribute float seed;
        attribute float phase;
        attribute vec3 color;
        uniform float time;
        uniform float baseSize;
        varying vec3 vColor;

        void main() {
          vColor = color;
          // GPU-driven drift: oscillation around base position
          vec3 pos = position;
          float idx = seed + phase;
          pos.x += sin(time * 0.1 + idx) * 1.5;
          pos.y += sin(time * 0.08 + phase) * 0.6;
          pos.z += cos(time * 0.1 + idx * 0.7) * 1.5;

          vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
          gl_PointSize = size * baseSize * (300.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        uniform float baseOpacity;
        varying vec3 vColor;

        void main() {
          vec4 texColor = texture2D(map, gl_PointCoord);
          gl_FragColor = vec4(vColor, baseOpacity) * texColor;
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
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
    // Volumetric light shafts — merged into a single draw call with per-vertex
    // radial and axial opacity falloff so they look like soft light, not tubes.
    this.godRayData = [];
    const geometries = [];

    for (let i = 0; i < 5; i++) {
      // More radial segments (16) for round cross-section, more height
      // segments (10) for smooth axial gradient
      const heightSegs = 10;
      const radialSegs = 16;
      const height = 70;
      const topRadius = 2;
      const bottomRadius = 14;
      const geo = new THREE.CylinderGeometry(
        topRadius, bottomRadius, height, radialSegs, heightSegs, true
      );

      // Bake per-vertex alpha into a color attribute:
      //   - axial: bright at top (surface), fading to 0 at bottom
      //   - radial: bright at centre axis, fading toward outer edge
      const posArr = geo.attributes.position.array;
      const count = geo.attributes.position.count;
      const alphas = new Float32Array(count);
      const halfH = height / 2;

      for (let v = 0; v < count; v++) {
        const x = posArr[v * 3];
        const y = posArr[v * 3 + 1];   // along cylinder axis
        const z = posArr[v * 3 + 2];

        // axialT: 0 at bottom, 1 at top
        const axialT = THREE.MathUtils.clamp((y + halfH) / height, 0, 1);
        // smooth cubic ease-in for softer bottom fade
        const axialFade = axialT * axialT * (3 - 2 * axialT);

        // radius at this height for the cone
        const expectedR = THREE.MathUtils.lerp(bottomRadius, topRadius, axialT);
        const actualR = Math.sqrt(x * x + z * z);
        const radialT = expectedR > 0.001 ? THREE.MathUtils.clamp(actualR / expectedR, 0, 1) : 0;
        // bell-curve-ish radial falloff (bright core, soft edges)
        const radialFade = Math.exp(-radialT * radialT * 3.0);

        alphas[v] = axialFade * radialFade;
      }
      geo.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));

      const phase = Math.random() * Math.PI * 2;
      const baseOpacity = 0.015 + Math.random() * 0.015;
      const offsetX = Math.sin(phase) * 40;
      const offsetZ = Math.cos(phase) * 40;
      const rotZ = (Math.random() - 0.5) * 0.3;

      const matrix = new THREE.Matrix4();
      matrix.makeRotationZ(rotZ);
      matrix.setPosition(offsetX, -15, offsetZ);
      geo.applyMatrix4(matrix);

      geometries.push(geo);
      this.godRayData.push({ phase, baseOpacity, offsetX, offsetZ });
    }

    const mergedGeo = mergeGeometries(geometries, false);
    for (const geo of geometries) geo.dispose();

    this.godRayMaterial = new THREE.ShaderMaterial({
      uniforms: {
        color: { value: new THREE.Color(0x88bbdd) },
        opacity: { value: 0.02 },
      },
      vertexShader: /* glsl */ `
        attribute float alpha;
        varying float vAlpha;
        void main() {
          vAlpha = alpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 color;
        uniform float opacity;
        varying float vAlpha;
        void main() {
          gl_FragColor = vec4(color, opacity * vAlpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.godRayMesh = new THREE.Mesh(mergedGeo, this.godRayMaterial);
    this.scene.add(this.godRayMesh);
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

    // Update GPU particle time uniform
    this.particleSystem.material.uniforms.time.value = this.time;

    // CPU respawn: only update particles that drift too far from the player
    const ppos = this.particleSystem.geometry.attributes.position.array;
    const seeds = this.particleSystem.geometry.attributes.seed.array;
    const phases = this.particleSystem.geometry.attributes.phase.array;
    let respawned = false;
    for (let i = 0; i < ppos.length; i += 3) {
      const pi = i / 3;
      // Estimate GPU-displaced position for distance check
      const idx = seeds[pi] + phases[pi];
      const ex = ppos[i] + Math.sin(this.time * 0.1 + idx) * 1.5;
      const ey = ppos[i + 1] + Math.sin(this.time * 0.08 + phases[pi]) * 0.6;
      const ez = ppos[i + 2] + Math.cos(this.time * 0.1 + idx * 0.7) * 1.5;

      // Also apply upward drift on CPU (slow float up)
      ppos[i + 1] += dt * 0.2;

      const dx = ex - playerPos.x;
      const dy = ey - playerPos.y;
      const dz = ez - playerPos.z;
      if (dx * dx + dy * dy + dz * dz > 10000 || ppos[i + 1] > 0) {
        const horizontalRadius = THREE.MathUtils.lerp(140, 85, depthBlend);
        const verticalSpan = THREE.MathUtils.lerp(95, 180, depthBlend);
        const abyssOffset = THREE.MathUtils.lerp(8, 30, abyssBlend);
        ppos[i] = playerPos.x + (Math.random() - 0.5) * horizontalRadius;
        ppos[i + 1] = playerPos.y - Math.random() * verticalSpan - abyssOffset;
        ppos[i + 2] = playerPos.z + (Math.random() - 0.5) * horizontalRadius;
        respawned = true;
      }
    }
    if (respawned) {
      this.particleSystem.geometry.attributes.position.needsUpdate = true;
    }

    // Denser, slightly larger snow in mid/deep water, then tighten in abyss for readability.
    const deepOpacity = THREE.MathUtils.lerp(this.particleBaseOpacity * 0.68, this.particleBaseOpacity * 1.55, depthBlend);
    const abyssFade = THREE.MathUtils.lerp(1.0, 0.86, abyssBlend);
    this.particleSystem.material.uniforms.baseOpacity.value = deepOpacity * abyssFade;

    const deepSize = THREE.MathUtils.lerp(this.particleBaseSize * 0.9, this.particleBaseSize * 1.45, depthBlend);
    const abyssSizeClamp = THREE.MathUtils.lerp(1.0, 0.9, abyssBlend);
    this.particleSystem.material.uniforms.baseSize.value = deepSize * abyssSizeClamp;

    // Animate caustic lights (only near surface)
    for (const c of this.causticLights) {
      c.light.intensity = depth < 80
        ? c.baseIntensity * (1 + Math.sin(this.time * c.speed + c.offset) * 0.5) * (1 - depth / 80)
        : 0;
      // Follow player horizontally
      c.light.position.x = playerPos.x + Math.sin(c.offset + this.time * 0.2) * 20;
      c.light.position.z = playerPos.z + Math.cos(c.offset + this.time * 0.15) * 20;
    }

    // God rays visibility — single merged mesh follows player
    if (depth < 60) {
      let avgOpacity = 0;
      for (const r of this.godRayData) {
        avgOpacity += r.baseOpacity * (1 - depth / 60) * (0.8 + Math.sin(this.time * 0.5 + r.phase) * 0.2);
      }
      this.godRayMaterial.uniforms.opacity.value = avgOpacity / this.godRayData.length;
      this.godRayMesh.visible = true;
      this.godRayMesh.position.set(playerPos.x, 0, playerPos.z);
    } else {
      this.godRayMesh.visible = false;
    }

    // Sun light follows player but fades with depth; disable shadows when too deep
    this.sunLight.position.set(playerPos.x + 50, 100, playerPos.z + 30);
    this.sunLight.target.position.set(playerPos.x, playerPos.y, playerPos.z);
    const sunFade = depth < 100 ? 0.6 * (1 - depth / 100) : 0;
    this.sunLight.intensity = sunFade;
    this.sunLight.castShadow = depth < 120;
  }
}
