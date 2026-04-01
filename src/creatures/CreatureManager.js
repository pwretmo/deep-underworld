import * as THREE from 'three';
import { Anglerfish } from './Anglerfish.js';
import { Leviathan } from './Leviathan.js';
import { Jellyfish } from './Jellyfish.js';
import { GhostShark } from './GhostShark.js';
import { DeepOne } from './DeepOne.js';
// Giger biomechanical creatures
import { BoneWorm } from './BoneWorm.js';
import { SpinalEel } from './SpinalEel.js';
import { SirenSkull } from './SirenSkull.js';
import { AbyssalMaw } from './AbyssalMaw.js';
import { BioMechCrab } from './BioMechCrab.js';
import { RibCage } from './RibCage.js';
import { TendrilHunter } from './TendrilHunter.js';
import { PipeOrgan } from './PipeOrgan.js';
import { FacelessOne } from './FacelessOne.js';
import { Lamprey } from './Lamprey.js';
import { Harvester } from './Harvester.js';
import { BirthSac } from './BirthSac.js';
import { NeedleFish } from './NeedleFish.js';
import { VoidJelly } from './VoidJelly.js';
import { Amalgam } from './Amalgam.js';
import { Sentinel } from './Sentinel.js';
import { Husk } from './Husk.js';
import { ChainDragger } from './ChainDragger.js';
import { AbyssWraith } from './AbyssWraith.js';
import { TubeCluster } from './TubeCluster.js';
import { SporeCloud } from './SporeCloud.js';
import { IronWhale } from './IronWhale.js';
import { MechOctopus } from './MechOctopus.js';
import { Parasite } from './Parasite.js';
import { qualityManager } from '../QualityManager.js';

// Defaults come from QualityManager per tier
const _qSettings = qualityManager.getSettings();
let DESPAWN_DISTANCE = _qSettings.creatureDespawnDistance;
let CULL_DISTANCE = _qSettings.creatureCullDistance;
let MAX_CREATURES = _qSettings.maxCreatures;
let DESPAWN_DISTANCE_SQ = DESPAWN_DISTANCE * DESPAWN_DISTANCE;
let CULL_DISTANCE_SQ = CULL_DISTANCE * CULL_DISTANCE;
const QUEUE_DRAIN_PER_FRAME = 1;

window.addEventListener('qualitychange', (e) => {
  const s = e.detail.settings;
  DESPAWN_DISTANCE = s.creatureDespawnDistance;
  CULL_DISTANCE = s.creatureCullDistance;
  MAX_CREATURES = s.maxCreatures;
  DESPAWN_DISTANCE_SQ = DESPAWN_DISTANCE * DESPAWN_DISTANCE;
  CULL_DISTANCE_SQ = CULL_DISTANCE * CULL_DISTANCE;
  CREATURE_VISIBILITY_DEPTH_BUDGETS = VISIBILITY_BUDGETS_BY_TIER[e.detail.tier] || VISIBILITY_BUDGETS_BY_TIER.high;
});

function _distSq(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}
const DYNAMIC_SPAWNS_PER_CYCLE = 2;
const SPAWN_LOOKAHEAD_DEPTH = 45;
const HEAVY_FRAME_DT = 1 / 20;
const MAX_SPAWN_BUDGET_MS = 10;
const SPAWN_EMA_ALPHA = 0.2;
const HEAVY_SPAWN_WARN_MS = 50;
const VISIBILITY_BUDGETS_BY_TIER = {
  low:    [{ depth: 80, maxVisible: 6 },  { depth: 160, maxVisible: 5 },  { depth: 260, maxVisible: 4 },  { depth: 380, maxVisible: 3 },  { depth: Infinity, maxVisible: 3 }],
  medium: [{ depth: 80, maxVisible: 9 },  { depth: 160, maxVisible: 8 },  { depth: 260, maxVisible: 6 },  { depth: 380, maxVisible: 5 },  { depth: Infinity, maxVisible: 4 }],
  high:   [{ depth: 80, maxVisible: 12 }, { depth: 160, maxVisible: 10 }, { depth: 260, maxVisible: 8 },  { depth: 380, maxVisible: 6 },  { depth: Infinity, maxVisible: 6 }],
  ultra:  [{ depth: 80, maxVisible: 15 }, { depth: 160, maxVisible: 13 }, { depth: 260, maxVisible: 10 }, { depth: 380, maxVisible: 8 },  { depth: Infinity, maxVisible: 8 }],
};
let CREATURE_VISIBILITY_DEPTH_BUDGETS = VISIBILITY_BUDGETS_BY_TIER[qualityManager.tier] || VISIBILITY_BUDGETS_BY_TIER.high;

