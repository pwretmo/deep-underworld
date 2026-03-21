import * as THREE from 'three';
import { Player } from './player/Player.js';
import { Ocean } from './environment/Ocean.js';
import { Terrain } from './environment/Terrain.js';
import { Flora } from './environment/Flora.js';
import { CreatureManager } from './creatures/CreatureManager.js';
import { HUD } from './ui/HUD.js';
import { AudioManager } from './audio/AudioManager.js';
import { UnderwaterEffect } from './shaders/UnderwaterEffect.js';

export class Game {
  constructor() {
    this.clock = new THREE.Clock();
    this.scene = new THREE.Scene();
    this.running = false;
    this.pendingStart = false;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.8;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    document.body.appendChild(this.renderer.domElement);

    // Camera
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.set(0, -5, 0);
    this.scene.add(this.camera);

    // Systems
    this.player = new Player(this.camera, this.renderer.domElement);
    this.ocean = new Ocean(this.scene);
    this.terrain = new Terrain(this.scene);
    this.flora = new Flora(this.scene);
    this.creatures = new CreatureManager(this.scene);
    this.hud = new HUD();
    this.audio = new AudioManager();
    this.underwaterEffect = new UnderwaterEffect(this.renderer, this.scene, this.camera);

    // Game state
    this.oxygen = 100;
    this.battery = 100;
    this.flashlightOn = false;
    this.gameOver = false;
    this.maxDepth = 0;
    this.menuOverlay = document.getElementById('menu');
    this.pauseOverlay = document.getElementById('paused');
    this.gameOverOverlay = document.getElementById('game-over');

    this._setupEvents();
    this._animate();
  }

