/**
 * Central quality tier manager.
 * Defines low/medium/high presets and exposes runtime tier switching
 * with an optional auto-quality heuristic based on frame time.
 */

const QUALITY_TIERS = {
  low: {
    shadowMapEnabled: false,
    shadowMapSize: 0,
    particleCount: 750,
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
    particleCount: 1500,
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
    particleCount: 2250,
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
    particleCount: 3000,
    floraDensityScale: 1.5,
    maxCreatures: 120,
    maxPointLights: 20,
    postProcessScale: 1.0,
    terrainViewDistance: 4,
    creatureCullDistance: 300,
    creatureDespawnDistance: 400,
  },
};

const TIER_ORDER = ["low", "medium", "high", "ultra"];
const STORAGE_KEY = "qualityTier";

// Auto-quality thresholds
const AUTO_DOWNGRADE_MS = 33; // < 30 fps
const AUTO_DOWNGRADE_SECS = 1.5;
const AUTO_UPGRADE_MS = 20; // > 50 fps
const AUTO_UPGRADE_SECS = 4;
const EMA_ALPHA = 2 / (30 + 1); // ~30-frame EMA

// Spike detection
const SPIKE_THRESHOLD_MS = 50;
const SPIKE_RECOVERY_SECS = 2;
const ANTI_PING_PONG_MS = 1500;

// GPU patterns that qualify for automatic ultra tier selection
const HIGH_END_GPU_PATTERNS = [
  /RTX\s*40/i,
  /RTX\s*50/i,
  /RTX\s*4090/i,
  /RTX\s*4080/i,
  /RX\s*7900/i,
  /RX\s*9070/i,
  /RTX\s*5090/i,
  /RTX\s*5080/i,
];

function pushGpuLabel(labels, value) {
  if (typeof value !== "string") return;
  const normalized = value.trim();
  if (!normalized) return;
  labels.push(normalized);
}

function hasHighEndGpuSignature(labels) {
  return labels.some((label) =>
    HIGH_END_GPU_PATTERNS.some((pattern) => pattern.test(label)),
  );
}

