import * as THREE from 'three';
import { Player } from './player/Player.js';
import { Ocean } from './environment/Ocean.js';
import { Terrain } from './environment/Terrain.js';
import { Flora } from './environment/Flora.js';
import { CreatureManager } from './creatures/CreatureManager.js';
import { HUD } from './ui/HUD.js';
import { AudioManager } from './audio/AudioManager.js';
import { UnderwaterEffect } from './shaders/UnderwaterEffect.js';
import { PreloadCoordinator } from './PreloadCoordinator.js';
import { AbyssEncounter } from './encounters/AbyssEncounter.js';

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
    this.renderer.toneMappingExposure = 0.76;
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
    this.abyssEncounter = new AbyssEncounter();

    this.renderTuning = {
      depthThresholds: {
        mid: 120,
        deep: 340,
        abyss: 700,
      },
      exposure: {
        surface: 0.76,
        mid: 0.66,
        deep: 0.55,
        abyss: 0.48,
        flashlightBoost: 0.08,
        easing: 0.08,
      },
    };
    this._targetExposure = this.renderer.toneMappingExposure;
    this._pointLightBudget = {
      shallowMax: 10,
      deepMax: 6,
      refreshInterval: 0,
      elapsed: 0,
    };

    // Alias so automated tests can use game.creatureManager or game.creatures
    this.creatureManager = this.creatures;

    // FPS tracking for automated testing
    this.fps = 0;
    this._fpsFrames = 0;
    this._fpsTime = 0;

    // Game state
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
    this.descentOverlay = document.getElementById('descent-transition');
    this.descentProgressBar = document.getElementById('descent-progress-bar');
    this._descentActive = false;
    this._startTransition = { owner: 'game', startRequested: false, started: false };

    this.preload = new PreloadCoordinator({
      renderer: this.renderer,
      underwaterEffect: this.underwaterEffect,
      player: this.player,
      terrain: this.terrain,
      flora: this.flora,
      creatures: this.creatures,
    });
    this.preload.startMenuIdleWarmup();

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
        if (this.hud.handleLocatorNavigation(e.code)) {
          if (e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'Enter') {
            e.preventDefault();
          }
          return;
        }
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
        this._startTransition.startRequested = false;
        this._pauseAudio();
      } else if (this.running && !this.gameOver) {
        this.pauseOverlay.classList.add('visible');
        this._pauseAudio();
      }
    };
    document.addEventListener('pointerlockerror', () => {
      if (!this.pendingStart) return;
      this._beginGameplayWithoutPointerLock();
    });
    this.pauseOverlay.addEventListener('click', () => {
      this.player.lock();
    });
  }

  start() {
    if (this.gameOver || this.running || this.pendingStart || this._startTransition.startRequested) return;
    this._startTransition.startRequested = true;
    this.preload.cancel('user-start');
    this.pendingStart = true;
    this.pauseOverlay.classList.remove('visible');
    this.audio.start();

    const lockRequested = this.player.lock();
    if (!lockRequested) {
      this._beginGameplayWithoutPointerLock();
      return;
    }

    // Do not block start if pointer lock cannot be acquired.
    window.setTimeout(() => {
      if (!this.pendingStart || this.running || this.gameOver) return;
      this._beginGameplayWithoutPointerLock();
    }, 250);

    console.log('[deep-underworld] Game starting...');
  }

  _beginGameplayWithoutPointerLock() {
    if (!this.pendingStart || this.running || this.gameOver) return;
    this.player.locked = true;
    this._beginGameplay();
  }

  /**
   * Start in autoplay mode — skips pointer lock so Chrome DevTools MCP can
   * drive the game via press_key / evaluate_script without user gestures.
   */
  startAutoplay() {
    if (this.running) return;
    this.preload.cancel('autoplay-start');
    this.preload.startDescentAssistFromSnapshot();
    this._startTransition.startRequested = false;
    this._startTransition.started = true;
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
    this.hud.closeLocator();
    this.gameOver = false;
    this.flashlightOn = false;
    this.pendingStart = false;
    this.running = false;
    this.gameOverOverlay.classList.add('visible');
    this.player.reset();
    this.creatures.reset();
    this.player.flashlight.visible = false;
    this.pauseOverlay.classList.remove('visible');
    this._descentActive = false;
    this.descentOverlay.classList.remove('visible', 'fade-out');
    if (this.autoplay) {
      this.startAutoplay();
    } else {
      this.start();
    }
  }

  _toggleControlsHelp() {
    this.controlsHelpVisible = !this.controlsHelpVisible;
    this.controlsHelpOverlay.classList.toggle('visible', this.controlsHelpVisible);
  }

  _toggleFlashlight() {
    this.flashlightOn = !this.flashlightOn;
    this.player.flashlight.visible = this.flashlightOn;
  }

  _sonarPing() {
    this.hud.sonarPing(this.player.position, this.creatures.getCreaturePositions());
    this.audio.playSonar();
  }

  _beginGameplay() {
    this._startTransition.startRequested = false;
    this._startTransition.started = true;
    this.pendingStart = false;
    this.preload.startDescentAssistFromSnapshot();
    this.menuOverlay.classList.add('hidden');
    this.gameOverOverlay.classList.remove('visible');
    this.pauseOverlay.classList.remove('visible');

    // Show descent transition overlay
    this.descentOverlay.classList.add('visible');
    this.descentOverlay.classList.remove('fade-out');
    this.descentProgressBar.style.width = '0%';
    this._descentActive = true;

    // Warm-up render to force shader compilation before gameplay
    this.underwaterEffect.render(0);

    this.running = true;
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

    try {
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

    const nearestCreatureDist = this.creatures.getNearestCreatureDistance(this.player.position);

    // Depth tracking
    if (depth > this.maxDepth) this.maxDepth = depth;

    // Update HUD
    const creaturesByType = this.creatures.getCreaturesByType(this.player.position);
    this.hud.update(depth, this.flashlightOn);
    this.hud.updateLocator(creaturesByType, this.player.position, this.camera);

    // Update underwater fog based on depth, then let encounter override if active
    this._updateEnvironmentForDepth(depth);
    this._updateRenderPipelineForDepth(depth);
    this.abyssEncounter.update(dt, depth, this.player, this.scene, this._fog, this.ocean.ambientLight, this.hud, this.audio);

    this.audio.update(dt, {
      depth,
      nearestCreatureDist,
      encounterState: this.abyssEncounter.getAudioState(),
    });

    this._updatePointLightBudget(dt, depth, this.player.position);

    // Keep descent assist pumping in both regular and autoplay starts.
    this.preload.pumpDescentAssist();

    // Update descent transition overlay
    if (this._descentActive) {
      const progress = this.creatures.getLoadProgress();
      if (progress.total > 0) {
        const pct = Math.min(100, (progress.loaded / progress.total) * 100);
        this.descentProgressBar.style.width = pct + '%';
      }
      if (this.creatures.isFullyLoaded()) {
        this._descentActive = false;
        this.descentOverlay.classList.add('fade-out');
        setTimeout(() => {
          this.descentOverlay.classList.remove('visible');
          this.descentOverlay.classList.remove('fade-out');
        }, 800);
      }
    }

    // Render with post-processing
    this.underwaterEffect.render(depth, {
      flashlightOn: this.flashlightOn,
      exposure: this.renderer.toneMappingExposure,
    });
    } catch (err) {
      console.error('[deep-underworld] Animation frame error:', err);
    }
  }

  _initEnvironmentColors() {
    // Pre-allocate reusable Color objects to avoid per-frame GC pressure
    this._fogColor = new THREE.Color();
    this._envColorA = new THREE.Color();
    this._envColorB = new THREE.Color();
    this._envColorC = new THREE.Color();
    this._envColorD = new THREE.Color();
    this._fog = new THREE.Fog(0x006994, 5, 300);
    this.scene.fog = this._fog;
  }

  _updateEnvironmentForDepth(depth) {
    // Overlapping depth bands for smoother transitions without hard visual steps.
    const twilight = THREE.MathUtils.smoothstep(depth, 35, 210);
    const darkZone = THREE.MathUtils.smoothstep(depth, 170, 520);
    const abyss = THREE.MathUtils.smoothstep(depth, 430, 900);

    this._envColorA.set(0x004b70); // surface teal-blue
    this._envColorB.set(0x001b2b); // twilight blue-black
    this._envColorC.set(0x02060d); // dark zone indigo-black
    this._envColorD.set(0x000205); // near-black abyss with faint blue for silhouettes

    this._fogColor.copy(this._envColorA);
    this._fogColor.lerp(this._envColorB, twilight);
    this._fogColor.lerp(this._envColorC, darkZone);
    this._fogColor.lerp(this._envColorD, abyss);

    const nearTwilight = THREE.MathUtils.lerp(5.0, 1.6, twilight);
    const nearDark = THREE.MathUtils.lerp(nearTwilight, 0.45, darkZone);
    const fogNear = THREE.MathUtils.lerp(nearDark, 0.18, abyss);

    const farTwilight = THREE.MathUtils.lerp(220, 82, twilight);
    const farDark = THREE.MathUtils.lerp(farTwilight, 34, darkZone);
    const fogFar = THREE.MathUtils.lerp(farDark, 19, abyss);

    const ambientTwilight = THREE.MathUtils.lerp(0.24, 0.1, twilight);
    const ambientDark = THREE.MathUtils.lerp(ambientTwilight, 0.025, darkZone);
    const ambientIntensity = THREE.MathUtils.lerp(ambientDark, 0.006, abyss);

    this._fog.color.copy(this._fogColor);
    this._fog.near = fogNear;
    this._fog.far = fogFar;
    this.scene.background.copy(this._fogColor);
    this.ocean.ambientLight.intensity = ambientIntensity;
  }

  _updateRenderPipelineForDepth(depth) {
    const thresholds = this.renderTuning.depthThresholds;
    const exposure = this.renderTuning.exposure;

    const midBlend = THREE.MathUtils.smoothstep(depth, thresholds.mid, thresholds.deep);
    const deepBlend = THREE.MathUtils.smoothstep(depth, thresholds.deep, thresholds.abyss);

    let target = THREE.MathUtils.lerp(exposure.surface, exposure.mid, midBlend);
    target = THREE.MathUtils.lerp(target, exposure.deep, deepBlend);

    const abyssBlend = THREE.MathUtils.smoothstep(depth, thresholds.abyss, thresholds.abyss + 280);
    target = THREE.MathUtils.lerp(target, exposure.abyss, abyssBlend);

    if (this.flashlightOn) {
      target += exposure.flashlightBoost;
    }

    this._targetExposure = THREE.MathUtils.clamp(target, 0.42, 0.9);
    this.renderer.toneMappingExposure = THREE.MathUtils.lerp(
      this.renderer.toneMappingExposure,
      this._targetExposure,
      exposure.easing
    );
  }

  _updatePointLightBudget(dt, depth, playerPos) {
    this._pointLightBudget.elapsed += dt;
    if (this._pointLightBudget.elapsed < this._pointLightBudget.refreshInterval) {
      return;
    }

    this._pointLightBudget.elapsed = 0;

    const depthBlend = THREE.MathUtils.smoothstep(depth, 35, 220);
    const maxLights = Math.round(THREE.MathUtils.lerp(
      this._pointLightBudget.shallowMax,
      this._pointLightBudget.deepMax,
      depthBlend
    ));

    const candidates = [];
    this.scene.traverse((obj) => {
      if (!obj.isPointLight) return;
      if (obj === this.player.subLight) return;

      if (obj.userData.duwBaseIntensity === undefined || obj.intensity > 0) {
        obj.userData.duwBaseIntensity = obj.intensity;
      }

      const desiredIntensity = obj.intensity > 0
        ? obj.intensity
        : (obj.userData.duwBaseIntensity ?? 0);

      const worldPos = obj.getWorldPosition(new THREE.Vector3());
      const distanceSq = worldPos.distanceToSquared(playerPos);
      const score = (desiredIntensity + 0.001) / (distanceSq + 1);
      candidates.push({ light: obj, score, distanceSq });
    });

    candidates.sort((a, b) => b.score - a.score);

    for (let i = 0; i < candidates.length; i++) {
      const entry = candidates[i];
      const desiredIntensity = entry.light.intensity > 0
        ? entry.light.intensity
        : (entry.light.userData.duwBaseIntensity ?? 0);
      entry.light.userData.duwDesiredIntensity = desiredIntensity;

      if (i < maxLights) {
        if (entry.light.userData.duwCulled && desiredIntensity > 0) {
          entry.light.intensity = entry.light.userData.duwDesiredIntensity;
        }
        entry.light.userData.duwCulled = false;
      } else {
        entry.light.userData.duwCulled = true;
        entry.light.intensity = 0;
      }
    }
  }
}
