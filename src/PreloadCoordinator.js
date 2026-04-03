import * as THREE from "three";
import { PRELOAD_LOOKUP_ARTIFACT } from "./generated/preloadLookupArtifact.js";

const SCHEMA_VERSION = 1;
const GAME_VERSION = "0.16.0";
const IDB_NAME = "deep-underworld-procedural-cache";
const IDB_STORE = "snapshots";
const LOCAL_META_KEY = "duw.preload.meta";

const MAX_PRELOADED_CREATURES = 24;
const MAX_PRELOADED_TERRAIN_CHUNKS = 6;
const MAX_PRELOADED_FLORA_CHUNKS = 5;
const FRAME_BUDGET_MS = 6;
const DESCENT_ASSIST_FRAME_BUDGET_MS = 5;
const START_PRIME_FRAME_BUDGET_MS = 4;
const START_PRIME_TIMEOUT_MS = 1000 * 8;
const VIEW_WARMUP_TIMEOUT_MS = 1500;
const CREATURE_SHOWCASE_TIMEOUT_MS = 1500;
const MAX_CREATURE_SHOWCASE_TYPES = 1;
// Prime the opening and mid-depth creature set behind the descent overlay so
// early gameplay does not hit first-seen creature shader compiles.
const START_PRIME_DEPTH = 220;
const WRITE_THROTTLE_MS = 5000;
const ENTRY_TTL_MS = 1000 * 60 * 60 * 24;
const INDEXED_DB_SIZE_CEILING = 3 * 1024 * 1024;

export class PreloadCoordinator {
  constructor({
    renderer,
    underwaterEffect,
    player,
    terrain,
    flora,
    creatures,
    scene,
    ocean,
    prepareDepthState,
  }) {
    this.renderer = renderer;
    this.underwaterEffect = underwaterEffect;
    this.player = player;
    this.terrain = terrain;
    this.flora = flora;
    this.creatures = creatures;
    this.scene = scene;
    this.ocean = ocean;
    this.prepareDepthState = prepareDepthState;

    this.state = "idle";
    this._token = null;
    this._hasIdleCallback = typeof window.requestIdleCallback === "function";

    this.worldSeed = this._resolveWorldSeed();
    this.qualityTier = this._resolveQualityTier();
    this.cacheKey = this._buildCacheKey();
    this.runtimeCache = new Map();
    this.persistenceDisabledForSession = false;
    this._advisorySnapshot = null;
    this._skipLookupWarmupFromSnapshot = false;
    this._lookupChecksum = PRELOAD_LOOKUP_ARTIFACT.checksum;
    this._descentAssist = {
      active: false,
      prepared: false,
      cursor: 0,
      targetCreaturePreload: 0,
      targetTerrainChunks: 0,
      targetFloraChunks: 0,
    };
    this._descentAssistRequested = false;

    this._cache = new ProceduralStartupCache({
      cacheKey: this.cacheKey,
      worldSeed: this.worldSeed,
      qualityTier: this.qualityTier,
      onDisablePersistence: () => {
        this.persistenceDisabledForSession = true;
      },
    });
  }

  startMenuIdleWarmup() {
    if (this.state !== "idle") return;
    this.state = "warming";
    this._token = { cancelled: false };
    void this._runWarmup(this._token);
  }

  cancel(reason = "cancelled") {
    if (this.state !== "warming") return;
    if (this._token) {
      this._token.cancelled = true;
      this._token.reason = reason;
    }
    this.state = "cancelled";
  }

  startDescentAssistFromSnapshot() {
    this._descentAssistRequested = true;
    if (!this._advisorySnapshot) {
      this._descentAssist.active = false;
      return false;
    }

    this._descentAssist.active = true;
    this._descentAssist.prepared = false;
    this._descentAssist.cursor = 0;
    this._descentAssist.targetCreaturePreload =
      this._advisorySnapshot.creaturePreloaded;
    this._descentAssist.targetTerrainChunks =
      this._advisorySnapshot.terrainChunks;
    this._descentAssist.targetFloraChunks = this._advisorySnapshot.floraChunks;
    return true;
  }

