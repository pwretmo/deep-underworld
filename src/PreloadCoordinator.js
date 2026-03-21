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
const WRITE_THROTTLE_MS = 5000;
const ENTRY_TTL_MS = 1000 * 60 * 60 * 24;
const INDEXED_DB_SIZE_CEILING = 3 * 1024 * 1024;

export class PreloadCoordinator {
  constructor({ renderer, underwaterEffect, player, terrain, flora, creatures }) {
    this.renderer = renderer;
    this.underwaterEffect = underwaterEffect;
    this.player = player;
    this.terrain = terrain;
    this.flora = flora;
    this.creatures = creatures;

    this.state = 'idle';
    this._token = null;
    this._hasIdleCallback = typeof window.requestIdleCallback === 'function';

    this.worldSeed = this._resolveWorldSeed();
    this.qualityTier = this._resolveQualityTier();
    this.cacheKey = this._buildCacheKey();
    this.runtimeCache = new Map();
    this.persistenceDisabledForSession = false;

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

  async _runWarmup(token) {
    try {
      await this._cache.init();
      const cached = await this._cache.readSnapshot();
      if (cached) {
        this.runtimeCache.set('startupSnapshot', cached);
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