export class CreatureManager {
  constructor(scene, options = {}) {
    this.scene = scene;
    this._pointLightBudget = options.pointLightBudget ?? null;
    this.creatures = [];
    this.spawnTimer = 0;
    this.lastDepth = 0;
    this.initialized = false;
    this._spawnQueue = [];
    this._spawnTotal = 0;
    this._spawnedCount = 0;
    this._spawnCooldown = 0;
    this._spawnCostEmaMs = 0;
    this._lastSpawnCostMs = 0;
    const MAX_VIS_K = 16;
    this._visRoots  = new Array(MAX_VIS_K).fill(null);
    this._visScores = new Float64Array(MAX_VIS_K);
    this._visCount  = 0;
    this._typeCount = new Map();
    this._queuedTypeCount = new Map();
    // Diagnostic counters (read by profiling; negligible overhead)
    this._diagCandidateCount = 0;
    this._diagBroadPhaseCount = 0;
    this._diagVisSelectUs = 0;
  }

  prepareInitialQueue(playerPos) {
    if (!this.initialized) {
      this._spawnInitialCreatures(playerPos);
    }
  }

  preloadDrain(maxCount, cancelToken, depth = Infinity, maxCostMs = Infinity) {
    if (maxCount <= 0) return 0;
    let drained = 0;
    const batchStart = performance.now();
    while (this._spawnQueue.length > 0 && drained < maxCount) {
      if ((performance.now() - batchStart) >= maxCostMs) break;
      if (cancelToken?.cancelled) break;
      const entryIndex = Number.isFinite(depth)
        ? this._spawnQueue.findIndex((entry) => entry.depthMin <= depth + SPAWN_LOOKAHEAD_DEPTH)
        : 0;
      if (entryIndex === -1) break;
      const [entry] = this._spawnQueue.splice(entryIndex, 1);
      this._queuedTypeCount.set(entry.type, (this._queuedTypeCount.get(entry.type) ?? 0) - 1);
      const _t0 = performance.now();
      const instance = entry.createFn();
      const _spawnMs = performance.now() - _t0;
      this._lastSpawnCostMs = _spawnMs;
      this._spawnCostEmaMs = this._spawnCostEmaMs === 0
        ? _spawnMs
        : THREE.MathUtils.lerp(this._spawnCostEmaMs, _spawnMs, SPAWN_EMA_ALPHA);

      if (_spawnMs > HEAVY_SPAWN_WARN_MS) {
        console.warn(`[CreatureManager] Slow spawn: ${entry.type} took ${_spawnMs.toFixed(1)}ms`);
      }
      this._add(entry.type, instance, entry.depthMin, entry.depthMax);
      if (entry.countsTowardLoad !== false) {
        this._spawnedCount++;
      }
      drained++;
    }
    return drained;
  }

  getSpawnQueueLength() {
    return this._spawnQueue.length;
  }

  getSpawnQueueLengthUpToDepth(maxDepth) {
    let count = 0;
    for (const entry of this._spawnQueue) {
      if (entry.depthMin <= maxDepth) {
        count++;
      }
    }
    return count;
  }

  hasQueuedSpawnsUpToDepth(maxDepth) {
    return this.getSpawnQueueLengthUpToDepth(maxDepth) > 0;
  }

  _rndPos(playerPos, hRange, yBase, yRange) {
    return new THREE.Vector3(
      playerPos.x + (Math.random() - 0.5) * hRange,
      yBase - Math.random() * yRange,
      playerPos.z + (Math.random() - 0.5) * hRange
    );
  }

  _angledPos(playerPos, dist, y) {
    const a = Math.random() * Math.PI * 2;
    return new THREE.Vector3(
      playerPos.x + Math.cos(a) * dist,
      y,
      playerPos.z + Math.sin(a) * dist
    );
  }