  pumpDescentAssist() {
    if (!this._descentAssist.active) return;

    if (!this._descentAssist.prepared) {
      this.creatures.prepareInitialQueue(this.player.position);
      this.terrain.preloadPrepareAround(this.player.position);
      this.flora.preloadPrepareAround(this.player.position);
      this._descentAssist.prepared = true;
    }

    // Run at most one assist action per frame in round-robin order.
    // This avoids compounding creature+terrain+flora initialization in the
    // same frame, which can otherwise produce long stalls.
    const actions = [
      (budgetMs) => this._pumpDescentCreatureAssist(budgetMs),
      () => this._pumpDescentTerrainAssist(),
      () => this._pumpDescentFloraAssist(),
    ];

    let remainingBudgetMs = DESCENT_ASSIST_FRAME_BUDGET_MS;
    for (
      let attempt = 0;
      attempt < actions.length && remainingBudgetMs > 0.25;
      attempt++
    ) {
      const actionIndex =
        (this._descentAssist.cursor + attempt) % actions.length;
      const actionStart = performance.now();
      const didWork = actions[actionIndex](remainingBudgetMs);
      const elapsed = performance.now() - actionStart;
      remainingBudgetMs = Math.max(0, remainingBudgetMs - elapsed);

      if (didWork) {
        this._descentAssist.cursor = (actionIndex + 1) % actions.length;
        break;
      }

      this._descentAssist.cursor = (actionIndex + 1) % actions.length;
    }

    if (this._isDescentAssistComplete()) {
      this._descentAssist.active = false;
    }
  }

  isDescentAssistActive() {
    return this._descentAssist.active;
  }

  async primeStartBaseline({ onProgress } = /** @type {{ onProgress?: Function }} */ ({})) {
    const token = { cancelled: false };

    // Yield before any heavy synchronous work so the browser can paint the
    // descent overlay (achieving FCP) before shader compilation begins.
    await new Promise((resolve) =>
      window.requestAnimationFrame(() => resolve()),
    );

    this.creatures.prepareInitialQueue(this.player.position);
    this.terrain.preloadPrepareAround(this.player.position);
    this.flora.preloadPrepareAround(this.player.position);
    await this._warmGpuOnceAsync(token);

    let _phase = "loading";
    let _finalization = null;
    const deadline = performance.now() + START_PRIME_TIMEOUT_MS;
    const reportProgress = () => {
      onProgress?.({
        phase: _phase,
        creatures: this.creatures.getLoadProgress(),
        primeCreatures: this.creatures.getPrimeLoadProgress(START_PRIME_DEPTH),
        queuedThroughDepth:
          this.creatures.getSpawnQueueLengthUpToDepth(START_PRIME_DEPTH),
        terrainPending: this.terrain.getPendingCount(),
        floraPending: this.flora.getPendingCount(),
        finalization: _finalization,
      });
    };

    reportProgress();

    while (this._needsStartPrimeWork() && performance.now() < deadline) {
      const frameStart = performance.now();

      while (performance.now() - frameStart < START_PRIME_FRAME_BUDGET_MS) {
        let didWork = false;

        if (this.creatures.hasQueuedSpawnsUpToDepth(START_PRIME_DEPTH)) {
          didWork =
            this.creatures.preloadDrain(1, undefined, START_PRIME_DEPTH) > 0 ||
            didWork;
        }

        if (this.terrain.getPendingCount() > 0) {
          didWork = this.terrain.preloadDrain(1) > 0 || didWork;
        }

        if (this.flora.getPendingCount() > 0) {
          didWork = this.flora.preloadDrain(1) > 0 || didWork;
        }

        reportProgress();

        if (!didWork || !this._needsStartPrimeWork()) {
          break;
        }
      }

      if (this._needsStartPrimeWork()) {
        await new Promise((resolve) =>
          window.requestAnimationFrame(() => resolve()),
        );
      }
    }

    // Do a final yield after startup priming rather than calling renderer.compileAsync().
    // Three's compileAsync() still performs a synchronous compile step up front and
    // has been hanging on some scene/material combinations. The opening-band warm
    // renders above are cheaper and keep startup responsive.
    _phase = "finalizing";
    _finalization = {
      label: "Finishing nearby spawns",
      stepIndex: 1,
      stepTotal: 5,
      current: 0,
      total: 0,
      unit: "creatures",
    };
    reportProgress();
    await this._finishCreaturePrime(START_PRIME_DEPTH, 2500, (progress) => {
      _finalization = {
        ...progress,
        stepIndex: 1,
        stepTotal: 5,
      };
      reportProgress();
    });
    await this._warmDepthBandRenders((progress) => {
      _finalization = {
        ...progress,
        stepIndex: 2,
        stepTotal: 5,
      };
      reportProgress();
    }, VIEW_WARMUP_TIMEOUT_MS);
    await this._warmCreatureShowcaseRenders(
      START_PRIME_DEPTH,
      (progress) => {
        _finalization = {
          ...progress,
          stepIndex: 3,
          stepTotal: 5,
        };
        reportProgress();
      },
      CREATURE_SHOWCASE_TIMEOUT_MS,
    );
    await this._reWarmFlashlightWithCreatures((progress) => {
      _finalization = {
        ...progress,
        stepIndex: 4,
        stepTotal: 5,
      };
      reportProgress();
    });
    _finalization = {
      label: "Handing off to live render",
      stepIndex: 5,
      stepTotal: 5,
      current: 0,
      total: 1,
      unit: "frames",
    };
    reportProgress();
    await new Promise((resolve) =>
      window.requestAnimationFrame(() => resolve()),
    );
    _finalization = {
      label: "Handing off to live render",
      stepIndex: 5,
      stepTotal: 5,
      current: 1,
      total: 1,
      unit: "frames",
    };

    reportProgress();

    return {
      timedOut: this._needsStartPrimeWork(),
      primedDepth: START_PRIME_DEPTH,
      creatures: this.creatures.getLoadProgress(),
      queuedThroughDepth:
        this.creatures.getSpawnQueueLengthUpToDepth(START_PRIME_DEPTH),
      terrainPending: this.terrain.getPendingCount(),
      floraPending: this.flora.getPendingCount(),
    };
  }

