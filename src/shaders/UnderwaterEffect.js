import * as THREE from 'three/webgpu';
import {
  Fn,
  If,
  abs,
  clamp,
  convertToTexture,
  cos,
  distance,
  dot,
  exp,
  float,
  fract,
  max,
  min,
  mix,
  pass,
  pow,
  screenUV,
  sin,
  smoothstep,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { bloom as createBloomNode } from 'three/addons/tsl/display/BloomNode.js';
import { godrays } from 'three/addons/tsl/display/GodraysNode.js';
import { qualityManager } from '../QualityManager.js';
import { DEPTH_THRESHOLDS } from '../lighting/LightingPolicy.js';

function deepFreeze(obj) {
  Object.freeze(obj);
  Object.values(obj).forEach(v => {
    if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
  });
  return obj;
}

function cloneUniformValue(value) {
  return value && typeof value.clone === 'function' ? value.clone() : value;
}

function cloneUniforms(uniforms) {
  const next = {};
  for (const [name, entry] of Object.entries(uniforms)) {
    next[name] = { value: cloneUniformValue(entry.value) };
  }
  return next;
}

const RENDER_PIPELINE_TUNING = deepFreeze({
  depthThresholds: DEPTH_THRESHOLDS,
  extinction: {
    r: 0.12,
    g: 0.045,
    b: 0.014,
  },
  scatter: {
    r: 0.04,
    g: 0.12,
    b: 0.18,
    density: 0.003,
  },
  grading: {
    contrast: 1.08,
    vignette: 0.28,
    grain: 0.018,
    scanline: 0.0,
    eyeAdapt: 0.12,
  },
  highlightRoll: {
    start: 0.78,
    range: 0.34,
    strength: 0.40,
  },
  bloom: {
    surfaceStrength: 0.28,
    deepStrength: 0.55,
    surfaceThreshold: 0.78,
    deepThreshold: 0.58,
    radius: 0.62,
  },
  performance: {
    baseScale: 1.0,
    minScale: 0.6,
    scaleLevels: [1.0, 0.85, 0.72, 0.6],
    degradeThresholdMs: 28,
    severeThresholdMs: 45,
    emergencyThresholdMs: 120,
    recoveryThresholdMs: 22,
    scaleChangeCooldownMs: 900,
    recoveryDelayMs: 1400,
    emergencyHoldMs: 2800,
    stableFramesForRecovery: 96,
    // Item 1: sustained moderate-pressure counter
    sustainedModeratePressureFrames: 8,
    moderatePressureThresholdMs: 24,
    // Item 3: suspend bloom at pressured state, not only emergency
    bloomSuspendThresholdMs: 34,
    // Item 2: depth-based post-FX scale caps
    depthScaleCaps: {
      surface: 0.85,
      mid: 0.85,
      deep: 0.72,
      abyss: 0.6,
    },
    startupStableThresholdMs: 24,
    startupStableFrames: 18,
    startupMaxHoldMs: 9000,
  },
});

const UNDERWATER_UNIFORM_TEMPLATE = {
  time: { value: 0 },
  depth: { value: 0 },
  exposure: { value: 0.76 },
  flashlightActive: { value: 0 },
  resolution: { value: new THREE.Vector2() },
  depthThresholds: { value: new THREE.Vector3(130, 340, 720) },
  grading: { value: new THREE.Vector4(1.08, 0.28, 0.018, 0.0) },
  extinction: { value: new THREE.Vector3(0.22, 0.045, 0.014) },
  scatterColor: { value: new THREE.Vector3(0.012, 0.048, 0.075) },
  scatterDensity: { value: 0.003 },
  eyeAdapt: { value: 0.12 },
  highlightRoll: { value: new THREE.Vector3(0.78, 0.34, 0.40) },
  bloomParams: { value: new THREE.Vector3(0.28, 0.78, 1.6) },
  reducedMode: { value: 0.0 },
};

function createUnderwaterUniformNodes(uniforms) {
  return {
    time: uniform(uniforms.time.value),
    depth: uniform(uniforms.depth.value),
    exposure: uniform(uniforms.exposure.value),
    flashlightActive: uniform(uniforms.flashlightActive.value),
    resolution: uniform(uniforms.resolution.value),
    depthThresholds: uniform(uniforms.depthThresholds.value),
    grading: uniform(uniforms.grading.value),
    extinction: uniform(uniforms.extinction.value),
    scatterColor: uniform(uniforms.scatterColor.value),
    scatterDensity: uniform(uniforms.scatterDensity.value),
    eyeAdapt: uniform(uniforms.eyeAdapt.value),
    highlightRoll: uniform(uniforms.highlightRoll.value),
    bloomParams: uniform(uniforms.bloomParams.value),
    reducedMode: uniform(uniforms.reducedMode.value),
  };
}

function disposeRttNode(node) {
  if (!node?.isRTTNode) {
    return;
  }

  if (typeof node.dispose === 'function') {
    node.dispose();
    return;
  }

  node.renderTarget?.dispose?.();
}

function updateRttNodeScale(node, width, height, pixelRatio, scale) {
  if (!node?.isRTTNode) {
    return;
  }

  node.setSize(width, height);
  node.setPixelRatio(pixelRatio * scale);
}

function createUnderwaterPostColorNode(sourceNode, uniformNodes) {
  const sourceTextureNode = convertToTexture(sourceNode);
  const sourceUVNode = sourceTextureNode.uvNode || screenUV;
  const peakOf = (colorNode) => max(max(colorNode.r, colorNode.g), colorNode.b);
  const samplePeak = (sampleUvNode) => peakOf(sourceTextureNode.sample(sampleUvNode).rgb);
  const samplePeakCross = (sampleUvNode, probeNode) => samplePeak(sampleUvNode.add(vec2(probeNode.x, 0.0)))
    .add(samplePeak(sampleUvNode.sub(vec2(probeNode.x, 0.0))))
    .add(samplePeak(sampleUvNode.add(vec2(0.0, probeNode.y))))
    .add(samplePeak(sampleUvNode.sub(vec2(0.0, probeNode.y))))
    .mul(0.25);

  return Fn(() => {
    const distortedUv = vec2(sourceUVNode).toVar();
    const lumaWeights = vec3(0.2126, 0.7152, 0.0722);
    const distortionStrength = uniformNodes.depth.mul(0.0000055).add(0.0011);

    distortedUv.assign(vec2(
      distortedUv.x.add(sin(distortedUv.y.mul(15.0).add(uniformNodes.time)).mul(distortionStrength)),
      distortedUv.y,
    ));
    distortedUv.assign(vec2(
      distortedUv.x,
      distortedUv.y.add(
        cos(distortedUv.x.mul(12.0).add(uniformNodes.time.mul(0.8)))
          .mul(distortionStrength)
          .mul(0.6)
      ),
    ));

    const baseSample = sourceTextureNode.sample(distortedUv);
    const color = vec3(baseSample.rgb).toVar();
    const fragCoord = distortedUv.mul(uniformNodes.resolution);
    const midBlend = smoothstep(uniformNodes.depthThresholds.x, uniformNodes.depthThresholds.y, uniformNodes.depth);
    const deepBlend = smoothstep(uniformNodes.depthThresholds.y, uniformNodes.depthThresholds.z, uniformNodes.depth);
    const abyssBlend = smoothstep(
      uniformNodes.depthThresholds.z,
      uniformNodes.depthThresholds.z.add(280.0),
      uniformNodes.depth,
    );
    const depthBlend = clamp(
      midBlend.mul(0.45).add(deepBlend.mul(0.7)).add(abyssBlend.mul(0.35)),
      0.0,
      1.0,
    );

    If(uniformNodes.reducedMode.lessThan(0.5), () => {
      const edgeDist = distance(distortedUv, vec2(0.5));
      const edgeMask = smoothstep(0.2, 0.74, edgeDist);
      const aberrationStrength = min(
        depthBlend.mul(0.00014).add(abyssBlend.mul(0.00005)).mul(edgeMask),
        0.00022,
      );
      const red = sourceTextureNode.sample(distortedUv.add(vec2(aberrationStrength, aberrationStrength.mul(0.3)))).r;
      const blue = sourceTextureNode.sample(distortedUv.sub(vec2(aberrationStrength, aberrationStrength.mul(0.2)))).b;

      color.assign(vec3(red, color.g, blue));
    });

    const vignetteStrength = min(depthBlend.mul(uniformNodes.grading.y).add(0.12), 0.65);
    const vignetteDistance = dot(distortedUv.sub(0.5), distortedUv.sub(0.5));
    const vignetteMask = float(1.0).sub(smoothstep(0.12, 0.42, vignetteDistance).mul(vignetteStrength));
    color.assign(color.mul(max(vignetteMask, 0.35)));

    const transmittance = exp(uniformNodes.extinction.mul(uniformNodes.depth).mul(-1.0));
    const scatterMix = float(1.0).sub(exp(uniformNodes.scatterDensity.mul(uniformNodes.depth).mul(-1.0)));
    const scatter = uniformNodes.scatterColor.mul(scatterMix);
    const preTintLuma = peakOf(color);
    const litAmount = float(0.0).toVar();

    If(uniformNodes.flashlightActive.greaterThan(0.5), () => {
      If(uniformNodes.reducedMode.greaterThan(0.5), () => {
        litAmount.assign(smoothstep(0.08, 0.22, preTintLuma).mul(0.65));
      }).Else(() => {
        const lightProbe = max(vec2(1.0).div(uniformNodes.resolution), vec2(0.0005));
        const nearbyLuma = samplePeak(distortedUv.add(vec2(lightProbe.x, 0.0)))
          .add(samplePeak(distortedUv.sub(vec2(lightProbe.x, 0.0))))
          .add(samplePeak(distortedUv.add(vec2(0.0, lightProbe.y))))
          .add(samplePeak(distortedUv.sub(vec2(0.0, lightProbe.y))))
          .mul(0.25);
        const localSpread = float(1.0).sub(smoothstep(0.08, 0.38, abs(preTintLuma.sub(nearbyLuma))));
        const nearbyLight = smoothstep(0.03, 0.16, nearbyLuma);

        litAmount.assign(smoothstep(0.05, 0.18, preTintLuma).mul(nearbyLight).mul(localSpread));
      });
    });

    const clampedLit = litAmount.mul(0.6);
    color.assign(
      color
        .mul(mix(transmittance, vec3(1.0), clampedLit))
        .add(scatter.mul(float(1.0).sub(litAmount.mul(0.7))))
    );

    const shallowCaustic = float(1.0).sub(smoothstep(0.0, 80.0, uniformNodes.depth));
    If(shallowCaustic.greaterThan(0.001), () => {
      const causticUv = distortedUv.mul(12.0);
      const causticTime = uniformNodes.time.mul(0.35);
      const causticOne = sin(causticUv.x.mul(3.7).add(causticTime)).mul(
        sin(causticUv.y.mul(4.1).sub(causticTime.mul(0.8)))
      );
      const causticTwo = sin(causticUv.x.mul(2.3).sub(causticTime.mul(1.2)).add(1.7)).mul(
        sin(causticUv.y.mul(3.3).add(causticTime.mul(0.9)))
      );
      const causticThree = sin(causticUv.x.add(causticUv.y).mul(2.8).add(causticTime.mul(0.6)));
      const causticValue = pow(max(0.0, causticOne.add(causticTwo.mul(0.7)).add(causticThree.mul(0.5))).mul(0.33), 2.2);
      const nearSurface = float(1.0).sub(smoothstep(5.0, 60.0, uniformNodes.depth)).mul(0.14);
      const midCaustic = float(1.0).sub(smoothstep(25.0, 80.0, uniformNodes.depth)).mul(0.05);

      color.addAssign(color.mul(causticValue).mul(nearSurface.add(midCaustic)).mul(shallowCaustic));
    });

    const contrast = mix(1.0, uniformNodes.grading.x, depthBlend);
    color.assign(color.sub(0.18).mul(contrast).add(0.18));

    const adaptLuma = dot(color, lumaWeights);
    const midtoneMask = smoothstep(0.005, 0.08, adaptLuma)
      .mul(float(1.0).sub(smoothstep(0.25, 0.6, adaptLuma)));
    const adaptAmount = midBlend.mul(uniformNodes.eyeAdapt).mul(float(1.0).sub(deepBlend.mul(0.5)));
    color.addAssign(color.mul(midtoneMask).mul(adaptAmount));

    const silhouetteLift = smoothstep(0.02, 0.25, dot(color, lumaWeights)).mul(0.028).mul(abyssBlend);
    color.addAssign(vec3(silhouetteLift));

    const grainStrength = uniformNodes.grading.z.add(depthBlend.mul(0.02))
      .mul(float(1.0).sub(uniformNodes.reducedMode.mul(0.7)));
    const grain = fract(
      sin(dot(distortedUv.mul(uniformNodes.time).mul(0.01), vec2(12.9898, 78.233))).mul(43758.5453)
    );
    color.addAssign(vec3(grain.sub(0.5).mul(grainStrength)));

    const dither = fract(
      fract(dot(fragCoord, vec2(0.06711056, 0.00583715)).add(uniformNodes.time.mul(0.003))).mul(52.9829189)
    );
    const ditherStrength = mix(0.0016, 0.0065, abyssBlend)
      .mul(float(1.0).sub(uniformNodes.reducedMode.mul(0.75)));
    color.addAssign(vec3(dither.sub(0.5).mul(ditherStrength)));

    const highlight = peakOf(color);
    const neighborPeak = highlight.toVar();
    const coveragePeak = highlight.toVar();
    If(uniformNodes.reducedMode.lessThan(0.5), () => {
      const bloomProbe = max(vec2(1.0).div(uniformNodes.resolution), vec2(0.0006));
      neighborPeak.assign(samplePeakCross(distortedUv, bloomProbe));
      coveragePeak.assign(neighborPeak);

      If(max(highlight, neighborPeak).greaterThan(uniformNodes.bloomParams.y.sub(0.06)), () => {
        // Probe farther only for likely bloom candidates so the common path does not pay a second 4-tap cross sample.
        const coverageProbe = bloomProbe.mul(
          max(float(2.2), uniformNodes.bloomParams.z.mul(0.75).add(1.4))
        );

        coveragePeak.assign(samplePeakCross(distortedUv, coverageProbe));
      });
    });

    const highlightCoverage = smoothstep(0.04, 0.18, coveragePeak);
    const sparkleIsolated = smoothstep(0.03, 0.14, highlight.sub(neighborPeak))
      .mul(float(1.0).sub(smoothstep(0.1, 0.3, coveragePeak)));
    const compactHighlight = smoothstep(0.05, 0.2, highlight.sub(coveragePeak))
      .mul(float(1.0).sub(smoothstep(0.12, 0.34, coveragePeak)));
    const preservedCore = smoothstep(uniformNodes.bloomParams.y.add(0.14), 1.25, highlight)
      .mul(0.22);
    const particulateSuppression = max(sparkleIsolated, compactHighlight);
    const bloomMask = smoothstep(uniformNodes.bloomParams.y, 1.0, highlight)
      .mul(clamp(highlightCoverage.add(preservedCore), 0.0, 1.0))
      .mul(float(1.0).sub(particulateSuppression.mul(0.92)));
    const bloomLift = uniformNodes.bloomParams.x.mul(depthBlend.mul(0.22).add(0.18))
      .mul(mix(0.3, 1.0, highlightCoverage))
      .mul(float(1.0).sub(particulateSuppression.mul(0.82)));
    color.addAssign(color.mul(bloomMask).mul(bloomLift));

    const scanline = sin(distortedUv.y.mul(uniformNodes.resolution.y).mul(1.5)).mul(0.03).add(0.97);
    const scanlineStrength = clamp(depthBlend, 0.0, 1.0)
      .mul(uniformNodes.grading.w)
      .mul(float(1.0).sub(uniformNodes.reducedMode.mul(0.9)));
    color.assign(color.mul(mix(1.0, scanline, scanlineStrength)));

    const peak = peakOf(color).toVar();
    If(uniformNodes.flashlightActive.greaterThan(0.5), () => {
      const beamCenterDistance = distance(distortedUv, vec2(0.5));
      const beamInfluence = float(1.0).sub(smoothstep(0.0, 0.38, beamCenterDistance));
      const localCompress = beamInfluence.mul(smoothstep(0.3, 0.75, peak)).mul(0.45);

      color.assign(mix(color, color.div(color.mul(0.7).add(1.0)), localCompress));
      peak.assign(peakOf(color));
    });

    const rollStart = max(0.45, uniformNodes.highlightRoll.x.sub(uniformNodes.exposure.mul(0.08)));
    const rollBlend = smoothstep(rollStart, rollStart.add(uniformNodes.highlightRoll.y), peak)
      .mul(uniformNodes.highlightRoll.z);
    const rolled = color.div(color.add(1.0));

    color.assign(mix(color, rolled, rollBlend));

    return vec4(clamp(color, 0.0, 1.0), baseSample.a);
  })();
}

export class UnderwaterEffect {
  constructor(renderer, scene, camera, sunLight = null) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this._sunLight = sunLight;
    this.time = 0;

    // Phase 2c keeps the existing wrapper boundary intact while porting the
    // underwater post-processing chain to TSL nodes on the RenderPipeline.
    this._renderPipeline = new THREE.RenderPipeline(renderer);
    this._scenePass = pass(scene, camera);
    this._sceneColorNode = this._scenePass.getTextureNode('output');
    this._activeOutputNode = null;
    this._bloomRenderNode = null;
    this._bloomRenderTextureNode = null;
    this._underwaterSceneOutputNode = null;
    this._underwaterBloomOutputNode = null;
    this._rendererSize = new THREE.Vector2();
    this._drawingBufferSize = new THREE.Vector2();
    this._effectiveBloomSize = new THREE.Vector2();

    this.tuning = RENDER_PIPELINE_TUNING;
    this._nativeComposerPixelRatio = Math.max(renderer.getPixelRatio(), 1);
    this._composerScale = this.tuning.performance.baseScale;
    this._appliedComposerScale = 0;
    this._appliedComposerPixelRatio = 0;
    this._appliedComposerWidth = 0;
    this._appliedComposerHeight = 0;
    this._scaleLadder = [];
    this._scaleIndex = 0;
    // Warm-up cooldown: ignore adaptive signals for the first 2 s to avoid reacting to
    // one-time shader-compilation / render-target-allocation spikes on the first frame.
    const _warmupNow = (typeof performance !== 'undefined' && typeof performance.now === 'function')
      ? performance.now() : 0;
    const _warmupMs = 2000;
    this._nextScaleChangeAt = _warmupNow + _warmupMs;
    this._recoveryAllowedAt = _warmupNow + _warmupMs;
    this._stableRecoveryFrames = 0;
    this._bloomSuspended = false;
    this._bloomSuspendedUntil = 0;
    this._lastRenderMs = 0;
    this._consecutiveEmergencyFrames = 0;

    this.underwaterPass = { uniforms: cloneUniforms(UNDERWATER_UNIFORM_TEMPLATE) };
    this.underwaterPass.uniforms.resolution.value.set(window.innerWidth, window.innerHeight);
    this.underwaterPass.uniforms.depthThresholds.value.set(
      this.tuning.depthThresholds.mid,
      this.tuning.depthThresholds.deep,
      this.tuning.depthThresholds.abyss
    );
    this.underwaterPass.uniforms.grading.value.set(
      this.tuning.grading.contrast,
      this.tuning.grading.vignette,
      this.tuning.grading.grain,
      this.tuning.grading.scanline
    );
    this.underwaterPass.uniforms.extinction.value.set(
      this.tuning.extinction.r,
      this.tuning.extinction.g,
      this.tuning.extinction.b
    );
    this.underwaterPass.uniforms.scatterColor.value.set(
      this.tuning.scatter.r,
      this.tuning.scatter.g,
      this.tuning.scatter.b
    );
    this.underwaterPass.uniforms.scatterDensity.value = this.tuning.scatter.density;
    this.underwaterPass.uniforms.eyeAdapt.value = this.tuning.grading.eyeAdapt;
    this.underwaterPass.uniforms.highlightRoll.value.set(
      this.tuning.highlightRoll.start,
      this.tuning.highlightRoll.range,
      this.tuning.highlightRoll.strength
    );
    this.underwaterPass.uniforms.bloomParams.value.set(
      this.tuning.bloom.surfaceStrength,
      this.tuning.bloom.surfaceThreshold,
      this.tuning.bloom.radius * 2.4
    );
    this._underwaterUniformNodes = createUnderwaterUniformNodes(this.underwaterPass.uniforms);
    this._underwaterSceneOutputNode = this._createUnderwaterOutputNode(this._sceneColorNode);

    // Bloom node for ultra tier
    this._bloomPass = null;
    this._setupBloom(qualityManager.tier);

    // Godrays node for ultra tier
    this._godraysPass = null;
    this._godraysBaseDensity = 0;
    this._godraysBaseMaxDensity = 0;
    this._godraysBloomRenderNode = null;
    this._godraysBloomRenderTextureNode = null;
    this._underwaterBloomGodraysOutputNode = null;
    this._godraysSceneRenderNode = null;
    this._godraysSceneRenderTextureNode = null;
    this._underwaterGodraysOutputNode = null;
    this._setupGodrays(qualityManager.tier);

    // Adaptive render guard:
    // creature-dense scenes can cause heavy post-processing stalls on some GPUs.
    this._renderEmaMs = 16;
    this._qualityMaxScale = qualityManager.getSettings().postProcessScale;
    this._depthScaleCap = 1.0;
    this._startupScaleCap = 1.0;
    this._postProcessMaxScale = Math.min(
      this._qualityMaxScale,
      this._depthScaleCap,
      this._startupScaleCap
    );
    this._reducedShaderMode = false;
    this._isSoftwareRenderer = false;
    this._moderatePressureFrames = 0;
    this._startupGuard = {
      active: false,
      stableFrames: 0,
      endsAt: 0,
    };
    // Item 4: cache quantized pass-state inputs to skip unnecessary bloom recomputation
    this._passStateCacheDepth = -9999;
    this._passStateCacheFlashlight = null;
    this._passStateCacheExposure = -1;
    // Cached bloom targets — updated on cache miss, applied every frame via lerp
    this._bloomTargetStrength = this.tuning.bloom.surfaceStrength;
    this._bloomTargetThreshold = this.tuning.bloom.surfaceThreshold;
    this._bloomTargetRadius = this.tuning.bloom.radius * 2.0;
    this._lastDepth = 0;
    this._lastFlashlightOn = false;
    this._lastExposure = 0.76;
    this._rebuildScaleLadder();
    this._applyComposerScale(true);

    window.addEventListener('qualitychange', (e) => {
      this._qualityMaxScale = e.detail.settings.postProcessScale;
      this._setupBloom(e.detail.tier);
      this._setupGodrays(e.detail.tier);
      this._refreshScaleCap({ force: true, skipCooldown: true });
    });
  }

  _getRendererSize() {
    this.renderer.getSize(this._rendererSize);
    return this._rendererSize;
  }

  _getDrawingBufferSize() {
    this.renderer.getDrawingBufferSize(this._drawingBufferSize);
    return this._drawingBufferSize;
  }

  _setOutputNode(node, force = false) {
    if (!force && this._activeOutputNode === node) {
      return;
    }

    this._activeOutputNode = node;
    this._renderPipeline.outputNode = node;
    this._renderPipeline.needsUpdate = true;
  }

  _createUnderwaterOutputNode(sourceNode) {
    return convertToTexture(createUnderwaterPostColorNode(sourceNode, this._underwaterUniformNodes));
  }

  _updateUnderwaterNodeSizes(
    width = this._appliedComposerWidth || this._getRendererSize().width,
    height = this._appliedComposerHeight || this._getRendererSize().height,
    pixelRatio = this._appliedComposerPixelRatio || this._nativeComposerPixelRatio,
    scale = this._appliedComposerScale || this._composerScale || 1,
  ) {
    updateRttNodeScale(this._bloomRenderTextureNode, width, height, pixelRatio, scale);
    updateRttNodeScale(this._underwaterSceneOutputNode, width, height, pixelRatio, scale);
    updateRttNodeScale(this._underwaterBloomOutputNode, width, height, pixelRatio, scale);
    updateRttNodeScale(this._godraysBloomRenderTextureNode, width, height, pixelRatio, scale);
    updateRttNodeScale(this._underwaterBloomGodraysOutputNode, width, height, pixelRatio, scale);
    updateRttNodeScale(this._godraysSceneRenderTextureNode, width, height, pixelRatio, scale);
    updateRttNodeScale(this._underwaterGodraysOutputNode, width, height, pixelRatio, scale);
  }

  _setReducedMode(enabled) {
    this._reducedShaderMode = enabled;
    const reducedModeValue = enabled ? 1.0 : 0.0;
    this.underwaterPass.uniforms.reducedMode.value = reducedModeValue;
    this._underwaterUniformNodes.reducedMode.value = reducedModeValue;
  }

  _syncOutputNode(force = false) {
    let nextNode;
    if (this._bloomPass && !this._bloomSuspended && this._godraysPass) {
      nextNode = this._underwaterBloomGodraysOutputNode;
    } else if (this._bloomPass && !this._bloomSuspended) {
      nextNode = this._underwaterBloomOutputNode;
    } else if (this._godraysPass) {
      nextNode = this._underwaterGodraysOutputNode;
    } else {
      nextNode = this._underwaterSceneOutputNode;
    }
    this._setOutputNode(nextNode, force);
  }

  _getEffectiveBloomSize(width, height) {
    const scale = THREE.MathUtils.clamp(
      this._appliedComposerScale || this._composerScale || 1,
      this.tuning.performance.minScale,
      1
    );

    this._effectiveBloomSize.set(
      Math.max(1, Math.round(width * scale)),
      Math.max(1, Math.round(height * scale))
    );

    return this._effectiveBloomSize;
  }

  _updateBloomNodeSize() {
    if (!this._bloomPass) {
      return;
    }

    const size = this._getDrawingBufferSize();
    this._bloomPass.setSize(size.width, size.height);
  }

  _updateGodraysNodeSize() {
    if (!this._godraysPass) {
      return;
    }

    const size = this._getDrawingBufferSize();
    this._godraysPass.setSize(size.width, size.height);
  }

  /**
   * Add or remove the godrays node based on quality tier.
   * Ultra tier only — 60 raymarch steps is expensive.
   */
  _setupGodrays(tier) {
    if (tier === 'ultra' && this._sunLight && !this._godraysPass) {
      const depthNode = this._scenePass.getTextureNode('depth');
      this._godraysPass = godrays(depthNode, this.camera, this._sunLight);
      this._godraysPass.maxDensity.value = 0.5;
      this._godraysPass.density.value = 0.7;
      this._godraysPass.raymarchSteps.value = 60;
      this._godraysPass.distanceAttenuation.value = 2;
      this._godraysBaseDensity = 0.7;
      this._godraysBaseMaxDensity = 0.5;

      // Wrap setSize to follow adaptive composer scale
      const baseSetSize = this._godraysPass.setSize.bind(this._godraysPass);
      this._godraysPass.setSize = (width, height) => {
        const scale = THREE.MathUtils.clamp(
          this._appliedComposerScale || this._composerScale || 1,
          this.tuning.performance.minScale,
          1
        );
        baseSetSize(
          Math.max(1, Math.round(width * scale)),
          Math.max(1, Math.round(height * scale))
        );
      };
      this._updateGodraysNodeSize();
    } else if (tier !== 'ultra' && this._godraysPass) {
      this._godraysPass.dispose();
      this._godraysPass = null;
    }

    this._rebuildOutputChains();
  }

  /**
   * Rebuild godrays-dependent output chain nodes based on current bloom + godrays state.
   * Called after _setupBloom or _setupGodrays changes pass availability.
   */
  _rebuildOutputChains() {
    // Dispose old godrays-specific chain nodes
    disposeRttNode(this._godraysBloomRenderTextureNode);
    disposeRttNode(this._underwaterBloomGodraysOutputNode);
    this._godraysBloomRenderNode = null;
    this._godraysBloomRenderTextureNode = null;
    this._underwaterBloomGodraysOutputNode = null;

    disposeRttNode(this._godraysSceneRenderTextureNode);
    disposeRttNode(this._underwaterGodraysOutputNode);
    this._godraysSceneRenderNode = null;
    this._godraysSceneRenderTextureNode = null;
    this._underwaterGodraysOutputNode = null;

    if (this._godraysPass) {
      if (this._bloomPass) {
        // bloom + godrays chain
        this._godraysBloomRenderNode = this._sceneColorNode.add(this._bloomPass).add(this._godraysPass);
        this._godraysBloomRenderTextureNode = convertToTexture(this._godraysBloomRenderNode);
        this._underwaterBloomGodraysOutputNode = this._createUnderwaterOutputNode(this._godraysBloomRenderTextureNode);
      }

      // godrays-only chain (used when bloom is suspended or absent)
      this._godraysSceneRenderNode = this._sceneColorNode.add(this._godraysPass);
      this._godraysSceneRenderTextureNode = convertToTexture(this._godraysSceneRenderNode);
      this._underwaterGodraysOutputNode = this._createUnderwaterOutputNode(this._godraysSceneRenderTextureNode);
    }

    this._updateUnderwaterNodeSizes();
    this._syncOutputNode(true);
  }

  /**
   * Add or remove the bloom node based on quality tier.
   * Ultra tier keeps the multi-pass bloom path upstream of the underwater TSL stage.
   */
  _setupBloom(tier) {
    if (tier === 'ultra' && !this._bloomPass) {
      this._bloomPass = createBloomNode(
        this._sceneColorNode,
        this.tuning.bloom.surfaceStrength,
        this.tuning.bloom.radius,
        this.tuning.bloom.surfaceThreshold
      );

      // BloomNode sizes itself from the renderer drawing buffer every frame.
      // Wrap the instance so its blur chain follows the adaptive composer scale.
      const baseSetSize = this._bloomPass.setSize.bind(this._bloomPass);
      this._bloomPass.setSize = (width, height) => {
        const scaledSize = this._getEffectiveBloomSize(width, height);
        baseSetSize(scaledSize.width, scaledSize.height);
      };

      this._bloomRenderNode = this._sceneColorNode.add(this._bloomPass);
      this._bloomRenderTextureNode = convertToTexture(this._bloomRenderNode);
      this._underwaterBloomOutputNode = this._createUnderwaterOutputNode(this._bloomRenderTextureNode);
    } else if (tier !== 'ultra' && this._bloomPass) {
      this._bloomPass.dispose();
      this._bloomPass = null;
      disposeRttNode(this._underwaterBloomOutputNode);
      disposeRttNode(this._bloomRenderTextureNode);
      this._bloomRenderNode = null;
      this._bloomRenderTextureNode = null;
      this._underwaterBloomOutputNode = null;
      this._bloomSuspended = false;
      this._bloomSuspendedUntil = 0;
    }

    if (this._bloomPass) {
      this._bloomPass.strength.value = this.tuning.bloom.surfaceStrength;
      this._bloomPass.radius.value = this.tuning.bloom.radius;
      this._bloomPass.threshold.value = this.tuning.bloom.surfaceThreshold;
      this._updateBloomNodeSize();
    }

    this._rebuildOutputChains();
  }

  resize() {
    this._applyComposerScale(true);
  }

  warmPerformanceFallbacks({ depth = 0, flashlightOn = false, exposure = 0.76 } = {}) {
    if (this._scaleLadder.length <= 1) {
      return;
    }

    const originalIndex = this._scaleIndex;
    const originalScale = this._composerScale;

    for (let i = 0; i < this._scaleLadder.length; i++) {
      if (i === originalIndex) {
        continue;
      }

      this._scaleIndex = i;
      this._composerScale = this._scaleLadder[i];
      this._applyComposerScale(true);
      this._updatePassState(depth, flashlightOn, exposure);
      this._renderPipeline.render();
    }

    this._scaleIndex = originalIndex;
    this._composerScale = originalScale;
    this._applyComposerScale(true);
    this._updatePassState(depth, flashlightOn, exposure);
  }

  _rebuildScaleLadder() {
    const requestedScales = [
      this.tuning.performance.baseScale,
      ...this.tuning.performance.scaleLevels,
      this._postProcessMaxScale,
      this.tuning.performance.minScale,
    ];

    const nextScaleLadder = [];
    for (const scale of requestedScales) {
      const clampedScale = THREE.MathUtils.clamp(
        scale,
        this.tuning.performance.minScale,
        this._postProcessMaxScale
      );

      if (!nextScaleLadder.some((entry) => Math.abs(entry - clampedScale) < 0.01)) {
        nextScaleLadder.push(clampedScale);
      }
    }

    nextScaleLadder.sort((a, b) => b - a);
    this._scaleLadder = nextScaleLadder;
    this._scaleIndex = this._findScaleIndex(this._composerScale);
    this._composerScale = this._scaleLadder[this._scaleIndex] ?? this.tuning.performance.minScale;
  }

  _findScaleIndex(scale) {
    if (this._scaleLadder.length === 0) {
      return 0;
    }

    let bestIndex = 0;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this._scaleLadder.length; i++) {
      const delta = Math.abs(this._scaleLadder[i] - scale);
      if (delta < bestDelta) {
        bestIndex = i;
        bestDelta = delta;
      }
    }
    return bestIndex;
  }

  _setScaleIndex(index, { force = false, skipCooldown = false, holdRecovery = false, now = performance.now() } = {}) {
    const nextIndex = THREE.MathUtils.clamp(index, 0, Math.max(this._scaleLadder.length - 1, 0));
    const nextScale = this._scaleLadder[nextIndex] ?? this.tuning.performance.minScale;

    if (!force && Math.abs(nextScale - this._composerScale) < 0.01) {
      return false;
    }

    this._scaleIndex = nextIndex;
    this._composerScale = nextScale;
    this._nextScaleChangeAt = skipCooldown ? now : now + this.tuning.performance.scaleChangeCooldownMs;
    if (holdRecovery) {
      this._recoveryAllowedAt = Math.max(
        this._recoveryAllowedAt,
        now + this.tuning.performance.emergencyHoldMs
      );
    } else {
      this._recoveryAllowedAt = Math.max(
        this._recoveryAllowedAt,
        now + this.tuning.performance.recoveryDelayMs
      );
    }
    this._applyComposerScale(force);
    return true;
  }

  _setBloomSuspended(suspended, now = performance.now()) {
    this._bloomSuspended = suspended;
    if (suspended) {
      this._bloomSuspendedUntil = now + this.tuning.performance.emergencyHoldMs;
    }

    this._syncOutputNode(true);
  }

  _refreshScaleCap({ force = false, skipCooldown = false } = {}) {
    const newMax = Math.min(
      this._qualityMaxScale,
      this._depthScaleCap,
      this._startupScaleCap
    );
    if (!force && Math.abs(newMax - this._postProcessMaxScale) < 0.005) {
      return;
    }

    this._postProcessMaxScale = newMax;
    this._rebuildScaleLadder();
    const clampedIndex = this._findScaleIndex(Math.min(this._composerScale, newMax));
    this._setScaleIndex(clampedIndex, { force: true, skipCooldown });
  }

  beginStartupGuard() {
    const now = performance.now();
    const targetScale = qualityManager.tier === 'ultra' ? 0.6 : 0.72;
    this._startupGuard.active = true;
    this._startupGuard.stableFrames = 0;
    this._startupGuard.endsAt = now + this.tuning.performance.startupMaxHoldMs;
    this._startupScaleCap = Math.min(this._startupScaleCap, targetScale);
    this._refreshScaleCap({ force: true, skipCooldown: true });
    this._setScaleIndex(this._findScaleIndex(targetScale), { force: true, skipCooldown: true, holdRecovery: true, now });
    this._stableRecoveryFrames = 0;
    this._moderatePressureFrames = 0;
    this._setReducedMode(true);
    if (this._bloomPass && !this._bloomSuspended) {
      this._setBloomSuspended(true, now);
    }
  }

  isStartupResponsive() {
    return !this._startupGuard.active ||
      this._startupGuard.stableFrames >= this.tuning.performance.startupStableFrames;
  }

  getStartupGuardStatus() {
    return {
      active: this._startupGuard.active,
      stableFrames: this._startupGuard.stableFrames,
      requiredFrames: this.tuning.performance.startupStableFrames,
      remainingMs: this._startupGuard.active
        ? Math.max(0, this._startupGuard.endsAt - performance.now())
        : 0,
    };
  }

  _updateStartupGuard(renderMs, now) {
    if (!this._startupGuard.active) return;

    if (renderMs <= this.tuning.performance.startupStableThresholdMs) {
      this._startupGuard.stableFrames++;
    } else {
      this._startupGuard.stableFrames = 0;
    }

    if (
      this._startupGuard.stableFrames < this.tuning.performance.startupStableFrames &&
      now < this._startupGuard.endsAt
    ) {
      return;
    }

    this._startupGuard.active = false;
    this._startupGuard.stableFrames = 0;
    this._startupScaleCap = 1.0;
    this._refreshScaleCap({ force: true, skipCooldown: true });
  }

  _applyComposerScale(force = false) {
    this._nativeComposerPixelRatio = Math.max(this.renderer.getPixelRatio(), 1);
    const nextScale = THREE.MathUtils.clamp(
      this._composerScale,
      this.tuning.performance.minScale,
      this._postProcessMaxScale
    );
    const size = this._getRendererSize();
    const width = size.width;
    const height = size.height;
    const pixelRatio = this._nativeComposerPixelRatio;

    if (!force &&
      Math.abs(nextScale - this._appliedComposerScale) < 0.01 &&
      Math.abs(pixelRatio - this._appliedComposerPixelRatio) < 0.01 &&
      width === this._appliedComposerWidth &&
      height === this._appliedComposerHeight) {
      return;
    }

    this._appliedComposerScale = nextScale;
    this._appliedComposerPixelRatio = pixelRatio;
    this._appliedComposerWidth = width;
    this._appliedComposerHeight = height;
    this._scenePass.setResolutionScale(nextScale);
    this._scenePass.setPixelRatio(pixelRatio);
    this._scenePass.setSize(width, height);
    this._updateBloomNodeSize();
    this._updateGodraysNodeSize();
    this.underwaterPass.uniforms.resolution.value.set(
      width * pixelRatio * nextScale,
      height * pixelRatio * nextScale
    );
    this._updateUnderwaterNodeSizes(width, height, pixelRatio, nextScale);
  }

  _updatePassState(depth, flashlightOn, exposure) {
    this.time += 0.016;
    this._lastDepth = depth;
    this._lastFlashlightOn = flashlightOn;
    this._lastExposure = exposure;
    this.underwaterPass.uniforms.time.value = this.time;
    this.underwaterPass.uniforms.depth.value = depth;
    this.underwaterPass.uniforms.exposure.value = exposure;
    this.underwaterPass.uniforms.flashlightActive.value = flashlightOn ? 1 : 0;
    this._underwaterUniformNodes.time.value = this.time;
    this._underwaterUniformNodes.depth.value = depth;
    this._underwaterUniformNodes.exposure.value = exposure;
    this._underwaterUniformNodes.flashlightActive.value = flashlightOn ? 1 : 0;

    // Fade godrays density with depth (matches billboard god ray range 40-80)
    if (this._godraysPass) {
      const depthFade = 1.0 - THREE.MathUtils.smoothstep(depth, 40, 80);
      this._godraysPass.density.value = this._godraysBaseDensity * depthFade;
      this._godraysPass.maxDensity.value = this._godraysBaseMaxDensity * depthFade;
    }

    // Item 4: quantize inputs — skip expensive bloom target recomputation when nothing meaningful
    // changed. The lerp convergence itself must still run every frame so bloom params converge
    // smoothly rather than freezing until the next cache miss.
    const qDepth = Math.round(depth / 5) * 5;
    const qExposure = Math.round(exposure * 100) / 100;
    if (
      qDepth !== this._passStateCacheDepth ||
      flashlightOn !== this._passStateCacheFlashlight ||
      qExposure !== this._passStateCacheExposure
    ) {
      this._passStateCacheDepth = qDepth;
      this._passStateCacheFlashlight = flashlightOn;
      this._passStateCacheExposure = qExposure;

      const depthNorm = THREE.MathUtils.smoothstep(
        depth,
        this.tuning.depthThresholds.mid,
        this.tuning.depthThresholds.abyss
      );

      this._bloomTargetStrength = THREE.MathUtils.lerp(
        this.tuning.bloom.surfaceStrength,
        this.tuning.bloom.deepStrength,
        depthNorm
      ) * (flashlightOn ? 0.35 : 1.0);

      this._bloomTargetThreshold = THREE.MathUtils.lerp(
        this.tuning.bloom.surfaceThreshold,
        this.tuning.bloom.deepThreshold,
        depthNorm
      ) + (flashlightOn ? 0.30 : 0.0);

      this._bloomTargetRadius = THREE.MathUtils.lerp(
        this.tuning.bloom.radius * 2.0,
        this.tuning.bloom.radius * 2.8,
        depthNorm
      );
    }

    // Lerp convergence runs every frame regardless of cache state so bloom params
    // converge smoothly rather than freezing at stale values on cache hits.
    const shaderBloomScale = this._bloomPass && !this._bloomSuspended ? 0.3 : 1.0;
    const flashlightBloomRadiusScale = flashlightOn ? 0.82 : 1.0;
    const bloomParams = this.underwaterPass.uniforms.bloomParams.value;
    bloomParams.x = THREE.MathUtils.lerp(bloomParams.x, this._bloomTargetStrength * shaderBloomScale, 0.09);
    bloomParams.y = THREE.MathUtils.lerp(bloomParams.y, this._bloomTargetThreshold, 0.09);
    bloomParams.z = THREE.MathUtils.lerp(bloomParams.z, this._bloomTargetRadius, 0.09);

    if (this._bloomPass && !this._bloomSuspended) {
      this._bloomPass.strength.value = THREE.MathUtils.lerp(
        this._bloomPass.strength.value,
        this._bloomTargetStrength,
        0.09
      );
      this._bloomPass.threshold.value = THREE.MathUtils.lerp(
        this._bloomPass.threshold.value,
        this._bloomTargetThreshold,
        0.09
      );
      this._bloomPass.radius.value = THREE.MathUtils.lerp(
        this._bloomPass.radius.value,
        this.tuning.bloom.radius * flashlightBloomRadiusScale,
        0.09
      );
    }
  }

  render(depth, { flashlightOn = false, exposure = 0.76 } = {}) {
    const frameStart = performance.now();
    this._updatePassState(depth, flashlightOn, exposure);
    this._renderPipeline.render();

    const now = performance.now();
    const renderMs = now - frameStart;
    this._lastRenderMs = renderMs;
    this._renderEmaMs = this._renderEmaMs * 0.92 + renderMs * 0.08;

    // Software-renderer sessions hold their reduced profile permanently — never recover.
    if (!this._isSoftwareRenderer &&
      !this._startupGuard.active &&
      this._bloomSuspended &&
      this._bloomPass &&
      now >= this._bloomSuspendedUntil &&
      this._scaleIndex === 0 &&
      this._renderEmaMs < this.tuning.performance.recoveryThresholdMs) {
      this._setBloomSuspended(false, now);
    }

    const underPressure =
      renderMs > this.tuning.performance.severeThresholdMs ||
      this._renderEmaMs > this.tuning.performance.degradeThresholdMs;
    const emergencyFrame = renderMs > this.tuning.performance.emergencyThresholdMs;

    // Require ≥2 consecutive emergency frames before snapping to minimum scale / suspending
    // bloom, to avoid overreacting to isolated one-off spikes (shader compilation, tab focus, etc.).
    if (emergencyFrame) {
      this._consecutiveEmergencyFrames = Math.min(this._consecutiveEmergencyFrames + 1, 2);
    } else {
      this._consecutiveEmergencyFrames = 0;
    }
    const sustainedEmergency = this._consecutiveEmergencyFrames >= 2;

    // Items 1/8: track sustained moderate-EMA pressure for early degradation
    const moderatePressure = this._renderEmaMs > this.tuning.performance.moderatePressureThresholdMs;
    if (moderatePressure) {
      this._moderatePressureFrames = Math.min(
        this._moderatePressureFrames + 1,
        this.tuning.performance.sustainedModeratePressureFrames + 1
      );
    } else {
      this._moderatePressureFrames = 0;
    }
    const sustainedModeratePressure =
      this._moderatePressureFrames >= this.tuning.performance.sustainedModeratePressureFrames;

    // Items 6/7: activate reduced shader mode under any tier of pressure
    const shouldReduceShader =
      this._startupGuard.active ||
      underPressure ||
      sustainedModeratePressure;
    if (shouldReduceShader !== this._reducedShaderMode) {
      this._setReducedMode(shouldReduceShader);
    }

    if (underPressure) {
      this._stableRecoveryFrames = 0;

      // Item 3: suspend bloom at pressured state, not only at emergency.
      // For the emergency path, require sustained emergency to avoid overreacting to single-frame spikes.
      if (this._bloomPass && !this._bloomSuspended &&
          (sustainedEmergency || renderMs > this.tuning.performance.bloomSuspendThresholdMs)) {
        this._setBloomSuspended(true, now);
      }

      if (now >= this._nextScaleChangeAt) {
        const nextIndex = sustainedEmergency
          ? this._scaleLadder.length - 1
          : this._scaleIndex + 1;
        this._setScaleIndex(nextIndex, { now, holdRecovery: sustainedEmergency });
      }
    } else if (sustainedModeratePressure && now >= this._nextScaleChangeAt) {
      // Item 1: degrade one rung earlier under sustained moderate-EMA pressure
      this._stableRecoveryFrames = 0;
      this._setScaleIndex(this._scaleIndex + 1, { now });
    } else if (!this._isSoftwareRenderer && this._renderEmaMs < this.tuning.performance.recoveryThresholdMs) {
      // Software-renderer sessions stay in reduced profile and never scale back up.
      this._stableRecoveryFrames++;
      if (
        this._scaleIndex > 0 &&
        !this._startupGuard.active &&
        now >= this._nextScaleChangeAt &&
        now >= this._recoveryAllowedAt &&
        this._stableRecoveryFrames >= this.tuning.performance.stableFramesForRecovery
      ) {
        this._stableRecoveryFrames = 0;
        this._setScaleIndex(this._scaleIndex - 1, { now });
      }
    } else {
      this._stableRecoveryFrames = 0;
    }

    this._updateStartupGuard(renderMs, now);
  }

  getDiagnostics() {
    const extinction = this.underwaterPass.uniforms.extinction.value;
    const scatterColor = this.underwaterPass.uniforms.scatterColor.value;
    const bloomParams = this.underwaterPass.uniforms.bloomParams.value;
    const transmittance = {
      r: Math.exp(-extinction.x * this._lastDepth),
      g: Math.exp(-extinction.y * this._lastDepth),
      b: Math.exp(-extinction.z * this._lastDepth),
    };
    const scatterMix = 1 - Math.exp(-this.underwaterPass.uniforms.scatterDensity.value * this._lastDepth);
    const emaPressure = this._renderEmaMs > this.tuning.performance.emergencyThresholdMs
      ? 'emergency'
      : this._renderEmaMs > this.tuning.performance.degradeThresholdMs
        ? 'pressured'
        : 'normal';
    const lastRenderPressure = this._lastRenderMs > this.tuning.performance.emergencyThresholdMs
      ? 'emergency'
      : this._lastRenderMs > this.tuning.performance.severeThresholdMs
        ? 'pressured'
        : 'normal';
    const emergency =
      this._bloomSuspended ||
      this._lastRenderMs > this.tuning.performance.emergencyThresholdMs;
    const pressured =
      emergency ||
      this._lastRenderMs > this.tuning.performance.severeThresholdMs ||
      this._renderEmaMs > this.tuning.performance.degradeThresholdMs;

    return {
      composerScale: this._composerScale,
      renderEmaMs: this._renderEmaMs,
      lastRenderMs: this._lastRenderMs,
      bloomSuspended: this._bloomSuspended,
      reducedShaderMode: this._reducedShaderMode,
      depthScaleCap: this._depthScaleCap,
      postProcessMaxScale: this._postProcessMaxScale,
      depth: this._lastDepth,
      flashlightOn: this._lastFlashlightOn,
      exposure: this._lastExposure,
      extinction: {
        r: extinction.x,
        g: extinction.y,
        b: extinction.z,
      },
      transmittance,
      scatter: {
        color: {
          r: scatterColor.x,
          g: scatterColor.y,
          b: scatterColor.z,
        },
        density: this.underwaterPass.uniforms.scatterDensity.value,
        mix: scatterMix,
      },
      bloom: {
        mode: this._bloomPass ? 'pipeline' : 'none',
        passEnabled: !!this._bloomPass && !this._bloomSuspended,
        shaderStrength: bloomParams.x,
        shaderThreshold: bloomParams.y,
        shaderRadius: bloomParams.z,
        passStrength: this._bloomPass?.strength?.value ?? null,
        passThreshold: this._bloomPass?.threshold?.value ?? null,
        passRadius: this._bloomPass?.radius?.value ?? null,
      },
      emaPressure,
      lastRenderPressure,
      renderPressure: emergency ? 'emergency' : pressured ? 'pressured' : 'normal',
      stallRisk: emergency ? 'emergency' : pressured ? 'pressured' : 'normal',
      stallRiskLabel: emergency ? 'Emergency' : pressured ? 'Pressured' : 'Normal',
    };
  }

  /**
   * Item 2: Cap the maximum composer scale for the current depth band.
   * Called each frame from LightingPolicy.applyToScene.
   * Deep/abyss zones tolerate cheaper post-FX — visual sensitivity is lower.
   */
  applyDepthScaleCap(depth) {
    const caps = this.tuning.performance.depthScaleCaps;
    const thresholds = this.tuning.depthThresholds;
    let cap;
    if (depth < thresholds.mid) {
      cap = caps.surface;
    } else if (depth < thresholds.deep) {
      cap = caps.mid;
    } else if (depth < thresholds.abyss) {
      cap = caps.deep;
    } else {
      cap = caps.abyss;
    }

    if (Math.abs(cap - this._depthScaleCap) < 0.005) return;
    this._depthScaleCap = cap;
    this._refreshScaleCap({ force: true, skipCooldown: true });
  }

  /**
   * Item 9: Start with a reduced post-process profile for software/fallback renderers.
   * Called once from Game constructor when software rendering is detected.
   */
  applySoftwareRendererPolicy() {
    this._isSoftwareRenderer = true;
    this._setReducedMode(true);
    this._setScaleIndex(this._scaleLadder.length - 1, { force: true, skipCooldown: true });
    if (this._bloomPass && !this._bloomSuspended) {
      this._setBloomSuspended(true);
    }
  }

  /**
   * Item 5: Warm all scale-ladder variants with bloom explicitly suspended.
   * Allows PreloadCoordinator to pre-compile the bloom-off post-FX permutation.
   */
  warmBloomSuspendedVariant({ depth = 0, flashlightOn = false, exposure = 0.76 } = {}) {
    if (!this._bloomPass) return;
    const wasSuspended = this._bloomSuspended;
    if (!wasSuspended) {
      this._bloomSuspended = true;
      this._syncOutputNode(true);
    }
    this.warmPerformanceFallbacks({ depth, flashlightOn, exposure });
    if (!wasSuspended) {
      this._bloomSuspended = false;
      this._syncOutputNode(true);
    }
  }

  /**
   * Render one frame without updating EMA or adaptive state.
   * Use this during GPU warm-up to avoid polluting adaptive metrics with
   * one-time shader-compilation / render-target-allocation spikes.
   */
  warmRender(depth = 0, { flashlightOn = false, exposure = 0.76 } = {}) {
    this._updatePassState(depth, flashlightOn, exposure);
    this._renderPipeline.render();
  }
}


