import * as THREE from 'three/webgpu';
import {
  clamp,
  dot,
  exp,
  float,
  floor,
  fract,
  instancedBufferAttribute,
  instancedDynamicBufferAttribute,
  max,
  mix,
  positionView,
  positionWorld,
  pow,
  smoothstep,
  sin,
  step,
  texture,
  uniform,
  uv,
  varying,
  vec2,
  vec3,
} from 'three/tsl';
import { qualityManager } from '../QualityManager.js';

function cloneUniformValue(value) {
  return value?.clone ? value.clone() : value;
}

function attachUniforms(material, uniforms) {
  material.uniforms = uniforms;
  material.userData.uniforms = uniforms;
  return material;
}

function createUniformMap(definitions) {
  const uniforms = {};

  for (const [key, value] of Object.entries(definitions)) {
    uniforms[key] = uniform(cloneUniformValue(value));
  }

  return uniforms;
}

function hash2D(point) {
  return fract(sin(dot(point, vec2(127.1, 311.7))).mul(43758.5453));
}

function noise2D(point) {
  const cell = floor(point).toVar();
  const fraction = fract(point).toVar();

  fraction.assign(fraction.mul(fraction).mul(vec2(3.0).sub(fraction.mul(2.0))));

  const a = hash2D(cell);
  const b = hash2D(cell.add(vec2(1.0, 0.0)));
  const c = hash2D(cell.add(vec2(0.0, 1.0)));
  const d = hash2D(cell.add(vec2(1.0, 1.0)));

  return mix(mix(a, b, fraction.x), mix(c, d, fraction.x), fraction.y);
}

function fbm2D(point) {
  const octave0 = noise2D(point).mul(0.5);
  const octave1Point = point.mul(2.0).add(vec2(100.0));
  const octave1 = noise2D(octave1Point).mul(0.25);
  const octave2Point = octave1Point.mul(2.0).add(vec2(100.0));
  const octave2 = noise2D(octave2Point).mul(0.125);
  const octave3Point = octave2Point.mul(2.0).add(vec2(100.0));
  const octave3 = noise2D(octave3Point).mul(0.0625);
  const octave4Point = octave3Point.mul(2.0).add(vec2(100.0));
  const octave4 = noise2D(octave4Point).mul(0.03125);

  return octave0.add(octave1).add(octave2).add(octave3).add(octave4);
}

function createParticleMaterial(geometry, snowTexture, baseSize, baseOpacity) {
  const uniforms = createUniformMap({
    time: 0,
    baseSize,
    baseOpacity,
  });
  const centerNode = instancedDynamicBufferAttribute(geometry.getAttribute('particleCenter'), 'vec3');
  const sizeNode = instancedBufferAttribute(geometry.getAttribute('particleSize'), 'float');
  const colorNode = instancedBufferAttribute(geometry.getAttribute('particleColor'), 'vec3');
  const seedNode = instancedBufferAttribute(geometry.getAttribute('particleSeed'), 'float');
  const phaseNode = instancedBufferAttribute(geometry.getAttribute('particlePhase'), 'float');
  const material = new THREE.PointsNodeMaterial();
  const driftedCenter = centerNode.add(vec3(
    sin(uniforms.time.mul(0.1).add(seedNode).add(phaseNode)).mul(1.5),
    sin(uniforms.time.mul(0.08).add(phaseNode)).mul(0.6),
    uniforms.time.mul(0.1).add(seedNode).add(phaseNode).mul(0.7).cos().mul(1.5)
  ));
  material.positionNode = driftedCenter;
  material.sizeAttenuation = true;

  const viewDist = positionView.z.negate();
  const bokeh = varying(step(0.95, fract(seedNode.mul(127.1).add(phaseNode.mul(311.7)))));
  const focusDist = 30.0;
  const coc = viewDist.sub(focusDist).abs().div(focusDist);
  const dofScale = float(1.0).add(coc.mul(0.35));
  const bokehScale = float(1.0).add(bokeh.mul(1.4));
  const scatter = float(1.0).add(0.35.div(float(1.0).add(viewDist.mul(0.02))));
  const bokehBright = float(1.0).add(bokeh.mul(2.0));
  const distFade = smoothstep(3.0, 14.0, viewDist);

  material.sizeNode = clamp(
    sizeNode
      .mul(uniforms.baseSize)
      .mul(dofScale)
      .mul(bokehScale)
      .mul(float(300.0).div(max(viewDist, 1.0))),
    0.5,
    16.0,
  );
  material.colorNode = varying(pow(colorNode, vec3(2.2))).mul(scatter).mul(bokehBright);
  material.opacityNode = texture(snowTexture, uv()).a.mul(uniforms.baseOpacity).mul(distFade);
  material.transparent = true;
  material.blending = THREE.AdditiveBlending;
  material.depthWrite = false;
  material.fog = false;

  return attachUniforms(material, uniforms);
}