  async _runWarmup(token) {
    try {
      await this._cache.init();
      const cached = await this._cache.readSnapshot();
      const advisorySnapshot = this._normalizeSnapshot(cached);
      if (advisorySnapshot) {
        this._applyAdvisorySnapshot(advisorySnapshot);
      }

      // Keep menu-idle warmup CPU-bound. Synchronous renderer.compile() calls can
      // still monopolize the main thread after the player hits start, even if the
      // warmup token gets cancelled. Explicit start priming already does the GPU
      // work behind the descent overlay using the async warm-up path.
      await this._runBudgeted(token, () => this._warmCreatureQueue(token));
      await this._runBudgeted(token, () => this._warmTerrainAndFlora(token));
      await this._runBudgeted(token, () => this._warmNonAudioLookups(token));

      if (token.cancelled) return;

      const snapshot = this._createSnapshot();
      this.runtimeCache.set("startupSnapshot", snapshot);
      await this._cache.writeSnapshot(snapshot);

      if (!token.cancelled) {
        this.state = "finalized";
      }
    } catch (err) {
      // Startup preload and cache failures are non-fatal.
      console.warn("[deep-underworld] Menu-idle preload degraded:", err);
      if (!token.cancelled) {
        this.state = "finalized";
      }
    }
  }

  async _runBudgeted(token, workStep) {
    while (!token.cancelled) {
      const done = await this._runSlice(token, workStep);
      if (done) return;
    }
  }