function getWebGLGpuLabels(gl) {
  const labels = [];
  if (!gl?.getParameter) return labels;

  const ext = gl.getExtension?.("WEBGL_debug_renderer_info");
  if (ext) {
    pushGpuLabel(labels, gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
    pushGpuLabel(labels, gl.getParameter(ext.UNMASKED_VENDOR_WEBGL));
  }

  pushGpuLabel(labels, gl.getParameter(gl.RENDERER));
  pushGpuLabel(labels, gl.getParameter(gl.VENDOR));
  return [...new Set(labels)];
}

async function getWebGPUGpuLabels(renderer) {
  const labels = [];
  const backend = renderer?.backend;

  const adapterInfoCandidates = [
    backend?.adapter?.info,
    backend?.device?.adapterInfo,
  ];
  for (const info of adapterInfoCandidates) {
    pushGpuLabel(labels, info?.description);
    pushGpuLabel(labels, info?.vendor);
    pushGpuLabel(labels, info?.architecture);
  }

  let adapter = backend?.adapter;
  if (!adapter && typeof navigator !== "undefined" && navigator.gpu) {
    adapter = await navigator.gpu.requestAdapter();
  }
  if (!adapter) return [...new Set(labels)];

  let info = adapter.info ?? null;
  if (!info && typeof adapter.requestAdapterInfo === "function") {
    try {
      info = await adapter.requestAdapterInfo();
    } catch (_) {
      info = null;
    }
  }

  pushGpuLabel(labels, info?.description);
  pushGpuLabel(labels, info?.vendor);
  pushGpuLabel(labels, info?.architecture);
  return [...new Set(labels)];
}

class QualityManager {
  constructor() {
    const stored =
      typeof localStorage !== "undefined"
        ? localStorage.getItem(STORAGE_KEY)
        : null;
    if (stored && QUALITY_TIERS[stored]) {
      this._tier = stored;
      this._autoQuality = false; // user previously chose a tier
    } else {
      this._tier = "high";
      this._autoQuality = true;
    }
    this._settings = { ...QUALITY_TIERS[this._tier] };

    // Auto-quality EMA state
    this._frameTimeEma = 16;
    this._downgradeDuration = 0;
    this._upgradeDuration = 0;
    this._ultraUpgradeDuration = 0;
    this._highEndGpuDetected = false;

    // Spike detection & anti-ping-pong state
    this._lastTierChangeTime = 0;
    this._spikeDowngrade = false;
  }

  /** Current tier name. */
  get tier() {
    return this._tier;
  }

  /** Whether auto tier adjustment is active. */
  get autoQuality() {
    return this._autoQuality;
  }
  set autoQuality(val) {
    this._autoQuality = !!val;
  }

  /** Returns a shallow copy of the current tier's settings. */
  getSettings() {
    return this._settings;
  }

  /**
   * Detect GPU capabilities from the renderer and auto-select ultra tier
   * if a high-end GPU is detected and autoQuality is enabled.
   * Call this once after renderer.init() has completed.
   */
  async detectGPU(renderer) {
    if (!this._autoQuality) return;
    this._highEndGpuDetected = false;

    try {
      const backend = renderer.backend;
      const gpuLabels = backend?.isWebGLBackend
        ? getWebGLGpuLabels(backend.gl)
        : await getWebGPUGpuLabels(renderer);

      this._highEndGpuDetected = hasHighEndGpuSignature(gpuLabels);
      if (this._highEndGpuDetected && this._tier !== "ultra") {
        this._applyAutoTier("ultra");
      }
    } catch (_) {
      /* GPU detection not available */
    }
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
    try {
      localStorage.setItem(STORAGE_KEY, tier);
    } catch (_) {
      /* noop */
    }
    window.dispatchEvent(
      new CustomEvent("qualitychange", {
        detail: { tier, settings: this._settings },
      }),
    );
  }

  /**
   * Call once per frame with the frame's delta time (seconds).
   * Drives the auto-quality heuristic when enabled.
   */
  updateFrameTime(dt) {
    const frameMs = dt * 1000;
    this._frameTimeEma =
      this._frameTimeEma + EMA_ALPHA * (frameMs - this._frameTimeEma);

    if (!this._autoQuality) return;

    const now = performance.now();
    const inCooldown = now - this._lastTierChangeTime < ANTI_PING_PONG_MS;
    const idx = TIER_ORDER.indexOf(this._tier);

    // Spike detection: immediate one-tier downgrade on single-frame stall
    if (frameMs > SPIKE_THRESHOLD_MS && !inCooldown && idx > 0) {
      this._spikeDowngrade = true;
      this._applyAutoTier(TIER_ORDER[idx - 1]);
      this._lastTierChangeTime = now;
      return;
    }

    if (this._frameTimeEma > AUTO_DOWNGRADE_MS) {
      this._upgradeDuration = 0;
      this._downgradeDuration += dt;
      if (this._downgradeDuration >= AUTO_DOWNGRADE_SECS && idx > 0 && !inCooldown) {
        this._applyAutoTier(TIER_ORDER[idx - 1]);
        this._lastTierChangeTime = now;
        this._spikeDowngrade = false;
      }
    } else if (this._frameTimeEma < AUTO_UPGRADE_MS) {
      this._downgradeDuration = 0;
      const upgradeThreshold = this._spikeDowngrade
        ? SPIKE_RECOVERY_SECS
        : AUTO_UPGRADE_SECS;
      this._upgradeDuration += dt;
      const maxGenericIdx = TIER_ORDER.indexOf("high");
      if (this._upgradeDuration >= upgradeThreshold && idx < maxGenericIdx && !inCooldown) {
        this._applyAutoTier(TIER_ORDER[idx + 1]);
        this._lastTierChangeTime = now;
        this._spikeDowngrade = false;
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
    window.dispatchEvent(
      new CustomEvent("qualitychange", {
        detail: { tier, settings: this._settings },
      }),
    );
  }
}

/** Singleton instance. */
export const qualityManager = new QualityManager();