  _registerCreatureLights(instance) {
    this._pointLightBudget?.registerObjectLights(instance?.group ?? instance);
  }

  _unregisterCreatureLights(instance) {
    this._pointLightBudget?.unregisterObjectLights(instance?.group ?? instance);
  }

  _add(type, instance, depthMin, depthMax) {
    this._registerCreatureLights(instance);
    this.creatures.push({ type, instance, depthMin, depthMax });
    this._typeCount.set(type, (this._typeCount.get(type) ?? 0) + 1);
  }

  _queueAdd(type, createFn, depthMin, depthMax) {
    this._spawnQueue.push({ type, createFn, depthMin, depthMax, countsTowardLoad: true });
    this._queuedTypeCount.set(type, (this._queuedTypeCount.get(type) ?? 0) + 1);
  }

  _queueDynamicAdd(type, createFn, depthMin, depthMax) {
    this._spawnQueue.push({ type, createFn, depthMin, depthMax, countsTowardLoad: false });
    this._queuedTypeCount.set(type, (this._queuedTypeCount.get(type) ?? 0) + 1);
  }

  _spawnInitialCreatures(playerPos) {
    // ── Original creatures ──

    // Jellyfish – twilight zone
    this._queueAdd('jellyfish',
      () => new Jellyfish(this.scene, new THREE.Vector3(playerPos.x + 20, -80, playerPos.z + 20), 6),
      30, 400);
    this._queueAdd('jellyfish',
      () => new Jellyfish(this.scene, new THREE.Vector3(playerPos.x - 30, -150, playerPos.z - 40), 5),
      30, 400);

    // Anglerfish – dark zone
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const ax = playerPos.x + Math.cos(a) * 50;
      const ay = -200 - Math.random() * 200;
      const az = playerPos.z + Math.sin(a) * 50;
      this._queueAdd('anglerfish',
        () => new Anglerfish(this.scene, new THREE.Vector3(ax, ay, az)),
        150, 800);
    }

    // Ghost sharks
    for (let i = 0; i < 2; i++) {
      const p = this._rndPos(playerPos, 80, -100, 200);
      this._queueAdd('ghostshark',
        () => new GhostShark(this.scene, p),
        50, 600);
    }

    // Leviathans
    this._queueAdd('leviathan',
      () => new Leviathan(this.scene, new THREE.Vector3(playerPos.x, -400, playerPos.z)),
      300, 2000);
    this._queueAdd('leviathan',
      () => new Leviathan(this.scene, new THREE.Vector3(playerPos.x + 100, -600, playerPos.z + 100)),
      400, 2000);

    // Deep Ones
    this._queueAdd('deepone',
      () => new DeepOne(this.scene, new THREE.Vector3(playerPos.x - 60, -350, playerPos.z + 80)),
      250, 2000);
    this._queueAdd('deepone',
      () => new DeepOne(this.scene, new THREE.Vector3(playerPos.x + 80, -550, playerPos.z - 60)),
      400, 2000);

    // ── Giger biomechanical creatures ──

    // Shallow / wide-depth creatures
    for (let i = 0; i < 2; i++) {
      const p = this._rndPos(playerPos, 90, -60, 150);
      this._queueAdd('needlefish',
        () => new NeedleFish(this.scene, p),
        30, 600);
    }

    for (let i = 0; i < 2; i++) {
      const p = this._rndPos(playerPos, 70, -80, 200);
      this._queueAdd('parasite',
        () => new Parasite(this.scene, p),
        50, 800);
    }

    { const p = this._rndPos(playerPos, 60, -100, 120);
    this._queueAdd('biomechcrab',
      () => new BioMechCrab(this.scene, p),
      60, 500); }

    { const p = this._rndPos(playerPos, 80, -70, 100);
    this._queueAdd('sporecloud',
      () => new SporeCloud(this.scene, p),
      40, 500); }

    // Mid-depth
    { const p = this._rndPos(playerPos, 70, -180, 150);
    this._queueAdd('boneworm',
      () => new BoneWorm(this.scene, p),
      120, 700); }

    { const p = this._rndPos(playerPos, 80, -200, 200);
    this._queueAdd('spinaleel',
      () => new SpinalEel(this.scene, p),
      150, 800); }

