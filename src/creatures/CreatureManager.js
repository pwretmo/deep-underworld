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

export class CreatureManager {
  constructor(scene) {
    this.scene = scene;
    this.creatures = [];
    this.spawnTimer = 0;
    this.lastDepth = 0;
    this.initialized = false;
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

  _spawnInitialCreatures(playerPos) {
    // ── Original creatures ──

    // Jellyfish – twilight zone
    this._add('jellyfish',
      new Jellyfish(this.scene, new THREE.Vector3(playerPos.x + 20, -80, playerPos.z + 20), 6),
      30, 400);
    this._add('jellyfish',
      new Jellyfish(this.scene, new THREE.Vector3(playerPos.x - 30, -150, playerPos.z - 40), 5),
      30, 400);

    // Anglerfish – dark zone
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      this._add('anglerfish',
        new Anglerfish(this.scene, new THREE.Vector3(
          playerPos.x + Math.cos(a) * 50, -200 - Math.random() * 200, playerPos.z + Math.sin(a) * 50)),
        150, 800);
    }

    // Ghost sharks
    for (let i = 0; i < 2; i++) {
      this._add('ghostshark',
        new GhostShark(this.scene, this._rndPos(playerPos, 80, -100, 200)),
        50, 600);
    }

    // Leviathans
    this._add('leviathan',
      new Leviathan(this.scene, new THREE.Vector3(playerPos.x, -400, playerPos.z)),
      300, 2000);
    this._add('leviathan',
      new Leviathan(this.scene, new THREE.Vector3(playerPos.x + 100, -600, playerPos.z + 100)),
      400, 2000);

    // Deep Ones
    this._add('deepone',
      new DeepOne(this.scene, new THREE.Vector3(playerPos.x - 60, -350, playerPos.z + 80)),
      250, 2000);
    this._add('deepone',
      new DeepOne(this.scene, new THREE.Vector3(playerPos.x + 80, -550, playerPos.z - 60)),
      400, 2000);

    // ── Giger biomechanical creatures ──

    // Shallow / wide-depth creatures
    for (let i = 0; i < 2; i++)
      this._add('needlefish',
        new NeedleFish(this.scene, this._rndPos(playerPos, 90, -60, 150)),
        30, 600);

    for (let i = 0; i < 2; i++)
      this._add('parasite',
        new Parasite(this.scene, this._rndPos(playerPos, 70, -80, 200)),
        50, 800);

    this._add('biomechcrab',
      new BioMechCrab(this.scene, this._rndPos(playerPos, 60, -100, 120)),
      60, 500);

    this._add('sporecloud',
      new SporeCloud(this.scene, this._rndPos(playerPos, 80, -70, 100)),
      40, 500);

    // Mid-depth
    this._add('boneworm',
      new BoneWorm(this.scene, this._rndPos(playerPos, 70, -180, 150)),
      120, 700);

    this._add('spinaleel',
      new SpinalEel(this.scene, this._rndPos(playerPos, 80, -200, 200)),
      150, 800);

    this._add('sirenSkull',
      new SirenSkull(this.scene, this._rndPos(playerPos, 80, -180, 150)),
      120, 700);

    this._add('lamprey',
      new Lamprey(this.scene, this._rndPos(playerPos, 70, -200, 200)),
      150, 800);

    this._add('voidjelly',
      new VoidJelly(this.scene, this._rndPos(playerPos, 80, -160, 200)),
      100, 700);

    this._add('chaindragger',
      new ChainDragger(this.scene, this._rndPos(playerPos, 70, -200, 150)),
      150, 800);

    this._add('mechoctopus',
      new MechOctopus(this.scene, this._rndPos(playerPos, 90, -220, 200)),
      160, 900);

    // Deep creatures
    this._add('tendrilhunter',
      new TendrilHunter(this.scene, this._rndPos(playerPos, 80, -350, 200)),
      250, 1200);

    this._add('harvester',
      new Harvester(this.scene, this._rndPos(playerPos, 70, -380, 200)),
      280, 1200);

    this._add('abysswraith',
      new AbyssWraith(this.scene, this._rndPos(playerPos, 90, -400, 200)),
      300, 1500);

    this._add('birthsac',
      new BirthSac(this.scene, this._rndPos(playerPos, 60, -350, 150)),
      250, 1200);

    // Abyss creatures
    this._add('facelessone',
      new FacelessOne(this.scene, this._rndPos(playerPos, 80, -500, 200)),
      400, 2000);

    this._add('amalgam',
      new Amalgam(this.scene, this._rndPos(playerPos, 70, -550, 200)),
      450, 2000);

    this._add('sentinel',
      new Sentinel(this.scene, this._rndPos(playerPos, 80, -500, 200)),
      400, 2000);

    this._add('abyssalmaw',
      new AbyssalMaw(this.scene, this._rndPos(playerPos, 90, -550, 250)),
      450, 2000);

    this._add('ironwhale',
      new IronWhale(this.scene, this._rndPos(playerPos, 120, -600, 300)),
      500, 2000);

    for (let i = 0; i < 2; i++)
      this._add('husk',
        new Husk(this.scene, this._rndPos(playerPos, 80, -450, 300)),
        350, 2000);

    // Stationary creatures – placed around starting area at fixed depths
    this._add('pipeorgan',
      new PipeOrgan(this.scene, new THREE.Vector3(playerPos.x + 40, -280, playerPos.z + 30)),
      200, 1500);
    this._add('pipeorgan',
      new PipeOrgan(this.scene, new THREE.Vector3(playerPos.x - 50, -420, playerPos.z - 60)),
      350, 1500);

    this._add('tubecluster',
      new TubeCluster(this.scene, new THREE.Vector3(playerPos.x + 30, -220, playerPos.z - 40)),
      150, 1200);
    this._add('tubecluster',
      new TubeCluster(this.scene, new THREE.Vector3(playerPos.x - 40, -340, playerPos.z + 50)),
      250, 1200);
    this._add('tubecluster',
      new TubeCluster(this.scene, new THREE.Vector3(playerPos.x + 60, -500, playerPos.z + 70)),
      400, 1500);

    this._add('ribcage',
      new RibCage(this.scene, new THREE.Vector3(playerPos.x - 30, -360, playerPos.z - 30)),
      280, 1500);
    this._add('ribcage',
      new RibCage(this.scene, new THREE.Vector3(playerPos.x + 50, -520, playerPos.z + 40)),
      420, 1500);

    this.initialized = true;
  }