  _setupEvents() {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.underwaterEffect.resize();
    });

    document.addEventListener('keydown', (e) => {
      if (!this.running) return;
      if (e.code === 'KeyF') this._toggleFlashlight();
      if (e.code === 'KeyE') this._sonarPing();
      if (e.code === 'KeyC') this.hud.toggleLocator();
      if (e.code === 'Digit0') this.hud.stopTracking();
      if (this.hud.locatorVisible) {
        const num = parseInt(e.key);
        if (num >= 1 && num <= 9) this.hud.trackCreature(num - 1);
      }
    });

    this.player.onLockChange = (locked) => {
      if (locked) {
        if (this.pendingStart && !this.gameOver) {
          this._beginGameplay();
        } else if (this.running && !this.gameOver) {
          this.pauseOverlay.classList.remove('visible');
          this._resumeAudio();
        }
      } else if (this.pendingStart) {
        this.pendingStart = false;
        this._pauseAudio();
      } else if (this.running && !this.gameOver) {
        this.pauseOverlay.classList.add('visible');
        this._pauseAudio();
      }
    };
    document.addEventListener('pointerlockerror', () => {
      if (!this.pendingStart) return;
      this.pendingStart = false;
      this.running = false;
      this._pauseAudio();
    });
    this.pauseOverlay.addEventListener('click', () => {
      this.pauseOverlay.classList.remove('visible');
      this.player.lock();
    });
  }

  start() {
    if (this.gameOver || this.running || this.pendingStart) return;
    this.pendingStart = true;
    this.pauseOverlay.classList.remove('visible');
    this.player.lock();
    this.audio.start();
  }

  restart() {
    this.oxygen = 100;
    this.battery = 100;
    this.gameOver = false;
    this.flashlightOn = false;
    this.pendingStart = false;
    this.running = false;
    this.player.reset();
    this.creatures.reset();
    this.player.flashlight.visible = false;
    this.pauseOverlay.classList.remove('visible');
    this.start();
  }

  _toggleFlashlight() {
    if (this.battery <= 0) return;
    this.flashlightOn = !this.flashlightOn;
    this.player.flashlight.visible = this.flashlightOn;
  }

  _sonarPing() {
    this.hud.sonarPing(this.player.position, this.creatures.getCreaturePositions());
    this.audio.playSonar();
  }

  _beginGameplay() {
    this.pendingStart = false;
    this.running = true;
    this.menuOverlay.classList.add('hidden');
    this.pauseOverlay.classList.remove('visible');
    this._resumeAudio();
    this.clock.start();
  }

  _pauseAudio() {
    if (!this.audio.ctx) return;
    void this.audio.ctx.suspend().catch(() => {});
  }

  _resumeAudio() {
    if (!this.audio.ctx) return;
    void this.audio.ctx.resume().catch(() => {});
  }

  _animate() {
    requestAnimationFrame(() => this._animate());

    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (!this.running || this.gameOver || !this.player.locked) return;

    const depth = Math.max(0, -this.player.position.y);

    // Update systems
    this.player.update(dt);
    this.ocean.update(dt, depth, this.player.position);
    this.terrain.update(this.player.position);
    this.flora.update(dt, this.player.position);
    this.creatures.update(dt, this.player.position, depth);
    this.audio.update(dt, depth, this.creatures.getNearestCreatureDistance(this.player.position));

    // Oxygen depletion
    this.oxygen -= dt * 0.8;
    if (depth > 200) this.oxygen -= dt * 0.3;
    if (depth > 500) this.oxygen -= dt * 0.5;
    this.oxygen = Math.max(0, this.oxygen);

    // Battery drain when flashlight is on
    if (this.flashlightOn) {
      this.battery -= dt * 2;
      if (this.battery <= 0) {
        this.battery = 0;
        this.flashlightOn = false;
        this.player.flashlight.visible = false;
      }
    }

    // Depth tracking
    if (depth > this.maxDepth) this.maxDepth = depth;

    // Update HUD
    const creaturesByType = this.creatures.getCreaturesByType(this.player.position);
    this.hud.update(depth, this.oxygen, this.battery, this.flashlightOn);
    this.hud.updateLocator(creaturesByType, this.player.position, this.camera);

    // Update underwater fog based on depth
    this._updateEnvironmentForDepth(depth);

    // Game over check
    if (this.oxygen <= 0) {
      this.gameOver = true;
      this.running = false;
      this.gameOverOverlay.classList.add('visible');
      this._pauseAudio();
      this.player.unlock();
    }

    // Render with post-processing
    this.underwaterEffect.render(depth);
  }

  _updateEnvironmentForDepth(depth) {
    // Fog and ambient light changes with depth
    let fogColor, fogNear, fogFar, ambientIntensity;

    if (depth < 50) {
      // Sunlit zone
      const t = depth / 50;
      fogColor = new THREE.Color().lerpColors(
        new THREE.Color(0x004466), new THREE.Color(0x002233), t
      );
      fogNear = 5;
      fogFar = THREE.MathUtils.lerp(200, 100, t);
      ambientIntensity = THREE.MathUtils.lerp(0.25, 0.1, t);
    } else if (depth < 200) {
      // Twilight zone
      const t = (depth - 50) / 150;
      fogColor = new THREE.Color().lerpColors(
        new THREE.Color(0x002233), new THREE.Color(0x000811), t
      );
      fogNear = 2;
      fogFar = THREE.MathUtils.lerp(100, 45, t);
      ambientIntensity = THREE.MathUtils.lerp(0.1, 0.015, t);
    } else if (depth < 500) {
      // Dark zone - nearly pitch black
      const t = (depth - 200) / 300;
      fogColor = new THREE.Color().lerpColors(
        new THREE.Color(0x000811), new THREE.Color(0x010104), t
      );
      fogNear = 0.5;
      fogFar = THREE.MathUtils.lerp(45, 22, t);
      ambientIntensity = THREE.MathUtils.lerp(0.015, 0.002, t);
    } else {
      // Abyss - total darkness, only flashlight illuminates
      const t = Math.min(1, (depth - 500) / 300);
      fogColor = new THREE.Color().lerpColors(
        new THREE.Color(0x010104), new THREE.Color(0x000001), t
      );
      fogNear = 0.1;
      fogFar = THREE.MathUtils.lerp(22, 14, t);
      ambientIntensity = THREE.MathUtils.lerp(0.002, 0.0003, t);
    }

    this.scene.fog = new THREE.Fog(fogColor, fogNear, fogFar);
    this.scene.background = fogColor;
    this.ocean.ambientLight.intensity = ambientIntensity;
  }
}