  async _runSlice(token, workStep) {
    if (token.cancelled) return true;

    if (this._hasIdleCallback) {
      return new Promise((resolve) => {
        window.requestIdleCallback(
          () => {
            resolve(this._drainWorkSlice(token, workStep));
          },
          { timeout: 50 },
        );
      });
    }

    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(this._drainWorkSlice(token, workStep));
      }, 16);
    });
  }

  _drainWorkSlice(token, workStep) {
    const start = performance.now();
    while (!token.cancelled && performance.now() - start < FRAME_BUDGET_MS) {
      if (workStep()) return true;
    }
    return false;
  }

  _warmGpuOnce(token) {
    if (token.cancelled) return true;
    if (this._gpuWarmed) return true;

    this.underwaterEffect.warmRender(0, {
      flashlightOn: false,
      exposure: this.renderer.toneMappingExposure,
    });
    this.underwaterEffect.warmPerformanceFallbacks({
      depth: 0,
      flashlightOn: false,
      exposure: this.renderer.toneMappingExposure,
    });
    // Keep startup GPU warm-up focused on the opening band. Deep-band variants can
    // compile lazily later without freezing the player at the first interactive frame.
    this.underwaterEffect.warmBloomSuspendedVariant({
      depth: 0,
      flashlightOn: false,
      exposure: this.renderer.toneMappingExposure,
    });

    // Warm flashlight materials so first toggle doesn't cause a shader-compile hitch
    this._warmFlashlightOnce();

    this._gpuWarmed = true;
    return true;
  }

  _warmFlashlightOnce() {
    const wasVisible = this.player.flashlight.visible;
    this.player.flashlight.visible = true;
    this.underwaterEffect.warmRender(0, {
      flashlightOn: true,
      exposure: this.renderer.toneMappingExposure,
    });
    this.player.flashlight.visible = wasVisible;
  }

  async _warmGpuOnceAsync(token) {
    if (token.cancelled) return;
    if (this._gpuWarmed) return;

    await this._warmRenderAsync({
      depth: 0,
      flashlightOn: false,
      flashlightVisible: false,
      exposure: this.renderer.toneMappingExposure,
    });
    if (token.cancelled) return;

    this.underwaterEffect.warmPerformanceFallbacks({
      depth: 0,
      flashlightOn: false,
      exposure: this.renderer.toneMappingExposure,
    });
    await new Promise((r) => requestAnimationFrame(r));
    if (token.cancelled) return;

    this.underwaterEffect.warmBloomSuspendedVariant({
      depth: 0,
      flashlightOn: false,
      exposure: this.renderer.toneMappingExposure,
    });
    await new Promise((r) => requestAnimationFrame(r));
    if (token.cancelled) return;

    await this._warmFlashlightOnceAsync();
    if (token.cancelled) return;

    // Pre-compile sunLight shadow map if shadows are enabled on this tier
    if (this.ocean && this.ocean.sunLight.castShadow) {
      this.renderer.render(this.scene, this.player.camera);
      await new Promise((r) => requestAnimationFrame(r));
      if (token.cancelled) return;
    }

    this._gpuWarmed = true;
  }

  async _warmFlashlightOnceAsync() {
    await this._warmRenderAsync({
      depth: 0,
      flashlightOn: true,
      flashlightVisible: true,
      exposure: this.renderer.toneMappingExposure,
    });
  }

  async _reWarmFlashlightWithCreatures(onProgress) {
    const wasVisible = this.player.flashlight.visible;
    this.player.flashlight.visible = true;
    const depths = [0, 160];
    let completed = 0;
    onProgress?.({
      label: "Warming flashlight with creatures",
      current: completed,
      total: depths.length,
      unit: "passes",
    });
    for (const depth of depths) {
      this.underwaterEffect.warmRender(depth, {
        flashlightOn: true,
        exposure: this.renderer.toneMappingExposure,
      });
      completed++;
      onProgress?.({
        label: "Warming flashlight with creatures",
        current: completed,
        total: depths.length,
        unit: "passes",
      });
      await new Promise((resolve) =>
        window.requestAnimationFrame(() => resolve()),
      );
    }
    this.player.flashlight.visible = wasVisible;
  }

  async _warmRenderAsync({
    depth = 0,
    flashlightOn = false,
    flashlightVisible = false,
    exposure = this.renderer.toneMappingExposure,
  } = {}) {
    const wasVisible = this.player.flashlight.visible;
    this.player.flashlight.visible = flashlightVisible;
    this.underwaterEffect.warmRender(depth, {
      flashlightOn,
      exposure,
    });
    await new Promise((r) => requestAnimationFrame(r));
    this.player.flashlight.visible = wasVisible;
  }

  _warmCreatureQueue(token) {
    if (token.cancelled) return true;

    this.creatures.prepareInitialQueue(this.player.position);
    const current = this.creatures.getLoadProgress().loaded;
    if (
      current >= MAX_PRELOADED_CREATURES ||
      this.creatures.getSpawnQueueLength() === 0
    ) {
      return true;
    }

    this.creatures.preloadDrain(1, token);
    return false;
  }

  _warmTerrainAndFlora(token) {
    if (token.cancelled) return true;

    if (!this._terrainPrepared) {
      this.terrain.preloadPrepareAround(this.player.position);
      this.flora.preloadPrepareAround(this.player.position);
      this._terrainPrepared = true;
    }

    if (
      this.terrain.getChunkCount() < MAX_PRELOADED_TERRAIN_CHUNKS &&
      this.terrain.getPendingCount() > 0
    ) {
      this.terrain.preloadDrain(1, token);
      return false;
    }

    if (
      this.flora.getChunkCount() < MAX_PRELOADED_FLORA_CHUNKS &&
      this.flora.getPendingCount() > 0
    ) {
      this.flora.preloadDrain(1, token);
      return false;
    }

    return true;
  }

  _warmNonAudioLookups(token) {
    if (token.cancelled) return true;
    // The lookup checksum is generated ahead of time during build so runtime
    // warmup preserves the snapshot field without burning idle-frame budget.
    this._lookupChecksum = PRELOAD_LOOKUP_ARTIFACT.checksum;
    this._skipLookupWarmupFromSnapshot = true;
    return true;
  }

  _pumpDescentCreatureAssist(maxBudgetMs = Infinity) {
    const target = this._descentAssist.targetCreaturePreload;
    if (target <= 0) return false;

    const progress = this.creatures.getLoadProgress();
    if (progress.loaded >= target) return false;
    if (this.creatures.getSpawnQueueLength() === 0) return false;

    return this.creatures.preloadDrain(1, undefined, Infinity, maxBudgetMs) > 0;
  }

  _pumpDescentTerrainAssist() {
    const target = this._descentAssist.targetTerrainChunks;
    if (target <= 0) return false;
    if (this.terrain.getChunkCount() >= target) return false;
    if (this.terrain.getPendingCount() === 0) return false;

    this.terrain.preloadDrain(1);
    return true;
  }

  _pumpDescentFloraAssist() {
    const target = this._descentAssist.targetFloraChunks;
    if (target <= 0) return false;
    if (this.flora.getChunkCount() >= target) return false;
    if (this.flora.getPendingCount() === 0) return false;

    this.flora.preloadDrain(1);
    return true;
  }

  _isDescentAssistComplete() {
    const creatureDone =
      this.creatures.getLoadProgress().loaded >=
        this._descentAssist.targetCreaturePreload ||
      this.creatures.getSpawnQueueLength() === 0;
    const terrainDone =
      this.terrain.getChunkCount() >= this._descentAssist.targetTerrainChunks ||
      this.terrain.getPendingCount() === 0;
    const floraDone =
      this.flora.getChunkCount() >= this._descentAssist.targetFloraChunks ||
      this.flora.getPendingCount() === 0;

    return creatureDone && terrainDone && floraDone;
  }

  _needsStartPrimeWork() {
    return (
      this.creatures.hasQueuedSpawnsUpToDepth(START_PRIME_DEPTH) ||
      this.terrain.getPendingCount() > 0 ||
      this.flora.getPendingCount() > 0
    );
  }

  async _finishCreaturePrime(maxDepth, maxExtraMs = 2500, onProgress) {
    const remainingAtStart =
      this.creatures.getSpawnQueueLengthUpToDepth(maxDepth);
    let drainedTotal = 0;
    onProgress?.({
      label: "Finishing nearby spawns",
      current: 0,
      total: remainingAtStart,
      unit: "creatures",
    });

    const deadline = performance.now() + maxExtraMs;
    while (
      this.creatures.hasQueuedSpawnsUpToDepth(maxDepth) &&
      performance.now() < deadline
    ) {
      const drained = this.creatures.preloadDrain(1, undefined, maxDepth);
      drainedTotal += Math.max(0, drained);
      onProgress?.({
        label: "Finishing nearby spawns",
        current: drainedTotal,
        total: remainingAtStart,
        unit: "creatures",
      });
      await new Promise((resolve) =>
        window.requestAnimationFrame(() => resolve()),
      );
      if (drained <= 0) {
        await new Promise((resolve) =>
          window.requestAnimationFrame(() => resolve()),
        );
      }
    }
  }

  async _warmDepthBandRenders(onProgress, maxExtraMs = VIEW_WARMUP_TIMEOUT_MS) {
    if (!this.prepareDepthState) return;

    // Warm representative view/depth bands behind the descent overlay so the
    // player does not hit first-seen creature and terrain shader compiles later
    // in the run. Use broad yaw coverage rather than exhaustive scene sweeps.
    const originalPosition = this.player.position.clone();
    const originalQuaternion = this.player.camera.quaternion.clone();
    const originalEuler = this.player.euler.clone();
    const originalDepth = this.player.depth;
    const sampleDepths = [0, 80, 160, 240];
    const sampleYawAngles = [
      originalEuler.y,
      originalEuler.y + Math.PI * 0.5,
      originalEuler.y + Math.PI,
      originalEuler.y + Math.PI * 1.5,
    ];
    const deadline = performance.now() + maxExtraMs;
    const totalViews = sampleDepths.length * sampleYawAngles.length;
    let completedViews = 0;

    onProgress?.({
      label: "Warming representative views",
      current: completedViews,
      total: totalViews,
      unit: "views",
    });

    for (const depth of sampleDepths) {
      if (performance.now() >= deadline) {
        break;
      }

      this.player.position.copy(originalPosition);
      this.player.position.y = -Math.max(depth, 5);
      this.player.depth = depth;
      this.prepareDepthState(depth);

      for (const yaw of sampleYawAngles) {
        if (performance.now() >= deadline) {
          break;
        }

        this.player.euler.set(0.08, yaw, 0, "YXZ");
        this.player.camera.quaternion.setFromEuler(this.player.euler);
        this.underwaterEffect.warmRender(depth, {
          flashlightOn: false,
          exposure: this.renderer.toneMappingExposure,
        });
        completedViews++;
        onProgress?.({
          label: "Warming representative views",
          current: completedViews,
          total: totalViews,
          unit: "views",
        });
        await new Promise((resolve) =>
          window.requestAnimationFrame(() => resolve()),
        );
      }
    }

    this.player.position.copy(originalPosition);
    this.player.depth = originalDepth;
    this.player.euler.copy(originalEuler);
    this.player.camera.quaternion.copy(originalQuaternion);
    this.prepareDepthState(Math.max(0, -this.player.position.y));
  }

  async _warmCreatureShowcaseRenders(
    maxDepth = START_PRIME_DEPTH,
    onProgress,
    maxExtraMs = CREATURE_SHOWCASE_TIMEOUT_MS,
  ) {
    const originalPosition = this.player.position.clone();
    const originalQuaternion = this.player.camera.quaternion.clone();
    const originalEuler = this.player.euler.clone();
    const originalDepth = this.player.depth;
    const seenTypes = new Set();
    const showcaseTargets = [];
    const deadline = performance.now() + maxExtraMs;

    for (const creature of this.creatures.creatures) {
      if (creature.depthMin > maxDepth || seenTypes.has(creature.type)) {
        continue;
      }

      const pos = creature.instance?.getPosition?.();
      const root = creature.instance?.group;
      if (!pos || !root) {
        continue;
      }

      seenTypes.add(creature.type);
      showcaseTargets.push({ pos });
      if (showcaseTargets.length >= MAX_CREATURE_SHOWCASE_TYPES) {
        break;
      }
    }

    let completedShowcases = 0;
    onProgress?.({
      label: "Showcasing creature shaders",
      current: completedShowcases,
      total: showcaseTargets.length,
      unit: "types",
    });

    for (const target of showcaseTargets) {
      if (performance.now() >= deadline) {
        break;
      }

      const { pos } = target;
      this.player.position.set(pos.x, pos.y + 2, pos.z + 18);
      this.player.depth = Math.max(0, -this.player.position.y);
      this.prepareDepthState(this.player.depth);
      this.player.camera.lookAt(pos.x, pos.y, pos.z);
      this.player.euler.setFromQuaternion(this.player.camera.quaternion, "YXZ");
      this.underwaterEffect.warmRender(this.player.depth, {
        flashlightOn: false,
        exposure: this.renderer.toneMappingExposure,
      });
      completedShowcases++;
      onProgress?.({
        label: "Showcasing creature shaders",
        current: completedShowcases,
        total: showcaseTargets.length,
        unit: "types",
      });
      await new Promise((resolve) =>
        window.requestAnimationFrame(() => resolve()),
      );
    }

    this.player.position.copy(originalPosition);
    this.player.depth = originalDepth;
    this.player.euler.copy(originalEuler);
    this.player.camera.quaternion.copy(originalQuaternion);
    this.prepareDepthState(Math.max(0, -this.player.position.y));
  }

  _normalizeSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return null;
    if (snapshot.cacheKey !== this.cacheKey) return null;
    if (snapshot.schemaVersion !== SCHEMA_VERSION) return null;
    if (snapshot.worldSeed !== this.worldSeed) return null;
    if (snapshot.qualityTier !== this.qualityTier) return null;

    return {
      cacheKey: snapshot.cacheKey,
      schemaVersion: snapshot.schemaVersion,
      worldSeed: snapshot.worldSeed,
      qualityTier: snapshot.qualityTier,
      creaturePreloaded: this._clampInt(
        snapshot.creaturePreloaded,
        0,
        MAX_PRELOADED_CREATURES,
      ),
      terrainChunks: this._clampInt(
        snapshot.terrainChunks,
        0,
        MAX_PRELOADED_TERRAIN_CHUNKS,
      ),
      floraChunks: this._clampInt(
        snapshot.floraChunks,
        0,
        MAX_PRELOADED_FLORA_CHUNKS,
      ),
      lookupChecksum: Number.isFinite(snapshot.lookupChecksum)
        ? Number(snapshot.lookupChecksum.toFixed(4))
        : null,
      createdAt: this._clampInt(snapshot.createdAt, 0, Number.MAX_SAFE_INTEGER),
    };
  }

  _applyAdvisorySnapshot(snapshot) {
    this._advisorySnapshot = snapshot;
    this.runtimeCache.set("startupSnapshot", snapshot);
    this._skipLookupWarmupFromSnapshot =
      snapshot.lookupChecksum === PRELOAD_LOOKUP_ARTIFACT.checksum;
    this._lookupChecksum = PRELOAD_LOOKUP_ARTIFACT.checksum;

    // Start immediately if gameplay/autoplay already requested assist before
    // the async cache read delivered this advisory snapshot.
    if (this._descentAssistRequested) {
      this.startDescentAssistFromSnapshot();
    }
  }

  _clampInt(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, Math.floor(value)));
  }

  _createSnapshot() {
    const progress = this.creatures.getLoadProgress();
    return {
      cacheKey: this.cacheKey,
      createdAt: Date.now(),
      worldSeed: this.worldSeed,
      qualityTier: this.qualityTier,
      schemaVersion: SCHEMA_VERSION,
      creaturePreloaded: progress.loaded,
      creatureTotal: progress.total,
      terrainChunks: this.terrain.getChunkCount(),
      floraChunks: this.flora.getChunkCount(),
      lookupChecksum: Number(this._lookupChecksum?.toFixed(4) || 0),
      lifecycleState: this.state,
    };
  }

  _buildCacheKey() {
    return [
      GAME_VERSION,
      this.worldSeed,
      this.qualityTier,
      `schema-${SCHEMA_VERSION}`,
    ].join(":");
  }

  _resolveWorldSeed() {
    const fromQuery = new URLSearchParams(window.location.search).get("seed");
    if (fromQuery) return fromQuery;

    try {
      const key = "duw.worldSeed";
      const existing = window.localStorage.getItem(key);
      if (existing) return existing;
      const generated = String(Math.floor(Math.random() * 1_000_000_000));
      window.localStorage.setItem(key, generated);
      return generated;
    } catch {
      return "volatile-seed";
    }
  }

  _resolveQualityTier() {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    if (pixelRatio < 1.25) return "low";
    if (pixelRatio < 1.75) return "medium";
    return "high";
  }
}
class ProceduralStartupCache {
  constructor({ cacheKey, worldSeed, qualityTier, onDisablePersistence }) {
    this.cacheKey = cacheKey;
    this.worldSeed = worldSeed;
    this.qualityTier = qualityTier;
    this._db = null;
    this._nextWriteAt = 0;
    this._onDisablePersistence = onDisablePersistence;
    this._persistenceEnabled = true;
  }

