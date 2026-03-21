import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { qualityManager } from '../QualityManager.js';

const RENDER_PIPELINE_TUNING = Object.freeze({
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
    degradeThresholdMs: 28,
    severeThresholdMs: 45,
    recoveryThresholdMs: 22,
    degradeStep: 0.05,
    severeDegradeStep: 0.09,
    recoveryStep: 0.02,
  },
});

const UnderwaterShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    depth: { value: 0 },
    exposure: { value: 0.76 },
    resolution: { value: new THREE.Vector2() },
    depthThresholds: { value: new THREE.Vector3(130, 340, 720) },
    grading: { value: new THREE.Vector4(1.2, 0.88, 0.018, 0.24) },
    darkening: { value: 0.55 },
    highlightRoll: { value: new THREE.Vector3(0.62, 0.34, 0.62) },
    bloomParams: { value: new THREE.Vector3(0.28, 0.78, 1.6) },
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
    uniform vec2 resolution;
    uniform vec3 depthThresholds;
    uniform vec4 grading;
    uniform float darkening;
    uniform vec3 highlightRoll;
    uniform vec3 bloomParams;
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

      // Chromatic aberration (increases with depth)
      float caStr = 0.0015 + depth * 0.000005;
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

      // Color grading - deep ocean tint
      float depthT = clamp(depth / (depthThresholds.z * 0.75), 0.0, 1.0);
      vec3 shallowTint = vec3(0.65, 0.8, 1.0);
      vec3 deepTint = vec3(0.12, 0.19, 0.27);
      vec3 abyssTint = vec3(0.038, 0.068, 0.1);
      vec3 tint = depthT < 0.5
        ? mix(shallowTint, deepTint, depthT * 2.0)
        : mix(deepTint, abyssTint, (depthT - 0.5) * 2.0);
      color.rgb *= tint;

      // Darken overall based on depth while preserving flashlight readability.
      float depthDarkening = 1.0 - depthBlend * darkening;
      color.rgb *= max(depthDarkening, 0.35);

      // Depth-aware contrast to strengthen separation in mid/deep zones.
      float contrast = mix(1.0, grading.x, depthBlend);
      color.rgb = (color.rgb - 0.18) * contrast + 0.18;

      // Preserve faint hero silhouettes in abyss by gently lifting midtones.
      float luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
      float silhouetteLift = smoothstep(0.04, 0.32, luma) * 0.022 * abyssBlend;
      color.rgb += silhouetteLift;

      // Film grain - heavier for oppressive atmosphere
      float grainStr = grading.z + depthBlend * 0.02;
      float grain = fract(sin(dot(uv * time * 0.01, vec2(12.9898, 78.233))) * 43758.5453);
      color.rgb += (grain - 0.5) * grainStr;

      // Ordered dither in darker gradients helps break visible color banding.
      float dither = fract(52.9829189 * fract(dot(fragCoord, vec2(0.06711056, 0.00583715)) + time * 0.003));
      float ditherStrength = mix(0.0016, 0.0065, abyssBlend);
      color.rgb += (dither - 0.5) * ditherStrength;

      // A single-sample highlight spill is much cheaper than sampling neighboring
      // texels for bloom, while still keeping bright bioluminescent accents lively.
      float highlight = max(max(color.r, color.g), color.b);
      float bloomMask = smoothstep(bloomParams.y, 1.0, highlight);
      float bloomLift = bloomParams.x * (0.18 + depthBlend * 0.22);
      color.rgb += color.rgb * bloomMask * bloomLift;

      // Slight scanline effect for deep water dread
      float scanline = 0.97 + 0.03 * sin(uv.y * resolution.y * 1.5);
      float scanlineStr = clamp(depthBlend, 0.0, 1.0) * grading.w;
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

    // Adaptive render guard:
    // creature-dense scenes can cause heavy post-processing stalls on some GPUs.
    this._renderEmaMs = 16;
    this._postProcessMaxScale = qualityManager.getSettings().postProcessScale;
    this._applyComposerScale(true);

    window.addEventListener('qualitychange', (e) => {
      this._postProcessMaxScale = e.detail.settings.postProcessScale;
      this._composerScale = Math.min(this._composerScale, this._postProcessMaxScale);
      this._applyComposerScale(true);
    });
  }

  resize() {
    this._applyComposerScale(true);
  }

  _applyComposerScale(force = false) {
    this._nativeComposerPixelRatio = Math.max(this.renderer.getPixelRatio(), 1);
    const nextScale = THREE.MathUtils.clamp(
      this._composerScale,
      this.tuning.performance.minScale,
      this._postProcessMaxScale
    );

    if (!force && Math.abs(nextScale - this._appliedComposerScale) < 0.01) {
      return;
    }

    this._appliedComposerScale = nextScale;
    const pixelRatio = this._nativeComposerPixelRatio * nextScale;
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.underwaterPass.uniforms.resolution.value.set(
      window.innerWidth * pixelRatio,
      window.innerHeight * pixelRatio
    );
  }

  render(depth, { flashlightOn = false, exposure = 0.76 } = {}) {
    const frameStart = performance.now();
    this.time += 0.016;
    this.underwaterPass.uniforms.time.value = this.time;
    this.underwaterPass.uniforms.depth.value = depth;
    this.underwaterPass.uniforms.exposure.value = exposure;

    const depthNorm = THREE.MathUtils.smoothstep(
      depth,
      this.tuning.depthThresholds.mid,
      this.tuning.depthThresholds.abyss
    );

    const targetStrength = THREE.MathUtils.lerp(
      this.tuning.bloom.surfaceStrength,
      this.tuning.bloom.deepStrength,
      depthNorm
    ) * (flashlightOn ? 0.88 : 1.0);

    const targetThreshold = THREE.MathUtils.lerp(
      this.tuning.bloom.surfaceThreshold,
      this.tuning.bloom.deepThreshold,
      depthNorm
    ) + (flashlightOn ? 0.08 : 0.0);

    const targetRadius = THREE.MathUtils.lerp(
      this.tuning.bloom.radius * 2.0,
      this.tuning.bloom.radius * 2.8,
      depthNorm
    );

    const bloomParams = this.underwaterPass.uniforms.bloomParams.value;
    bloomParams.x = THREE.MathUtils.lerp(bloomParams.x, targetStrength, 0.09);
    bloomParams.y = THREE.MathUtils.lerp(bloomParams.y, targetThreshold, 0.09);
    bloomParams.z = THREE.MathUtils.lerp(bloomParams.z, targetRadius, 0.09);

    this.composer.render();

    const renderMs = performance.now() - frameStart;
    this._renderEmaMs = this._renderEmaMs * 0.92 + renderMs * 0.08;

    if (renderMs > this.tuning.performance.severeThresholdMs || this._renderEmaMs > this.tuning.performance.degradeThresholdMs) {
      const degradeStep = renderMs > this.tuning.performance.severeThresholdMs
        ? this.tuning.performance.severeDegradeStep
        : this.tuning.performance.degradeStep;
      this._composerScale = Math.max(this.tuning.performance.minScale, this._composerScale - degradeStep);
      this._applyComposerScale();
    } else if (this._renderEmaMs < this.tuning.performance.recoveryThresholdMs) {
      this._composerScale = Math.min(this._postProcessMaxScale, this._composerScale + this.tuning.performance.recoveryStep);
      this._applyComposerScale();
    }
  }
}
