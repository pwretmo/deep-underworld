import * as THREE from 'three';
import { noise2D } from './utils/noise.js';

const SCHEMA_VERSION = 1;
const GAME_VERSION = '0.16.0';
const IDB_NAME = 'deep-underworld-procedural-cache';
const IDB_STORE = 'snapshots';
const LOCAL_META_KEY = 'duw.preload.meta';

const MAX_PRELOADED_CREATURES = 12;
const MAX_PRELOADED_TERRAIN_CHUNKS = 6;
const MAX_PRELOADED_FLORA_CHUNKS = 5;
const FRAME_BUDGET_MS = 6;
const DESCENT_ASSIST_FRAME_BUDGET_MS = 5;
const START_PRIME_FRAME_BUDGET_MS = 4;
const START_PRIME_TIMEOUT_MS = 1000 * 6;
const START_PRIME_DEPTH = 320;
const WRITE_THROTTLE_MS = 5000;
const ENTRY_TTL_MS = 1000 * 60 * 60 * 24;
const INDEXED_DB_SIZE_CEILING = 3 * 1024 * 1024;

export class PreloadCoordinator {
  constructor({ renderer, underwaterEffect, player, terrain, flora, creatures, prepareDepthState }) {
    this.renderer = renderer;
    this.underwaterEffect = underwaterEffect;
    this.player = player;
    this.terrain = terrain;
    this.flora = flora;
    this.creatures = creatures;
    this.prepareDepthState = prepareDepthState;

    this.state = 'idle';
    this._token = null;
    this._hasIdleCallback = typeof window.requestIdleCallback === 'function';

    this.worldSeed = this._resolveWorldSeed();
    this.qualityTier = this._resolveQualityTier();
    this.cacheKey = this._buildCacheKey();
    this.runtimeCache = new Map();
    this.persistenceDisabledForSession = false;
    this._advisorySnapshot = null;
    this._skipLookupWarmupFromSnapshot = false;
    this._descentAssist = {
      active: false,
      prepared: false,
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
    if (this.state !== 'idle') return;
    this.state = 'warming';
    this._token = { cancelled: false };
    void this._runWarmup(this._token);
  }

  cancel(reason = 'cancelled') {
    if (this.state !== 'warming') return;
    if (this._token) {
      this._token.cancelled = true;
      this._token.reason = reason;
    }
    this.state = 'cancelled';
  }

  startDescentAssistFromSnapshot() {
    this._descentAssistRequested = true;
    if (!this._advisorySnapshot) {
      this._descentAssist.active = false;
      return false;
    }

    this._descentAssist.active = true;
    this._descentAssist.prepared = false;
    this._descentAssist.targetCreaturePreload = this._advisorySnapshot.creaturePreloaded;
    this._descentAssist.targetTerrainChunks = this._advisorySnapshot.terrainChunks;
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

    const start = performance.now();
    while (performance.now() - start < DESCENT_ASSIST_FRAME_BUDGET_MS) {
      let didWork = false;

      didWork = this._pumpDescentCreatureAssist() || didWork;
      didWork = this._pumpDescentTerrainAssist() || didWork;
      didWork = this._pumpDescentFloraAssist() || didWork;

      if (!didWork) break;
    }

    if (this._isDescentAssistComplete()) {
      this._descentAssist.active = false;
    }
  }

  async primeStartBaseline({ onProgress } = {}) {
    const token = { cancelled: false };

    // Yield before any heavy synchronous work so the browser can paint the
    // descent overlay (achieving FCP) before shader compilation begins.
    await new Promise(resolve => window.requestAnimationFrame(() => resolve()));

    this.creatures.prepareInitialQueue(this.player.position);
    this.terrain.preloadPrepareAround(this.player.position);
    this.flora.preloadPrepareAround(this.player.position);
    this._warmGpuOnce(token);

    const deadline = performance.now() + START_PRIME_TIMEOUT_MS;
    const reportProgress = () => {
      onProgress?.({
        creatures: this.creatures.getLoadProgress(),
        queuedThroughDepth: this.creatures.getSpawnQueueLengthUpToDepth(START_PRIME_DEPTH),
        terrainPending: this.terrain.getPendingCount(),
        floraPending: this.flora.getPendingCount(),
      });
    };

    reportProgress();

    while (this._needsStartPrimeWork() && performance.now() < deadline) {
      const frameStart = performance.now();

      while (performance.now() - frameStart < START_PRIME_FRAME_BUDGET_MS) {
        let didWork = false;

        if (this.creatures.hasQueuedSpawnsUpToDepth(START_PRIME_DEPTH)) {
          didWork = this.creatures.preloadDrain(1, undefined, START_PRIME_DEPTH) > 0 || didWork;
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
        await new Promise(resolve => window.requestAnimationFrame(() => resolve()));
      }
    }

    await this._warmDepthBandRenders();

    reportProgress();

    return {
      timedOut: this._needsStartPrimeWork(),
      primedDepth: START_PRIME_DEPTH,
      creatures: this.creatures.getLoadProgress(),
      queuedThroughDepth: this.creatures.getSpawnQueueLengthUpToDepth(START_PRIME_DEPTH),
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

      await this._runBudgeted(token, () => this._warmGpuOnce(token));
      await this._runBudgeted(token, () => this._warmCreatureQueue(token));
      await this._runBudgeted(token, () => this._warmTerrainAndFlora(token));
      await this._runBudgeted(token, () => this._warmNonAudioLookups(token));

      if (token.cancelled) return;

      const snapshot = this._createSnapshot();
      this.runtimeCache.set('startupSnapshot', snapshot);
      await this._cache.writeSnapshot(snapshot);

      if (!token.cancelled) {
        this.state = 'finalized';
      }
    } catch (err) {
      // Startup preload and cache failures are non-fatal.
      console.warn('[deep-underworld] Menu-idle preload degraded:', err);
      if (!token.cancelled) {
        this.state = 'finalized';
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
      return new Promise(resolve => {
        window.requestIdleCallback(() => {
          resolve(this._drainWorkSlice(token, workStep));
        }, { timeout: 50 });
      });
    }

    return new Promise(resolve => {
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

    this.renderer.compile(this.underwaterEffect.scene, this.underwaterEffect.camera);
    this.underwaterEffect.render(0);
    this._gpuWarmed = true;
    return true;
  }

  _warmCreatureQueue(token) {
    if (token.cancelled) return true;

    this.creatures.prepareInitialQueue(this.player.position);
    const current = this.creatures.getLoadProgress().loaded;
    if (current >= MAX_PRELOADED_CREATURES || this.creatures.getSpawnQueueLength() === 0) {
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

    if (this.terrain.getChunkCount() < MAX_PRELOADED_TERRAIN_CHUNKS && this.terrain.getPendingCount() > 0) {
      this.terrain.preloadDrain(1, token);
      return false;
    }

    if (this.flora.getChunkCount() < MAX_PRELOADED_FLORA_CHUNKS && this.flora.getPendingCount() > 0) {
      this.flora.preloadDrain(1, token);
      return false;
    }

    return true;
  }

  _warmNonAudioLookups(token) {
    if (token.cancelled) return true;
    if (this._skipLookupWarmupFromSnapshot) return true;

    if (!this._lookupPlan) {
      this._lookupPlan = this._buildLookupPlan();
      this._lookupCursor = 0;
      this._lookupChecksum = 0;
    }

    if (this._lookupCursor >= this._lookupPlan.length) return true;

    const p = this._lookupPlan[this._lookupCursor++];
    this._lookupChecksum += noise2D(p.x, p.z);
    return this._lookupCursor >= this._lookupPlan.length;
  }

  _buildLookupPlan() {
    const plan = [];
    for (let x = -8; x <= 8; x++) {
      for (let z = -8; z <= 8; z++) {
        plan.push({ x: x * 0.07, z: z * 0.07 });
      }
    }
    return plan;
  }

  _pumpDescentCreatureAssist() {
    const target = this._descentAssist.targetCreaturePreload;
    if (target <= 0) return false;

    const progress = this.creatures.getLoadProgress();
    if (progress.loaded >= target) return false;
    if (this.creatures.getSpawnQueueLength() === 0) return false;

    this.creatures.preloadDrain(1);
    return true;
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
      this.creatures.getLoadProgress().loaded >= this._descentAssist.targetCreaturePreload ||
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
    return this.creatures.hasQueuedSpawnsUpToDepth(START_PRIME_DEPTH) ||
      this.terrain.getPendingCount() > 0 ||
      this.flora.getPendingCount() > 0;
  }

  async _warmDepthBandRenders() {
    if (!this.prepareDepthState) return;

    // Reduced warmup set (3 depths × 2 yaws). Shaders already compiled in _warmGpuOnce();
    // fog/lighting are uniform updates, not shader variants, so no recompilation needed.
    const sampleDepths = [0, 120, 320];
    const sampleYawAngles = [0, Math.PI];
    const originalPosition = this.player.position.clone();
    const originalQuaternion = this.player.camera.quaternion.clone();
    const originalEuler = this.player.euler.clone();
    const originalDepth = this.player.depth;

    for (const depth of sampleDepths) {
      this.player.position.copy(originalPosition);
      this.player.position.y = -Math.max(depth, 5);
      this.player.depth = depth;
      this.prepareDepthState(depth);

      for (const yaw of sampleYawAngles) {
        this.player.euler.set(0, yaw, 0, 'YXZ');
        this.player.camera.quaternion.setFromEuler(this.player.euler);
        this.underwaterEffect.render(depth, {
          flashlightOn: false,
          exposure: this.renderer.toneMappingExposure,
        });
        await new Promise(resolve => window.requestAnimationFrame(() => resolve()));
      }
    }

    this.player.position.copy(originalPosition);
    this.player.depth = originalDepth;
    this.player.euler.copy(originalEuler);
    this.player.camera.quaternion.copy(originalQuaternion);
    this.prepareDepthState(Math.max(0, -this.player.position.y));
  }

  _normalizeSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return null;
    if (snapshot.cacheKey !== this.cacheKey) return null;
    if (snapshot.schemaVersion !== SCHEMA_VERSION) return null;
    if (snapshot.worldSeed !== this.worldSeed) return null;
    if (snapshot.qualityTier !== this.qualityTier) return null;

    return {
      cacheKey: snapshot.cacheKey,
      schemaVersion: snapshot.schemaVersion,
      worldSeed: snapshot.worldSeed,
      qualityTier: snapshot.qualityTier,
      creaturePreloaded: this._clampInt(snapshot.creaturePreloaded, 0, MAX_PRELOADED_CREATURES),
      terrainChunks: this._clampInt(snapshot.terrainChunks, 0, MAX_PRELOADED_TERRAIN_CHUNKS),
      floraChunks: this._clampInt(snapshot.floraChunks, 0, MAX_PRELOADED_FLORA_CHUNKS),
      lookupChecksum: Number.isFinite(snapshot.lookupChecksum) ? snapshot.lookupChecksum : null,
      createdAt: this._clampInt(snapshot.createdAt, 0, Number.MAX_SAFE_INTEGER),
    };
  }

  _applyAdvisorySnapshot(snapshot) {
    this._advisorySnapshot = snapshot;
    this.runtimeCache.set('startupSnapshot', snapshot);
    this._skipLookupWarmupFromSnapshot = snapshot.lookupChecksum !== null;

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
    return [GAME_VERSION, this.worldSeed, this.qualityTier, `schema-${SCHEMA_VERSION}`].join(':');
  }

  _resolveWorldSeed() {
    const fromQuery = new URLSearchParams(window.location.search).get('seed');
    if (fromQuery) return fromQuery;

    try {
      const key = 'duw.worldSeed';
      const existing = window.localStorage.getItem(key);
      if (existing) return existing;
      const generated = String(Math.floor(Math.random() * 1_000_000_000));
      window.localStorage.setItem(key, generated);
      return generated;
    } catch {
      return 'volatile-seed';
    }
  }

  _resolveQualityTier() {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    if (pixelRatio < 1.25) return 'low';
    if (pixelRatio < 1.75) return 'medium';
    return 'high';
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
      this._disablePersistence('missing-indexeddb');
      return;
    }

    try {
      this._db = await this._openDb();
      await this._pruneStartup();
    } catch (err) {
      this._disablePersistence('idb-unavailable');
      console.warn('[deep-underworld] IndexedDB disabled for this session:', err);
    }
  }

  async readSnapshot() {
    if (!this._db || !this._persistenceEnabled) return null;

    try {
      const item = await this._read(this.cacheKey);
      if (!item) return null;
      if (!item.payload || typeof item.payload !== 'object') {
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
      this._disablePersistence('read-failed');
      console.warn('[deep-underworld] Cache read failed; using memory-only warmup.', err);
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
        this._disablePersistence('quota-exceeded');
      } else {
        this._disablePersistence('write-failed');
      }
      console.warn('[deep-underworld] Persistent cache disabled for this session:', err);
    }
  }

  async _pruneStartup() {
    if (!this._db || !this._persistenceEnabled) return;

    const now = Date.now();
    const all = await this._readAll();

    for (const entry of all) {
      if (!entry || entry.expiresAt < now || entry.sizeBytes > INDEXED_DB_SIZE_CEILING) {
        await this._remove(entry.key);
      }
    }

    const fresh = (await this._readAll()).sort((a, b) => a.lastAccessAt - b.lastAccessAt);
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
    this._writeTinyMeta({ persistenceDisabled: true, reason, cacheKey: this.cacheKey });
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
    return err && (
      err.name === 'QuotaExceededError' ||
      err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      String(err.message || '').toLowerCase().includes('quota')
    );
  }

  _openDb() {
    return new Promise((resolve, reject) => {
      const req = window.indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
      req.onblocked = () => reject(new Error('IndexedDB open blocked'));
    });
  }

  _read(key) {
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error('IndexedDB read failed'));
    });
  }

  _readAll() {
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error || new Error('IndexedDB readAll failed'));
    });
  }

  _write(value) {
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(IDB_STORE, 'readwrite');
      const req = tx.objectStore(IDB_STORE).put(value);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error || new Error('IndexedDB write failed'));
    });
  }

  _remove(key) {
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(IDB_STORE, 'readwrite');
      const req = tx.objectStore(IDB_STORE).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error || new Error('IndexedDB delete failed'));
    });
  }
}