  async init() {
    this._writeTinyMeta({
      gameVersion: GAME_VERSION,
      worldSeed: this.worldSeed,
      qualityTier: this.qualityTier,
      schemaVersion: SCHEMA_VERSION,
      cacheKey: this.cacheKey,
    });

    if (!window.indexedDB) {
      this._disablePersistence("missing-indexeddb");
      return;
    }

    try {
      this._db = await this._openDb();
      await this._pruneStartup();
    } catch (err) {
      this._disablePersistence("idb-unavailable");
      console.warn(
        "[deep-underworld] IndexedDB disabled for this session:",
        err,
      );
    }
  }

  async readSnapshot() {
    if (!this._db || !this._persistenceEnabled) return null;

    try {
      const item = await this._read(this.cacheKey);
      if (!item) return null;
      if (!item.payload || typeof item.payload !== "object") {
        await this._remove(this.cacheKey);
        return null;
      }
      if (item.expiresAt && item.expiresAt < Date.now()) {
        await this._remove(this.cacheKey);
        return null;
      }

      item.lastAccessAt = Date.now();
      await this._write(item);
      return item.payload;
    } catch (err) {
      this._disablePersistence("read-failed");
      console.warn(
        "[deep-underworld] Cache read failed; using memory-only warmup.",
        err,
      );
      return null;
    }
  }