function createGodRayMaterial(seedValue) {
  const uniforms = createUniformMap({
    time: 0,
    opacity: 1,
    seed: seedValue,
  });
  const material = new THREE.MeshBasicNodeMaterial();
  const uvNode = varying(uv());
  const worldPos = varying(positionWorld);
  const axial = pow(uvNode.y, 0.35).mul(smoothstep(0.0, 0.05, uvNode.y));
  const cx = uvNode.x.sub(0.5).mul(2.0);
  const baseRadial = exp(cx.mul(cx).mul(-8.0));
  const timeNode = uniforms.time.mul(0.06);
  const edgeNoise = fbm2D(vec2(
    worldPos.y.mul(0.03).add(uniforms.seed.mul(13.7)).add(timeNode),
    worldPos.x.mul(0.02).add(uniforms.seed.mul(7.3))
  )).mul(2.0).sub(1.0);
  const radial = smoothstep(0.05, 0.55, baseRadial.add(edgeNoise.mul(0.3)));
  const shimmer = fbm2D(vec2(
    worldPos.x.mul(0.05).add(timeNode.mul(0.8)).add(uniforms.seed.mul(3.1)),
    worldPos.y.mul(0.04).sub(timeNode.mul(0.5))
  ));
  const intensity = float(0.55).add(shimmer.mul(0.55));
  const alpha = axial.mul(radial).mul(intensity).mul(uniforms.opacity);
  const warm = pow(vec3(0.5, 0.7, 0.85), vec3(2.2));
  const cool = pow(vec3(0.25, 0.45, 0.65), vec3(2.2));

  material.colorNode = mix(cool, warm, radial.mul(axial));
  material.opacityNode = alpha.mul(0.24);
  material.transparent = true;
  material.side = THREE.DoubleSide;
  material.blending = THREE.AdditiveBlending;
  material.depthWrite = false;
  material.fog = false;

  return attachUniforms(material, uniforms);
}

