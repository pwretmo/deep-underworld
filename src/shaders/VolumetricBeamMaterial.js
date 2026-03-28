import * as THREE from 'three';

/**
 * Volumetric beam shader for the flashlight cone.
 *
 * Features:
 * - Axial density falloff (bright near source, fading to tip)
 * - Radial shaft definition (brighter center, soft edges)
 * - View-dependent anisotropic scattering (brighter looking into beam)
 * - Procedural noise for organic light shaft feel
 * - Fog-aware (respects THREE.Fog)
 */

const VolumetricBeamShader = {
  uniforms: {
    time: { value: 0 },
    // Color authored as sRGB hex; convert to linear so OutputPass encodes correctly
    beamColor: { value: new THREE.Color(0x8899bb).convertSRGBToLinear() },
    beamLength: { value: 50.0 },
    baseOpacity: { value: 0.035 },
    // Scattering anisotropy: 0 = isotropic, positive = forward-scatter
    anisotropy: { value: 0.55 },
    // Noise scale for organic feel
    noiseScale: { value: 1.8 },
    noiseStrength: { value: 0.35 },
    // Fog uniforms (set from scene.fog)
    fogColor: { value: new THREE.Color(0x000000) },
    fogNear: { value: 1.0 },
    fogFar: { value: 300.0 },
  },

  vertexShader: /* glsl */ `
    varying vec3 vLocalPos;
    varying vec3 vWorldPos;
    varying vec3 vBeamDirWorld;
    varying float vAxialT;
    varying float vRadialT;

    uniform float beamLength;

    void main() {
      vLocalPos = position;
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vWorldPos = worldPos.xyz;
      // Precompute beam forward direction in world space for fragment scattering.
      vBeamDirWorld = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, -1.0));

      // Axial parameter: 0 at source, 1 at tip (cone extends along -Z in local space)
      vAxialT = clamp(-position.z / beamLength, 0.0, 1.0);

      // Radial parameter: distance from beam axis relative to max radius at this depth
      float maxRadius = tan(${(Math.PI / 7).toFixed(6)}) * abs(position.z);
      float radialDist = length(position.xy);
      vRadialT = maxRadius > 0.001 ? clamp(radialDist / maxRadius, 0.0, 1.0) : 0.0;

      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */ `
    uniform float time;
    uniform vec3 beamColor;
    uniform float beamLength;
    uniform float baseOpacity;
    uniform float anisotropy;
    uniform float noiseScale;
    uniform float noiseStrength;
    uniform vec3 fogColor;
    uniform float fogNear;
    uniform float fogFar;

    varying vec3 vLocalPos;
    varying vec3 vWorldPos;
    varying vec3 vBeamDirWorld;
    varying float vAxialT;
    varying float vRadialT;

    // Simple 3D hash for procedural noise
    float hash(vec3 p) {
      p = fract(p * vec3(443.8975, 397.2973, 491.1871));
      p += dot(p, p.yzx + 19.19);
      return fract((p.x + p.y) * p.z);
    }

    float noise3D(vec3 p) {
      vec3 i = floor(p);
      vec3 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);

      float n000 = hash(i);
      float n100 = hash(i + vec3(1, 0, 0));
      float n010 = hash(i + vec3(0, 1, 0));
      float n110 = hash(i + vec3(1, 1, 0));
      float n001 = hash(i + vec3(0, 0, 1));
      float n101 = hash(i + vec3(1, 0, 1));
      float n011 = hash(i + vec3(0, 1, 1));
      float n111 = hash(i + vec3(1, 1, 1));

      float nx00 = mix(n000, n100, f.x);
      float nx10 = mix(n010, n110, f.x);
      float nx01 = mix(n001, n101, f.x);
      float nx11 = mix(n011, n111, f.x);

      float nxy0 = mix(nx00, nx10, f.y);
      float nxy1 = mix(nx01, nx11, f.y);

      return mix(nxy0, nxy1, f.z);
    }

    float fbm(vec3 p) {
      float v = 0.0;
      v += noise3D(p) * 0.5;
      v += noise3D(p * 2.01) * 0.25;
      v += noise3D(p * 4.03) * 0.125;
      return v;
    }

    void main() {
      // --- Axial falloff: bright near source, fading toward tip ---
      // Use a combination of exponential and linear falloff for natural density
      float axialFalloff = exp(-2.2 * vAxialT) * (1.0 - vAxialT * 0.6);

      // --- Radial shaft: soft Gaussian-like falloff from center ---
      float radialFalloff = exp(-3.5 * vRadialT * vRadialT);

      // --- View-dependent anisotropic scattering ---
      // Approximate Henyey-Greenstein phase function
      vec3 viewDir = normalize(cameraPosition - vWorldPos);
      float cosTheta = dot(viewDir, vBeamDirWorld);
      float g = anisotropy;
      float phase = (1.0 - g * g) / (4.0 * 3.14159 * pow(1.0 + g * g - 2.0 * g * cosTheta, 1.5));
      // Normalize to keep intensity manageable
      float anisotropicBoost = clamp(phase * 2.0, 0.5, 3.0);

      // --- Procedural noise for organic light shaft feel ---
      vec3 noiseCoord = vLocalPos * noiseScale * 0.08 + vec3(time * 0.12, time * 0.08, time * 0.05);
      float n = fbm(noiseCoord);
      float noiseMod = 1.0 - noiseStrength + noiseStrength * n * 2.0;

      // --- Combine all factors ---
      float density = axialFalloff * radialFalloff * anisotropicBoost * noiseMod * baseOpacity;

      // Edge softening to prevent hard cone boundary
      float edgeSoftness = smoothstep(1.0, 0.75, vRadialT);
      density *= edgeSoftness;

      // --- Fog attenuation ---
      float dist = length(vWorldPos - cameraPosition);
      float fogFactor = smoothstep(fogNear, fogFar, dist);
      vec3 finalColor = mix(beamColor, fogColor, fogFactor * 0.6);
      density *= (1.0 - fogFactor * 0.7);

      // beamColor uniform is already in linear space; OutputPass handles sRGB encoding
      gl_FragColor = vec4(finalColor, clamp(density, 0.0, 0.15));
    }
  `,
};

/**
 * Create the volumetric beam ShaderMaterial.
 * @returns {THREE.ShaderMaterial}
 */
export function createVolumetricBeamMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(VolumetricBeamShader.uniforms),
    vertexShader: VolumetricBeamShader.vertexShader,
    fragmentShader: VolumetricBeamShader.fragmentShader,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}

const AdvancedVolumetricBeamShader = {
  uniforms: {
    time: { value: 0 },
    // Color authored as sRGB hex; convert to linear so OutputPass encodes correctly
    beamColor: { value: new THREE.Color(0x8eaad1).convertSRGBToLinear() },
    beamLength: { value: 54.0 },
    baseOpacity: { value: 0.042 },
    anisotropy: { value: 0.63 },
    noiseScale: { value: 2.1 },
    noiseStrength: { value: 0.42 },
    depthAttenuation: { value: 1.0 },
    depthOpacityScale: { value: 1.0 },
    fogColor: { value: new THREE.Color(0x000000) },
    fogNear: { value: 1.0 },
    fogFar: { value: 300.0 },
    coneTanHalfAngle: { value: Math.tan(Math.PI / 9) },
    waterExtinction: { value: new THREE.Vector3(0.38, 0.065, 0.018) },
    waterDepth: { value: 0 },
  },

  vertexShader: /* glsl */ `
    varying vec3 vLocalPos;
    varying vec3 vWorldPos;
    varying vec3 vBeamDirWorld;
    varying float vAxialT;
    varying float vRadialT;

    uniform float beamLength;
    uniform float coneTanHalfAngle;

    void main() {
      vLocalPos = position;
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vWorldPos = worldPos.xyz;
      vBeamDirWorld = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, -1.0));

      vAxialT = clamp(-position.z / beamLength, 0.0, 1.0);
      float maxRadius = coneTanHalfAngle * abs(position.z);
      float radialDist = length(position.xy);
      vRadialT = maxRadius > 0.001 ? clamp(radialDist / maxRadius, 0.0, 1.0) : 0.0;

      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */ `
    uniform float time;
    uniform vec3 beamColor;
    uniform float baseOpacity;
    uniform float anisotropy;
    uniform float noiseScale;
    uniform float noiseStrength;
    uniform float depthAttenuation;
    uniform float depthOpacityScale;
    uniform vec3 fogColor;
    uniform float fogNear;
    uniform float fogFar;
    uniform vec3 waterExtinction;
    uniform float waterDepth;

    varying vec3 vLocalPos;
    varying vec3 vWorldPos;
    varying vec3 vBeamDirWorld;
    varying float vAxialT;
    varying float vRadialT;

    float hash(vec3 p) {
      p = fract(p * vec3(443.8975, 397.2973, 491.1871));
      p += dot(p, p.yzx + 19.19);
      return fract((p.x + p.y) * p.z);
    }

    float noise3D(vec3 p) {
      vec3 i = floor(p);
      vec3 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);

      float n000 = hash(i);
      float n100 = hash(i + vec3(1, 0, 0));
      float n010 = hash(i + vec3(0, 1, 0));
      float n110 = hash(i + vec3(1, 1, 0));
      float n001 = hash(i + vec3(0, 0, 1));
      float n101 = hash(i + vec3(1, 0, 1));
      float n011 = hash(i + vec3(0, 1, 1));
      float n111 = hash(i + vec3(1, 1, 1));

      float nx00 = mix(n000, n100, f.x);
      float nx10 = mix(n010, n110, f.x);
      float nx01 = mix(n001, n101, f.x);
      float nx11 = mix(n011, n111, f.x);
      float nxy0 = mix(nx00, nx10, f.y);
      float nxy1 = mix(nx01, nx11, f.y);
      return mix(nxy0, nxy1, f.z);
    }

    float fbm(vec3 p) {
      float v = 0.0;
      v += noise3D(p) * 0.5;
      v += noise3D(p * 2.02) * 0.25;
      v += noise3D(p * 4.07) * 0.125;
      return v;
    }

    void main() {
      float axialFade = exp(-2.5 * vAxialT) * (1.0 - 0.6 * vAxialT);
      float radialFade = exp(-4.2 * vRadialT * vRadialT);

      vec3 viewDir = normalize(cameraPosition - vWorldPos);
      float cosTheta = dot(viewDir, vBeamDirWorld);
      float g = anisotropy;
      float phase = (1.0 - g * g) / (4.0 * 3.14159 * pow(1.0 + g * g - 2.0 * g * cosTheta, 1.5));
      float scatter = clamp(phase * 2.2, 0.35, 2.2);

      vec3 noiseCoord = vLocalPos * (noiseScale * 0.09) + vec3(time * 0.11, time * 0.07, time * 0.05);
      float n = fbm(noiseCoord);
      float noiseMod = 1.0 - noiseStrength + (noiseStrength * n * 2.0);

      // Particulate forward scatter: deeper water has more suspended material,
      // making the beam read in open water without needing high base opacity.
      float depthParticleBoost = 1.0 + smoothstep(100.0, 500.0, waterDepth) * 0.5;

      float density = baseOpacity;
      density *= axialFade;
      density *= radialFade;
      density *= scatter;
      density *= noiseMod;
      density *= depthAttenuation;
      density *= depthOpacityScale;
      density *= depthParticleBoost;

      float edgeSoftness = smoothstep(1.0, 0.72, vRadialT);
      density *= edgeSoftness;

      // Water extinction: beam color attenuates with depth (Beer-Lambert).
      vec3 depthTint = beamColor * exp(-waterExtinction * waterDepth * 0.25);

      float dist = length(vWorldPos - cameraPosition);
      float fogFactor = smoothstep(fogNear, fogFar, dist);
      vec3 finalColor = mix(depthTint, fogColor, fogFactor * 0.65);
      density *= (1.0 - fogFactor * 0.68);

      // beamColor uniform is already in linear space; OutputPass handles sRGB encoding
      gl_FragColor = vec4(finalColor, clamp(density, 0.0, 0.10));
    }
  `,
};

