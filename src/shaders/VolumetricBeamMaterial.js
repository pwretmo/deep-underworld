import * as THREE from "three/webgpu";
import {
  attribute,
  cameraPosition,
  clamp,
  distance,
  dot,
  exp,
  float,
  floor,
  fract,
  Fn,
  length,
  max,
  mix,
  modelWorldMatrix,
  normalize,
  pointUV,
  positionLocal,
  positionView,
  positionWorld,
  pow,
  smoothstep,
  sin,
  texture,
  uniform,
  varying,
  vec3,
  vec4,
} from "three/tsl";

const BASIC_CONE_TAN_HALF_ANGLE = Math.tan(Math.PI / 7);
const ADVANCED_CONE_TAN_HALF_ANGLE = Math.tan(Math.PI / 10);
const TAU_OVER_TWO = 12.56636;

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

const hash3D = Fn(([inputPosition]) => {
  const p = fract(vec3(inputPosition).mul(vec3(443.8975, 397.2973, 491.1871))).toVar();
  const offset = dot(p, p.yzx.add(vec3(19.19)));
  p.addAssign(vec3(offset));

  return fract(p.x.add(p.y).mul(p.z));
});

const noise3D = Fn(([inputPosition]) => {
  const cell = floor(vec3(inputPosition)).toVar();
  const fraction = fract(vec3(inputPosition)).toVar();

  fraction.assign(fraction.mul(fraction).mul(vec3(3.0).sub(fraction.mul(2.0))));

  const n000 = hash3D(cell);
  const n100 = hash3D(cell.add(vec3(1.0, 0.0, 0.0)));
  const n010 = hash3D(cell.add(vec3(0.0, 1.0, 0.0)));
  const n110 = hash3D(cell.add(vec3(1.0, 1.0, 0.0)));
  const n001 = hash3D(cell.add(vec3(0.0, 0.0, 1.0)));
  const n101 = hash3D(cell.add(vec3(1.0, 0.0, 1.0)));
  const n011 = hash3D(cell.add(vec3(0.0, 1.0, 1.0)));
  const n111 = hash3D(cell.add(vec3(1.0, 1.0, 1.0)));

  const nx00 = mix(n000, n100, fraction.x);
  const nx10 = mix(n010, n110, fraction.x);
  const nx01 = mix(n001, n101, fraction.x);
  const nx11 = mix(n011, n111, fraction.x);

  const nxy0 = mix(nx00, nx10, fraction.y);
  const nxy1 = mix(nx01, nx11, fraction.y);

  return mix(nxy0, nxy1, fraction.z);
});

function fbm3D(inputPosition, octave2, octave3) {
  return noise3D(inputPosition).mul(0.5)
    .add(noise3D(inputPosition.mul(octave2)).mul(0.25))
    .add(noise3D(inputPosition.mul(octave3)).mul(0.125));
}

