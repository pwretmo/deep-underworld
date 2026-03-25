import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { qualityManager } from '../QualityManager.js';

function deepFreeze(obj) {
  Object.freeze(obj);
  Object.values(obj).forEach(v => {
    if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
  });
  return obj;
}

const RENDER_PIPELINE_TUNING = deepFreeze({
  depthThresholds: {
    mid: 130,
    deep: 340,
    abyss: 720,
  },
  grading: {
    contrast: 1.2,
    vignette: 0.88,
    grain: 0.018,
    scanline: 0.24,
    darkening: 0.55,
  },
  highlightRoll: {
    start: 0.62,
    range: 0.34,
    strength: 0.62,
  },
  bloom: {
    surfaceStrength: 0.28,
    deepStrength: 0.82,
    surfaceThreshold: 0.78,
    deepThreshold: 0.44,
    radius: 0.62,
  },
  performance: {
    baseScale: 1.0,
    minScale: 0.6,
    maxScale: 1.0,
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
      surface: 1.0,
      mid: 0.85,
      deep: 0.72,
      abyss: 0.6,
    },
  },
});

const UnderwaterShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    depth: { value: 0 },
    exposure: { value: 0.76 },
    flashlightActive: { value: 0 },
    resolution: { value: new THREE.Vector2() },
    depthThresholds: { value: new THREE.Vector3(130, 340, 720) },
    grading: { value: new THREE.Vector4(1.2, 0.88, 0.018, 0.24) },
    darkening: { value: 0.55 },
    highlightRoll: { value: new THREE.Vector3(0.62, 0.34, 0.62) },
    bloomParams: { value: new THREE.Vector3(0.28, 0.78, 1.6) },
    reducedMode: { value: 0.0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float depth;
    uniform float exposure;
    uniform float flashlightActive;
    uniform vec2 resolution;
    uniform vec3 depthThresholds;
    uniform vec4 grading;
    uniform float darkening;
    uniform vec3 highlightRoll;
    uniform vec3 bloomParams;
    uniform float reducedMode;
    varying vec2 vUv;

    void main() {
      vec2 uv = vUv;

      // Underwater distortion - subtle wavy effect
      float distortStr = 0.0015 + depth * 0.000008;
      uv.x += sin(uv.y * 15.0 + time * 1.0) * distortStr;
      uv.y += cos(uv.x * 12.0 + time * 0.8) * distortStr * 0.6;

      vec4 color = texture2D(tDiffuse, uv);
      vec2 fragCoord = uv * resolution;
      float midBlend = smoothstep(depthThresholds.x, depthThresholds.y, depth);
      float deepBlend = smoothstep(depthThresholds.y, depthThresholds.z, depth);
      float abyssBlend = smoothstep(depthThresholds.z, depthThresholds.z + 280.0, depth);
      float depthBlend = clamp(midBlend * 0.45 + deepBlend * 0.7 + abyssBlend * 0.35, 0.0, 1.0);

      // Chromatic aberration — scaled back in reduced mode (items 6/7)
      float caStr = (0.0015 + depth * 0.000005) * (1.0 - reducedMode * 0.85);
      float r = texture2D(tDiffuse, uv + vec2(caStr, caStr * 0.3)).r;
      float b = texture2D(tDiffuse, uv - vec2(caStr, caStr * 0.2)).b;
      color.r = r;
      color.b = b;

      // Heavy vignette, but avoid crushing edge details into pure black.
      float vigBase = 0.28 + depthBlend * grading.y;
      float vigStr = min(vigBase, 0.9);
      vec2 center = uv - 0.5;
      float vigDist = dot(center, center);
      float vignette = 1.0 - smoothstep(0.12, 0.42, vigDist) * vigStr;
      color.rgb *= max(vignette, 0.2);

      // Water column absorption shifts ambient light toward blue with depth.
      // Direct flashlight illumination travels a short path through water,
      // so nearby lit surfaces keep their natural color.
      float depthT = clamp(depth / (depthThresholds.z * 0.75), 0.0, 1.0);
        vec3 shallowTint = vec3(0.65, 0.8, 1.0);
        vec3 deepTint = vec3(0.12, 0.19, 0.27);
        vec3 abyssTint = vec3(0.038, 0.068, 0.1);
      vec3 tint = depthT < 0.5
        ? mix(shallowTint, deepTint, depthT * 2.0)
        : mix(deepTint, abyssTint, (depthT - 0.5) * 2.0);

      // Exempt flashlight-illuminated pixels from the depth tint.
      // Bright emissive pixels should not read as flashlight spill on their own,
      // so require both the flashlight to be active and nearby pixels to share
      // similar brightness before relaxing the deep-water grading.
      float preTintLuma = max(max(color.r, color.g), color.b);
      // Scale probe to zero when flashlight is off — avoids 4 redundant texture lookups (item 6).
      vec2 lightProbe = max(vec2(1.0) / resolution, vec2(0.0005)) * flashlightActive;
      float nearbyLuma = 0.25 * (
        max(max(texture2D(tDiffuse, uv + vec2(lightProbe.x, 0.0)).r, texture2D(tDiffuse, uv + vec2(lightProbe.x, 0.0)).g), texture2D(tDiffuse, uv + vec2(lightProbe.x, 0.0)).b) +
        max(max(texture2D(tDiffuse, uv - vec2(lightProbe.x, 0.0)).r, texture2D(tDiffuse, uv - vec2(lightProbe.x, 0.0)).g), texture2D(tDiffuse, uv - vec2(lightProbe.x, 0.0)).b) +
        max(max(texture2D(tDiffuse, uv + vec2(0.0, lightProbe.y)).r, texture2D(tDiffuse, uv + vec2(0.0, lightProbe.y)).g), texture2D(tDiffuse, uv + vec2(0.0, lightProbe.y)).b) +
        max(max(texture2D(tDiffuse, uv - vec2(0.0, lightProbe.y)).r, texture2D(tDiffuse, uv - vec2(0.0, lightProbe.y)).g), texture2D(tDiffuse, uv - vec2(0.0, lightProbe.y)).b)
      );
      float localSpread = 1.0 - smoothstep(0.08, 0.38, abs(preTintLuma - nearbyLuma));
      float nearbyLight = smoothstep(0.03, 0.16, nearbyLuma);
      float litAmount = flashlightActive * smoothstep(0.05, 0.18, preTintLuma) * nearbyLight * localSpread;
      color.rgb *= mix(tint, vec3(1.0), litAmount);

      // Keep the deep-ocean depth darkening, but avoid crushing flashlight-lit
      // nearby surfaces that should remain readable.
      float depthDarkening = 1.0 - depthBlend * darkening;
      float ambientDarkening = max(depthDarkening, 0.35);
      color.rgb *= mix(vec3(ambientDarkening), vec3(1.0), litAmount);

      // Depth-aware contrast to strengthen separation in mid/deep zones.
      float contrast = mix(1.0, grading.x, depthBlend);
      color.rgb = (color.rgb - 0.18) * contrast + 0.18;

      // Preserve faint hero silhouettes in abyss by gently lifting midtones.
      float luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
      float silhouetteLift = smoothstep(0.04, 0.32, luma) * 0.022 * abyssBlend;
      color.rgb += silhouetteLift;

      // Film grain — heavier for oppressive atmosphere; reduced in low-cost mode (items 6/7)
      float grainStr = (grading.z + depthBlend * 0.02) * (1.0 - reducedMode * 0.7);
      float grain = fract(sin(dot(uv * time * 0.01, vec2(12.9898, 78.233))) * 43758.5453);
      color.rgb += (grain - 0.5) * grainStr;

      // Ordered dither in darker gradients helps break visible color banding.
      float dither = fract(52.9829189 * fract(dot(fragCoord, vec2(0.06711056, 0.00583715)) + time * 0.003));
      float ditherStrength = mix(0.0016, 0.0065, abyssBlend) * (1.0 - reducedMode * 0.75);
      color.rgb += (dither - 0.5) * ditherStrength;

      // A single-sample highlight spill is much cheaper than sampling neighboring
      // texels for bloom, while still keeping bright bioluminescent accents lively.
      float highlight = max(max(color.r, color.g), color.b);
      float bloomMask = smoothstep(bloomParams.y, 1.0, highlight);
      float bloomLift = bloomParams.x * (0.18 + depthBlend * 0.22);
      color.rgb += color.rgb * bloomMask * bloomLift;

      // Slight scanline effect for deep water dread
      float scanline = 0.97 + 0.03 * sin(uv.y * resolution.y * 1.5);
      float scanlineStr = clamp(depthBlend, 0.0, 1.0) * grading.w * (1.0 - reducedMode * 0.9);
      color.rgb *= mix(1.0, scanline, scanlineStr);

      // Highlight roll-off reduces flashlight hotspot clipping while keeping punch.
      float peak = max(max(color.r, color.g), color.b);
      float rollStart = max(0.45, highlightRoll.x - exposure * 0.08);
      float rollBlend = smoothstep(rollStart, rollStart + highlightRoll.y, peak) * highlightRoll.z;
      vec3 rolled = color.rgb / (1.0 + color.rgb);
      color.rgb = mix(color.rgb, rolled, rollBlend);

      color.rgb = clamp(color.rgb, 0.0, 1.0);

      gl_FragColor = color;
    }
  `,
};

export class UnderwaterEffect {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.time = 0;

    // Composer
    this.composer = new EffectComposer(renderer);
    this.tuning = RENDER_PIPELINE_TUNING;
    this._nativeComposerPixelRatio = Math.max(renderer.getPixelRatio(), 1);
    this._composerScale = this.tuning.performance.baseScale;
    this._appliedComposerScale = 0;
    this._appliedComposerWidth = 0;
    this._appliedComposerHeight = 0;
    this._scaleLadder = [];
    this._scaleIndex = 0;
    this._nextScaleChangeAt = 0;
    this._recoveryAllowedAt = 0;
    this._stableRecoveryFrames = 0;
    this._bloomSuspended = false;
    this._bloomSuspendedUntil = 0;
    this._lastRenderMs = 0;

    // Render pass
    const renderPass = new RenderPass(scene, camera);
    this.composer.addPass(renderPass);

    // Underwater shader
    this.underwaterPass = new ShaderPass(UnderwaterShader);
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
    this.underwaterPass.uniforms.darkening.value = this.tuning.grading.darkening;
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
    this.composer.addPass(this.underwaterPass);

    // UnrealBloomPass for ultra tier
    this._bloomPass = null;
    this._setupBloom(qualityManager.tier);

    // Adaptive render guard:
    // creature-dense scenes can cause heavy post-processing stalls on some GPUs.
    this._renderEmaMs = 16;
    this._qualityMaxScale = qualityManager.getSettings().postProcessScale;
    this._depthScaleCap = 1.0;
    this._postProcessMaxScale = this._qualityMaxScale;
    this._reducedShaderMode = false;
    this._isSoftwareRenderer = false;
    this._moderatePressureFrames = 0;
    // Item 4: cache quantized pass-state inputs to skip unnecessary bloom recomputation
    this._passStateCacheDepth = -9999;
    this._passStateCacheFlashlight = null;
    this._passStateCacheExposure = -1;
    // Cached bloom targets — updated on cache miss, applied every frame via lerp
    this._bloomTargetStrength = this.tuning.bloom.surfaceStrength;
    this._bloomTargetThreshold = this.tuning.bloom.surfaceThreshold;
    this._bloomTargetRadius = this.tuning.bloom.radius * 2.0;
    this._rebuildScaleLadder();
    this._applyComposerScale(true);

    window.addEventListener('qualitychange', (e) => {
      this._qualityMaxScale = e.detail.settings.postProcessScale;
      this._postProcessMaxScale = Math.min(this._qualityMaxScale, this._depthScaleCap);
      this._rebuildScaleLadder();
      this._setScaleIndex(this._findScaleIndex(this._composerScale), { force: true, resetCooldown: true });
      this._applyComposerScale(true);
      this._setupBloom(e.detail.tier);
    });
  }

  /**
   * Add or remove the UnrealBloomPass based on quality tier.
   * Ultra tier gets a real multi-pass bloom; other tiers use the
   * cheaper single-sample bloom baked into the underwater shader.
   */
  _setupBloom(tier) {
    if (tier === 'ultra' && !this._bloomPass) {
      const res = new THREE.Vector2(window.innerWidth, window.innerHeight);
      this._bloomPass = new UnrealBloomPass(res, 0.4, 0.6, 0.78);
      // Insert bloom pass before the underwater shader pass
      const idx = this.composer.passes.indexOf(this.underwaterPass);
      this.composer.insertPass(this._bloomPass, idx);
    } else if (tier !== 'ultra' && this._bloomPass) {
      this.composer.removePass(this._bloomPass);
      this._bloomPass.dispose();
      this._bloomPass = null;
      this._bloomSuspended = false;
      this._bloomSuspendedUntil = 0;
    }

    if (this._bloomPass) {
      this._bloomPass.enabled = !this._bloomSuspended;
    }
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
      this.composer.render();
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

  _setScaleIndex(index, { force = false, resetCooldown = false, holdRecovery = false, now = performance.now() } = {}) {
    const nextIndex = THREE.MathUtils.clamp(index, 0, Math.max(this._scaleLadder.length - 1, 0));
    const nextScale = this._scaleLadder[nextIndex] ?? this.tuning.performance.minScale;

    if (!force && Math.abs(nextScale - this._composerScale) < 0.01) {
      return false;
    }

    this._scaleIndex = nextIndex;
    this._composerScale = nextScale;
    this._nextScaleChangeAt = resetCooldown ? now : now + this.tuning.performance.scaleChangeCooldownMs;
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

    if (this._bloomPass) {
      this._bloomPass.enabled = !suspended;
    }
  }

  _applyComposerScale(force = false) {
    this._nativeComposerPixelRatio = Math.max(this.renderer.getPixelRatio(), 1);
    const nextScale = THREE.MathUtils.clamp(
      this._composerScale,
      this.tuning.performance.minScale,
      this._postProcessMaxScale
    );
    const width = window.innerWidth;
    const height = window.innerHeight;
    const pixelRatio = this._nativeComposerPixelRatio * nextScale;

    if (!force &&
      Math.abs(nextScale - this._appliedComposerScale) < 0.01 &&
      width === this._appliedComposerWidth &&
      height === this._appliedComposerHeight) {
      return;
    }

    this._appliedComposerScale = nextScale;
    this._appliedComposerWidth = width;
    this._appliedComposerHeight = height;
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
    this.underwaterPass.uniforms.resolution.value.set(
      width * pixelRatio,
      height * pixelRatio
    );
  }

  _updatePassState(depth, flashlightOn, exposure) {
    this.time += 0.016;
    this.underwaterPass.uniforms.time.value = this.time;
    this.underwaterPass.uniforms.depth.value = depth;
    this.underwaterPass.uniforms.exposure.value = exposure;
    this.underwaterPass.uniforms.flashlightActive.value = flashlightOn ? 1 : 0;

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
      ) * (flashlightOn ? 0.88 : 1.0);

      this._bloomTargetThreshold = THREE.MathUtils.lerp(
        this.tuning.bloom.surfaceThreshold,
        this.tuning.bloom.deepThreshold,
        depthNorm
      ) + (flashlightOn ? 0.08 : 0.0);

      this._bloomTargetRadius = THREE.MathUtils.lerp(
        this.tuning.bloom.radius * 2.0,
        this.tuning.bloom.radius * 2.8,
        depthNorm
      );
    }

    // Lerp convergence runs every frame regardless of cache state so bloom params
    // converge smoothly rather than freezing at stale values on cache hits.
    const shaderBloomScale = this._bloomPass && !this._bloomSuspended ? 0.3 : 1.0;
    const bloomParams = this.underwaterPass.uniforms.bloomParams.value;
    bloomParams.x = THREE.MathUtils.lerp(bloomParams.x, this._bloomTargetStrength * shaderBloomScale, 0.09);
    bloomParams.y = THREE.MathUtils.lerp(bloomParams.y, this._bloomTargetThreshold, 0.09);
    bloomParams.z = THREE.MathUtils.lerp(bloomParams.z, this._bloomTargetRadius, 0.09);

    if (this._bloomPass && !this._bloomSuspended) {
      this._bloomPass.strength = THREE.MathUtils.lerp(
        this._bloomPass.strength,
        this._bloomTargetStrength,
        0.09
      );
      this._bloomPass.threshold = THREE.MathUtils.lerp(
        this._bloomPass.threshold,
        this._bloomTargetThreshold,
        0.09
      );
    }
  }

  render(depth, { flashlightOn = false, exposure = 0.76 } = {}) {
    const frameStart = performance.now();
    this._updatePassState(depth, flashlightOn, exposure);
    this.composer.render();

    const now = performance.now();
    const renderMs = now - frameStart;
    this._lastRenderMs = renderMs;
    this._renderEmaMs = this._renderEmaMs * 0.92 + renderMs * 0.08;

    // Software-renderer sessions hold their reduced profile permanently — never recover.
    if (!this._isSoftwareRenderer &&
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
    const shouldReduceShader = underPressure || sustainedModeratePressure;
    if (shouldReduceShader !== this._reducedShaderMode) {
      this._reducedShaderMode = shouldReduceShader;
      this.underwaterPass.uniforms.reducedMode.value = shouldReduceShader ? 1.0 : 0.0;
    }

    if (underPressure) {
      this._stableRecoveryFrames = 0;

      // Item 3: suspend bloom at pressured state, not only at emergency
      if (this._bloomPass && !this._bloomSuspended &&
          (emergencyFrame || renderMs > this.tuning.performance.bloomSuspendThresholdMs)) {
        this._setBloomSuspended(true, now);
      }

      if (now >= this._nextScaleChangeAt) {
        const nextIndex = emergencyFrame
          ? this._scaleLadder.length - 1
          : this._scaleIndex + 1;
        this._setScaleIndex(nextIndex, { now, holdRecovery: emergencyFrame });
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
  }

  getDiagnostics() {
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
      emaPressure,
      lastRenderPressure,
      renderPressure: emergency ? 'emergency' : pressured ? 'pressured' : 'normal',
      stallRisk: emergency ? 'emergency' : pressured ? 'pressured' : 'normal',
      stallRiskLabel: emergency ? 'Emergency' : pressured ? 'Pressured' : 'Normal',
    };
  }

  /**
   * Item 2: Cap the maximum composer scale for the current depth band.
   * Called each frame from Game._updateRenderPipelineForDepth.
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
    const newMax = Math.min(this._qualityMaxScale, cap);
    if (Math.abs(newMax - this._postProcessMaxScale) < 0.005) return;
    this._postProcessMaxScale = newMax;
    this._rebuildScaleLadder();
    const clampedIndex = this._findScaleIndex(Math.min(this._composerScale, newMax));
    // force:true ensures the cap is always enforced even when the index matches the current value,
    // preventing the composer from rendering above the depth-based scale ceiling.
    this._setScaleIndex(clampedIndex, { force: true, resetCooldown: false });
  }

  /**
   * Item 9: Start with a reduced post-process profile for software/fallback renderers.
   * Called once from Game constructor when software rendering is detected.
   */
  applySoftwareRendererPolicy() {
    this._isSoftwareRenderer = true;
    this._reducedShaderMode = true;
    this.underwaterPass.uniforms.reducedMode.value = 1.0;
    this._setScaleIndex(this._scaleLadder.length - 1, { force: true, resetCooldown: true });
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
      this._bloomPass.enabled = false;
    }
    this.warmPerformanceFallbacks({ depth, flashlightOn, exposure });
    if (!wasSuspended) {
      this._bloomSuspended = false;
      this._bloomPass.enabled = true;
    }
  }
}