/**
 * Create an advanced volumetric beam material for external submarine headlights.
 * @returns {THREE.ShaderMaterial}
 */
export function createAdvancedVolumetricBeamMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(AdvancedVolumetricBeamShader.uniforms),
    vertexShader: AdvancedVolumetricBeamShader.vertexShader,
    fragmentShader: AdvancedVolumetricBeamShader.fragmentShader,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}

/**
 * Create the simple fallback material (matches original MeshBasicMaterial).
 * @returns {THREE.MeshBasicMaterial}
 */
export function createFallbackBeamMaterial() {
  return new THREE.MeshBasicMaterial({
    color: 0x8899bb,
    transparent: true,
    opacity: 0.022,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}

/**
 * Custom ShaderMaterial for dust particles with depth/scale cues.
 * Particles farther down the beam appear smaller and dimmer,
 * particles near the beam axis are brighter.
 */
const VolumetricDustShader = {
  uniforms: {
    time: { value: 0 },
    dustMap: { value: null },
    beamLength: { value: 50.0 },
    baseSize: { value: 0.12 },
    baseOpacity: { value: 0.4 },
    fogColor: { value: new THREE.Color(0x000000) },
    fogNear: { value: 1.0 },
    fogFar: { value: 300.0 },
  },

  vertexShader: /* glsl */ `
    attribute float size;
    attribute float phase;

    uniform float time;
    uniform float beamLength;
    uniform float baseSize;

    varying float vAxialT;
    varying float vRadialT;
    varying float vPhase;
    varying float vViewDist;

    void main() {
      // Axial: 0 at source, 1 at tip
      vAxialT = clamp(-position.z / beamLength, 0.0, 1.0);

      // Radial: distance from beam axis
      float maxRadius = tan(${(Math.PI / 7).toFixed(6)}) * abs(position.z);
      float radialDist = length(position.xy);
      vRadialT = maxRadius > 0.001 ? clamp(radialDist / maxRadius, 0.0, 1.0) : 0.0;

      vPhase = phase;

      // Depth-dependent sizing: particles farther in the beam are slightly smaller
      float depthScale = mix(1.3, 0.5, vAxialT);
      // Subtle pulsing per-particle
      float pulse = 1.0 + 0.15 * sin(time * 1.5 + phase * 6.28);

      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      vViewDist = -mvPosition.z;
      gl_PointSize = size * baseSize * depthScale * pulse * (300.0 / -mvPosition.z);
      gl_PointSize = clamp(gl_PointSize, 0.5, 16.0);
      gl_Position = projectionMatrix * mvPosition;
    }
  `,

  fragmentShader: /* glsl */ `
    uniform sampler2D dustMap;
    uniform float baseOpacity;
    uniform vec3 fogColor;
    uniform float fogNear;
    uniform float fogFar;

    varying float vAxialT;
    varying float vRadialT;
    varying float vPhase;
    varying float vViewDist;

    void main() {
      vec4 texColor = texture2D(dustMap, gl_PointCoord);

      // Particles near the beam axis are brighter
      float radialBrightness = mix(1.0, 0.2, vRadialT * vRadialT);

      // Particles farther in the beam are dimmer (depth cue)
      float depthDim = mix(1.0, 0.3, vAxialT);

      // Slight color variation per particle
      // sRGB-authored palette linearized for OutputPass (approx. pow 2.2)
      vec3 particleColor = mix(
        pow(vec3(0.6, 0.68, 0.8), vec3(2.2)),
        pow(vec3(0.75, 0.82, 0.95), vec3(2.2)),
        sin(vPhase * 3.14) * 0.5 + 0.5
      );

      float alpha = texColor.a * baseOpacity * radialBrightness * depthDim;

      // Fog attenuation (linear view-space distance from vertex shader)
      float fogFactor = smoothstep(fogNear, fogFar, vViewDist);
      particleColor = mix(particleColor, fogColor, fogFactor * 0.4);
      alpha *= (1.0 - fogFactor * 0.5);

      gl_FragColor = vec4(particleColor, clamp(alpha, 0.0, 0.6));
    }
  `,
};

/**
 * Create the enhanced dust particle ShaderMaterial.
 * @param {THREE.Texture} dustTexture
 * @returns {THREE.ShaderMaterial}
 */
export function createVolumetricDustMaterial(dustTexture) {
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(VolumetricDustShader.uniforms),
    vertexShader: VolumetricDustShader.vertexShader,
    fragmentShader: VolumetricDustShader.fragmentShader,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  mat.uniforms.dustMap.value = dustTexture;
  return mat;
}