function createBeamNodeMaterial(uniforms, config) {
  const material = new THREE.MeshBasicNodeMaterial();
  const localPos = varying(positionLocal);
  const worldPos = varying(positionWorld);
  const beamDirWorld = normalize(modelWorldMatrix.mul(vec4(0.0, 0.0, -1.0, 0.0)).xyz);
  const axialT = clamp(localPos.z.negate().div(uniforms.beamLength), 0.0, 1.0);
  const maxRadius = uniforms.coneTanHalfAngle.mul(localPos.z.abs());
  const radialT = clamp(length(localPos.xy).div(max(maxRadius, 0.001)), 0.0, 1.0);

  const axialFade = exp(axialT.mul(config.axialExp).negate()).mul(
    float(1.0).sub(axialT.mul(config.axialLinear))
  );
  const radialFade = exp(radialT.mul(radialT).mul(config.radialExp).negate());

  const viewDir = normalize(cameraPosition.sub(worldPos));
  const g = uniforms.anisotropy;
  const cosTheta = dot(viewDir, beamDirWorld);
  const phaseDenominator = pow(
    float(1.0).add(g.mul(g)).sub(g.mul(2.0).mul(cosTheta)),
    1.5
  );
  const phase = float(1.0).sub(g.mul(g)).div(float(TAU_OVER_TWO).mul(phaseDenominator));
  const anisotropicBoost = clamp(
    phase.mul(config.scatterScale),
    config.scatterClampMin,
    config.scatterClampMax
  );

  const noiseCoord = localPos.mul(uniforms.noiseScale.mul(config.noiseCoordScale)).add(
    vec3(
      uniforms.time.mul(config.timeVector[0]),
      uniforms.time.mul(config.timeVector[1]),
      uniforms.time.mul(config.timeVector[2])
    )
  );
  const noiseValue = fbm3D(noiseCoord, config.fbmScale2, config.fbmScale3);
  const noiseMod = float(1.0)
    .sub(uniforms.noiseStrength)
    .add(uniforms.noiseStrength.mul(noiseValue).mul(2.0));

  let density = uniforms.baseOpacity
    .mul(axialFade)
    .mul(radialFade)
    .mul(anisotropicBoost)
    .mul(noiseMod);

  if (config.includeDepthControls) {
    const depthParticleBoost = float(1.0).add(
      smoothstep(100.0, 500.0, uniforms.waterDepth).mul(0.5)
    );

    density = density
      .mul(uniforms.depthAttenuation)
      .mul(uniforms.depthOpacityScale)
      .mul(depthParticleBoost);
  }

  const edgeSoftness = float(1.0).sub(smoothstep(config.edgeStart, 1.0, radialT));
  density = density.mul(edgeSoftness);

  let beamColorNode = uniforms.beamColor;

  if (config.includeWaterExtinction) {
    beamColorNode = uniforms.beamColor.mul(
      exp(uniforms.waterExtinction.mul(uniforms.waterDepth).mul(-0.25))
    );
  }

  const fogFactor = smoothstep(uniforms.fogNear, uniforms.fogFar, distance(worldPos, cameraPosition));
  const finalColor = mix(beamColorNode, uniforms.fogColor, fogFactor.mul(config.fogColorMix));

  density = density.mul(float(1.0).sub(fogFactor.mul(config.fogDensityMix)));

  material.colorNode = finalColor;
  material.opacityNode = clamp(density, 0.0, config.alphaMax);
  material.transparent = true;
  material.blending = THREE.AdditiveBlending;
  material.side = THREE.DoubleSide;
  material.depthWrite = false;
  material.fog = false;

  return attachUniforms(material, uniforms);
}

/**
 * Create the volumetric beam material for the flashlight cone.
 * @returns {THREE.MeshBasicNodeMaterial}
 */
export function createVolumetricBeamMaterial() {
  const uniforms = createUniformMap({
    time: 0,
    beamColor: new THREE.Color(0x8899bb).convertSRGBToLinear(),
    beamLength: 50.0,
    baseOpacity: 0.035,
    anisotropy: 0.55,
    noiseScale: 1.8,
    noiseStrength: 0.35,
    fogColor: new THREE.Color(0x000000),
    fogNear: 1.0,
    fogFar: 300.0,
    coneTanHalfAngle: BASIC_CONE_TAN_HALF_ANGLE,
  });

  return createBeamNodeMaterial(uniforms, {
    axialExp: 2.2,
    axialLinear: 0.6,
    radialExp: 3.5,
    scatterScale: 2.0,
    scatterClampMin: 0.5,
    scatterClampMax: 3.0,
    noiseCoordScale: 0.08,
    timeVector: [0.12, 0.08, 0.05],
    fbmScale2: 2.01,
    fbmScale3: 4.03,
    edgeStart: 0.75,
    fogColorMix: 0.6,
    fogDensityMix: 0.7,
    alphaMax: 0.15,
    includeDepthControls: false,
    includeWaterExtinction: false,
  });
}

/**
 * Create an advanced volumetric beam material for external submarine headlights.
 * @returns {THREE.MeshBasicNodeMaterial}
 */