  async writeSnapshot(payload) {
    if (!this._db || !this._persistenceEnabled) return;
    if (Date.now() < this._nextWriteAt) return;

    this._nextWriteAt = Date.now() + WRITE_THROTTLE_MS;
    const sizeBytes = this._estimateSize(payload);
    if (sizeBytes > INDEXED_DB_SIZE_CEILING) return;

    const entry = {
      key: this.cacheKey,
      createdAt: Date.now(),
      lastAccessAt: Date.now(),
      expiresAt: Date.now() + ENTRY_TTL_MS,
      sizeBytes,
      payload,
    };

    try {
      await this._write(entry);
      await this._pruneStartup();
      this._writeTinyMeta({
        gameVersion: GAME_VERSION,
        worldSeed: this.worldSeed,
        qualityTier: this.qualityTier,
        schemaVersion: SCHEMA_VERSION,
        cacheKey: this.cacheKey,
        lastPersistAt: Date.now(),
      });
    } catch (err) {
      if (this._isQuotaError(err)) {
        this._disablePersistence("quota-exceeded");
      } else {
        this._disablePersistence("write-failed");
      }
      console.warn(
        "[deep-underworld] Persistent cache disabled for this session:",
        err,
      );
    }
  }

  async _pruneStartup() {
    if (!this._db || !this._persistenceEnabled) return;

    const now = Date.now();
    const all = await this._readAll();

    for (const entry of all) {
      if (
        !entry ||
        entry.expiresAt < now ||
        entry.sizeBytes > INDEXED_DB_SIZE_CEILING
      ) {
        await this._remove(entry.key);
      }
    }

    const fresh = (await this._readAll()).sort(
      (a, b) => a.lastAccessAt - b.lastAccessAt,
    );
    let total = fresh.reduce((sum, item) => sum + (item.sizeBytes || 0), 0);

    for (const entry of fresh) {
      if (total <= INDEXED_DB_SIZE_CEILING) break;
      await this._remove(entry.key);
      total -= entry.sizeBytes || 0;
    }
  }

