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
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.8;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.id = 'game-canvas';
    this.renderer.domElement.dataset.testid = 'game-canvas';
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

    // Alias so automated tests can use game.creatureManager or game.creatures
    this.creatureManager = this.creatures;

    // FPS tracking for automated testing
    this.fps = 0;
    this._fpsFrames = 0;
    this._fpsTime = 0;

    // Game state
    this.oxygen = 100;
    this.battery = 100;
    this.flashlightOn = false;
    this.gameOver = false;
    this.maxDepth = 0;
    this.depth = 0;
    this.autoplay = false;
    this.menuOverlay = document.getElementById('menu');
    this.pauseOverlay = document.getElementById('paused');
    this.gameOverOverlay = document.getElementById('game-over');
    this.controlsHelpOverlay = document.getElementById('controls-help');
    this.controlsHelpVisible = false;

    this._initEnvironmentColors();
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
      if (e.code === 'KeyH') this._toggleControlsHelp();
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
      this.player.lock();
    });
  }

  start() {
    if (this.gameOver || this.running || this.pendingStart) return;
    this.pendingStart = true;
    this.pauseOverlay.classList.remove('visible');
    this.player.lock();
    this.audio.start();
    console.log('[deep-underworld] Game starting...');
  }

  /**
   * Start in autoplay mode — skips pointer lock so Chrome DevTools MCP can
   * drive the game via press_key / evaluate_script without user gestures.
   */
  startAutoplay() {
    if (this.running) return;
    this.autoplay = true;
    this.player.locked = true; // simulate lock without real pointer lock
    this.menuOverlay.classList.add('hidden');
    this.gameOverOverlay.classList.remove('visible');
    this.pauseOverlay.classList.remove('visible');
    this.running = true;
    this.audio.start();
    this.clock.start();
    console.log('[deep-underworld] Autoplay mode active');
  }

  restart() {
    this.oxygen = 100;
    this.battery = 100;
    this.gameOver = false;
    this.flashlightOn = false;
    this.pendingStart = false;
    this.running = false;
    this.gameOverOverlay.classList.add('visible');
    this.player.reset();
    this.creatures.reset();
    this.player.flashlight.visible = false;
    this.pauseOverlay.classList.remove('visible');
    this.start();
  }

  _toggleControlsHelp() {
    this.controlsHelpVisible = !this.controlsHelpVisible;
    this.controlsHelpOverlay.classList.toggle('visible', this.controlsHelpVisible);
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
    this.gameOverOverlay.classList.remove('visible');
    this.pauseOverlay.classList.remove('visible');
    this._resumeAudio();
    this.clock.start();
    console.log('[deep-underworld] Gameplay started');
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
    if (!this.running || this.gameOver || (!this.player.locked && !this.autoplay)) return;

    // FPS counter
    this._fpsFrames++;
    this._fpsTime += dt;
    if (this._fpsTime >= 1) {
      this.fps = Math.round(this._fpsFrames / this._fpsTime);
      this._fpsFrames = 0;
      this._fpsTime = 0;
    }

    const depth = Math.max(0, -this.player.position.y);
    this.depth = depth;
    this.player.depth = depth;

    // Update systems
    this.player.update(dt);
    this.ocean.update(dt, depth, this.player.position);
    this.terrain.update(this.player.position);
    this.flora.update(dt, this.player.position);
    this.creatures.update(dt, this.player.position, depth);
    this.audio.update(dt, depth, this.creatures.getNearestCreatureDistance(this.player.position), this.oxygen);

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
      this.hud.closeLocator();
      this.gameOverOverlay.classList.add('visible');
      this._pauseAudio();
      this.player.unlock();
      console.log('[deep-underworld] Game over — oxygen depleted at depth ' + Math.floor(depth) + 'm');
    }

    // Render with post-processing
    this.underwaterEffect.render(depth);
  }

  _initEnvironmentColors() {
    // Pre-allocate reusable Color objects to avoid per-frame GC pressure
    this._fogColor = new THREE.Color();
    this._envColorA = new THREE.Color();
    this._envColorB = new THREE.Color();
    this._fog = new THREE.Fog(0x006994, 5, 300);
    this.scene.fog = this._fog;
  }

  _updateEnvironmentForDepth(depth) {
    // Fog and ambient light changes with depth
    let fogNear, fogFar, ambientIntensity;

    if (depth < 50) {
      // Sunlit zone
      const t = depth / 50;
      this._envColorA.set(0x004466);
      this._envColorB.set(0x002233);
      this._fogColor.lerpColors(this._envColorA, this._envColorB, t);
      fogNear = 5;
      fogFar = THREE.MathUtils.lerp(200, 100, t);
      ambientIntensity = THREE.MathUtils.lerp(0.25, 0.1, t);
    } else if (depth < 200) {
      // Twilight zone
      const t = (depth - 50) / 150;
      this._envColorA.set(0x002233);
      this._envColorB.set(0x000811);
      this._fogColor.lerpColors(this._envColorA, this._envColorB, t);
      fogNear = 2;
      fogFar = THREE.MathUtils.lerp(100, 45, t);
      ambientIntensity = THREE.MathUtils.lerp(0.1, 0.015, t);
    } else if (depth < 500) {
      // Dark zone - nearly pitch black
      const t = (depth - 200) / 300;
      this._envColorA.set(0x000811);
      this._envColorB.set(0x010104);
      this._fogColor.lerpColors(this._envColorA, this._envColorB, t);
      fogNear = 0.5;
      fogFar = THREE.MathUtils.lerp(45, 22, t);
      ambientIntensity = THREE.MathUtils.lerp(0.015, 0.002, t);
    } else {
      // Abyss - total darkness, only flashlight illuminates
      const t = Math.min(1, (depth - 500) / 300);
      this._envColorA.set(0x010104);
      this._envColorB.set(0x000001);
      this._fogColor.lerpColors(this._envColorA, this._envColorB, t);
      fogNear = 0.1;
      fogFar = THREE.MathUtils.lerp(22, 14, t);
      ambientIntensity = THREE.MathUtils.lerp(0.002, 0.0003, t);
    }

    this._fog.color.copy(this._fogColor);
    this._fog.near = fogNear;
    this._fog.far = fogFar;
    this.scene.background.copy(this._fogColor);
    this.ocean.ambientLight.intensity = ambientIntensity;
  }
}