    { const p = this._rndPos(playerPos, 80, -180, 150);
    this._queueAdd('sirenSkull',
      () => new SirenSkull(this.scene, p),
      120, 700); }

    { const p = this._rndPos(playerPos, 70, -200, 200);
    this._queueAdd('lamprey',
      () => new Lamprey(this.scene, p),
      150, 800); }

    { const p = this._rndPos(playerPos, 80, -160, 200);
    this._queueAdd('voidjelly',
      () => new VoidJelly(this.scene, p),
      100, 700); }

    { const p = this._rndPos(playerPos, 70, -200, 150);
    this._queueAdd('chaindragger',
      () => new ChainDragger(this.scene, p),
      150, 800); }

    { const p = this._rndPos(playerPos, 90, -220, 200);
    this._queueAdd('mechoctopus',
      () => new MechOctopus(this.scene, p),
      160, 900); }

    // Deep creatures
    { const p = this._rndPos(playerPos, 80, -350, 200);
    this._queueAdd('tendrilhunter',
      () => new TendrilHunter(this.scene, p),
      250, 1200); }

    { const p = this._rndPos(playerPos, 70, -380, 200);
    this._queueAdd('harvester',
      () => new Harvester(this.scene, p),
      280, 1200); }

    { const p = this._rndPos(playerPos, 90, -400, 200);
    this._queueAdd('abysswraith',
      () => new AbyssWraith(this.scene, p),
      300, 1500); }

    { const p = this._rndPos(playerPos, 60, -350, 150);
    this._queueAdd('birthsac',
      () => new BirthSac(this.scene, p),
      250, 1200); }

    // Abyss creatures
    { const p = this._rndPos(playerPos, 80, -500, 200);
    this._queueAdd('facelessone',
      () => new FacelessOne(this.scene, p),
      400, 2000); }

    { const p = this._rndPos(playerPos, 70, -550, 200);
    this._queueAdd('amalgam',
      () => new Amalgam(this.scene, p),
      450, 2000); }

    { const p = this._rndPos(playerPos, 80, -500, 200);
    this._queueAdd('sentinel',
      () => new Sentinel(this.scene, p),
      400, 2000); }

    { const p = this._rndPos(playerPos, 90, -550, 250);
    this._queueAdd('abyssalmaw',
      () => new AbyssalMaw(this.scene, p),
      450, 2000); }

    { const p = this._rndPos(playerPos, 120, -600, 300);
    this._queueAdd('ironwhale',
      () => new IronWhale(this.scene, p),
      500, 2000); }

    for (let i = 0; i < 2; i++) {
      const p = this._rndPos(playerPos, 80, -450, 300);
      this._queueAdd('husk',
        () => new Husk(this.scene, p),
        350, 2000);
    }

    // Stationary creatures – placed around starting area at fixed depths
    this._queueAdd('pipeorgan',
      () => new PipeOrgan(this.scene, new THREE.Vector3(playerPos.x + 40, -280, playerPos.z + 30)),
      200, 1500);
    this._queueAdd('pipeorgan',
      () => new PipeOrgan(this.scene, new THREE.Vector3(playerPos.x - 50, -420, playerPos.z - 60)),
      350, 1500);

    this._queueAdd('tubecluster',
      () => new TubeCluster(this.scene, new THREE.Vector3(playerPos.x + 30, -220, playerPos.z - 40)),
      150, 1200);
    this._queueAdd('tubecluster',
      () => new TubeCluster(this.scene, new THREE.Vector3(playerPos.x - 40, -340, playerPos.z + 50)),
      250, 1200);
    this._queueAdd('tubecluster',
      () => new TubeCluster(this.scene, new THREE.Vector3(playerPos.x + 60, -500, playerPos.z + 70)),
      400, 1500);

    this._queueAdd('ribcage',
      () => new RibCage(this.scene, new THREE.Vector3(playerPos.x - 30, -360, playerPos.z - 30)),
      280, 1500);
    this._queueAdd('ribcage',
      () => new RibCage(this.scene, new THREE.Vector3(playerPos.x + 50, -520, playerPos.z + 40)),
      420, 1500);