  update(dt, playerPos, depth) {
    if (!this.initialized) {
      this._spawnInitialCreatures(playerPos);
    }

    this.lastDepth = depth;
    this.spawnTimer += dt;

    // Dynamic spawning every 15 seconds
    if (this.spawnTimer > 15) {
      this.spawnTimer = 0;
      this._dynamicSpawn(playerPos, depth);
    }

    // Update all creatures
    for (const creature of this.creatures) {
      creature.instance.update(dt, playerPos);
    }
  }

  _count(type) {
    return this.creatures.filter(c => c.type === type).length;
  }

  _trySpawn(type, Cls, depth, depthMin, depthMax, cap, playerPos, hRange, yOff, yRange, extra) {
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

    if (depth > 30 && depth < 400 && this._count('jellyfish') < 3) {
      this._add('jellyfish',
        new Jellyfish(this.scene,
          this._rndPos(playerPos, 60, playerPos.y, 20),
          4 + Math.floor(Math.random() * 4)),
        30, 400);
    }

    if (depth > 500 && this._count('leviathan') < 3) {
      this._add('leviathan',
        new Leviathan(this.scene, this._rndPos(playerPos, 200, playerPos.y - 30, 50)),
        400, 2000);
    }

    if (depth > 300 && this._count('deepone') < 2) {
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
    if (depth > 200 && this._count('pipeorgan') < 4 && Math.random() < 0.3) {
      this._add('pipeorgan',
        new PipeOrgan(this.scene, this._rndPos(playerPos, 80, playerPos.y - 15, 30)),
        200, 1500);
    }
    if (depth > 150 && this._count('tubecluster') < 6 && Math.random() < 0.3) {
      this._add('tubecluster',
        new TubeCluster(this.scene, this._rndPos(playerPos, 70, playerPos.y - 10, 25)),
        150, 1200);
    }
    if (depth > 280 && this._count('ribcage') < 3 && Math.random() < 0.25) {
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
  }
}
