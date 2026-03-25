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
import { qualityManager } from './QualityManager.js';
import { PhysicsWorld } from './physics/PhysicsWorld.js';

export class Game {
  constructor() {
    this.clock = new THREE.Clock();
    this.scene = new THREE.Scene();
    this.running = false;
    this.pendingStart = false;
    this.startPreparing = false;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const qSettings = qualityManager.getSettings();
    this.renderer.shadowMap.enabled = qSettings.shadowMapEnabled;
    this.renderer.shadowMap.type = qualityManager.tier === 'ultra'
      ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    if (qualityManager.tier === 'ultra') {
      this.renderer.setPixelRatio(window.devicePixelRatio);
    }
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
    this.player = new Player(this.camera, this.renderer.domElement, this.renderer);
    this.ocean = new Ocean(this.scene);
    this.terrain = new Terrain(this.scene);
    this.flora = new Flora(this.scene);
    this.creatures = new CreatureManager(this.scene);
    this.hud = new HUD();
    this.audio = new AudioManager();
    this.underwaterEffect = new UnderwaterEffect(this.renderer, this.scene, this.camera);
    this.abyssEncounter = new AbyssEncounter();
    this.physicsWorld = null; // initialized async in _primeAndEnterGameplay

    // Detect high-end GPU for potential ultra tier auto-select
    qualityManager.detectGPU(this.renderer);
    // If GPU detection switched to ultra, apply renderer settings now
    if (qualityManager.tier === 'ultra') {
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer.setPixelRatio(window.devicePixelRatio);
    }
    this.graphicsDiagnostics = this._detectGraphicsDiagnostics();
    // Item 9: start software/fallback renderers in a reduced post-process profile.
    if (this.graphicsDiagnostics.hardwareAccelerated === false) {
      this.underwaterEffect.applySoftwareRendererPolicy();
    }

    this.renderTuning = {
      // Depth thresholds sourced from UnderwaterEffect to keep both in sync.
      depthThresholds: this.underwaterEffect.tuning.depthThresholds,
      exposure: {
        surface: 0.76,
        mid: 0.68,
        deep: 0.60,
        abyss: 0.56,
        flashlightBoost: 0.16,
        easing: 0.08,
      },
    };
    this._targetExposure = this.renderer.toneMappingExposure;
    this._pointLightBudget = {
      shallowMax: qSettings.maxPointLights,
      deepMax: Math.max(3, Math.round(qSettings.maxPointLights * 0.6)),
      transitionBand: 3,
      scanInterval: 0.35,
      scanElapsed: 1,
      retargetInterval: 0.22,
      retargetElapsed: 1,
      fadeInRate: 8,
      fadeOutRate: 6,
      managedLights: [],
      tempWorldPos: new THREE.Vector3(),
    };

    // Alias so automated tests can use game.creatureManager or game.creatures
    this.creatureManager = this.creatures;

    // Quality tier change listener
    window.addEventListener('qualitychange', (e) => {
      const s = e.detail.settings;
      const tier = e.detail.tier;
      this.renderer.shadowMap.enabled = s.shadowMapEnabled;
      this._pointLightBudget.shallowMax = s.maxPointLights;
      this._pointLightBudget.deepMax = Math.max(3, Math.round(s.maxPointLights * 0.6));
      // Ultra tier: soft shadows + uncapped pixel ratio
      if (tier === 'ultra') {
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.setPixelRatio(window.devicePixelRatio);
      } else {
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      }
    });

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
    this._autoplayState = this._createAutoplayState();
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
      prepareDepthState: (depth) => {
        this._updateEnvironmentForDepth(depth);
        this._updateRenderPipelineForDepth(depth);
      },
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
      // Autoplay mode: ESC toggles pause, but only after priming is complete
      if (e.code === 'Escape' && this.autoplay && !this.gameOver && !this.startPreparing) {
        const pauseVisible = this.pauseOverlay.classList.contains('visible');
        if (this.running || pauseVisible) {
          this._toggleAutoplayPause();
        }
        return;
      }
      if (e.code === 'KeyV' && (this.running || this.pauseOverlay.classList.contains('visible'))) {
        this.hud.toggleDiagnostics();
        return;
      }
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
      if (this.autoplay) {
        if (!this.startPreparing) this._toggleAutoplayPause();
      } else {
        this.player.lock();
      }
    });
  }

  start() {
    if (this.gameOver || this.running || this.pendingStart || this.startPreparing || this._startTransition.startRequested) return;
    this.autoplay = false;
    this.player.clearAutoplayInput();
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
    if (this.running || this.startPreparing) return;
    this.preload.cancel('autoplay-start');
    this.autoplay = true;
    this.player.locked = true; // simulate lock without real pointer lock
    this._updateAutoplayDrive(Math.max(0, -this.player.position.y), 0);
    this.audio.start();
    void this._primeAndEnterGameplay('Autoplay mode active');
  }

  restart() {
    this.hud.closeLocator();
    this.gameOver = false;
    this.flashlightOn = false;
    this.pendingStart = false;
    this.running = false;
    this.startPreparing = false;
    this.gameOverOverlay.classList.add('visible');
    this.player.reset();
    this.creatures.reset();
    this.player.flashlight.visible = false;
    this.pauseOverlay.classList.remove('visible');
    this._descentActive = false;
    this.descentOverlay.classList.remove('visible', 'fade-out');
    if (this.autoplay) {
      this._autoplayState = this._createAutoplayState();
      this.startAutoplay();
    } else {
      this.start();
    }
  }

  _toggleControlsHelp() {
    this.controlsHelpVisible = !this.controlsHelpVisible;
    this.controlsHelpOverlay.classList.toggle('visible', this.controlsHelpVisible);
  }

  _toggleAutoplayPause() {
    if (this.running) {
      this.running = false;
      this.pauseOverlay.classList.add('visible');
      this._pauseAudio();
    } else {
      this.running = true;
      this.pauseOverlay.classList.remove('visible');
      this._resumeAudio();
    }
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
    void this._primeAndEnterGameplay('Gameplay started');
  }

  async _primeAndEnterGameplay(logMessage) {
    if (this.running || this.startPreparing || this.gameOver) return;

    this.startPreparing = true;
    this._startTransition.startRequested = false;
    this._startTransition.started = true;
    this.pendingStart = false;
    this.menuOverlay.classList.add('hidden');
    this.gameOverOverlay.classList.remove('visible');
    this.pauseOverlay.classList.remove('visible');

    this.descentOverlay.classList.add('visible');
    this.descentOverlay.classList.remove('fade-out');
    this.descentProgressBar.style.width = '0%';
    this._descentActive = true;
    this._updateDescentProgress();

    // Initialize Rapier WASM physics before terrain/player use it
    this.physicsWorld = new PhysicsWorld();
    await this.physicsWorld.init();
    this.terrain.setPhysicsWorld(this.physicsWorld);
    this.player.setPhysicsWorld(this.physicsWorld);

    const primeSummary = await this.preload.primeStartBaseline({
      onProgress: () => this._updateDescentProgress(),
    });

    if (this.gameOver) {
      this.startPreparing = false;
      return;
    }

    this.preload.startDescentAssistFromSnapshot();

    // Dismiss descent overlay now that priming is complete.
    // The depth-gated spawn queue may never fully drain at shallow depth,
    // so we dismiss here rather than waiting for isFullyLoaded().
    this._descentActive = false;
    this.descentOverlay.classList.add('fade-out');
    setTimeout(() => {
      this.descentOverlay.classList.remove('visible');
      this.descentOverlay.classList.remove('fade-out');
    }, 800);

    // Warm-up render to force shader compilation before gameplay.
    this.underwaterEffect.render(0);

    this.running = true;
    this.startPreparing = false;
    this._resumeAudio();
    this.clock.start();

    console.log(`[deep-underworld] ${logMessage}`, primeSummary);
  }

  _updateDescentProgress() {
    // Composite progress: creatures 50%, terrain 25%, flora 25%
    const creatures = this.creatures.getLoadProgress();
    const terrainPending = this.terrain.getPendingCount();
    const terrainLoaded = this.terrain.getChunkCount();
    const terrainTotal = terrainLoaded + terrainPending;
    const floraPending = this.flora.getPendingCount();
    const floraLoaded = this.flora.getChunkCount();
    const floraTotal = floraLoaded + floraPending;

    const creaturePct = creatures.total > 0 ? creatures.loaded / creatures.total : 1;
    const terrainPct = terrainTotal > 0 ? terrainLoaded / terrainTotal : 1;
    const floraPct = floraTotal > 0 ? floraLoaded / floraTotal : 1;

    const pct = Math.min(100, (creaturePct * 0.5 + terrainPct * 0.25 + floraPct * 0.25) * 100);
    this.descentProgressBar.style.width = pct + '%';
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
    qualityManager.updateFrameTime(dt);
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
    this._updateAutoplayDrive(depth, dt);

    // Step physics before player update so collisions are current
    if (this.physicsWorld) {
      this.physicsWorld.step(dt);
    }

    // Update systems
    this.player.update(dt);
    // Sync fog into volumetric beam shaders so they fade with scene fog
    if (this.flashlightOn) {
      this.player.updateFogUniforms(this._fog);
    }
    this.ocean.update(dt, depth, this.player.position);

    // Time terrain + flora chunk work so creature spawning can be deferred
    // when the frame is already heavy (prevents compounding expensive operations).
    const _initStart = performance.now();
    this.terrain.update(this.player.position);
    this.flora.update(dt, this.player.position);
    const _initElapsed = performance.now() - _initStart;
    const _spawnBudget = Math.max(0, 12 - _initElapsed);
    this.creatures.update(dt, this.player.position, depth, _spawnBudget);

    const nearestCreatureDist = this.creatures.getNearestCreatureDistance(this.player.position);

    // Depth tracking
    if (depth > this.maxDepth) this.maxDepth = depth;

    // Update HUD
    const creaturesByType = this.creatures.getCreaturesByType(this.player.position);
    this.hud.update(depth, this.flashlightOn, this.camera);
    this.hud.updateLocator(creaturesByType, this.player.position, this.camera);
    this.hud.updateDiagnostics(this._getDiagnosticsSnapshot());

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

    // Keep descent assist pumping in both regular and autoplay starts,
    // but only when the frame hasn't already spent its initialization budget
    // on terrain/flora/creature work.
    if ((performance.now() - _initStart) < 14) {
      this.preload.pumpDescentAssist();
    }

    // Safety-net: dismiss descent overlay if still active (normally handled in _primeAndEnterGameplay)
    if (this._descentActive) {
      this._updateDescentProgress();
      this._descentActive = false;
      this.descentOverlay.classList.add('fade-out');
      setTimeout(() => {
        this.descentOverlay.classList.remove('visible');
        this.descentOverlay.classList.remove('fade-out');
      }, 800);
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

    // Generate a minimal IBL environment so metallic PBR surfaces have something
    // to reflect instead of rendering solid black in the deep ocean.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x050a14);
    envScene.add(new THREE.HemisphereLight(0x1a2540, 0x020408, 1.0));
    this.scene.environment = pmrem.fromScene(envScene).texture;
    this.scene.environmentIntensity = 0.5;
    pmrem.dispose();
  }

  _detectGraphicsDiagnostics() {
    try {
      const gl = this.renderer.getContext();
      if (!gl) {
        return {
          context: 'webgl',
          vendor: 'Unknown',
          renderer: 'Unavailable',
          hardwareAccelerated: null,
          hardwareAcceleratedLabel: 'Unknown',
        };
      }

      const context = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext
        ? 'webgl2'
        : 'webgl1';
      const ext = gl.getExtension?.('WEBGL_debug_renderer_info');
      const vendor = ext
        ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)
        : gl.getParameter(gl.VENDOR);
      const renderer = ext
        ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER);
      const normalized = `${vendor ?? ''} ${renderer ?? ''}`.toLowerCase();
      const softwareRenderer = [
        'swiftshader',
        'llvmpipe',
        'software',
        'softpipe',
        'mesa offscreen',
      ].some((token) => normalized.includes(token));
      const hardwareAccelerated = !softwareRenderer;

      return {
        context,
        vendor: vendor || 'Unknown',
        renderer: renderer || 'Unavailable',
        hardwareAccelerated,
        hardwareAcceleratedLabel: hardwareAccelerated ? 'Hardware accelerated' : 'Software / fallback',
      };
    } catch {
      return {
        context: 'webgl',
        vendor: 'Unknown',
        renderer: 'Unavailable',
        hardwareAccelerated: null,
        hardwareAcceleratedLabel: 'Unknown',
      };
    }
  }

  _getDiagnosticsSnapshot() {
    return {
      fps: this.fps,
      depth: this.depth,
      maxDepth: this.maxDepth,
      qualityTier: qualityManager.tier,
      autoplay: this.autoplay,
      running: this.running,
      physicsReady: !!this.physicsWorld,
      creaturesActive: this.creatures.creatures.length,
      queuedSpawns: this.creatures.getSpawnQueueLength(),
      flashlightOn: this.flashlightOn,
      exposure: this.renderer.toneMappingExposure,
      playerPosition: {
        x: this.player.position.x,
        y: this.player.position.y,
        z: this.player.position.z,
      },
      graphics: this.graphicsDiagnostics,
      postProcess: this.underwaterEffect.getDiagnostics(),
    };
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
    let fogNear = THREE.MathUtils.lerp(nearDark, 0.18, abyss);

    const farTwilight = THREE.MathUtils.lerp(220, 90, twilight);
    const farDark = THREE.MathUtils.lerp(farTwilight, 48, darkZone);
    let fogFar = THREE.MathUtils.lerp(farDark, 42, abyss);

    const ambientTwilight = THREE.MathUtils.lerp(0.24, 0.12, twilight);
    const ambientDark = THREE.MathUtils.lerp(ambientTwilight, 0.045, darkZone);
    const ambientIntensity = THREE.MathUtils.lerp(ambientDark, 0.038, abyss);

    // When flashlight is on, push fog back so the beam can illuminate the scene.
    // The push is proportional to depth — stronger at deeper zones where fog is thickest.
    if (this.flashlightOn) {
      const pushStrength = THREE.MathUtils.smoothstep(depth, 100, 600);
      fogNear += THREE.MathUtils.lerp(0.5, 3, pushStrength);
      fogFar += THREE.MathUtils.lerp(8, 38, pushStrength);
    }

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
      // Compensate a bit more at depth so flashlight readability remains consistent
      // while fog attenuation and ambient falloff become stronger.
      const flashlightComp = THREE.MathUtils.lerp(
        exposure.flashlightBoost,
        exposure.flashlightBoost * 1.3,
        THREE.MathUtils.smoothstep(depth, thresholds.mid, thresholds.abyss + 180)
      );
      target += flashlightComp;
    }

    this._targetExposure = THREE.MathUtils.clamp(target, 0.50, 0.9);
    this.renderer.toneMappingExposure = THREE.MathUtils.lerp(
      this.renderer.toneMappingExposure,
      this._targetExposure,
      exposure.easing
    );
    // Item 2: cap composer scale by depth band (deep zones tolerate cheaper FX).
    this.underwaterEffect.applyDepthScaleCap(depth);
  }

  _createAutoplayState() {
    return {
      // State machine — current behavior mode
      mode: 'descend', // 'descend' | 'recover' | 'sonar' | 'showcase'

      // Descent drive parameters
      minForward: 0.12,
      maxForward: 0.3,

      // Heading drift: periodic gentle yaw so descent isn't perfectly straight
      headingTimer: 0,
      headingInterval: 7,      // seconds between heading drift changes
      headingDrift: 0,         // current right input for drift (-1..1)
      headingDriftDuration: 0, // how long to hold current drift
      headingDriftElapsed: 0,

      // Progress watchdog (issue #102)
      watchdog: {
        checkInterval: 2.5,
        checkElapsed: 0,
        lastDepth: 0,
        lastX: 0,
        lastZ: 0,
        stallTime: 0,
        stallThreshold: 4,      // seconds stalled before recovery
        depthGainMin: 0.15,     // metres gained to count as progress
        posGainMin: 0.25,       // world-unit change to count as progress
      },

      // Recovery state
      recover: {
        active: false,
        timer: 0,
        duration: 3.5,         // seconds of recovery steering
        rightInput: 1,         // direction to steer out
        verticalDampen: 0.25,  // reduce descent during recovery
      },

      // Sonar showcase
      sonar: {
        timer: 0,
        interval: 22,          // seconds between autoplay sonar pings
        minDepth: 40,          // don't ping in the very shallow zone
      },

      // Flashlight showcase
      flashlight: {
        timer: 0,
        interval: 35,          // seconds between autoplay flashlight toggles
        minDepth: 120,         // only below twilight zone
      },

      // Creature framing (brief turn toward nearby creature)
      showcase: {
        active: false,
        timer: 0,
        duration: 2.5,
        rightInput: 0,
      },
    };
  }

  _updateAutoplayDrive(depth, dt) {
    if (!this.autoplay) {
      const autoplayInput = this.player.autoplayInput;
      if (autoplayInput.forward !== 0 || autoplayInput.right !== 0 || autoplayInput.vertical !== 0) {
        this.player.clearAutoplayInput();
      }
      return;
    }

    const s = this._autoplayState;
    const wd = s.watchdog;
    const rec = s.recover;

    // ─── Progress watchdog (issue #102) ───────────────────────────────────
    wd.checkElapsed += dt;
    if (wd.checkElapsed >= wd.checkInterval) {
      wd.checkElapsed = 0;
      const px = this.player.position.x;
      const pz = this.player.position.z;
      const depthGain = depth - wd.lastDepth;
      const posChange = Math.sqrt((px - wd.lastX) ** 2 + (pz - wd.lastZ) ** 2);
      const makingProgress = depthGain >= wd.depthGainMin || posChange >= wd.posGainMin;
      if (makingProgress) {
        wd.stallTime = 0;
      } else {
        wd.stallTime += wd.checkInterval;
      }
      wd.lastDepth = depth;
      wd.lastX = px;
      wd.lastZ = pz;

      // Trigger recovery when stalled long enough and not already recovering
      if (wd.stallTime >= wd.stallThreshold && !rec.active) {
        rec.active = true;
        rec.timer = 0;
        // Randomise recovery direction each stall to reduce chance of re-hitting the same wall
        rec.rightInput = Math.random() < 0.5 ? 1 : -1;
        wd.stallTime = 0;
        console.log('[autoplay] Stall detected — entering recovery', { depth });
      }
    }

    // ─── Recovery steering (issue #102) ───────────────────────────────────
    if (rec.active) {
      rec.timer += dt;
      if (rec.timer >= rec.duration) {
        rec.active = false;
        console.log('[autoplay] Recovery complete — resuming descent');
      }
    }

    // ─── Periodic sonar pings (issue #103) ────────────────────────────────
    if (depth >= s.sonar.minDepth) {
      s.sonar.timer += dt;
      if (s.sonar.timer >= s.sonar.interval) {
        s.sonar.timer = 0;
        this._sonarPing();
      }
    }

    // ─── Periodic flashlight toggles (issue #103) ─────────────────────────
    if (depth >= s.flashlight.minDepth) {
      s.flashlight.timer += dt;
      if (s.flashlight.timer >= s.flashlight.interval) {
        s.flashlight.timer = 0;
        this._toggleFlashlight();
      }
    }

    // ─── Creature showcase framing (issue #103) ───────────────────────────
    if (!s.showcase.active && !rec.active) {
      const nearDist = this.creatures.getNearestCreatureDistance(this.player.position);
      if (nearDist < 18 && nearDist > 2) {
        s.showcase.active = true;
        s.showcase.timer = 0;
        s.showcase.rightInput = Math.random() < 0.5 ? 0.4 : -0.4;
      }
    }
    if (s.showcase.active) {
      s.showcase.timer += dt;
      if (s.showcase.timer >= s.showcase.duration) {
        s.showcase.active = false;
      }
    }

    // ─── Gentle heading drift (issue #103) ────────────────────────────────
    s.headingTimer += dt;
    if (s.headingTimer >= s.headingInterval) {
      s.headingTimer = 0;
      // Pick a new gentle drift direction for natural-feeling movement
      const angle = Math.random() * Math.PI * 2;
      s.headingDrift = Math.cos(angle) * 0.35;
      s.headingDriftDuration = 1.5 + Math.random() * 2.5;
      s.headingDriftElapsed = 0;
    }
    s.headingDriftElapsed += dt;
    const driftActive = s.headingDriftElapsed < s.headingDriftDuration;
    const driftInput = driftActive ? s.headingDrift : 0;

    // ─── Compose final input ───────────────────────────────────────────────
    const forward = THREE.MathUtils.lerp(
      s.minForward,
      s.maxForward,
      THREE.MathUtils.smoothstep(depth, 8, 80)
    );

    let rightInput = driftInput;
    let verticalInput = -1; // default: descend

    if (rec.active) {
      // Recovery: steer away from obstacle, reduce descent
      const recoverStrength = THREE.MathUtils.smoothstep(rec.timer, 0, rec.duration * 0.3);
      rightInput = rec.rightInput * THREE.MathUtils.lerp(0.8, 0.4, recoverStrength);
      verticalInput = -rec.verticalDampen;
    } else if (s.showcase.active) {
      // Creature framing: blend in a gentle turn
      rightInput = THREE.MathUtils.lerp(driftInput, s.showcase.rightInput, 0.6);
    }

    this.player.setAutoplayInput({ forward, right: rightInput, vertical: verticalInput });
  }

  _updatePointLightBudget(dt, depth, playerPos) {
    const budget = this._pointLightBudget;
    budget.scanElapsed += dt;
    budget.retargetElapsed += dt;

    if (budget.scanElapsed >= budget.scanInterval || budget.managedLights.length === 0) {
      budget.scanElapsed = 0;
      this._refreshManagedPointLights();
    }

    if (budget.retargetElapsed >= budget.retargetInterval) {
      budget.retargetElapsed = 0;
      this._retargetPointLights(depth, playerPos);
    }

    const fadeInAlpha = 1 - Math.exp(-budget.fadeInRate * dt);
    const fadeOutAlpha = 1 - Math.exp(-budget.fadeOutRate * dt);

    for (const light of budget.managedLights) {
      if (!light.parent) continue;

      const baseIntensity = light.userData.duwBaseIntensity ?? light.intensity;
      const targetIntensity = light.userData.duwTargetIntensity ?? baseIntensity;

      if (targetIntensity > 0.001 && !light.visible) {
        light.visible = true;
      }

      const alpha = targetIntensity >= light.intensity ? fadeInAlpha : fadeOutAlpha;
      light.intensity = THREE.MathUtils.lerp(light.intensity, targetIntensity, alpha);

      if (targetIntensity <= 0.001 && light.intensity < Math.max(baseIntensity * 0.18, 0.05)) {
        light.intensity = 0;
        light.visible = false;
      }
    }
  }

  _refreshManagedPointLights() {
    const managedLights = [];
    this.scene.traverse((obj) => {
      if (!obj.isPointLight) return;
      if (obj === this.player.subLight) return;

      if (obj.userData.duwBaseIntensity === undefined) {
        obj.userData.duwBaseIntensity = obj.intensity;
      }
      if (obj.userData.duwTargetIntensity === undefined) {
        obj.userData.duwTargetIntensity = obj.intensity;
      }

      managedLights.push(obj);
    });
    this._pointLightBudget.managedLights = managedLights;
  }

  _retargetPointLights(depth, playerPos) {
    const budget = this._pointLightBudget;
    const depthBlend = THREE.MathUtils.smoothstep(depth, 35, 220);
    const maxLights = Math.round(THREE.MathUtils.lerp(
      budget.shallowMax,
      budget.deepMax,
      depthBlend
    ));

    const candidates = [];
    for (const light of budget.managedLights) {
      if (!light.parent) continue;

      const baseIntensity = light.userData.duwBaseIntensity ?? light.intensity;
      const worldPos = light.getWorldPosition(budget.tempWorldPos);
      const distanceSq = worldPos.distanceToSquared(playerPos);
      // Hysteresis: boost score for currently-active lights to prevent flip-flopping
      const isActive = (light.userData.duwTargetIntensity ?? 0) > 0.01;
      const hysteresis = isActive ? 1.2 : 1.0;
      const score = ((baseIntensity + 0.001) / (distanceSq + 1)) * hysteresis;
      candidates.push({ light, score });
      light.userData.duwTargetIntensity = 0;
    }

    candidates.sort((a, b) => b.score - a.score);

    const fullyLitCount = Math.min(maxLights, candidates.length);
    const fadeStartIndex = Math.max(fullyLitCount - 1, 0);
    const fadeEndIndex = fullyLitCount + budget.transitionBand;
    const cutoffIndex = Math.max(fullyLitCount - 1, 0);
    const softCutoffIndex = Math.min(candidates.length - 1, cutoffIndex + budget.transitionBand);
    const cutoffScore = candidates[cutoffIndex]?.score ?? 0;
    const softCutoffScore = candidates[softCutoffIndex]?.score ?? cutoffScore;

    for (let i = 0; i < candidates.length; i++) {
      const entry = candidates[i];
      const baseIntensity = entry.light.userData.duwBaseIntensity ?? 0;
      let weight = 0;

      if (i < fullyLitCount) {
        weight = 1;
      } else if (i < fadeEndIndex) {
        const rankWeight = 1 - THREE.MathUtils.smoothstep(fadeStartIndex, fadeEndIndex, i);
        if (cutoffScore > 0) {
          const scoreWeight = THREE.MathUtils.smoothstep(softCutoffScore * 0.9, cutoffScore * 1.05, entry.score);
          weight = rankWeight * scoreWeight;
        } else {
          weight = rankWeight;
        }
      }

      entry.light.userData.duwTargetIntensity = baseIntensity * weight;
    }
  }
}
