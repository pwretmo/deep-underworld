import * as THREE from "three/webgpu";
import { Player } from "./player/Player.js";
import { Ocean } from "./environment/Ocean.js";
import { Terrain } from "./environment/Terrain.js";
import { Flora } from "./environment/Flora.js";
import { CreatureManager } from "./creatures/CreatureManager.js";
import { HUD } from "./ui/HUD.js";
import { AudioManager } from "./audio/AudioManager.js";
import { UnderwaterEffect } from "./shaders/UnderwaterEffect.js";
import { PreloadCoordinator } from "./PreloadCoordinator.js";
import { AbyssEncounter } from "./encounters/AbyssEncounter.js";
import { qualityManager } from "./QualityManager.js";
import { PhysicsWorld } from "./physics/PhysicsWorld.js";
import { LightingPolicy } from "./lighting/LightingPolicy.js";

const DEFAULT_RENDERER_OPTIONS = Object.freeze({
  antialias: true,
  powerPreference: "high-performance",
});

async function resolveRendererOptions() {
  const rendererOptions = { ...DEFAULT_RENDERER_OPTIONS };

  if (typeof navigator === "undefined") {
    return rendererOptions;
  }

  if (!navigator.gpu?.requestAdapter) {
    rendererOptions.forceWebGL = true;
    return rendererOptions;
  }

  try {
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: rendererOptions.powerPreference,
      featureLevel: "compatibility",
    });

    if (!adapter) {
      rendererOptions.forceWebGL = true;
      return rendererOptions;
    }
  } catch (_) {
    rendererOptions.forceWebGL = true;
    return rendererOptions;
  }

  if (typeof document === "undefined") {
    return rendererOptions;
  }

  try {
    const probeCanvas = document.createElement("canvas");
    if (!probeCanvas.getContext("webgpu")) {
      rendererOptions.forceWebGL = true;
    }
  } catch (_) {
    rendererOptions.forceWebGL = true;
  }

  return rendererOptions;
}

export class Game {
  static async resolveRendererOptions() {
    return resolveRendererOptions();
  }