export function createAdvancedVolumetricBeamMaterial() {
  const uniforms = createUniformMap({
    time: 0,
    beamColor: new THREE.Color(0x8eaad1).convertSRGBToLinear(),
    beamLength: 80.0,
    baseOpacity: 0.055,
    anisotropy: 0.63,
    noiseScale: 2.1,
    noiseStrength: 0.42,
    depthAttenuation: 1.0,
    depthOpacityScale: 1.0,
    fogColor: new THREE.Color(0x000000),
    fogNear: 1.0,
    fogFar: 300.0,
    coneTanHalfAngle: ADVANCED_CONE_TAN_HALF_ANGLE,
    waterExtinction: new THREE.Vector3(0.38, 0.065, 0.018),
    waterDepth: 0.0,
  });

  return createBeamNodeMaterial(uniforms, {
    axialExp: 2.5,
    axialLinear: 0.6,
    radialExp: 4.2,
    scatterScale: 2.2,
    scatterClampMin: 0.35,
    scatterClampMax: 2.2,
    noiseCoordScale: 0.09,
    timeVector: [0.11, 0.07, 0.05],
    fbmScale2: 2.02,
    fbmScale3: 4.07,
    edgeStart: 0.72,
    fogColorMix: 0.65,
    fogDensityMix: 0.68,
    alphaMax: 0.14,
    includeDepthControls: true,
    includeWaterExtinction: true,
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
 * Create the enhanced dust particle material.
 * @param {THREE.Texture} dustTexture
 * @returns {THREE.PointsNodeMaterial}
 */
export function createVolumetricDustMaterial(dustTexture) {
  const uniforms = createUniformMap({
    time: 0,
    beamLength: 50.0,
    baseSize: 0.12,
    baseOpacity: 0.4,
    fogColor: new THREE.Color(0x000000),
    fogNear: 1.0,
    fogFar: 300.0,
  });

  const material = new THREE.PointsNodeMaterial();
  const localPos = varying(positionLocal);
  const phase = varying(attribute("phase", "float"));
  const viewDist = varying(positionView.z.negate());
  const axialT = clamp(localPos.z.negate().div(uniforms.beamLength), 0.0, 1.0);
  const maxRadius = float(BASIC_CONE_TAN_HALF_ANGLE).mul(localPos.z.abs());
  const radialT = clamp(length(localPos.xy).div(max(maxRadius, 0.001)), 0.0, 1.0);
  const depthScale = mix(1.3, 0.5, axialT);
  const pulse = float(1.0).add(sin(uniforms.time.mul(1.5).add(phase.mul(6.28))).mul(0.15));
  const pointSize = clamp(
    attribute("size", "float")
      .mul(uniforms.baseSize)
      .mul(depthScale)
      .mul(pulse)
      .mul(float(300.0).div(max(viewDist, 1.0))),
    0.5,
    16.0
  );
  const radialBrightness = mix(1.0, 0.2, radialT.mul(radialT));
  const depthDim = mix(1.0, 0.3, axialT);
  const paletteMix = sin(phase.mul(3.14)).mul(0.5).add(0.5);
  const particleColor = mix(
    pow(vec3(0.6, 0.68, 0.8), vec3(2.2)),
    pow(vec3(0.75, 0.82, 0.95), vec3(2.2)),
    paletteMix
  );
  const fogFactor = smoothstep(uniforms.fogNear, uniforms.fogFar, viewDist);

  material.sizeNode = pointSize;
  material.colorNode = mix(particleColor, uniforms.fogColor, fogFactor.mul(0.4));
  material.opacityNode = clamp(
    texture(dustTexture, pointUV).a
      .mul(uniforms.baseOpacity)
      .mul(radialBrightness)
      .mul(depthDim)
      .mul(float(1.0).sub(fogFactor.mul(0.5))),
    0.0,
    0.6
  );
  material.transparent = true;
  material.blending = THREE.AdditiveBlending;
  material.depthWrite = false;
  material.fog = false;

  return attachUniforms(material, uniforms);
}
