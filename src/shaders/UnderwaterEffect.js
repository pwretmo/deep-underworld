import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const UnderwaterShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    depth: { value: 0 },
    resolution: { value: new THREE.Vector2() },
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
    uniform vec2 resolution;
    varying vec2 vUv;

    void main() {
      vec2 uv = vUv;

      // Underwater distortion - subtle wavy effect
      float distortStr = 0.0015 + depth * 0.000008;
      uv.x += sin(uv.y * 15.0 + time * 1.0) * distortStr;
      uv.y += cos(uv.x * 12.0 + time * 0.8) * distortStr * 0.6;

      vec4 color = texture2D(tDiffuse, uv);

      // Chromatic aberration (increases with depth)
      float caStr = 0.0015 + depth * 0.000005;
      float r = texture2D(tDiffuse, uv + vec2(caStr, caStr * 0.3)).r;
      float b = texture2D(tDiffuse, uv - vec2(caStr, caStr * 0.2)).b;
      color.r = r;
      color.b = b;

      // Heavy vignette - pitch black edges in deep water
      float vigBase = 0.4 + depth * 0.002;
      float vigStr = min(vigBase, 2.5);
      vec2 center = uv - 0.5;
      float vigDist = dot(center, center);
      float vignette = 1.0 - vigDist * vigStr;
      vignette = smoothstep(0.0, 0.7, vignette);
      color.rgb *= vignette;

      // Color grading - deep ocean tint
      float depthT = clamp(depth / 400.0, 0.0, 1.0);
      vec3 shallowTint = vec3(0.65, 0.8, 1.0);
      vec3 deepTint = vec3(0.15, 0.1, 0.25);
      vec3 abyssTint = vec3(0.05, 0.03, 0.08);
      vec3 tint = depthT < 0.5
        ? mix(shallowTint, deepTint, depthT * 2.0)
        : mix(deepTint, abyssTint, (depthT - 0.5) * 2.0);
      color.rgb *= tint;

      // Darken overall based on depth
      float darkening = 1.0 - clamp(depth / 600.0, 0.0, 0.6);
      color.rgb *= darkening;

      // Film grain - heavier for oppressive atmosphere
      float grainStr = 0.025 + depth * 0.00005;
      float grain = fract(sin(dot(uv * time * 0.01, vec2(12.9898, 78.233))) * 43758.5453);
      color.rgb += (grain - 0.5) * grainStr;

      // Slight scanline effect for deep water dread
      float scanline = 0.97 + 0.03 * sin(uv.y * resolution.y * 1.5);
      float scanlineStr = clamp(depth / 500.0, 0.0, 1.0) * 0.4;
      color.rgb *= mix(1.0, scanline, scanlineStr);

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

    // Render pass
    const renderPass = new RenderPass(scene, camera);
    this.composer.addPass(renderPass);

    // Bloom for bioluminescent glow
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.4,  // strength - lower base, bloom stands out more in darkness
      0.6,  // radius - wider bloom spread
      0.7   // threshold - lower to pick up dim bioluminescence
    );
    this.composer.addPass(this.bloomPass);

    // Underwater shader
    this.underwaterPass = new ShaderPass(UnderwaterShader);
    this.underwaterPass.uniforms.resolution.value.set(window.innerWidth, window.innerHeight);
    this.composer.addPass(this.underwaterPass);

    // Adaptive bloom guard:
    // creature-dense scenes can cause heavy post-processing stalls on some GPUs.
    this._renderEmaMs = 16;
    this._bloomSuppressedUntil = 0;
  }

  resize() {
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.underwaterPass.uniforms.resolution.value.set(window.innerWidth, window.innerHeight);
  }

  render(depth) {
    const frameStart = performance.now();
    this.time += 0.016;
    this.underwaterPass.uniforms.time.value = this.time;
    this.underwaterPass.uniforms.depth.value = depth;

    // Increase bloom in deep zones (bioluminescence and flashlight stand out more)
    if (depth > 200) {
      this.bloomPass.strength = Math.min(1.1, 0.7 + (depth - 200) / 400 * 0.8);
      this.bloomPass.threshold = Math.max(0.3, 0.7 - depth / 1000);
    } else {
      this.bloomPass.strength = 0.4;
      this.bloomPass.threshold = 0.7;
    }

    const now = performance.now();
    this.bloomPass.enabled = now >= this._bloomSuppressedUntil;

    this.composer.render();

    const renderMs = performance.now() - frameStart;
    this._renderEmaMs = this._renderEmaMs * 0.92 + renderMs * 0.08;

    // If a render spike occurs, temporarily disable bloom to prevent repeated freezes.
    if (renderMs > 100 || this._renderEmaMs > 28) {
      this._bloomSuppressedUntil = performance.now() + 3500;
    }
  }
}
