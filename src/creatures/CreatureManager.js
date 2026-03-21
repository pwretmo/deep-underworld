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

// Distance beyond which creatures are removed entirely
const DESPAWN_DISTANCE = 250;
// Distance beyond which creature updates are skipped (cheaper than despawn)
const CULL_DISTANCE = 180;
// Hard cap on total alive creatures to bound per-frame work
const MAX_CREATURES = 60;

export class CreatureManager {
  constructor(scene) {
    this.scene = scene;
    this.creatures = [];
    this.spawnTimer = 0;
    this.lastDepth = 0;
    this.initialized = false;
    this._spawnQueue = [];
    this._spawnTotal = 0;
    this._spawnedCount = 0;
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

  _add(type, instance, depthMin, depthMax) {
    this.creatures.push({ type, instance, depthMin, depthMax });
  }

  _queueAdd(type, createFn, depthMin, depthMax) {
    this._spawnQueue.push({ type, createFn, depthMin, depthMax });
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

  update(dt, playerPos, depth) {
    if (!this.initialized) {
      this._spawnInitialCreatures(playerPos);
    }

    // Drain spawn queue: 3 creatures per frame
    if (this._spawnQueue.length > 0) {
      const batch = Math.min(3, this._spawnQueue.length);
      for (let i = 0; i < batch; i++) {
        const entry = this._spawnQueue.shift();
        this._add(entry.type, entry.createFn(), entry.depthMin, entry.depthMax);
        this._spawnedCount++;
      }
    }

    this.lastDepth = depth;
    this.spawnTimer += dt;

    // Dynamic spawning every 15 seconds
    if (this.spawnTimer > 15) {
      this.spawnTimer = 0;
      this._dynamicSpawn(playerPos, depth);
    }

    // Remove creatures that have drifted far away (bounds total count)
    for (let i = this.creatures.length - 1; i >= 0; i--) {
      const c = this.creatures[i];
      const pos = c.instance.getPosition ? c.instance.getPosition() : null;
      if (pos && pos.distanceTo(playerPos) > DESPAWN_DISTANCE) {
        c.instance.dispose();
        this.creatures.splice(i, 1);
      }
    }

    // Update creatures with distance culling — skip far-away updates
    for (const creature of this.creatures) {
      const pos = creature.instance.getPosition ? creature.instance.getPosition() : null;
      if (pos && pos.distanceTo(playerPos) > CULL_DISTANCE) continue;
      creature.instance.update(dt, playerPos);
    }
  }

  _count(type) {
    return this.creatures.filter(c => c.type === type).length;
  }

  _trySpawn(type, Cls, depth, depthMin, depthMax, cap, playerPos, hRange, yOff, yRange, extra) {
    if (this.creatures.length >= MAX_CREATURES) return;
    if (depth > depthMin && this._count(type) < cap) {
      const pos = this._rndPos(playerPos, hRange, playerPos.y + yOff, yRange);
      this._add(type, extra
        ? new Cls(this.scene, pos, extra)
        : new Cls(this.scene, pos),
        depthMin, depthMax);
    }
  }

  _dynamicSpawn(playerPos, depth) {
    // Original creatures
    this._trySpawn('anglerfish', Anglerfish, depth, 150, 800, 5, playerPos, 80, -10, 30);
    this._trySpawn('ghostshark', GhostShark, depth, 50, 600, 4, playerPos, 100, 0, 30);

    if (this.creatures.length < MAX_CREATURES && depth > 30 && depth < 400 && this._count('jellyfish') < 3) {
      this._add('jellyfish',
        new Jellyfish(this.scene,
          this._rndPos(playerPos, 60, playerPos.y, 20),
          4 + Math.floor(Math.random() * 4)),
        30, 400);
    }

    if (this.creatures.length < MAX_CREATURES && depth > 500 && this._count('leviathan') < 3) {
      this._add('leviathan',
        new Leviathan(this.scene, this._rndPos(playerPos, 200, playerPos.y - 30, 50)),
        400, 2000);
    }

    if (this.creatures.length < MAX_CREATURES && depth > 300 && this._count('deepone') < 2) {
      this._add('deepone',
        new DeepOne(this.scene, this._angledPos(playerPos, 80 + Math.random() * 60, playerPos.y - 20 - Math.random() * 40)),
        250, 2000);
    }

    // Giger creature dynamic spawns – caps kept low for performance
    this._trySpawn('needlefish', NeedleFish, depth, 30, 600, 4, playerPos, 90, -5, 20);
    this._trySpawn('parasite', Parasite, depth, 50, 800, 4, playerPos, 70, -5, 20);
    this._trySpawn('biomechcrab', BioMechCrab, depth, 60, 500, 3, playerPos, 70, -10, 20);
    this._trySpawn('sporecloud', SporeCloud, depth, 40, 500, 3, playerPos, 80, -5, 20);
    this._trySpawn('boneworm', BoneWorm, depth, 120, 700, 3, playerPos, 80, -10, 30);
    this._trySpawn('spinaleel', SpinalEel, depth, 150, 800, 3, playerPos, 80, -10, 30);
    this._trySpawn('sirenSkull', SirenSkull, depth, 120, 700, 3, playerPos, 80, -10, 30);
    this._trySpawn('lamprey', Lamprey, depth, 150, 800, 3, playerPos, 80, -10, 30);
    this._trySpawn('voidjelly', VoidJelly, depth, 100, 700, 3, playerPos, 80, -10, 30);
    this._trySpawn('chaindragger', ChainDragger, depth, 150, 800, 3, playerPos, 80, -10, 30);
    this._trySpawn('mechoctopus', MechOctopus, depth, 160, 900, 2, playerPos, 90, -15, 30);
    this._trySpawn('tendrilhunter', TendrilHunter, depth, 250, 1200, 3, playerPos, 90, -15, 40);
    this._trySpawn('harvester', Harvester, depth, 280, 1200, 2, playerPos, 80, -15, 40);
    this._trySpawn('abysswraith', AbyssWraith, depth, 300, 1500, 3, playerPos, 90, -15, 40);
    this._trySpawn('birthsac', BirthSac, depth, 250, 1200, 2, playerPos, 70, -10, 30);
    this._trySpawn('facelessone', FacelessOne, depth, 400, 2000, 2, playerPos, 90, -20, 50);
    this._trySpawn('amalgam', Amalgam, depth, 450, 2000, 2, playerPos, 80, -20, 50);
    this._trySpawn('sentinel', Sentinel, depth, 400, 2000, 3, playerPos, 90, -20, 50);
    this._trySpawn('abyssalmaw', AbyssalMaw, depth, 450, 2000, 2, playerPos, 90, -20, 50);
    this._trySpawn('husk', Husk, depth, 350, 2000, 4, playerPos, 80, -15, 50);
    this._trySpawn('ironwhale', IronWhale, depth, 500, 2000, 1, playerPos, 150, -30, 60);

    // Stationary creatures spawn more rarely
    if (this.creatures.length < MAX_CREATURES && depth > 200 && this._count('pipeorgan') < 4 && Math.random() < 0.3) {
      this._add('pipeorgan',
        new PipeOrgan(this.scene, this._rndPos(playerPos, 80, playerPos.y - 15, 30)),
        200, 1500);
    }
    if (this.creatures.length < MAX_CREATURES && depth > 150 && this._count('tubecluster') < 6 && Math.random() < 0.3) {
      this._add('tubecluster',
        new TubeCluster(this.scene, this._rndPos(playerPos, 70, playerPos.y - 10, 25)),
        150, 1200);
    }
    if (this.creatures.length < MAX_CREATURES && depth > 280 && this._count('ribcage') < 3 && Math.random() < 0.25) {
      this._add('ribcage',
        new RibCage(this.scene, this._rndPos(playerPos, 70, playerPos.y - 15, 30)),
        280, 1500);
    }
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

  getCreaturesByType(playerPos) {
    const groups = {};
    for (const creature of this.creatures) {
      if (!groups[creature.type]) {
        groups[creature.type] = { count: 0, nearest: Infinity, nearestPos: null };
      }
      groups[creature.type].count++;
      if (creature.instance.getPosition) {
        const d = creature.instance.getPosition().distanceTo(playerPos);
        if (d < groups[creature.type].nearest) {
          groups[creature.type].nearest = d;
          groups[creature.type].nearestPos = creature.instance.getPosition().clone();
        }
      }
    }
    return groups;
  }

  getNearestCreatureDistance(playerPos) {
    let minDist = Infinity;
    for (const creature of this.creatures) {
      if (creature.instance.getPosition) {
        const d = creature.instance.getPosition().distanceTo(playerPos);
        if (d < minDist) minDist = d;
      }
    }
    return minDist;
  }

  reset() {
    for (const creature of this.creatures) {
      creature.instance.dispose();
    }
    this.creatures = [];
    this.initialized = false;
    this.spawnTimer = 0;
    this._spawnQueue = [];
    this._spawnTotal = 0;
    this._spawnedCount = 0;
  }
}