export class Ocean {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];
    this.time = 0;

    // Ambient light — richer blue fill for underwater atmosphere
    this.ambientLight = new THREE.AmbientLight(0x2a4466, 0.22);
    scene.add(this.ambientLight);

    // Sun light from above (only visible near surface).
    // Dynamic shadow-map compilation was causing multi-second startup stalls
    // on the first interactive render, so keep the light shadowless.
    this.sunLight = new THREE.DirectionalLight(0x7099bb, 0.45);
    this.sunLight.position.set(50, 100, 30);
    this.sunLight.castShadow = false;
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
      emissive: new THREE.Color(0x336688),
      emissiveIntensity: 0.15,
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
    const geo = new THREE.Sprite().geometry.clone();
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

    const centerAttr = new THREE.InstancedBufferAttribute(positions, 3);
    centerAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('particleCenter', centerAttr);
    geo.setAttribute('particleSize', new THREE.InstancedBufferAttribute(sizes, 1));
    geo.setAttribute('particleColor', new THREE.InstancedBufferAttribute(colors, 3));
    geo.setAttribute('particleSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    geo.setAttribute('particlePhase', new THREE.InstancedBufferAttribute(phases, 1));

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

    this.particleCenters = positions;
    this.particleSeeds = seeds;
    this.particlePhases = phases;

    const mat = createParticleMaterial(geo, snowTexture, this.particleBaseSize, this.particleBaseOpacity);

    // WebGPU honors textured particle sizing for PointsNodeMaterial on instanced Sprites.
    this.particleSystem = new THREE.Sprite(mat);
    this.particleSystem.geometry = geo;
    this.particleSystem.count = count;
    this.particleSystem.frustumCulled = false;
    this.scene.add(this.particleSystem);
  }

  _createCausticLights() {
    this.causticLights = [];
    for (let i = 0; i < 10; i++) {
      const light = new THREE.PointLight(0x88ccff, 0.5, 70);
      light.userData.duwCategory = 'flora_decor';
      light.position.set(
        (Math.random() - 0.5) * 50,
        -3 - Math.random() * 18,
        (Math.random() - 0.5) * 50
      );
      this.scene.add(light);
      this.causticLights.push({
        light,
        offset: Math.random() * Math.PI * 2,
        speed: 0.5 + Math.random() * 1.2,
        baseIntensity: 0.35 + Math.random() * 0.4,
      });
    }
  }

  _createGodRays() {
    // God rays: individual billboard planes that always face the camera
    // on Y-axis. Each ray is a single tall PlaneGeometry with a soft
    // procedural noise shader — no geometry edges visible.
    this.godRayGroup = new THREE.Group();
    this.godRays = [];
    const rayCount = 14;

    for (let i = 0; i < rayCount; i++) {
      const width = 8 + Math.random() * 16;
      const height = 65 + Math.random() * 55;
      const geo = new THREE.PlaneGeometry(width, height, 1, 1);
      const mat = createGodRayMaterial(i + Math.random());
      const mesh = new THREE.Mesh(geo, mat);

      // Spread rays around the player in a ring
      const angle = (i / rayCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
      const dist = 15 + Math.random() * 40;
      mesh.position.set(
        Math.sin(angle) * dist,
        -height * 0.3,
        Math.cos(angle) * dist
      );

      // Slight random tilt for variety
      mesh.rotation.z = (Math.random() - 0.5) * 0.15;

      this.godRayGroup.add(mesh);
      this.godRays.push({ mesh, mat, height });
    }

    this.scene.add(this.godRayGroup);
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

    // Dynamic surface emissive: shimmer strongest in shallow water
    const emissivePulse = 0.12 + Math.sin(this.time * 0.7) * 0.06 + Math.sin(this.time * 1.3 + 0.5) * 0.03;
    const surfaceEmissiveFade = 1.0 - THREE.MathUtils.smoothstep(depth, 30, 80);
    this.waterSurface.material.emissiveIntensity = emissivePulse * surfaceEmissiveFade;

    // Update GPU particle time uniform
    this.particleSystem.material.uniforms.time.value = this.time;

    // CPU respawn: only update particles that drift too far from the player
    const ppos = this.particleCenters;
    const seeds = this.particleSeeds;
    const phases = this.particlePhases;
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
      this.particleSystem.geometry.attributes.particleCenter.needsUpdate = true;
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
      const causticFade = 1.0 - THREE.MathUtils.smoothstep(depth, 40, 100);
      c.light.intensity = causticFade > 0
        ? c.baseIntensity * (1 + Math.sin(this.time * c.speed + c.offset) * 0.6) * causticFade
        : 0;
      // Follow player horizontally
      c.light.position.x = playerPos.x + Math.sin(c.offset + this.time * 0.2) * 20;
      c.light.position.z = playerPos.z + Math.cos(c.offset + this.time * 0.15) * 20;
    }

    // God rays: billboard each plane toward camera, update uniforms
    if (depth < 80) {
      const depthFade = 1.0 - THREE.MathUtils.smoothstep(depth, 40, 80);
      this.godRayGroup.visible = true;
      this.godRayGroup.position.set(playerPos.x, 0, playerPos.z);
      for (const ray of this.godRays) {
        ray.mat.uniforms.opacity.value = depthFade;
        ray.mat.uniforms.time.value = this.time;
        // Y-axis billboard: face the camera horizontally
        const dx = -ray.mesh.position.x; // cam local X is 0
        const dz = -ray.mesh.position.z; // cam local Z is 0
        ray.mesh.rotation.y = Math.atan2(dx, dz);
      }
    } else {
      this.godRayGroup.visible = false;
    }

    // Sun light follows player but fades with depth.
    this.sunLight.position.set(playerPos.x + 50, 100, playerPos.z + 30);
    this.sunLight.target.position.set(playerPos.x, playerPos.y, playerPos.z);
    const sunFade = depth < 100 ? 0.6 * (1 - depth / 100) : 0;
    this.sunLight.intensity = sunFade;
  }
}