  constructor(rendererOptions = {}) {
    this.clock = new THREE.Timer();
    this.clock.connect(document);
    this.scene = new THREE.Scene();
    this.running = false;
    this.pendingStart = false;
    this.startPreparing = false;
    this._streamingFrameParity = 0;

    // Renderer
    this.renderer = new THREE.WebGPURenderer({
      ...DEFAULT_RENDERER_OPTIONS,
      ...rendererOptions,
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const qSettings = qualityManager.getSettings();
    this.renderer.shadowMap.enabled = qSettings.shadowMapEnabled;
    this.renderer.shadowMap.type =
      qualityManager.tier === "ultra"
        ? THREE.PCFSoftShadowMap
        : THREE.PCFShadowMap;
    if (qualityManager.tier === "ultra") {
      this.renderer.setPixelRatio(window.devicePixelRatio);
    }
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.76;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.id = "game-canvas";
    this.renderer.domElement.dataset.testid = "game-canvas";
    document.body.appendChild(this.renderer.domElement);

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );
    this.camera.position.set(0, -5, 0);
    this.scene.add(this.camera);

    // Systems
    this.player = null;
    this.ocean = new Ocean(this.scene);
    this.terrain = new Terrain(this.scene);
    this.flora = new Flora(this.scene);
    this.creatures = new CreatureManager(this.scene);
    this.hud = new HUD();
    this.audio = new AudioManager();
    this.underwaterEffect = null;
    this.abyssEncounter = new AbyssEncounter();
    this.physicsWorld = null; // initialized async in _primeAndEnterGameplay
    this.preload = null;
    this.graphicsDiagnostics = null;

    // GPU detection and graphics diagnostics are deferred to async init()
    // because WebGPURenderer requires await renderer.init() before backend access.

    this.lightingPolicy = new LightingPolicy();
    this._pointLightBudget = {
      shallowMax: qSettings.maxPointLights,
      deepMax: Math.max(3, Math.round(qSettings.maxPointLights * 0.6)),
      transitionBand: 3,
      scanInterval: 1.1,
      minScanInterval: 0.9,
      maxScanInterval: 3.2,
      scanElapsed: 1,
      retargetInterval: 0.35,
      retargetElapsed: 1,
      fadeInRate: 8,
      fadeOutRate: 6,
      managedLights: [],
      activeLights: [],
      tempWorldPos: new THREE.Vector3(),
      heavyFrameThreshold: 0.08,
      scanCostAdjustThreshold: 1.5,
      scanCostRecoverThreshold: 0.8,
    };

    // Alias so automated tests can use game.creatureManager or game.creatures
    this.creatureManager = this.creatures;

    // Quality tier change listener
    window.addEventListener("qualitychange", (e) => {
      const s = e.detail.settings;
      const tier = e.detail.tier;
      this.renderer.shadowMap.enabled = s.shadowMapEnabled;
      this._pointLightBudget.shallowMax = s.maxPointLights;
      this._pointLightBudget.deepMax = Math.max(
        3,
        Math.round(s.maxPointLights * 0.6),
      );
      // Ultra tier: soft shadows + uncapped pixel ratio
      if (tier === "ultra") {
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
    this.menuOverlay = document.getElementById("menu");
    this.pauseOverlay = document.getElementById("paused");
    this.gameOverOverlay = document.getElementById("game-over");
    this.controlsHelpOverlay = document.getElementById("controls-help");
    this.controlsHelpVisible = false;
    this._lockLostDuringDescent = false;
    this._startupToken = 0;
    this._descentFadeTimer = null;
    this.descentOverlay = document.getElementById("descent-transition");
    this.descentProgressBar = document.getElementById("descent-progress-bar");
    this._descentItems = document.getElementById("descent-items");
    this._descentTease = document.getElementById("descent-tease");
    this._descentActive = false;
    this._descentPhase = "idle";
    this._descentLastCreatureCount = 0;
    this._descentLastTeaseTime = 0;
    this._startTransition = {
      owner: "game",
      startRequested: false,
      started: false,
    };
    this._eventsBound = false;
    // Preload warmup and event binding are deferred to async init() because
    // those paths touch renderer-dependent systems that require renderer.init().
    // _initEnvironmentColors() and _animate() are deferred to async init()
    // because PMREMGenerator and the render loop require renderer.init().
  }

  /**
   * Async initialization — must be called after construction.
   * WebGPURenderer requires `await renderer.init()` before first use.
   */
  async init() {
    await this.renderer.init();

    this.player = new Player(
      this.camera,
      this.renderer.domElement,
      this.renderer,
    );

    // Detect high-end GPU for potential ultra tier auto-select
    await qualityManager.detectGPU(this.renderer);
    // If GPU detection switched to ultra, apply renderer settings now
    if (qualityManager.tier === "ultra") {
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer.setPixelRatio(window.devicePixelRatio);
    }

    this.underwaterEffect = new UnderwaterEffect(
      this.renderer,
      this.scene,
      this.camera,
    );
    this.preload = this._createPreloadCoordinator();

    this.graphicsDiagnostics = this._detectGraphicsDiagnostics();
    // Item 9: start software/fallback renderers in a reduced post-process profile.
    if (this.graphicsDiagnostics.hardwareAccelerated === false) {
      this.underwaterEffect.applySoftwareRendererPolicy();
    }

    this._initEnvironmentColors();
    this._setupEvents();
    this.preload.startMenuIdleWarmup();
    this._animate();
  }

  _createPreloadCoordinator() {
    return new PreloadCoordinator({
      renderer: this.renderer,
      underwaterEffect: this.underwaterEffect,
      player: this.player,
      terrain: this.terrain,
      flora: this.flora,
      creatures: this.creatures,
      prepareDepthState: (depth) => {
        this.lightingPolicy.update(
          depth,
          false,
          this._fog,
          this.ocean.ambientLight,
          this.scene.background,
          this.renderer,
          this.underwaterEffect,
        );
      },
    });
  }

  _setupEvents() {
    if (this._eventsBound) return;
    this._eventsBound = true;

    window.addEventListener("resize", () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.underwaterEffect.resize();
    });

    document.addEventListener("keydown", (e) => {
      const pauseVisible = this.pauseOverlay.classList.contains("visible");

      if (
        e.code === "KeyR" &&
        (this.running || this.startPreparing || pauseVisible || this.gameOver)
      ) {
        e.preventDefault();
        this.restart();
        return;
      }

      // Autoplay mode: ESC toggles pause, but only after priming is complete
      if (
        e.code === "Escape" &&
        this.autoplay &&
        !this.gameOver &&
        !this.startPreparing
      ) {
        if (this.running || pauseVisible) {
          this._toggleAutoplayPause();
        }
        return;
      }
      if (
        (e.code === "KeyV" || (e.code === "KeyL" && e.shiftKey)) &&
        (this.running || this.pauseOverlay.classList.contains("visible"))
      ) {
        this.hud.toggleDiagnostics();
        return;
      }
      if (!this.running) return;
      if (e.code === "KeyH") this._toggleControlsHelp();
      if (e.code === "KeyF") this._toggleFlashlight();
      if (e.code === "KeyE") this._sonarPing();
      if (e.code === "KeyC") this.hud.toggleLocator();
      if (e.code === "Digit0") this.hud.stopTracking();
      if (this.hud.locatorVisible) {
        if (this.hud.handleLocatorNavigation(e.code)) {
          if (
            e.code === "ArrowUp" ||
            e.code === "ArrowDown" ||
            e.code === "Enter"
          ) {
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
          this.pauseOverlay.classList.remove("visible");
          this._resumeAudio();
        }
      } else if (this.pendingStart) {
        this.pendingStart = false;
        this._startTransition.startRequested = false;
        this._pauseAudio();
      } else if (this.startPreparing && !this.gameOver) {
        this._lockLostDuringDescent = true;
        this._pauseAudio();
      } else if (this.running && !this.gameOver) {
        this.pauseOverlay.classList.add("visible");
        this._pauseAudio();
      }
    };
    document.addEventListener("pointerlockerror", () => {
      if (!this.pendingStart) return;
      this._beginGameplayWithoutPointerLock();
    });
    this.pauseOverlay.addEventListener("click", () => {
      if (this.autoplay) {
        if (!this.startPreparing) this._toggleAutoplayPause();
      } else {
        this.player.lock();
      }
    });
  }

  start() {
    if (
      this.gameOver ||
      this.running ||
      this.pendingStart ||
      this.startPreparing ||
      this._startTransition.startRequested
    )
      return;
    this.autoplay = false;
    this.player.clearAutoplayInput();
    this._startTransition.startRequested = true;
    this.preload.cancel("user-start");
    this.pendingStart = true;
    this.pauseOverlay.classList.remove("visible");
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

    console.log("[deep-underworld] Game starting...");
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
    this.preload.cancel("autoplay-start");
    this.autoplay = true;
    this.player.locked = true; // simulate lock without real pointer lock
    this.player.euler.set(0, 0, 0, "YXZ");
    this.player.camera.quaternion.setFromEuler(this.player.euler);
    this._updateAutoplayDrive(Math.max(0, -this.player.position.y), 0);
    this.audio.start();
    void this._primeAndEnterGameplay("Autoplay mode active");
  }

  restart() {
    this._startupToken++;
    if (this._descentFadeTimer !== null) {
      clearTimeout(this._descentFadeTimer);
      this._descentFadeTimer = null;
    }

    this.preload.cancel("restart");
    this.hud.resetRuntimeState();
    this.abyssEncounter.reset(this.scene, this.lightingPolicy);
    this.gameOver = false;
    this.flashlightOn = false;
    this.maxDepth = 0;
    this.depth = 0;
    this.player.depth = 0;
    this.fps = 0;
    this._fpsFrames = 0;
    this._fpsTime = 0;
    this.pendingStart = false;
    this.running = false;
    this.startPreparing = false;
    this._lockLostDuringDescent = false;
    this._startTransition.startRequested = false;
    this._startTransition.started = false;
    this.gameOverOverlay.classList.remove("visible");
    this.controlsHelpVisible = false;
    this.controlsHelpOverlay.classList.remove("visible");
    this.player.reset();
    this.creatures.reset();
    this.player.flashlight.visible = false;
    this.pauseOverlay.classList.remove("visible");
    this._descentActive = false;
    this._descentPhase = "idle";
    this._descentLastCreatureCount = 0;
    this._descentLastTeaseTime = 0;
    this.descentOverlay.classList.remove("visible", "fade-out");
    this.lightingPolicy.update(
      0,
      false,
      this._fog,
      this.ocean.ambientLight,
      this.scene.background,
      this.renderer,
      this.underwaterEffect,
    );
    if (this.autoplay) {
      this._autoplayState = this._createAutoplayState();
      this.startAutoplay();
    } else {
      this.start();
    }
  }

  _toggleControlsHelp() {
    this.controlsHelpVisible = !this.controlsHelpVisible;
    this.controlsHelpOverlay.classList.toggle(
      "visible",
      this.controlsHelpVisible,
    );
  }

  _toggleAutoplayPause() {
    if (this.running) {
      this.running = false;
      this.pauseOverlay.classList.add("visible");
      this._pauseAudio();
    } else {
      this.running = true;
      this.pauseOverlay.classList.remove("visible");
      this._resumeAudio();
    }
  }

  _toggleFlashlight() {
    this.flashlightOn = !this.flashlightOn;
    this.player.flashlight.visible = this.flashlightOn;
  }

  _sonarPing() {
    this.hud.sonarPing(
      this.player.position,
      this.creatures.getCreaturePositions(),
    );
    this.audio.playSonar();
  }

  _beginGameplay() {
    void this._primeAndEnterGameplay("Gameplay started");
  }

  async _primeAndEnterGameplay(logMessage) {
    if (this.running || this.startPreparing || this.gameOver) return;

    const startupToken = ++this._startupToken;
    this.startPreparing = true;
    this._startTransition.startRequested = false;
    this._startTransition.started = true;
    this.pendingStart = false;
    this.menuOverlay.classList.add("hidden");
    this.gameOverOverlay.classList.remove("visible");
    this.pauseOverlay.classList.remove("visible");

    this.descentOverlay.classList.add("visible");
    this.descentOverlay.classList.remove("fade-out");
    this.descentProgressBar.style.width = "0%";
    this._descentActive = true;
    this._descentPhase = "physics";
    this._descentLastCreatureCount = 0;
    this._descentLastTeaseTime = 0;
    this._descentItems.innerHTML = "";
    this._descentTease.innerHTML = "";
    this._updateDescentProgress();
    this.underwaterEffect.beginStartupGuard();

    // Initialize Rapier WASM physics before terrain/player use it
    const physicsWorld = new PhysicsWorld();
    await physicsWorld.init();
    if (startupToken !== this._startupToken) return;

    this.physicsWorld = physicsWorld;
    this.terrain.setPhysicsWorld(physicsWorld);
    this.player.setPhysicsWorld(physicsWorld);

    this._descentPhase = "shaders";
    this._updateDescentProgress();

    const primeSummary = await this.preload.primeStartBaseline({
      onProgress: (data) => {
        if (startupToken === this._startupToken) {
          this._updateDescentProgress(data);
        }
      },
    });

    if (startupToken !== this._startupToken) return;
    if (this.gameOver) {
      this.startPreparing = false;
      return;
    }

    this.preload.startDescentAssistFromSnapshot();

    this.running = true;
    this.startPreparing = false;

    if (this._lockLostDuringDescent) {
      this._lockLostDuringDescent = false;
      this.pauseOverlay.classList.add("visible");
    } else {
      this._resumeAudio();
    }
    await this._warmOpeningFrames({
      onProgress: (data) => {
        if (startupToken === this._startupToken) {
          this._updateDescentProgress(data);
        }
      },
    });
    if (startupToken !== this._startupToken) return;

    // Dismiss descent overlay only after the first live gameplay frames have
    // rendered, so the player does not inherit opening-frame shader stalls.
    this._descentActive = false;
    this.descentOverlay.classList.add("fade-out");
    this._descentFadeTimer = setTimeout(() => {
      if (startupToken !== this._startupToken) return;
      this.descentOverlay.classList.remove("visible");
      this.descentOverlay.classList.remove("fade-out");
      this._descentFadeTimer = null;
    }, 800);

    console.log(`[deep-underworld] ${logMessage}`, primeSummary);
  }

  async _warmOpeningFrames({ onProgress } = {}) {
    const requiredResponsiveFrames = 6;
    let responsiveFrames = 0;
    for (let i = 0; i < 180; i++) {
      await new Promise((resolve) =>
        window.requestAnimationFrame(() => resolve()),
      );
      const startupGuard = this.underwaterEffect.getStartupGuardStatus();
      if (this.underwaterEffect.isStartupResponsive()) {
        responsiveFrames++;
        if (responsiveFrames >= requiredResponsiveFrames) {
          onProgress?.({
            phase: "opening",
            openingFrames: {
              responsiveFrames,
              requiredResponsiveFrames,
              guardActive: startupGuard.active,
              guardStableFrames: startupGuard.stableFrames,
              guardRequiredFrames: startupGuard.requiredFrames,
              guardRemainingMs: startupGuard.remainingMs,
            },
          });
          break;
        }
      } else {
        responsiveFrames = 0;
      }
      onProgress?.({
        phase: "opening",
        openingFrames: {
          responsiveFrames,
          requiredResponsiveFrames,
          guardActive: startupGuard.active,
          guardStableFrames: startupGuard.stableFrames,
          guardRequiredFrames: startupGuard.requiredFrames,
          guardRemainingMs: startupGuard.remainingMs,
        },
      });
    }
  }

  _updateDescentProgress(data) {
    // Update phase from PreloadCoordinator progress data
    if (data && data.phase) {
      if (data.phase === "loading") this._descentPhase = "loading";
      else if (data.phase === "finalizing") this._descentPhase = "finalizing";
      else if (data.phase === "opening") this._descentPhase = "opening";
    }

    // Composite progress spans the full startup pipeline so the bar does not
    // look complete before render warmup and live-render stabilization finish.
    const creatures = data?.primeCreatures || this.creatures.getLoadProgress();
    const terrainPending = this.terrain.getPendingCount();
    const terrainLoaded = this.terrain.getChunkCount();
    const terrainTotal = terrainLoaded + terrainPending;
    const floraPending = this.flora.getPendingCount();
    const floraLoaded = this.flora.getChunkCount();
    const floraTotal = floraLoaded + floraPending;
    const finalization = data?.finalization || null;
    const opening = data?.openingFrames || null;

    const phase = this._descentPhase;
    const physicsDone = phase !== "physics";
    const shadersDone = phase !== "physics" && phase !== "shaders";
    const finalizationDone = phase === "opening" || !this._descentActive;
    const openingDone = !this._descentActive;

    const creaturePct =
      creatures.total > 0 ? creatures.loaded / creatures.total : 1;
    const terrainPct = terrainTotal > 0 ? terrainLoaded / terrainTotal : 1;
    const floraPct = floraTotal > 0 ? floraLoaded / floraTotal : 1;
    const finalizationStepTotal = Math.max(1, finalization?.stepTotal || 4);
    const finalizationStepIndex =
      phase === "finalizing"
        ? Math.max(
            1,
            Math.min(finalization?.stepIndex || 1, finalizationStepTotal),
          )
        : finalizationDone
          ? finalizationStepTotal
          : 0;
    const finalizationStepPct =
      phase === "finalizing"
        ? finalization?.total > 0
          ? Math.max(
              0,
              Math.min(1, (finalization?.current || 0) / finalization.total),
            )
          : Math.max(0, Math.min(1, finalization?.current || 0))
        : finalizationDone
          ? 1
          : 0;
    const finalizationPct =
      finalizationStepIndex > 0
        ? Math.min(
            1,
            (finalizationStepIndex - 1 + finalizationStepPct) /
              finalizationStepTotal,
          )
        : 0;
    const openingPct =
      phase === "opening"
        ? Math.max(
            0,
            Math.min(
              1,
              (opening?.responsiveFrames || 0) /
                Math.max(1, opening?.requiredResponsiveFrames || 0),
            ),
          )
        : openingDone
          ? 1
          : 0;

    const physicsPct = physicsDone ? 1 : 0;
    const shaderPct = shadersDone ? 1 : phase === "shaders" ? 0.5 : 0;

    const pct = Math.min(
      100,
      (physicsPct * 0.05 +
        shaderPct * 0.1 +
        creaturePct * 0.2 +
        terrainPct * 0.12 +
        floraPct * 0.08 +
        finalizationPct * 0.3 +
        openingPct * 0.15) *
        100,
    );
    this.descentProgressBar.style.width = pct + "%";

    const formatProgressLabel = (label, current, total, unit) => {
      if (total <= 0) return `${label}...`;
      return `${label}... ${current}/${total}${unit ? ` ${unit}` : ""}`;
    };
    const finalizationStepOneActive =
      phase === "finalizing" && finalizationStepIndex === 1;
    const finalizationStepTwoActive =
      phase === "finalizing" && finalizationStepIndex === 2;
    const finalizationStepThreeActive =
      phase === "finalizing" && finalizationStepIndex === 3;
    const finalizationStepFourActive =
      phase === "finalizing" && finalizationStepIndex === 4;
    let openingLabel = "Stabilizing live render...";
    if (phase === "opening" && opening) {
      openingLabel = `Stabilizing live render... ${opening.responsiveFrames}/${opening.requiredResponsiveFrames} stable frames`;
      if (opening.guardActive) {
        openingLabel += ` (${Math.ceil(opening.guardRemainingMs)}ms guard)`;
      }
    }

    // Keep every startup stage visible from the beginning so the player can
    // see that shader/terrain/flora loading is only part of the startup work.
    const items = [
      {
        id: "physics",
        label: "Initializing physics...",
        done: physicsDone,
        active: phase === "physics",
      },
      {
        id: "shaders",
        label: "Compiling shaders...",
        done: shadersDone,
        active: phase === "shaders",
      },
      {
        id: "creatures",
        done: shadersDone && creaturePct >= 1,
        active: phase === "loading" && shadersDone && creaturePct < 1,
        label:
          creatures.total > 0
            ? `Spawning nearby creatures... ${creatures.loaded}/${creatures.total}`
            : "Spawning nearby creatures...",
      },
      {
        id: "terrain",
        done: shadersDone && terrainPct >= 1,
        active: phase === "loading" && shadersDone && terrainPct < 1,
        label:
          terrainTotal > 0
            ? `Generating terrain... ${terrainLoaded}/${terrainTotal} chunks`
            : "Generating terrain...",
      },
      {
        id: "flora",
        done: shadersDone && floraPct >= 1,
        active: phase === "loading" && shadersDone && floraPct < 1,
        label:
          floraTotal > 0
            ? `Growing flora... ${floraLoaded}/${floraTotal} chunks`
            : "Growing flora...",
      },
      {
        id: "finish-nearby",
        label: finalizationStepOneActive
          ? formatProgressLabel(
              "Finishing nearby spawns",
              finalization?.current || 0,
              finalization?.total || 0,
              finalization?.unit || "creatures",
            )
          : "Finishing nearby spawns...",
        done: finalizationDone || finalizationStepIndex > 1,
        active: finalizationStepOneActive,
      },
      {
        id: "warm-views",
        label: finalizationStepTwoActive
          ? formatProgressLabel(
              "Warming representative views",
              finalization?.current || 0,
              finalization?.total || 0,
              finalization?.unit || "views",
            )
          : "Warming representative views...",
        done: finalizationDone || finalizationStepIndex > 2,
        active: finalizationStepTwoActive,
      },
      {
        id: "showcase-creatures",
        label: finalizationStepThreeActive
          ? formatProgressLabel(
              "Showcasing creature shaders",
              finalization?.current || 0,
              finalization?.total || 0,
              finalization?.unit || "types",
            )
          : "Showcasing creature shaders...",
        done: finalizationDone || finalizationStepIndex > 3,
        active: finalizationStepThreeActive,
      },
      {
        id: "handoff",
        label: finalizationStepFourActive
          ? formatProgressLabel(
              "Handing off to live render",
              finalization?.current || 0,
              finalization?.total || 0,
              finalization?.unit || "frames",
            )
          : "Handing off to live render...",
        done: finalizationDone,
        active: finalizationStepFourActive,
      },
      {
        id: "opening",
        label: openingLabel,
        done: openingDone,
        active: phase === "opening" && this._descentActive,
      },
    ];

    let html = "";
    for (const item of items) {
      const cls = item.done
        ? "descent-item done"
        : item.active
          ? "descent-item active"
          : "descent-item";
      const check = item.done ? "✓" : item.active ? "◦" : " ";
      html += `<div class="${cls}"><span class="descent-item-check">${check}</span><span class="descent-item-text">${item.label}</span></div>`;
    }
    this._descentItems.innerHTML = html;

    // Creature tease
    if (
      data &&
      data.creatures &&
      data.creatures.loaded > this._descentLastCreatureCount
    ) {
      const now = performance.now();
      if (now - this._descentLastTeaseTime > 2000) {
        this._descentLastTeaseTime = now;
        this._showCreatureTease(data.creatures);
      }
      this._descentLastCreatureCount = data.creatures.loaded;
    }
  }

  _showCreatureTease(creaturesProgress) {
    const teaseMap = {
      jellyfish: "Bioluminescent pulses detected...",
      anglerfish: "Something lurks in the dark...",
      ghostshark: "Spectral signatures nearby...",
      leviathan: "Massive sonar returns detected...",
      deepone: "Unknown life forms below...",
      boneworm: "Biomechanical signatures emerging...",
      spinaleel: "Writhing movement in the deep...",
      sirenSkull: "Haunting frequencies detected...",
      lamprey: "Parasitic organisms detected...",
      abyssalmaw: "The abyss stares back...",
      biomechcrab: "Metallic scuttling detected...",
      needlefish: "Swift shadows in the current...",
      parasite: "Symbiotic life forms nearby...",
      sporecloud: "Spore density increasing...",
      tendrilhunter: "Tendrils probing the darkness...",
      harvester: "Industrial sounds echoing...",
      birthsac: "Organic growths pulsing...",
      voidjelly: "Void signatures detected...",
      chaindragger: "Metal scraping in the deep...",
      mechoctopus: "Mechanical appendages detected...",
      facelessone: "Something without a face watches...",
      amalgam: "Merged forms stirring...",
      sentinel: "Guardian presence detected...",
      abysswraith: "Wraith-like movement detected...",
      ironwhale: "Massive metallic echoes...",
      husk: "Empty shells drifting...",
      pipeorgan: "Deep resonance detected...",
      tubecluster: "Tube formations growing...",
      ribcage: "Skeletal structures detected...",
    };

    // Try to find what creature type was last spawned
    const spawned = this.creatures.creatures || [];
    let msg = "Scanning the deep...";
    for (let i = spawned.length - 1; i >= 0; i--) {
      const key = spawned[i].type;
      if (teaseMap[key]) {
        msg = teaseMap[key];
        break;
      }
    }

    this._descentTease.innerHTML = `<span>${msg}</span>`;
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

    this.clock.update();
    const rawDt = this.clock.getDelta();
    const dt = Math.min(rawDt, 0.05);
    qualityManager.updateFrameTime(rawDt);
    if (
      !this.running ||
      this.gameOver ||
      (!this.player.locked && !this.autoplay)
    )
      return;

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
      this._streamingFrameParity = (this._streamingFrameParity + 1) % 2;
      const _allowTerrainChunkWork = this._streamingFrameParity === 0;
      const _allowFloraChunkWork = !_allowTerrainChunkWork;
      this.terrain.update(this.player.position, _allowTerrainChunkWork);
      this.flora.update(dt, this.player.position, _allowFloraChunkWork);
      const _initElapsed = performance.now() - _initStart;
      const _spawnBudget = Math.max(0, 12 - _initElapsed);
      const _descentAssistActive = this.preload.isDescentAssistActive();
      const _effectiveSpawnBudget = _descentAssistActive ? 0 : _spawnBudget;
      this.creatures.update(
        dt,
        this.player.position,
        depth,
        _effectiveSpawnBudget,
      );

      const nearestCreatureDist = this.creatures.getNearestCreatureDistance(
        this.player.position,
      );

      // Depth tracking
      if (depth > this.maxDepth) this.maxDepth = depth;

      // Update HUD
      const creaturesByType = this.creatures.getCreaturesByType(
        this.player.position,
      );
      this.hud.update(depth, this.flashlightOn, this.camera);
      this.hud.updateLocator(
        creaturesByType,
        this.player.position,
        this.camera,
      );
      this.hud.updateBackgroundLoading(this.preload.isDescentAssistActive());

      // Evaluate depth-zone base, let encounter set modifiers, then apply
      this.lightingPolicy.evaluateBase(depth, this.flashlightOn);
      this.abyssEncounter.update(
        dt,
        depth,
        this.player,
        this.scene,
        this.lightingPolicy,
        this.hud,
        this.audio,
      );
      this.lightingPolicy.applyToScene(
        depth,
        this.flashlightOn,
        this._fog,
        this.ocean.ambientLight,
        this.scene.background,
        this.renderer,
        this.underwaterEffect,
      );

      this.audio.update(dt, {
        depth,
        nearestCreatureDist,
        encounterState: this.abyssEncounter.getAudioState(),
      });

      this._updatePointLightBudget(dt, depth, this.player.position);

      // Keep descent assist pumping in both regular and autoplay starts,
      // but only when the frame hasn't already spent its initialization budget
      // on terrain/flora/creature work.
      if (performance.now() - _initStart < 14) {
        this.preload.pumpDescentAssist();
      }

      // Render with post-processing
      this.underwaterEffect.render(depth, {
        flashlightOn: this.flashlightOn,
        exposure: this.renderer.toneMappingExposure,
      });

      if (this.hud.isDiagnosticsVisible()) {
        this.hud.updateDiagnostics(this._getDiagnosticsSnapshot());
      }
    } catch (err) {
      console.error("[deep-underworld] Animation frame error:", err);
    }
  }

  _initEnvironmentColors() {
    // Keep legacy Fog object as a data carrier for volumetric beam uniforms
    // (fog.color/near/far are read by Player.updateFogUniforms each frame).
    // Scene rendering uses the TSL fogNode set by Ocean.
    this._fog = new THREE.Fog(0x006994, 5, 300);

    // Connect Ocean's fogNode uniforms to LightingPolicy for per-frame updates
    this.lightingPolicy.setFogNodeUniforms(
      this.ocean.fogDensity,
      this.ocean.fogColorNode,
    );

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
      const backend = this.renderer.backend;
      const isWebGL = backend && backend.isWebGLBackend;

      if (isWebGL) {
        // WebGL fallback mode — use traditional GL context
        const gl = backend.gl;
        if (!gl) {
          return {
            context: "webgl",
            vendor: "Unknown",
            renderer: "Unavailable",
            hardwareAccelerated: null,
            hardwareAcceleratedLabel: "Unknown",
          };
        }
        const context =
          typeof WebGL2RenderingContext !== "undefined" &&
          gl instanceof WebGL2RenderingContext
            ? "webgl2"
            : "webgl1";
        const ext = gl.getExtension?.("WEBGL_debug_renderer_info");
        const vendor = ext
          ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)
          : gl.getParameter(gl.VENDOR);
        const renderer = ext
          ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
          : gl.getParameter(gl.RENDERER);
        const normalized = `${vendor ?? ""} ${renderer ?? ""}`.toLowerCase();
        const softwareRenderer = [
          "swiftshader",
          "llvmpipe",
          "software",
          "softpipe",
          "mesa offscreen",
        ].some((token) => normalized.includes(token));
        const hardwareAccelerated = !softwareRenderer;

        return {
          context,
          vendor: vendor || "Unknown",
          renderer: renderer || "Unavailable",
          hardwareAccelerated,
          hardwareAcceleratedLabel: hardwareAccelerated
            ? "Hardware accelerated"
            : "Software / fallback",
        };
      }

      // WebGPU backend
      return {
        context: "webgpu",
        vendor: "WebGPU",
        renderer: "WebGPU Backend",
        hardwareAccelerated: true,
        hardwareAcceleratedLabel: "Yes (WebGPU)",
      };
    } catch (_) {
      return {
        context: "unknown",
        vendor: "Unknown",
        renderer: "Unavailable",
        hardwareAccelerated: null,
        hardwareAcceleratedLabel: "Unknown",
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
      lighting: this.lightingPolicy.getDiagnostics(),
      pointLights: this._getPointLightBudgetDiagnostics(),
      graphics: this.graphicsDiagnostics,
      postProcess: this.underwaterEffect.getDiagnostics(),
    };
  }

  _getPointLightBudgetDiagnostics() {
    const budget = this._pointLightBudget;
    const depthBlend = THREE.MathUtils.smoothstep(this.depth, 35, 220);
    const maxLights = Math.round(
      THREE.MathUtils.lerp(budget.shallowMax, budget.deepMax, depthBlend),
    );
    const managedCategories = {};
    const activeCategories = {};
    let managedCount = 0;
    let activeCount = 0;

    for (const light of budget.managedLights) {
      if (!light.parent) continue;
      managedCount++;
      const category = light.userData.duwCategory ?? "uncategorized";
      managedCategories[category] = (managedCategories[category] ?? 0) + 1;

      if ((light.userData.duwTargetIntensity ?? 0) > 0.01) {
        activeCount++;
        activeCategories[category] = (activeCategories[category] ?? 0) + 1;
      }
    }

    return {
      managedCount,
      activeCount,
      maxLights,
      transitionBand: budget.transitionBand,
      scanInterval: budget.scanInterval,
      retargetInterval: budget.retargetInterval,
      managedCategories,
      activeCategories,
    };
  }

  _createAutoplayState() {
    return {
      // State machine — current behavior mode
      mode: "descend", // 'descend' | 'recover' | 'sonar' | 'showcase'

      // Descent drive parameters
      minForward: 0.12,
      maxForward: 0.3,

      // Heading drift: periodic gentle yaw so descent isn't perfectly straight
      headingTimer: 0,
      headingInterval: 7, // seconds between heading drift changes
      headingDrift: 0, // current right input for drift (-1..1)
      headingDriftDuration: 0, // how long to hold current drift
      headingDriftElapsed: 0,
      look: {
        basePitch: 0.02,
        recoveryPitch: 0.18,
        turnRate: 0.55,
        recoveryTurnRate: 1.1,
        response: 4,
      },

      // Progress watchdog (issue #102)
      watchdog: {
        checkInterval: 2.5,
        checkElapsed: 0,
        lastDepth: 0,
        lastClearDepth: 0,
        lastX: 0,
        lastZ: 0,
        stallTime: 0,
        depthStallTime: 0,
        stallThreshold: 4, // seconds stalled before recovery
        depthStallThreshold: 6, // seconds skimming sideways without descending
        depthClearMargin: 1.5, // must beat the prior local max by this much to clear a stall
        depthGainMin: 0.15, // metres gained to count as progress
        posGainMin: 0.25, // world-unit change to count as progress
        recoveryGraceDuration: 4.5,
        recoveryGraceTime: 0,
      },

      // Recovery state
      recover: {
        active: false,
        timer: 0,
        duration: 3.5, // seconds of recovery steering
        rightInput: 1, // direction to steer out
        turnDirection: 1,
        attempts: 0,
        lastTriggerDepth: 0,
        lastTriggerX: 0,
        lastTriggerZ: 0,
        samePocketDepth: 14,
        samePocketDistance: 24,
      },

      // Sonar showcase
      sonar: {
        timer: 0,
        interval: 22, // seconds between autoplay sonar pings
        minDepth: 40, // don't ping in the very shallow zone
      },

      // Flashlight showcase
      flashlight: {
        timer: 0,
        interval: 35, // seconds between autoplay flashlight toggles
        minDepth: 120, // only below twilight zone
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
      if (
        autoplayInput.forward !== 0 ||
        autoplayInput.right !== 0 ||
        autoplayInput.vertical !== 0
      ) {
        this.player.clearAutoplayInput();
      }
      return;
    }

    const s = this._autoplayState;
    const wd = s.watchdog;
    const rec = s.recover;

    // ─── Progress watchdog (issue #102) ───────────────────────────────────
    wd.recoveryGraceTime = Math.max(0, wd.recoveryGraceTime - dt);
    wd.checkElapsed += dt;
    if (wd.checkElapsed >= wd.checkInterval) {
      wd.checkElapsed = 0;
      const px = this.player.position.x;
      const pz = this.player.position.z;
      if (wd.recoveryGraceTime > 0) {
        wd.stallTime = 0;
        wd.depthStallTime = 0;
        wd.lastDepth = depth;
        wd.lastClearDepth = depth;
        wd.lastX = px;
        wd.lastZ = pz;
      } else {
        const depthGain = depth - wd.lastDepth;
        const posChange = Math.sqrt(
          (px - wd.lastX) ** 2 + (pz - wd.lastZ) ** 2,
        );
        const depthProgress = depthGain >= wd.depthGainMin;
        const lateralProgress = posChange >= wd.posGainMin;
        if (depthProgress || lateralProgress) {
          wd.stallTime = 0;
        } else {
          wd.stallTime += wd.checkInterval;
        }
        if (depth >= wd.lastClearDepth + wd.depthClearMargin) {
          wd.lastClearDepth = depth;
          wd.depthStallTime = 0;
        } else {
          wd.depthStallTime += wd.checkInterval;
        }
        wd.lastDepth = depth;
        wd.lastX = px;
        wd.lastZ = pz;

        // Trigger recovery when stalled long enough and not already recovering
        const stalledOnDepth = wd.depthStallTime >= wd.depthStallThreshold;
        if (
          (wd.stallTime >= wd.stallThreshold || stalledOnDepth) &&
          !rec.active
        ) {
          const samePocket =
            Math.abs(depth - rec.lastTriggerDepth) <= rec.samePocketDepth &&
            Math.hypot(px - rec.lastTriggerX, pz - rec.lastTriggerZ) <=
              rec.samePocketDistance;
          rec.active = true;
          rec.timer = 0;
          rec.attempts = samePocket ? Math.min(rec.attempts + 1, 4) : 1;
          rec.duration = THREE.MathUtils.lerp(
            4.2,
            6.4,
            Math.min(1, (rec.attempts - 1) / 3),
          );
          // Randomise recovery direction each stall to reduce chance of re-hitting the same wall
          rec.rightInput = Math.random() < 0.5 ? 1 : -1;
          rec.turnDirection = rec.rightInput;
          rec.lastTriggerDepth = depth;
          rec.lastTriggerX = px;
          rec.lastTriggerZ = pz;
          wd.stallTime = 0;
          wd.depthStallTime = 0;
          wd.recoveryGraceTime = 0;
          this.player.velocity.set(0, 0, 0);
          let nudgeMode = "none";
          if (stalledOnDepth || (samePocket && rec.attempts >= 2)) {
            this.player.autoplayCollisionBypassTimer = Math.max(
              this.player.autoplayCollisionBypassTimer || 0,
              rec.duration + 1,
            );
            nudgeMode = this._applyAutoplayRecoveryNudge(
              rec.turnDirection,
              rec.attempts,
            );
          }
          wd.lastDepth = Math.max(0, -this.player.position.y);
          wd.lastClearDepth = wd.lastDepth;
          wd.lastX = this.player.position.x;
          wd.lastZ = this.player.position.z;
          console.log("[autoplay] Stall detected — entering recovery", {
            depth,
            attempts: rec.attempts,
            nudgeMode,
          });
        }
      }
    }

    // ─── Recovery steering (issue #102) ───────────────────────────────────
    if (rec.active) {
      rec.timer += dt;
      if (rec.timer >= rec.duration) {
        rec.active = false;
        wd.recoveryGraceTime = wd.recoveryGraceDuration;
        wd.checkElapsed = 0;
        wd.lastDepth = depth;
        wd.lastClearDepth = depth;
        wd.lastX = this.player.position.x;
        wd.lastZ = this.player.position.z;
        console.log("[autoplay] Recovery complete — resuming descent");
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
      const nearDist = this.creatures.getNearestCreatureDistance(
        this.player.position,
      );
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
      THREE.MathUtils.smoothstep(depth, 8, 80),
    );

    let forwardInput = forward;
    let rightInput = driftInput;
    let verticalInput = -1; // default: descend
    let turnRate = driftInput * s.look.turnRate;
    let pitchTarget = s.look.basePitch;

    if (rec.active) {
      // Recovery: back out, ascend briefly, then sweep into a new heading.
      const recoverProgress = THREE.MathUtils.clamp(
        rec.timer / rec.duration,
        0,
        1,
      );
      const attemptBlend = Math.min(1, Math.max(0, (rec.attempts - 1) / 3));
      const backoffPhase = recoverProgress < 0.42;

      rightInput =
        rec.rightInput * THREE.MathUtils.lerp(0.85, 1.0, attemptBlend);
      turnRate =
        rec.turnDirection *
        THREE.MathUtils.lerp(
          s.look.recoveryTurnRate,
          s.look.recoveryTurnRate * 1.55,
          attemptBlend,
        );
      pitchTarget = THREE.MathUtils.lerp(
        s.look.recoveryPitch,
        s.look.basePitch,
        THREE.MathUtils.smoothstep(recoverProgress, 0.35, 1),
      );

      if (backoffPhase) {
        forwardInput = THREE.MathUtils.lerp(-0.55, -0.8, attemptBlend);
        verticalInput = THREE.MathUtils.lerp(0.45, 0.8, attemptBlend);
      } else {
        forwardInput = THREE.MathUtils.lerp(0.18, 0.38, attemptBlend);
        verticalInput = THREE.MathUtils.lerp(-0.12, -0.42, attemptBlend);
      }
    } else if (s.showcase.active) {
      // Creature framing: blend in a gentle turn
      rightInput = THREE.MathUtils.lerp(driftInput, s.showcase.rightInput, 0.6);
      turnRate =
        THREE.MathUtils.lerp(driftInput, s.showcase.rightInput, 0.6) *
        s.look.turnRate;
    }

    const lookAlpha = Math.min(1, dt * s.look.response);
    this.player.euler.x = THREE.MathUtils.lerp(
      this.player.euler.x,
      pitchTarget,
      lookAlpha,
    );
    this.player.euler.y -= turnRate * dt;
    this.player.euler.z = THREE.MathUtils.lerp(
      this.player.euler.z,
      0,
      lookAlpha,
    );
    this.player.camera.quaternion.setFromEuler(this.player.euler);

    this.player.setAutoplayInput({
      forward: forwardInput,
      right: rightInput,
      vertical: verticalInput,
    });
  }

  _applyAutoplayRecoveryNudge(turnDirection, attempts) {
    const forward = this.player.position.clone().set(0, 0, 0);
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 0.0001) {
      forward.set(0, 0, -1);
    } else {
      forward.normalize();
    }

    const right = this.player.position.clone().set(0, 0, 0);
    right.crossVectors(forward, this.camera.up).normalize();

    const strength = Math.min(1, Math.max(0, (attempts - 2) / 2));
    const desired = forward.multiplyScalar(
      THREE.MathUtils.lerp(-10, -16, strength),
    );
    desired.addScaledVector(
      right,
      turnDirection * THREE.MathUtils.lerp(12, 18, strength),
    );
    desired.y = THREE.MathUtils.lerp(8, 12, strength);

    let corrected = desired;
    let nudgeMode = "direct";
    if (this.physicsWorld && this.player._physicsCollider) {
      corrected = this.physicsWorld.computeMovement(
        this.player._physicsCollider,
        {
          x: desired.x,
          y: desired.y,
          z: desired.z,
        },
      );
      nudgeMode = "corrected";
    }

    const movedSq =
      corrected.x * corrected.x +
      corrected.y * corrected.y +
      corrected.z * corrected.z;
    const desiredSq =
      desired.x * desired.x + desired.y * desired.y + desired.z * desired.z;
    if (attempts >= 2 && movedSq < desiredSq * 0.2) {
      corrected = desired;
      nudgeMode = "direct";
    } else if (movedSq < 0.25) {
      return "blocked";
    }

    this.player.position.x += corrected.x;
    this.player.position.y += corrected.y;
    this.player.position.z += corrected.z;

    if (this.player._physicsBody) {
      this.player._physicsBody.setNextKinematicTranslation({
        x: this.player.position.x,
        y: this.player.position.y,
        z: this.player.position.z,
      });
    }

    return nudgeMode;
  }

  _updatePointLightBudget(dt, depth, playerPos) {
    const budget = this._pointLightBudget;

    // If the current frame is already heavy, defer point-light management work
    // so we don't compound stalls with extra traversal/sorting cost.
    if (dt > budget.heavyFrameThreshold) {
      budget.scanElapsed = Math.min(
        budget.scanElapsed + dt * 0.5,
        budget.scanInterval,
      );
      budget.retargetElapsed = Math.min(
        budget.retargetElapsed + dt * 0.5,
        budget.retargetInterval,
      );
      return;
    }

    budget.scanElapsed += dt;
    budget.retargetElapsed += dt;

    if (
      budget.scanElapsed >= budget.scanInterval ||
      budget.managedLights.length === 0
    ) {
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
      const targetIntensity =
        light.userData.duwTargetIntensity ?? baseIntensity;

      if (targetIntensity > 0.001 && !light.visible) {
        light.visible = true;
      }

      const alpha =
        targetIntensity >= light.intensity ? fadeInAlpha : fadeOutAlpha;
      light.intensity = THREE.MathUtils.lerp(
        light.intensity,
        targetIntensity,
        alpha,
      );

      if (
        targetIntensity <= 0.001 &&
        light.intensity < Math.max(baseIntensity * 0.18, 0.05)
      ) {
        light.intensity = 0;
        light.visible = false;
      }
    }
  }

  _refreshManagedPointLights() {
    const budget = this._pointLightBudget;
    const managedLights = budget.managedLights;
    managedLights.length = 0;
    const refreshStart = performance.now();

    this.scene.traverse((obj) => {
      if (!obj.isPointLight) return;
      if (obj === this.player.subLight) return;
      const cat = obj.userData.duwCategory;
      if (cat === "player_practical" || cat === "player_headlight") return;

      if (obj.userData.duwBaseIntensity === undefined) {
        obj.userData.duwBaseIntensity = obj.intensity;
      }
      if (obj.userData.duwTargetIntensity === undefined) {
        obj.userData.duwTargetIntensity = obj.intensity;
      }

      managedLights.push(obj);
    });

    const refreshCost = performance.now() - refreshStart;
    if (refreshCost > budget.scanCostAdjustThreshold) {
      budget.scanInterval = Math.min(
        budget.maxScanInterval,
        budget.scanInterval + 0.25,
      );
    } else if (refreshCost < budget.scanCostRecoverThreshold) {
      budget.scanInterval = Math.max(
        budget.minScanInterval,
        budget.scanInterval - 0.05,
      );
    }
  }

  _retargetPointLights(depth, playerPos) {
    const budget = this._pointLightBudget;
    const depthBlend = THREE.MathUtils.smoothstep(depth, 35, 220);
    const maxLights = Math.round(
      THREE.MathUtils.lerp(budget.shallowMax, budget.deepMax, depthBlend),
    );

    for (const light of budget.managedLights) {
      if (!light.parent) continue;

      const baseIntensity = light.userData.duwBaseIntensity ?? light.intensity;
      const worldPos = light.getWorldPosition(budget.tempWorldPos);
      const distanceSq = worldPos.distanceToSquared(playerPos);
      // Hysteresis: boost score for currently-active lights to prevent flip-flopping
      const isActive = (light.userData.duwTargetIntensity ?? 0) > 0.01;
      const hysteresis = isActive ? 1.2 : 1.0;
      // Category priority tiebreaker: encounter_hero > creature_bio > flora_decor
      const catPriority =
        light.userData.duwCategory === "encounter_hero"
          ? 1.15
          : light.userData.duwCategory === "creature_bio"
            ? 1.1
            : light.userData.duwCategory === "flora_decor"
              ? 1.05
              : 1.0;
      light.userData.duwScore =
        ((baseIntensity + 0.001) / (distanceSq + 1)) * hysteresis * catPriority;
      light.userData.duwTargetIntensity = 0;
    }

    const candidates = budget.activeLights;
    candidates.length = 0;
    for (const light of budget.managedLights) {
      if (light.parent) {
        candidates.push(light);
      }
    }
    candidates.sort(
      (a, b) => (b.userData.duwScore ?? 0) - (a.userData.duwScore ?? 0),
    );

    const fullyLitCount = Math.min(maxLights, candidates.length);
    const fadeStartIndex = Math.max(fullyLitCount - 1, 0);
    const fadeEndIndex = fullyLitCount + budget.transitionBand;
    const cutoffIndex = Math.max(fullyLitCount - 1, 0);
    const softCutoffIndex = Math.min(
      candidates.length - 1,
      cutoffIndex + budget.transitionBand,
    );
    const cutoffScore = candidates[cutoffIndex]?.userData.duwScore ?? 0;
    const softCutoffScore =
      candidates[softCutoffIndex]?.userData.duwScore ?? cutoffScore;

    for (let i = 0; i < candidates.length; i++) {
      const light = candidates[i];
      const baseIntensity = light.userData.duwBaseIntensity ?? 0;
      const score = light.userData.duwScore ?? 0;
      let weight = 0;

      if (i < fullyLitCount) {
        weight = 1;
      } else if (i < fadeEndIndex) {
        const rankWeight =
          1 - THREE.MathUtils.smoothstep(fadeStartIndex, fadeEndIndex, i);
        if (cutoffScore > 0) {
          const scoreWeight = THREE.MathUtils.smoothstep(
            softCutoffScore * 0.9,
            cutoffScore * 1.05,
            score,
          );
          weight = rankWeight * scoreWeight;
        } else {
          weight = rankWeight;
        }
      }

      light.userData.duwTargetIntensity = baseIntensity * weight;
    }
  }
}