    this._spawnTotal = this._spawnQueue.length;
    this._spawnedCount = 0;
    this.initialized = true;
  }

  isFullyLoaded() {
    return this.initialized && this._spawnQueue.length === 0;
  }

  getLoadProgress() {
    return { loaded: this._spawnedCount, total: this._spawnTotal };
  }

  getPrimeLoadProgress(maxDepth) {
    if (!Number.isFinite(maxDepth)) {
      return this.getLoadProgress();
    }

    return {
      loaded: this._spawnedCount,
      total: this._spawnedCount + this._simulatePrimeDrainCount(maxDepth),
    };
  }

  _simulatePrimeDrainCount(maxDepth) {
    const queue = this._spawnQueue
      .filter((entry) => entry.countsTowardLoad !== false)
      .map((entry) => ({ depthMin: entry.depthMin }));
    let drained = 0;

    while (queue.some((entry) => entry.depthMin <= maxDepth)) {
      const entryIndex = queue.findIndex(
        (entry) => entry.depthMin <= maxDepth + SPAWN_LOOKAHEAD_DEPTH,
      );
      if (entryIndex === -1) {
        break;
      }

      queue.splice(entryIndex, 1);
      drained++;
    }

    return drained;
  }

  _resolveVisibleCreatureBudget(depth) {
    for (const band of CREATURE_VISIBILITY_DEPTH_BUDGETS) {
      if (depth < band.depth) {
        return band.maxVisible;
      }
    }
    return CREATURE_VISIBILITY_DEPTH_BUDGETS[CREATURE_VISIBILITY_DEPTH_BUDGETS.length - 1].maxVisible;
  }

  _applyVisibilityBudget(depth) {
    const maxVisible = this._resolveVisibleCreatureBudget(depth);
    this._visCount = 0;

    const t0 = performance.now();
    let candidateCount = 0;
    let broadPhaseCount = 0;

    for (const creature of this.creatures) {
      const root = creature.instance?.group;
      if (!root || !creature._fPos) continue;

      candidateCount++;

      // Broad-phase: skip creatures beyond cull distance using cached
      // squared distance — avoids sqrt for the majority of creatures.
      if (creature._fDistSq > CULL_DISTANCE_SQ) {
        root.visible = false;
        continue;
      }

      broadPhaseCount++;

      // Hysteresis bias: already-visible creatures score lower so the
      // budget doesn't flicker when several sit at similar distances.
      const visibilityBias = root.visible ? 10 : 0;
      const dist = Math.sqrt(creature._fDistSq);
      const score = dist - visibilityBias;

      // Top-K insertion sort over pre-allocated struct-of-arrays.
      // Ascending order (closest first); evict farthest from tail.
      // K is small (3-6), so linear scan is faster than a full sort.
      const k = this._visCount;
      let insertAt = k;
      while (insertAt > 0 && this._visScores[insertAt - 1] > score) insertAt--;

      if (insertAt >= maxVisible) {
        root.visible = false;
        continue;
      }

      if (k < maxVisible) this._visCount++;

      // Shift entries right to make space (at most maxVisible entries)
      const limit = Math.min(k, maxVisible);
      for (let i = limit; i > insertAt; i--) {
        this._visRoots[i]  = this._visRoots[i - 1];
        this._visScores[i] = this._visScores[i - 1];
      }
      this._visRoots[insertAt]  = root;
      this._visScores[insertAt] = score;

      // Hide creature evicted from the tail when pool was already full
      if (k >= maxVisible) {
        const evicted = this._visRoots[maxVisible];
        if (evicted) evicted.visible = false;
        this._visRoots[maxVisible] = null;
      }
    }

    // Mark top-K survivors visible
    for (let i = 0; i < this._visCount; i++) {
      this._visRoots[i].visible = true;
    }

    // Diagnostics (read-only counters, no runtime cost beyond assignments)
    this._diagCandidateCount = candidateCount;
    this._diagBroadPhaseCount = broadPhaseCount;
    this._diagVisSelectUs = (performance.now() - t0) * 1000;
  }

  update(dt, playerPos, depth, spawnBudgetMs = 8) {
    this.prepareInitialQueue(playerPos);

    if (this._spawnCooldown > 0) {
      this._spawnCooldown = Math.max(0, this._spawnCooldown - dt);
    }

    // Drain queued spawns only when the frame has budget remaining.
    // Terrain/flora chunk building in the same frame may have consumed the
    // budget already — deferring one creature spawn to the next frame
    // prevents compounding expensive initialization operations.
    const frameIsHeavy = dt >= HEAVY_FRAME_DT;
    const cappedSpawnBudget = Math.min(MAX_SPAWN_BUDGET_MS, Math.max(0, spawnBudgetMs));
    const allowLightweightSpawn = frameIsHeavy && this._spawnCostEmaMs < 8 && this._spawnCostEmaMs > 0;
    if (this._spawnQueue.length > 0 && cappedSpawnBudget > 1 && (!frameIsHeavy || allowLightweightSpawn) && this._spawnCooldown <= 0) {
      const drainCount = cappedSpawnBudget > 6 ? 2 : QUEUE_DRAIN_PER_FRAME;
      const drained = this.preloadDrain(drainCount, undefined, depth, cappedSpawnBudget);
      if (drained > 0) {
        // Back off after heavy constructors so expensive spawns don't chain
        // into repeated long-frame stalls.
        if (this._lastSpawnCostMs > cappedSpawnBudget || this._spawnCostEmaMs > cappedSpawnBudget * 1.5) {
          const cooldown = Math.min(1.0, Math.max(0.2, this._lastSpawnCostMs / 220));
          this._spawnCooldown = Math.max(this._spawnCooldown, cooldown);
        }
      }
    }

    this.lastDepth = depth;
    this.spawnTimer += dt;

    // Dynamic spawning every 15 seconds
    if (this.spawnTimer > 15) {
      this.spawnTimer = 0;
      this._dynamicSpawn(playerPos, depth);
    }

    // ── Per-frame distance cache ──
    // Compute position + squared distance once per creature; reused by
    // despawn, visibility budgeting, and update culling.
    for (const c of this.creatures) {
      const pos = c.instance.getPosition ? c.instance.getPosition() : null;
      c._fPos = pos;
      c._fDistSq = pos ? _distSq(pos, playerPos) : Infinity;
    }

    // Remove creatures that have drifted far away (bounds total count)
    for (let i = this.creatures.length - 1; i >= 0; i--) {
      const c = this.creatures[i];
      if (c._fDistSq > DESPAWN_DISTANCE_SQ) {
        this._unregisterCreatureLights(c.instance);
        c.instance.dispose();
        this.creatures.splice(i, 1);
        this._typeCount.set(c.type, (this._typeCount.get(c.type) ?? 0) - 1);
      }
    }

    this._applyVisibilityBudget(depth);

    // Update only visible creatures (visibility already set by budget pass)
    for (const creature of this.creatures) {
      if (creature.instance?.group?.visible === false) continue;
      creature.instance.update(dt, playerPos);
    }

    // Sync invisible creature positions to prevent pop-in when they become visible
    for (const creature of this.creatures) {
      if (creature.instance?.group?.visible === false && creature._fPos) {
        creature.instance.group.position.copy(creature._fPos);
      }
    }
  }

  _count(type) {
    return this._typeCount.get(type) ?? 0;
  }

  _countQueued(type) {
    return this._queuedTypeCount.get(type) ?? 0;
  }

  _countWithQueued(type) {
    return this._count(type) + this._countQueued(type);
  }

  _createDynamicSpawnEntry(type, Cls, depth, depthMin, depthMax, cap, playerPos, hRange, yOff, yRange, extra) {
    if (this.creatures.length >= MAX_CREATURES) return;
    if (depth > depthMin && this._countWithQueued(type) < cap) {
      const pos = this._rndPos(playerPos, hRange, playerPos.y + yOff, yRange);
      return {
        type,
        createFn: () => (extra ? new Cls(this.scene, pos, extra) : new Cls(this.scene, pos)),
        depthMin,
        depthMax
      };
    }
    return null;
  }

  _queueDynamicEntry(entry) {
    if (!entry) return false;
    this._spawnQueue.push({
      type: entry.type,
      createFn: entry.createFn,
      depthMin: entry.depthMin,
      depthMax: entry.depthMax,
      countsTowardLoad: false,
    });
    this._queuedTypeCount.set(entry.type, (this._queuedTypeCount.get(entry.type) ?? 0) + 1);
    return true;
  }

  _flushDynamicCandidates(candidates, maxCount) {
    for (let i = candidates.length - 1; i > 0; i--) {
      const swapIndex = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[swapIndex]] = [candidates[swapIndex], candidates[i]];
    }

    let queued = 0;
    for (const candidate of candidates) {
      if (queued >= maxCount) break;
      if (this._queueDynamicEntry(candidate)) {
        queued++;
      }
    }

    return queued;
  }

  _dynamicSpawn(playerPos, depth) {
    // Early-out: skip all candidate evaluation when at capacity
    if (this.creatures.length >= MAX_CREATURES) return;

    const candidates = [];

    // Original creatures
    candidates.push(this._createDynamicSpawnEntry('anglerfish', Anglerfish, depth, 150, 800, 5, playerPos, 80, -10, 30));
    candidates.push(this._createDynamicSpawnEntry('ghostshark', GhostShark, depth, 50, 600, 4, playerPos, 100, 0, 30));

    if (this.creatures.length < MAX_CREATURES && depth > 30 && depth < 400 && this._countWithQueued('jellyfish') < 3) {
      const pos = this._rndPos(playerPos, 60, playerPos.y, 20);
      const count = 4 + Math.floor(Math.random() * 4);
      candidates.push({
        type: 'jellyfish',
        createFn: () => new Jellyfish(this.scene, pos, count),
        depthMin: 30,
        depthMax: 400,
      });
    }

    if (this.creatures.length < MAX_CREATURES && depth > 500 && this._countWithQueued('leviathan') < 3) {
      const pos = this._rndPos(playerPos, 200, playerPos.y - 30, 50);
      candidates.push({
        type: 'leviathan',
        createFn: () => new Leviathan(this.scene, pos),
        depthMin: 400,
        depthMax: 2000,
      });
    }

    if (this.creatures.length < MAX_CREATURES && depth > 300 && this._countWithQueued('deepone') < 2) {
      const pos = this._angledPos(playerPos, 80 + Math.random() * 60, playerPos.y - 20 - Math.random() * 40);
      candidates.push({
        type: 'deepone',
        createFn: () => new DeepOne(this.scene, pos),
        depthMin: 250,
        depthMax: 2000,
      });
    }

    // Giger creature dynamic spawns – caps kept low for performance
    candidates.push(this._createDynamicSpawnEntry('needlefish', NeedleFish, depth, 30, 600, 4, playerPos, 90, -5, 20));
    candidates.push(this._createDynamicSpawnEntry('parasite', Parasite, depth, 50, 800, 4, playerPos, 70, -5, 20));
    candidates.push(this._createDynamicSpawnEntry('biomechcrab', BioMechCrab, depth, 60, 500, 3, playerPos, 70, -10, 20));
    candidates.push(this._createDynamicSpawnEntry('sporecloud', SporeCloud, depth, 40, 500, 3, playerPos, 80, -5, 20));
    candidates.push(this._createDynamicSpawnEntry('boneworm', BoneWorm, depth, 120, 700, 3, playerPos, 80, -10, 30));
    candidates.push(this._createDynamicSpawnEntry('spinaleel', SpinalEel, depth, 150, 800, 3, playerPos, 80, -10, 30));
    candidates.push(this._createDynamicSpawnEntry('sirenSkull', SirenSkull, depth, 120, 700, 3, playerPos, 80, -10, 30));
    candidates.push(this._createDynamicSpawnEntry('lamprey', Lamprey, depth, 150, 800, 3, playerPos, 80, -10, 30));
    candidates.push(this._createDynamicSpawnEntry('voidjelly', VoidJelly, depth, 100, 700, 3, playerPos, 80, -10, 30));
    candidates.push(this._createDynamicSpawnEntry('chaindragger', ChainDragger, depth, 150, 800, 3, playerPos, 80, -10, 30));
    candidates.push(this._createDynamicSpawnEntry('mechoctopus', MechOctopus, depth, 160, 900, 2, playerPos, 90, -15, 30));
    candidates.push(this._createDynamicSpawnEntry('tendrilhunter', TendrilHunter, depth, 250, 1200, 3, playerPos, 90, -15, 40));
    candidates.push(this._createDynamicSpawnEntry('harvester', Harvester, depth, 280, 1200, 2, playerPos, 80, -15, 40));
    candidates.push(this._createDynamicSpawnEntry('abysswraith', AbyssWraith, depth, 300, 1500, 3, playerPos, 90, -15, 40));
    candidates.push(this._createDynamicSpawnEntry('birthsac', BirthSac, depth, 250, 1200, 2, playerPos, 70, -10, 30));
    candidates.push(this._createDynamicSpawnEntry('facelessone', FacelessOne, depth, 400, 2000, 2, playerPos, 90, -20, 50));
    candidates.push(this._createDynamicSpawnEntry('amalgam', Amalgam, depth, 450, 2000, 2, playerPos, 80, -20, 50));
    candidates.push(this._createDynamicSpawnEntry('sentinel', Sentinel, depth, 400, 2000, 3, playerPos, 90, -20, 50));
    candidates.push(this._createDynamicSpawnEntry('abyssalmaw', AbyssalMaw, depth, 450, 2000, 2, playerPos, 90, -20, 50));
    candidates.push(this._createDynamicSpawnEntry('husk', Husk, depth, 350, 2000, 4, playerPos, 80, -15, 50));
    candidates.push(this._createDynamicSpawnEntry('ironwhale', IronWhale, depth, 500, 2000, 1, playerPos, 150, -30, 60));

    // Stationary creatures spawn more rarely
    if (this.creatures.length < MAX_CREATURES && depth > 200 && this._countWithQueued('pipeorgan') < 4 && Math.random() < 0.3) {
      const pos = this._rndPos(playerPos, 80, playerPos.y - 15, 30);
      candidates.push({
        type: 'pipeorgan',
        createFn: () => new PipeOrgan(this.scene, pos),
        depthMin: 200,
        depthMax: 1500,
      });
    }
    if (this.creatures.length < MAX_CREATURES && depth > 150 && this._countWithQueued('tubecluster') < 6 && Math.random() < 0.3) {
      const pos = this._rndPos(playerPos, 70, playerPos.y - 10, 25);
      candidates.push({
        type: 'tubecluster',
        createFn: () => new TubeCluster(this.scene, pos),
        depthMin: 150,
        depthMax: 1200,
      });
    }
    if (this.creatures.length < MAX_CREATURES && depth > 280 && this._countWithQueued('ribcage') < 3 && Math.random() < 0.25) {
      const pos = this._rndPos(playerPos, 70, playerPos.y - 15, 30);
      candidates.push({
        type: 'ribcage',
        createFn: () => new RibCage(this.scene, pos),
        depthMin: 280,
        depthMax: 1500,
      });
    }

    this._flushDynamicCandidates(candidates.filter(Boolean), DYNAMIC_SPAWNS_PER_CYCLE);
  }

  getCreaturePositions() {
    const positions = [];
    for (const creature of this.creatures) {
      if (creature.instance.getPosition) {
        positions.push(creature.instance.getPosition());
      }
      if (creature.instance.getPositions) {
        positions.push(...creature.instance.getPositions());
      }
    }
    return positions;
  }

  getFrameStats() {
    let minDistSq = Infinity;
    const groups = {};

    for (const creature of this.creatures) {
      const distSq = creature._fDistSq;
      const type = creature.type;

      if (distSq < minDistSq) minDistSq = distSq;

      if (!groups[type]) {
        groups[type] = { count: 0, nearestSq: Infinity, nearestPos: null };
      }
      const g = groups[type];
      g.count++;
      if (distSq < g.nearestSq) {
        g.nearestSq = distSq;
        g.nearestPos = creature._fPos;
      }
    }

    const result = { nearestDist: Math.sqrt(minDistSq), groups: {} };
    for (const [type, g] of Object.entries(groups)) {
      result.groups[type] = {
        count: g.count,
        nearest: Math.sqrt(g.nearestSq),
        nearestPos: g.nearestPos?.clone() ?? null,
      };
    }
    return result;
  }

  reset() {
    for (const creature of this.creatures) {
      this._unregisterCreatureLights(creature.instance);
      creature.instance.dispose();
    }
    this.creatures = [];
    this.initialized = false;
    this.spawnTimer = 0;
    this._spawnQueue = [];
    this._spawnTotal = 0;
    this._spawnedCount = 0;
    this._typeCount.clear();
    this._queuedTypeCount.clear();
  }
}