  _disablePersistence(reason) {
    this._persistenceEnabled = false;
    this._db = null;
    this._writeTinyMeta({
      persistenceDisabled: true,
      reason,
      cacheKey: this.cacheKey,
    });
    this._onDisablePersistence();
  }

  _writeTinyMeta(data) {
    try {
      const existingRaw = window.localStorage.getItem(LOCAL_META_KEY);
      const existing = existingRaw ? JSON.parse(existingRaw) : {};
      const next = { ...existing, ...data, updatedAt: Date.now() };
      window.localStorage.setItem(LOCAL_META_KEY, JSON.stringify(next));
    } catch {
      // localStorage can be blocked in restrictive/private contexts.
    }
  }

  _estimateSize(value) {
    try {
      return new TextEncoder().encode(JSON.stringify(value)).length;
    } catch {
      return 0;
    }
  }

  _isQuotaError(err) {
    return (
      err &&
      (err.name === "QuotaExceededError" ||
        err.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
        String(err.message || "")
          .toLowerCase()
          .includes("quota"))
    );
  }

  _openDb() {
    return new Promise((resolve, reject) => {
      const req = window.indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { keyPath: "key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () =>
        reject(req.error || new Error("IndexedDB open failed"));
      req.onblocked = () => reject(new Error("IndexedDB open blocked"));
    });
  }

  _read(key) {
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () =>
        reject(req.error || new Error("IndexedDB read failed"));
    });
  }

  _readAll() {
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () =>
        reject(req.error || new Error("IndexedDB readAll failed"));
    });
  }

  _write(value) {
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(IDB_STORE, "readwrite");
      const req = tx.objectStore(IDB_STORE).put(value);
      req.onsuccess = () => resolve();
      req.onerror = () =>
        reject(req.error || new Error("IndexedDB write failed"));
    });
  }

  _remove(key) {
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(IDB_STORE, "readwrite");
      const req = tx.objectStore(IDB_STORE).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () =>
        reject(req.error || new Error("IndexedDB delete failed"));
    });
  }
}
