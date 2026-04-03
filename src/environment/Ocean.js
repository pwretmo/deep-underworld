import * as THREE from "three/webgpu";
import {
  abs,
  clamp,
  compute,
  cos,
  dot,
  exp,
  exponentialHeightFogFactor,
  float,
  floor,
  fog,
  Fn,
  fract,
  If,
  instancedBufferAttribute,
  instanceIndex,
  length,
  materialOpacity,
  max,
  mix,
  normalView,
  positionLocal,
  positionView,
  positionWorld,
  pow,
  sin,
  smoothstep,
  step,
  storage,
  texture,
  uniform,
  uv,
  varying,
  vec2,
  vec3,
} from "three/tsl";
import { qualityManager } from "../QualityManager.js";
import { expandGeometryBounds } from "../utils/geometryBounds.js";
import { WaveHeightfield } from "./WaveHeightfield.js";

/**
 * Tiers that use compute-driven wave heightfield instead of inline TSL vertex waves.
 */
const COMPUTE_WAVE_TIERS = new Set(["medium", "high", "ultra"]);

const WATER_SURFACE_X_WAVE_SCALE = 0.05;
const WATER_SURFACE_X_WAVE_SPEED = 0.5;
const WATER_SURFACE_X_WAVE_AMPLITUDE = 0.5;
const WATER_SURFACE_Z_WAVE_SCALE = 0.03;
const WATER_SURFACE_Z_WAVE_SPEED = 0.3;
const WATER_SURFACE_Z_WAVE_AMPLITUDE = 0.3;
const WATER_SURFACE_WAVE_FALLOFF_START = 10;
const WATER_SURFACE_WAVE_FALLOFF_END = 32;
const WATER_SURFACE_HORIZON_WAVE_FACTOR = 0.0;
const WATER_SURFACE_BOUNDS_PADDING =
  WATER_SURFACE_X_WAVE_AMPLITUDE + WATER_SURFACE_Z_WAVE_AMPLITUDE;
const MARINE_SNOW_VIEW_SCALE = 165.0;
const MARINE_SNOW_MIN_SCREEN_SIZE = 0.35;
const MARINE_SNOW_MAX_SCREEN_SIZE = 4.0;
const MARINE_SNOW_TEXTURE_RESOLUTION = 48;

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
  const cell = floor(point);
  const fraction = fract(point);
  const smoothedFraction = fraction
    .mul(fraction)
    .mul(vec2(3.0).sub(fraction.mul(2.0)));

  const a = hash2D(cell);
  const b = hash2D(cell.add(vec2(1.0, 0.0)));
  const c = hash2D(cell.add(vec2(0.0, 1.0)));
  const d = hash2D(cell.add(vec2(1.0, 1.0)));

  return mix(
    mix(a, b, smoothedFraction.x),
    mix(c, d, smoothedFraction.x),
    smoothedFraction.y,
  );
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

