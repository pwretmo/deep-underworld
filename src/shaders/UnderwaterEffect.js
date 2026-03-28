import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { qualityManager } from '../QualityManager.js';
import { DEPTH_THRESHOLDS } from '../lighting/LightingPolicy.js';

function deepFreeze(obj) {
  Object.freeze(obj);
  Object.values(obj).forEach(v => {
    if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
  });
  return obj;
}

const RENDER_PIPELINE_TUNING = deepFreeze({
  depthThresholds: DEPTH_THRESHOLDS,
  extinction: {
    r: 0.22,
    g: 0.045,
    b: 0.014,
  },
  scatter: {
    r: 0.012,
    g: 0.048,
    b: 0.075,
    density: 0.003,
  },
  grading: {
    contrast: 1.08,
    vignette: 0.28,
    grain: 0.018,
    scanline: 0.0,
    darkening: 0.0,
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

const UnderwaterShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    depth: { value: 0 },
    exposure: { value: 0.76 },
    flashlightActive: { value: 0 },
    resolution: { value: new THREE.Vector2() },
    depthThresholds: { value: new THREE.Vector3(130, 340, 720) },
    grading: { value: new THREE.Vector4(1.08, 0.28, 0.018, 0.0) },
    darkening: { value: 0.0 },
    extinction: { value: new THREE.Vector3(0.22, 0.045, 0.014) },
    scatterColor: { value: new THREE.Vector3(0.012, 0.048, 0.075) },
    scatterDensity: { value: 0.003 },
    eyeAdapt: { value: 0.12 },
    highlightRoll: { value: new THREE.Vector3(0.78, 0.34, 0.40) },
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
    uniform vec3 extinction;
    uniform vec3 scatterColor;
    uniform float scatterDensity;
    uniform float eyeAdapt;
    uniform vec3 highlightRoll;
    uniform vec3 bloomParams;
    uniform float reducedMode;
    varying vec2 vUv;

    void main() {
      vec2 uv = vUv;

      // Underwater distortion - subtle wavy effect
      float distortStr = 0.0011 + depth * 0.0000055;
      uv.x += sin(uv.y * 15.0 + time * 1.0) * distortStr;
      uv.y += cos(uv.x * 12.0 + time * 0.8) * distortStr * 0.6;

      vec4 color = texture2D(tDiffuse, uv);
      vec2 fragCoord = uv * resolution;
      float midBlend = smoothstep(depthThresholds.x, depthThresholds.y, depth);
      float deepBlend = smoothstep(depthThresholds.y, depthThresholds.z, depth);
      float abyssBlend = smoothstep(depthThresholds.z, depthThresholds.z + 280.0, depth);
      float depthBlend = clamp(midBlend * 0.45 + deepBlend * 0.7 + abyssBlend * 0.35, 0.0, 1.0);

      // Keep aberration subtle: depth-aware, edge-weighted, and hard-capped.
      // Skip the extra texture taps entirely in reduced mode.
      if (reducedMode < 0.5) {
        float edgeDist = distance(uv, vec2(0.5));
        float edgeMask = smoothstep(0.2, 0.74, edgeDist);
        float caStr = (depthBlend * 0.00014 + abyssBlend * 0.00005) * edgeMask;
        caStr = min(caStr, 0.00022);
        float r = texture2D(tDiffuse, uv + vec2(caStr, caStr * 0.3)).r;
        float b = texture2D(tDiffuse, uv - vec2(caStr, caStr * 0.2)).b;
        color.r = r;
        color.b = b;
      }

      // Vignette — lighter to preserve edge detail at depth.
      float vigBase = 0.12 + depthBlend * grading.y;
      float vigStr = min(vigBase, 0.65);
      vec2 center = uv - 0.5;
      float vigDist = dot(center, center);
      float vignette = 1.0 - smoothstep(0.12, 0.42, vigDist) * vigStr;
      color.rgb *= max(vignette, 0.2);

      // Physically-based water column attenuation (Beer-Lambert extinction).
      // Red light absorbs first, then green, then blue — preserving relative
      // contrast between nearby surfaces instead of crushing to uniform black.
      vec3 transmittance = exp(-extinction * depth);

      // Forward scatter: blue-green ambient glow accumulated along the view path.
      float scatterMix = 1.0 - exp(-scatterDensity * depth);
      vec3 scatter = scatterColor * scatterMix;

      // Exempt flashlight-illuminated pixels from attenuation.
      // Bright emissive pixels should not read as flashlight spill on their own,
      // so require both the flashlight to be active and nearby pixels to share
      // similar brightness before relaxing the deep-water grading.
      float preTintLuma = max(max(color.r, color.g), color.b);
      float litAmount = 0.0;
      if (flashlightActive > 0.5) {
        if (reducedMode > 0.5) {
          litAmount = smoothstep(0.08, 0.22, preTintLuma) * 0.65;
        } else {
          vec2 lightProbe = max(vec2(1.0) / resolution, vec2(0.0005));
          float nearbyLuma = 0.25 * (
            max(max(texture2D(tDiffuse, uv + vec2(lightProbe.x, 0.0)).r, texture2D(tDiffuse, uv + vec2(lightProbe.x, 0.0)).g), texture2D(tDiffuse, uv + vec2(lightProbe.x, 0.0)).b) +
            max(max(texture2D(tDiffuse, uv - vec2(lightProbe.x, 0.0)).r, texture2D(tDiffuse, uv - vec2(lightProbe.x, 0.0)).g), texture2D(tDiffuse, uv - vec2(lightProbe.x, 0.0)).b) +
            max(max(texture2D(tDiffuse, uv + vec2(0.0, lightProbe.y)).r, texture2D(tDiffuse, uv + vec2(0.0, lightProbe.y)).g), texture2D(tDiffuse, uv + vec2(0.0, lightProbe.y)).b) +
            max(max(texture2D(tDiffuse, uv - vec2(0.0, lightProbe.y)).r, texture2D(tDiffuse, uv - vec2(0.0, lightProbe.y)).g), texture2D(tDiffuse, uv - vec2(0.0, lightProbe.y)).b)
          );
          float localSpread = 1.0 - smoothstep(0.08, 0.38, abs(preTintLuma - nearbyLuma));
          float nearbyLight = smoothstep(0.03, 0.16, nearbyLuma);
          litAmount = smoothstep(0.05, 0.18, preTintLuma) * nearbyLight * localSpread;
        }
      }

      // Apply extinction to ambient surfaces; flashlight-lit pixels retain partial
      // extinction so water absorption preserves form-revealing depth contrast.
      float clampedLit = litAmount * 0.6;
      color.rgb = color.rgb * mix(transmittance, vec3(1.0), clampedLit)
                + scatter * (1.0 - litAmount * 0.7);

      // Screen-space caustics: additive light pattern in shallow water
      float shallowCaustic = 1.0 - smoothstep(0.0, 80.0, depth);
      if (shallowCaustic > 0.001) {
        vec2 cUV = uv * 12.0;
        float ct = time * 0.35;
        float c1 = sin(cUV.x * 3.7 + ct) * sin(cUV.y * 4.1 - ct * 0.8);
        float c2 = sin(cUV.x * 2.3 - ct * 1.2 + 1.7) * sin(cUV.y * 3.3 + ct * 0.9);
        float c3 = sin((cUV.x + cUV.y) * 2.8 + ct * 0.6);
        float causticVal = max(0.0, c1 + c2 * 0.7 + c3 * 0.5);
        causticVal = pow(causticVal * 0.33, 2.2);
        float nearSurface = smoothstep(60.0, 5.0, depth) * 0.14;
        float midCaustic = smoothstep(80.0, 25.0, depth) * 0.05;
        color.rgb += color.rgb * causticVal * (nearSurface + midCaustic) * shallowCaustic;
      }

      // Depth-aware contrast to strengthen separation in mid/deep zones.
      float contrast = mix(1.0, grading.x, depthBlend);
      color.rgb = (color.rgb - 0.18) * contrast + 0.18;

      // Luminance-based eye adaptation: preserve local contrast at mid-depth
      // without flattening the oppressive abyss.
      float adaptLuma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
      float midtoneMask = smoothstep(0.005, 0.08, adaptLuma)
                        * (1.0 - smoothstep(0.25, 0.6, adaptLuma));
      float adaptAmount = midBlend * eyeAdapt * (1.0 - deepBlend * 0.5);
      color.rgb += color.rgb * midtoneMask * adaptAmount;

      // Preserve faint hero silhouettes in abyss by gently lifting midtones.
      float luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
      float silhouetteLift = smoothstep(0.02, 0.25, luma) * 0.028 * abyssBlend;
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
      float neighborPeak = highlight;
      if (reducedMode < 0.5) {
        vec2 bloomProbe = max(vec2(1.0) / resolution, vec2(0.0006));
        neighborPeak = 0.25 * (
          max(max(texture2D(tDiffuse, uv + vec2(bloomProbe.x, 0.0)).r, texture2D(tDiffuse, uv + vec2(bloomProbe.x, 0.0)).g), texture2D(tDiffuse, uv + vec2(bloomProbe.x, 0.0)).b) +
          max(max(texture2D(tDiffuse, uv - vec2(bloomProbe.x, 0.0)).r, texture2D(tDiffuse, uv - vec2(bloomProbe.x, 0.0)).g), texture2D(tDiffuse, uv - vec2(bloomProbe.x, 0.0)).b) +
          max(max(texture2D(tDiffuse, uv + vec2(0.0, bloomProbe.y)).r, texture2D(tDiffuse, uv + vec2(0.0, bloomProbe.y)).g), texture2D(tDiffuse, uv + vec2(0.0, bloomProbe.y)).b) +
          max(max(texture2D(tDiffuse, uv - vec2(0.0, bloomProbe.y)).r, texture2D(tDiffuse, uv - vec2(0.0, bloomProbe.y)).g), texture2D(tDiffuse, uv - vec2(0.0, bloomProbe.y)).b)
        );
      }
      float sparkleIsolated =
        smoothstep(0.04, 0.2, highlight - neighborPeak) *
        (1.0 - smoothstep(0.08, 0.3, neighborPeak));
      float bloomMask = smoothstep(bloomParams.y, 1.0, highlight) * (1.0 - sparkleIsolated * 0.85);
      float bloomLift = bloomParams.x * (0.18 + depthBlend * 0.22) * (1.0 - sparkleIsolated * 0.65);
      color.rgb += color.rgb * bloomMask * bloomLift;

      // Slight scanline effect for deep water dread
      float scanline = 0.97 + 0.03 * sin(uv.y * resolution.y * 1.5);
      float scanlineStr = clamp(depthBlend, 0.0, 1.0) * grading.w * (1.0 - reducedMode * 0.9);
      color.rgb *= mix(1.0, scanline, scanlineStr);

      // Highlight roll-off reduces flashlight hotspot clipping while keeping punch.
      float peak = max(max(color.r, color.g), color.b);

      // Local beam-center exposure roll-off: compress highlights near the beam
      // axis (screen center) instead of lifting the entire frame when the
      // flashlight is on. This prevents the double-lobe whiteout artifact.
      if (flashlightActive > 0.5) {
        float beamCenterDist = distance(uv, vec2(0.5));
        float beamInfluence = 1.0 - smoothstep(0.0, 0.38, beamCenterDist);
        float localCompress = beamInfluence * smoothstep(0.3, 0.75, peak) * 0.45;
        color.rgb = mix(color.rgb, color.rgb / (1.0 + color.rgb * 0.7), localCompress);
        peak = max(max(color.r, color.g), color.b);
      }

      float rollStart = max(0.45, highlightRoll.x - exposure * 0.08);
      float rollBlend = smoothstep(rollStart, rollStart + highlightRoll.y, peak) * highlightRoll.z;
      vec3 rolled = color.rgb / (1.0 + color.rgb);
      color.rgb = mix(color.rgb, rolled, rollBlend);

      color.rgb = clamp(color.rgb, 0.0, 1.0);

      // Output is linear; OutputPass at the end of the composer chain
      // handles tone mapping and sRGB encoding for the final canvas output.
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
    this.composer.addPass(this.underwaterPass);

    // OutputPass for correct sRGB conversion and tone mapping
    this._outputPass = new OutputPass();
    this.composer.addPass(this._outputPass);

    // UnrealBloomPass for ultra tier
    this._bloomPass = null;
    this._setupBloom(qualityManager.tier);

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
      this._refreshScaleCap({ force: true, skipCooldown: true });
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

    if (this._bloomPass) {
      this._bloomPass.enabled = !suspended;
    }
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
    this._reducedShaderMode = true;
    this.underwaterPass.uniforms.reducedMode.value = 1.0;
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
    this._lastDepth = depth;
    this._lastFlashlightOn = flashlightOn;
    this._lastExposure = exposure;
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
      this._reducedShaderMode = shouldReduceShader;
      this.underwaterPass.uniforms.reducedMode.value = shouldReduceShader ? 1.0 : 0.0;
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
        mode: this._bloomPass ? 'unreal' : 'shader',
        passEnabled: !!this._bloomPass && !this._bloomSuspended,
        shaderStrength: bloomParams.x,
        shaderThreshold: bloomParams.y,
        shaderRadius: bloomParams.z,
        passStrength: this._bloomPass?.strength ?? null,
        passThreshold: this._bloomPass?.threshold ?? null,
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
    this._reducedShaderMode = true;
    this.underwaterPass.uniforms.reducedMode.value = 1.0;
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
      this._bloomPass.enabled = false;
    }
    this.warmPerformanceFallbacks({ depth, flashlightOn, exposure });
    if (!wasSuspended) {
      this._bloomSuspended = false;
      this._bloomPass.enabled = true;
    }
  }

  /**
   * Render one frame without updating EMA or adaptive state.
   * Use this during GPU warm-up to avoid polluting adaptive metrics with
   * one-time shader-compilation / render-target-allocation spikes.
   */
  warmRender(depth = 0, { flashlightOn = false, exposure = 0.76 } = {}) {
    this._updatePassState(depth, flashlightOn, exposure);
    this.composer.render();
  }
}


