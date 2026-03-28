/**
 * Central quality tier manager.
 * Defines low/medium/high presets and exposes runtime tier switching
 * with an optional auto-quality heuristic based on frame time.
 */

const QUALITY_TIERS = {
  low: {
    shadowMapEnabled: false,
    shadowMapSize: 0,
    particleCount: 100,
    floraDensityScale: 0.3,
    maxCreatures: 25,
    maxPointLights: 3,
    postProcessScale: 0.6,
    terrainViewDistance: 2,
    creatureCullDistance: 120,
    creatureDespawnDistance: 170,
  },
  medium: {
    shadowMapEnabled: true,
    shadowMapSize: 512,
    particleCount: 250,
    floraDensityScale: 0.6,
    maxCreatures: 40,
    maxPointLights: 6,
    postProcessScale: 0.8,
    terrainViewDistance: 3,
    creatureCullDistance: 150,
    creatureDespawnDistance: 210,
  },
  high: {
    shadowMapEnabled: true,
    shadowMapSize: 1024,
    particleCount: 500,
    floraDensityScale: 1.0,
    maxCreatures: 60,
    maxPointLights: 10,
    postProcessScale: 1.0,
    terrainViewDistance: 3,
    creatureCullDistance: 180,
    creatureDespawnDistance: 250,
  },
  ultra: {
    shadowMapEnabled: true,
    shadowMapSize: 4096,
    particleCount: 2000,
    floraDensityScale: 1.5,
    maxCreatures: 120,
    maxPointLights: 20,
    postProcessScale: 1.0,
    terrainViewDistance: 4,
    creatureCullDistance: 300,
    creatureDespawnDistance: 400,
  },
};

const TIER_ORDER = ['low', 'medium', 'high', 'ultra'];
const STORAGE_KEY = 'qualityTier';

// Auto-quality thresholds
const AUTO_DOWNGRADE_MS = 33;   // < 30 fps
const AUTO_DOWNGRADE_SECS = 3;
const AUTO_UPGRADE_MS = 20;     // > 50 fps
const AUTO_UPGRADE_SECS = 5;
const EMA_ALPHA = 2 / (30 + 1); // ~30-frame EMA

// GPU patterns that qualify for automatic ultra tier selection
const HIGH_END_GPU_PATTERNS = [
  /RTX\s*40/i, /RTX\s*50/i, /RTX\s*4090/i, /RTX\s*4080/i,
  /RX\s*7900/i, /RX\s*9070/i, /RTX\s*5090/i, /RTX\s*5080/i,
];

class QualityManager {
  constructor() {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (stored && QUALITY_TIERS[stored]) {
      this._tier = stored;
      this._autoQuality = false; // user previously chose a tier
    } else {
      this._tier = 'high';
      this._autoQuality = true;
    }
    this._settings = { ...QUALITY_TIERS[this._tier] };

    // Auto-quality EMA state
    this._frameTimeEma = 16;
    this._downgradeDuration = 0;
    this._upgradeDuration = 0;
    this._ultraUpgradeDuration = 0;
    this._highEndGpuDetected = false;
  }

  /** Current tier name. */
  get tier() { return this._tier; }

  /** Whether auto tier adjustment is active. */
  get autoQuality() { return this._autoQuality; }
  set autoQuality(val) { this._autoQuality = !!val; }

  /** Returns a shallow copy of the current tier's settings. */
  getSettings() {
    return this._settings;
  }

  /**
   * Detect GPU capabilities from the renderer and auto-select ultra tier
   * if a high-end GPU is detected and autoQuality is enabled.
   * Call this once after the renderer is created.
   */
  detectGPU(renderer) {
    if (!this._autoQuality) return;
    try {
      const backend = renderer.backend;
      const isWebGL = backend && backend.isWebGLBackend;

      if (isWebGL) {
        const gl = backend.gl;
        const ext = gl?.getExtension('WEBGL_debug_renderer_info');
        if (!ext) return;
        const gpuRenderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '';
        this._highEndGpuDetected = HIGH_END_GPU_PATTERNS.some((p) => p.test(gpuRenderer));
      } else {
        // WebGPU backend — assume high-end GPU since WebGPU requires modern hardware
        this._highEndGpuDetected = true;
      }
    } catch (_) { /* GPU detection not available */ }
  }

  /** Switch to a specific tier. Persists to localStorage. */
  setTier(tier) {
    if (!QUALITY_TIERS[tier] || tier === this._tier) return;
    this._tier = tier;
    this._settings = { ...QUALITY_TIERS[tier] };
    this._autoQuality = false;
    this._downgradeDuration = 0;
    this._upgradeDuration = 0;
    this._ultraUpgradeDuration = 0;
    try { localStorage.setItem(STORAGE_KEY, tier); } catch (_) { /* noop */ }
    window.dispatchEvent(new CustomEvent('qualitychange', { detail: { tier, settings: this._settings } }));
  }

  /**
   * Call once per frame with the frame's delta time (seconds).
   * Drives the auto-quality heuristic when enabled.
   */
  updateFrameTime(dt) {
    const frameMs = dt * 1000;
    this._frameTimeEma = this._frameTimeEma + EMA_ALPHA * (frameMs - this._frameTimeEma);

    if (!this._autoQuality) return;

    const idx = TIER_ORDER.indexOf(this._tier);

    if (this._frameTimeEma > AUTO_DOWNGRADE_MS) {
      this._upgradeDuration = 0;
      this._downgradeDuration += dt;
      if (this._downgradeDuration >= AUTO_DOWNGRADE_SECS && idx > 0) {
        this._applyAutoTier(TIER_ORDER[idx - 1]);
      }
    } else if (this._frameTimeEma < AUTO_UPGRADE_MS) {
      this._downgradeDuration = 0;
      this._upgradeDuration += dt;
      const maxGenericIdx = TIER_ORDER.indexOf('high');
      if (this._upgradeDuration >= AUTO_UPGRADE_SECS && idx < maxGenericIdx) {
        this._applyAutoTier(TIER_ORDER[idx + 1]);
      }
      // Keep ultra opt-in. Runtime promotion to ultra can introduce large
      // mid-session hitches when bloom and higher-resolution targets spin up.
      this._ultraUpgradeDuration = 0;
    } else {
      this._downgradeDuration = 0;
      this._upgradeDuration = 0;
      this._ultraUpgradeDuration = 0;
    }
  }

  /** Internal: switch tier without disabling autoQuality. */
  _applyAutoTier(tier) {
    if (!QUALITY_TIERS[tier] || tier === this._tier) return;
    this._tier = tier;
    this._settings = { ...QUALITY_TIERS[tier] };
    this._downgradeDuration = 0;
    this._upgradeDuration = 0;
    this._ultraUpgradeDuration = 0;
    // Don't persist auto changes to localStorage
    window.dispatchEvent(new CustomEvent('qualitychange', { detail: { tier, settings: this._settings } }));
  }
}

/** Singleton instance. */
export const qualityManager = new QualityManager();