function createParticleMaterial(
  geometry,
  snowTexture,
  baseSize,
  baseOpacity,
  posStorageNode,
) {
  const uniforms = createUniformMap({
    time: 0,
    baseSize,
    baseOpacity,
  });
  const centerNode = posStorageNode.element(instanceIndex).toVec3();
  const sizeNode = instancedBufferAttribute(
    geometry.getAttribute("particleSize"),
    "float",
  );
  const colorNode = instancedBufferAttribute(
    geometry.getAttribute("particleColor"),
    "vec3",
  );
  const seedNode = instancedBufferAttribute(
    geometry.getAttribute("particleSeed"),
    "float",
  );
  const phaseNode = instancedBufferAttribute(
    geometry.getAttribute("particlePhase"),
    "float",
  );
  const material = new THREE.PointsNodeMaterial();
  const driftedCenter = centerNode.add(
    vec3(
      sin(uniforms.time.mul(0.05).add(seedNode.mul(0.013)).add(phaseNode))
        .mul(0.45)
        .add(cos(uniforms.time.mul(0.023).add(seedNode.mul(0.021))).mul(0.18)),
      sin(
        uniforms.time
          .mul(0.04)
          .add(seedNode.mul(0.009))
          .add(phaseNode.mul(0.6)),
      ).mul(0.12),
      cos(
        uniforms.time
          .mul(0.047)
          .add(seedNode.mul(0.015))
          .add(phaseNode.mul(1.2)),
      )
        .mul(0.45)
        .add(sin(uniforms.time.mul(0.028).add(seedNode.mul(0.019))).mul(0.18)),
    ),
  );
  material.positionNode = driftedCenter;
  material.sizeAttenuation = true;

  const viewDist = varying(positionView.z.negate());
  const screenScale = float(MARINE_SNOW_VIEW_SCALE).div(max(viewDist, 1.0));
  const nearFade = smoothstep(3.0, 11.0, viewDist);
  const farFade = float(1.0).sub(smoothstep(75.0, 150.0, viewDist).mul(0.2));
  const translucency = float(0.72).add(
    fract(seedNode.mul(53.17).add(phaseNode.mul(7.13))).mul(0.28),
  );
  const brightness = float(0.68).add(
    float(0.2).div(float(1.0).add(viewDist.mul(0.04))),
  );

  material.sizeNode = clamp(
    sizeNode.mul(uniforms.baseSize).mul(screenScale),
    MARINE_SNOW_MIN_SCREEN_SIZE,
    MARINE_SNOW_MAX_SCREEN_SIZE,
  );
  material.colorNode = varying(pow(colorNode, vec3(2.2))).mul(brightness);
  material.opacityNode = texture(snowTexture, uv())
    .a.mul(uniforms.baseOpacity)
    .mul(translucency)
    .mul(nearFade)
    .mul(farFade);
  material.transparent = true;
  material.blending = THREE.NormalBlending;
  material.depthWrite = false;
  material.fog = true;

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
  const edgeNoise = fbm2D(
    vec2(
      worldPos.y.mul(0.03).add(uniforms.seed.mul(13.7)).add(timeNode),
      worldPos.x.mul(0.02).add(uniforms.seed.mul(7.3)),
    ),
  )
    .mul(2.0)
    .sub(1.0);
  const radial = smoothstep(0.05, 0.55, baseRadial.add(edgeNoise.mul(0.3)));
  const shimmer = fbm2D(
    vec2(
      worldPos.x.mul(0.05).add(timeNode.mul(0.8)).add(uniforms.seed.mul(3.1)),
      worldPos.y.mul(0.04).sub(timeNode.mul(0.5)),
    ),
  );
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
  constructor(scene, options = {}) {
    this.scene = scene;
    this._pointLightBudget = options.pointLightBudget ?? null;
    this.particles = [];
    this.time = 0;
    this.particleCount = 0;
    this._particleSpawnAnchor = new THREE.Vector3();
    this._hasParticleSpawnAnchor = false;
    this._particleTexture = null;
    this._particleComputeStorageAttributes = [];
    this._particleRenderer = null;

    // Wave heightfield (compute-driven, medium+ tiers)
    this._waveHeightfield = null;
    if (COMPUTE_WAVE_TIERS.has(qualityManager.tier)) {
      this._waveHeightfield = new WaveHeightfield(qualityManager.tier);
    }

    // Ambient light — richer blue fill for underwater atmosphere
    this.ambientLight = new THREE.AmbientLight(0x2a4466, 0.50);
    scene.add(this.ambientLight);

    // Sun light from above (only visible near surface).
    // Shadow-map is pre-compiled during PreloadCoordinator warm-up so
    // enabling castShadow here no longer causes a first-frame stall.
    const tier = qualityManager.tier;
    this.sunLight = new THREE.DirectionalLight(0x7099bb, 0.45);
    this.sunLight.position.set(50, 100, 30);
    this.sunLight.castShadow = tier === "high" || tier === "ultra";
    const shadowSize = qualityManager.getSettings().shadowMapSize || 1024;
    this.sunLight.shadow.mapSize.set(shadowSize, shadowSize);
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 150;
    this.sunLight.shadow.camera.left = -60;
    this.sunLight.shadow.camera.right = 60;
    this.sunLight.shadow.camera.top = 60;
    this.sunLight.shadow.camera.bottom = -60;

    // Depth-adaptive shadow bias: increase bias in deeper zones where shadow map precision degrades
    const depthFactor = smoothstep(float(0), float(720), abs(positionWorld.y));
    this.sunLight.shadow.biasNode = mix(
      float(-0.001),
      float(-0.005),
      depthFactor,
    );

    scene.add(this.sunLight);
    scene.add(this.sunLight.target);

    // Water surface plane (visible from below)
    this._createWaterSurface();

    // Floating particles (marine snow, plankton)
    this.particleBaseSize = 0.12;
    this.particleBaseOpacity = 0.22;
    this._rebuildParticles(qualityManager.getSettings());

    // God rays
    this._createGodRays();

    // Exponential height fog via TSL fogNode.
    // fogHeight = 0.0 is the water surface (Y = 0). Fragments at negative Y
    // (underwater) produce a positive distance (0 - positionWorld.y), so fog
    // correctly increases with ocean depth.
    this.fogDensity = uniform(0.0015);
    this.fogHeight = uniform(0.0);
    this.fogColorNode = uniform(new THREE.Color(0x006994));
    scene.fogNode = fog(
      this.fogColorNode,
      exponentialHeightFogFactor(this.fogDensity, this.fogHeight),
    );
    scene.background = new THREE.Color(0x006994);

    // React to quality tier changes for shadow map size and castShadow
    window.addEventListener("qualitychange", (/** @type {CustomEvent} */ e) => {
      const newTier = e.detail.tier;
      const size = e.detail.settings.shadowMapSize || 1024;
      this.sunLight.castShadow = newTier === "high" || newTier === "ultra";
      this.sunLight.shadow.mapSize.set(size, size);
      if (this.sunLight.shadow.map) {
        this.sunLight.shadow.map.dispose();
        this.sunLight.shadow.map = null;
      }
      this._rebuildHeightfield(newTier);
      this._rebuildParticles(/** @type {CustomEvent} */ (e).detail.settings);
      this._rebuildWaterSurface();
    });
  }

  _getMarineSnowParticleCount(settings = qualityManager.getSettings()) {
    return Math.max(1, Math.round(settings.particleCount ?? 1));
  }

  /**
   * Rebuild the wave heightfield for a new quality tier.
   * Disposes the old heightfield and creates a new one (or null for low tier).
   */
  _rebuildHeightfield(tier) {
    if (this._waveHeightfield) {
      this._waveHeightfield.dispose();
      this._waveHeightfield = null;
    }
    if (COMPUTE_WAVE_TIERS.has(tier)) {
      this._waveHeightfield = new WaveHeightfield(tier);
    }
  }

  /**
   * Expose the wave heightfield for external consumers (e.g. CausticPass).
   * Returns null on low tier.
   * @returns {WaveHeightfield|null}
   */
  getWaveHeightfield() {
    return this._waveHeightfield;
  }

  _disposeParticleComputeResources() {
    this.particleCompute?.dispose();

    // Compute-only storage attributes are not owned by the render geometry.
    const attributeManager = this._particleRenderer?._attributes;
    if (attributeManager) {
      for (const attribute of this._particleComputeStorageAttributes) {
        attributeManager.delete(attribute);
      }
    }

    this._particleComputeStorageAttributes = [];
    this.particleCompute = null;
  }

  _disposeParticles() {
    this._disposeParticleComputeResources();

    if (this.particleSystem) {
      this.scene.remove(this.particleSystem);
      this.particleSystem.geometry?.dispose();
      this.particleSystem.material?.dispose();
      this.particleSystem = null;
    }

    this._particleTexture?.dispose();

    this._computeUniforms = null;
    this._particleTexture = null;
    this.particleCount = 0;
  }

  _rebuildParticles(settings = qualityManager.getSettings()) {
    const nextCount = this._getMarineSnowParticleCount(settings);
    if (this.particleSystem && nextCount === this.particleCount) {
      return;
    }

    this._disposeParticles();
    this._createParticles(nextCount);
  }

  _createWaterSurface() {
    const tier = qualityManager.tier;
    const useTransmission = tier === "high" || tier === "ultra";

    const waterSegments = { low: 16, medium: 24, high: 40, ultra: 60 };
    const segments = waterSegments[tier] || 24;
    const geo = new THREE.PlaneGeometry(2000, 2000, segments, segments);

    let mat;
    if (useTransmission) {
      mat = new THREE.MeshPhysicalMaterial({
        color: 0x4488bb,
        transparent: true,
        opacity: 1.0,
        transmission: 0.9,
        thickness: 1.5,
        ior: 1.333,
        roughness: 0.05,
        metalness: 0.0,
        attenuationColor: new THREE.Color(0x1a5c6e),
        attenuationDistance: 8.0,
        side: THREE.DoubleSide,
        emissive: new THREE.Color(0x336688),
        emissiveIntensity: 0.15,
        envMapIntensity: 0.0,
      });
    } else {
      mat = new THREE.MeshStandardMaterial({
        color: 0x2d6388,
        transparent: true,
        opacity: 0.26,
        side: THREE.DoubleSide,
        metalness: 0.0,
        roughness: 0.05,
        envMapIntensity: 0.0,
        emissive: new THREE.Color(0x336688),
        emissiveIntensity: 0.15,
      });
    }

    const viewDir = positionView.negate().normalize();
    const surfaceFacing = abs(dot(normalView, viewDir));
    const horizonFade = smoothstep(0.08, 0.34, surfaceFacing);
    const uniforms = createUniformMap({
      time: 0,
      surfacePhaseOffset: new THREE.Vector2(0, 0),
    });

    // Wave displacement — either from compute heightfield (medium+) or inline TSL (low)
    const waveFade = smoothstep(
      WATER_SURFACE_WAVE_FALLOFF_START,
      WATER_SURFACE_WAVE_FALLOFF_END,
      length(positionLocal.xy),
    );
    const waveStrength = mix(
      float(1.0),
      float(WATER_SURFACE_HORIZON_WAVE_FACTOR),
      waveFade,
    );

    let wave;
    if (this._waveHeightfield) {
      // Compute-driven path: sample the storage buffer heightfield.
      // positionLocal.xy = local mesh coords; surfacePhaseOffset re-centers
      // the heightfield grid around the player (set each frame in update()).
      const localXY = positionLocal.xy;
      wave = this._waveHeightfield
        .createHeightSampleNode(localXY)
        .mul(waveStrength);
    } else {
      // Inline TSL fallback (low tier) — same sinusoidal logic as before
      const waveSamplePoint = positionLocal.xy.add(uniforms.surfacePhaseOffset);
      wave = sin(
        waveSamplePoint.x
          .mul(WATER_SURFACE_X_WAVE_SCALE)
          .add(uniforms.time.mul(WATER_SURFACE_X_WAVE_SPEED)),
      )
        .mul(WATER_SURFACE_X_WAVE_AMPLITUDE)
        .add(
          cos(
            waveSamplePoint.y
              .mul(WATER_SURFACE_Z_WAVE_SCALE)
              .add(uniforms.time.mul(WATER_SURFACE_Z_WAVE_SPEED)),
          ).mul(WATER_SURFACE_Z_WAVE_AMPLITUDE),
        )
        .mul(waveStrength);
    }

    mat.positionNode = vec3(
      positionLocal.x,
      positionLocal.y,
      positionLocal.z.add(wave),
    );
    // Fade the ceiling mesh out at grazing angles so the shallow horizon
    // blends into fog instead of switching abruptly from surface to open water.
    mat.opacityNode = materialOpacity.mul(pow(horizonFade, 1.35));
    mat.depthWrite = false;
    mat.needsUpdate = true;
    attachUniforms(mat, uniforms);
    expandGeometryBounds(geo, "z", WATER_SURFACE_BOUNDS_PADDING);

    this.waterSurface = new THREE.Mesh(geo, mat);
    this.waterSurface.rotation.x = -Math.PI / 2;
    this.waterSurface.position.y = 0;
    this.scene.add(this.waterSurface);

    this._waterSurfaceUsesTransmission = useTransmission;
  }

  _rebuildWaterSurface() {
    if (this.waterSurface) {
      this.scene.remove(this.waterSurface);
      this.waterSurface.geometry.dispose();
      this.waterSurface.material.dispose();
      this.waterSurface = null;
    }
    this._createWaterSurface();
  }

  _createParticles(count = this._getMarineSnowParticleCount()) {
    this.particleCount = count;
    const geo = new THREE.Sprite().geometry.clone();
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const phases = new Float32Array(count);
    const spawnAnchor = this._hasParticleSpawnAnchor
      ? this._particleSpawnAnchor
      : null;

    for (let i = 0; i < count; i++) {
      if (spawnAnchor) {
        positions[i * 3] = spawnAnchor.x + (Math.random() - 0.5) * 140;
        positions[i * 3 + 1] = spawnAnchor.y - (Math.random() * 95 + 8);
        positions[i * 3 + 2] = spawnAnchor.z + (Math.random() - 0.5) * 140;
      } else {
        positions[i * 3] = (Math.random() - 0.5) * 200;
        positions[i * 3 + 1] = -Math.random() * 800;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 200;
      }
      sizes[i] = 0.45 + Math.pow(Math.random(), 1.7) * 1.15;
      seeds[i] = Math.random() * 1000;
      phases[i] = Math.random() * Math.PI * 2;
      const brightness = 0.58 + Math.random() * 0.2;
      // Muted cool particulate helps the field read as marine snow instead of glow.
      colors[i * 3] = brightness * 0.9;
      colors[i * 3 + 1] = brightness;
      colors[i * 3 + 2] = brightness + 0.08 + Math.random() * 0.06;
    }

    // Storage buffer for positions — updated by GPU compute shader
    const posStorageAttr = new THREE.StorageInstancedBufferAttribute(
      positions,
      3,
    );
    const seedStorageAttr = new THREE.StorageInstancedBufferAttribute(seeds, 1);
    const phaseStorageAttr = new THREE.StorageInstancedBufferAttribute(
      phases,
      1,
    );

    geo.setAttribute("particleCenter", posStorageAttr);
    geo.setAttribute(
      "particleSize",
      new THREE.InstancedBufferAttribute(sizes, 1),
    );
    geo.setAttribute(
      "particleColor",
      new THREE.InstancedBufferAttribute(colors, 3),
    );
    geo.setAttribute(
      "particleSeed",
      new THREE.InstancedBufferAttribute(seeds.slice(), 1),
    );
    geo.setAttribute(
      "particlePhase",
      new THREE.InstancedBufferAttribute(phases.slice(), 1),
    );

    // TSL storage buffer nodes for the compute shader
    const posBuffer = storage(posStorageAttr, "vec3", count);
    const seedBuffer = storage(seedStorageAttr, "float", count).toReadOnly();
    const phaseBuffer = storage(phaseStorageAttr, "float", count).toReadOnly();

    // Compute shader uniforms
    this._computeUniforms = {
      dt: uniform(0.016),
      time: uniform(0.0),
      playerPos: uniform(new THREE.Vector3(0, 0, 0)),
      respawnRadius: uniform(140.0),
      respawnVertical: uniform(95.0),
      respawnOffset: uniform(8.0),
    };

    // GPU compute kernel — updates particle positions each frame
    const computeFn = Fn(() => {
      const pos = posBuffer.element(instanceIndex);
      const seed = seedBuffer.element(instanceIndex).toFloat();
      const phase = phaseBuffer.element(instanceIndex).toFloat();
      const time = this._computeUniforms.time;

      // Suspended marine snow meanders laterally and settles gently instead of rising.
      const lateralX = sin(time.mul(0.11).add(seed.mul(0.013)).add(phase))
        .mul(0.28)
        .add(
          cos(time.mul(0.043).add(seed.mul(0.021)).add(phase.mul(0.7))).mul(
            0.12,
          ),
        );
      const lateralZ = cos(
        time.mul(0.097).add(seed.mul(0.017)).add(phase.mul(1.31)),
      )
        .mul(0.24)
        .add(
          sin(time.mul(0.051).add(seed.mul(0.019)).add(phase.mul(0.9))).mul(
            0.14,
          ),
        );
      const verticalDrift = sin(
        time.mul(0.071).add(seed.mul(0.011)).add(phase.mul(0.5)),
      )
        .mul(0.045)
        .add(cos(time.mul(0.037).add(seed.mul(0.023)).add(phase)).mul(0.02))
        .sub(0.028);

      pos.x.addAssign(this._computeUniforms.dt.mul(lateralX));
      pos.y.addAssign(this._computeUniforms.dt.mul(verticalDrift));
      pos.z.addAssign(this._computeUniforms.dt.mul(lateralZ));

      // Distance check for respawn
      const dx = pos.x.sub(this._computeUniforms.playerPos.x);
      const dy = pos.y.sub(this._computeUniforms.playerPos.y);
      const dz = pos.z.sub(this._computeUniforms.playerPos.z);
      const distSq = dx.mul(dx).add(dy.mul(dy)).add(dz.mul(dz));

      // Respawn when too far (>100 units) or above water surface
      If(distSq.greaterThan(10000.0).or(pos.y.greaterThan(0.0)), () => {
        // Deterministic hash-based pseudo-random using seed + time
        const t = time;
        const rx = fract(
          sin(seed.mul(12.9898).add(t.mul(0.1))).mul(43758.5453),
        ).sub(0.5);
        const ry = fract(
          sin(seed.mul(78.233).add(t.mul(0.07))).mul(43758.5453),
        );
        const rz = fract(
          sin(seed.mul(45.164).add(t.mul(0.13))).mul(43758.5453),
        ).sub(0.5);

        pos.x.assign(
          this._computeUniforms.playerPos.x.add(
            rx.mul(this._computeUniforms.respawnRadius),
          ),
        );
        pos.y.assign(
          this._computeUniforms.playerPos.y.sub(
            ry
              .mul(this._computeUniforms.respawnVertical)
              .add(this._computeUniforms.respawnOffset),
          ),
        );
        pos.z.assign(
          this._computeUniforms.playerPos.z.add(
            rz.mul(this._computeUniforms.respawnRadius),
          ),
        );
      });
    });

    this.particleCompute = computeFn().compute(count);
    this._particleComputeStorageAttributes = [
      seedStorageAttr,
      phaseStorageAttr,
    ];

    // Build an irregular, low-energy flake texture instead of a bright soft disc.
    const pSize = MARINE_SNOW_TEXTURE_RESOLUTION;
    const canvas = document.createElement("canvas");
    canvas.width = pSize;
    canvas.height = pSize;
    const ctx = canvas.getContext("2d");
    const drawParticleLobe = (x, y, radiusX, radiusY, alpha, angle = 0) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.scale(radiusX / radiusY, 1);

      const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radiusY);
      gradient.addColorStop(0, `rgba(255,255,255,${alpha})`);
      gradient.addColorStop(0.58, `rgba(255,255,255,${alpha * 0.35})`);
      gradient.addColorStop(1, "rgba(255,255,255,0)");

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(0, 0, radiusY, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    drawParticleLobe(
      pSize * 0.46,
      pSize * 0.54,
      pSize * 0.2,
      pSize * 0.15,
      0.55,
      -0.4,
    );
    drawParticleLobe(
      pSize * 0.62,
      pSize * 0.46,
      pSize * 0.1,
      pSize * 0.07,
      0.28,
      0.3,
    );
    drawParticleLobe(
      pSize * 0.34,
      pSize * 0.6,
      pSize * 0.08,
      pSize * 0.055,
      0.18,
      -0.75,
    );
    const snowTexture = new THREE.CanvasTexture(canvas);
    this._particleTexture = snowTexture;

    // Material reads positions from the same storage buffer
    const posReadNode = storage(posStorageAttr, "vec3", count).toReadOnly();
    const mat = createParticleMaterial(
      geo,
      snowTexture,
      this.particleBaseSize,
      this.particleBaseOpacity,
      posReadNode,
    );

    // WebGPU honors textured particle sizing for PointsNodeMaterial on instanced Sprites.
    this.particleSystem = new THREE.Sprite(mat);
    this.particleSystem.geometry = geo;
    this.particleSystem.count = count;
    this.particleSystem.frustumCulled = false;
    this.scene.add(this.particleSystem);
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
        Math.cos(angle) * dist,
      );

      // Slight random tilt for variety
      mesh.rotation.z = (Math.random() - 0.5) * 0.15;

      // Pre-compute the fixed billboard angle at construction time.
      // The group origin always coincides with the camera's horizontal
      // position, so this angle is constant per ray.
      const _billboardAngle = Math.atan2(-mesh.position.x, -mesh.position.z);

      this.godRayGroup.add(mesh);
      this.godRays.push({ mesh, mat, height, _billboardAngle });
    }

    this.scene.add(this.godRayGroup);
  }

  update(dt, depth, playerPos, renderer) {
    this.time += dt;
    const depthBlend = THREE.MathUtils.smoothstep(depth, 45, 320);
    const abyssBlend = THREE.MathUtils.smoothstep(depth, 380, 760);
    this._particleSpawnAnchor.copy(playerPos);
    this._hasParticleSpawnAnchor = true;
    this._particleRenderer = renderer;

    // Dispatch wave heightfield compute (medium+ tiers)
    if (this._waveHeightfield) {
      this._waveHeightfield.update(this.time, playerPos, renderer);
    }

    this.waterSurface.material.uniforms.time.value = this.time;
    this.waterSurface.material.uniforms.surfacePhaseOffset.value.set(
      playerPos.x,
      -playerPos.z,
    );
    this.waterSurface.position.x = playerPos.x;
    this.waterSurface.position.z = playerPos.z;

    // Dynamic surface emissive: shimmer strongest in shallow water
    const emissivePulse =
      0.12 +
      Math.sin(this.time * 0.7) * 0.06 +
      Math.sin(this.time * 1.3 + 0.5) * 0.03;
    const surfaceEmissiveFade = 1.0 - THREE.MathUtils.smoothstep(depth, 30, 80);
    this.waterSurface.material.emissiveIntensity =
      emissivePulse * surfaceEmissiveFade;

    // Update GPU particle time uniform
    this.particleSystem.material.uniforms.time.value = this.time;

    // Update compute shader uniforms and dispatch GPU particle update
    this._computeUniforms.dt.value = dt;
    this._computeUniforms.time.value = this.time;
    this._computeUniforms.playerPos.value.copy(playerPos);
    this._computeUniforms.respawnRadius.value = THREE.MathUtils.lerp(
      140,
      85,
      depthBlend,
    );
    this._computeUniforms.respawnVertical.value = THREE.MathUtils.lerp(
      95,
      180,
      depthBlend,
    );
    this._computeUniforms.respawnOffset.value = THREE.MathUtils.lerp(
      8,
      30,
      abyssBlend,
    );
    renderer.computeAsync(this.particleCompute);

    // Deep water gets a bit denser, but avoid oversized bright discs.
    const deepOpacity = THREE.MathUtils.lerp(
      this.particleBaseOpacity * 0.7,
      this.particleBaseOpacity * 1.0,
      depthBlend,
    );
    const abyssFade = THREE.MathUtils.lerp(1.0, 0.9, abyssBlend);
    this.particleSystem.material.uniforms.baseOpacity.value =
      deepOpacity * abyssFade;

    const deepSize = THREE.MathUtils.lerp(
      this.particleBaseSize * 0.85,
      this.particleBaseSize * 1.05,
      depthBlend,
    );
    const abyssSizeClamp = THREE.MathUtils.lerp(1.0, 0.94, abyssBlend);
    this.particleSystem.material.uniforms.baseSize.value =
      deepSize * abyssSizeClamp;

    // God rays: billboard each plane toward camera, update uniforms
    if (depth < 80) {
      const depthFade = 1.0 - THREE.MathUtils.smoothstep(depth, 40, 80);
      this.godRayGroup.visible = true;
      this.godRayGroup.position.set(playerPos.x, 0, playerPos.z);
      for (const ray of this.godRays) {
        ray.mat.uniforms.opacity.value = depthFade;
        ray.mat.uniforms.time.value = this.time;
        // Y-axis billboard: use pre-computed angle (no per-frame trig)
        ray.mesh.rotation.y = ray._billboardAngle;
      }
    } else {
      this.godRayGroup.visible = false;
    }

    // Sun light follows player but fades with depth.
    this.sunLight.position.set(playerPos.x + 50, 100, playerPos.z + 30);
    this.sunLight.target.position.set(playerPos.x, playerPos.y, playerPos.z);
    const sunFade = depth < 100 ? 1.8 * (1 - depth / 100) : 0;
    this.sunLight.intensity = sunFade;
  }
}
