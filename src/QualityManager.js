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
};

const TIER_ORDER = ['low', 'medium', 'high'];
const STORAGE_KEY = 'qualityTier';

// Auto-quality thresholds
const AUTO_DOWNGRADE_MS = 33;   // < 30 fps
const AUTO_DOWNGRADE_SECS = 3;
const AUTO_UPGRADE_MS = 20;     // > 50 fps
const AUTO_UPGRADE_SECS = 5;
const EMA_ALPHA = 2 / (30 + 1); // ~30-frame EMA

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

  /** Switch to a specific tier. Persists to localStorage. */
  setTier(tier) {
    if (!QUALITY_TIERS[tier] || tier === this._tier) return;
    this._tier = tier;
    this._settings = { ...QUALITY_TIERS[tier] };
    this._autoQuality = false;
    this._downgradeDuration = 0;
    this._upgradeDuration = 0;
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
      if (this._upgradeDuration >= AUTO_UPGRADE_SECS && idx < TIER_ORDER.length - 1) {
        this._applyAutoTier(TIER_ORDER[idx + 1]);
      }
    } else {
      this._downgradeDuration = 0;
      this._upgradeDuration = 0;
    }
  }

  /** Internal: switch tier without disabling autoQuality. */
  _applyAutoTier(tier) {
    if (!QUALITY_TIERS[tier] || tier === this._tier) return;
    this._tier = tier;
    this._settings = { ...QUALITY_TIERS[tier] };
    this._downgradeDuration = 0;
    this._upgradeDuration = 0;
    // Don't persist auto changes to localStorage
    window.dispatchEvent(new CustomEvent('qualitychange', { detail: { tier, settings: this._settings } }));
  }
}

/** Singleton instance. */
export const qualityManager = new QualityManager();
