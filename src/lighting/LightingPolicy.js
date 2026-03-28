import * as THREE from 'three';

/**
 * Authoritative depth-zone thresholds shared by the lighting policy and
 * underwater post-FX pipeline. Editing these values is the single tuning
 * surface for depth-zone boundaries.
 */
export const DEPTH_THRESHOLDS = Object.freeze({
  mid: 130,
  deep: 340,
  abyss: 720,
});

/**
 * Centralized depth-zone lighting profiles.
 * Single source of truth for fog, ambient, and exposure parameters.
 * Depth-zone tuning (#184, #185) can be done by editing this data.
 */
export const DEPTH_ZONE_PROFILES = Object.freeze({
  fog: Object.freeze({
    colors: Object.freeze({
      surface: 0x006b8f,
      twilight: 0x003352,
      darkZone: 0x081018,
      abyss: 0x030608,
    }),
    bands: Object.freeze({
      twilight: Object.freeze({ start: 35, end: 210 }),
      darkZone: Object.freeze({ start: 170, end: 520 }),
      abyss: Object.freeze({ start: 430, end: 900 }),
    }),
    near: Object.freeze({ surface: 5.0, twilight: 3.0, darkZone: 1.5, abyss: 0.5 }),
    far: Object.freeze({ surface: 240, twilight: 160, darkZone: 85, abyss: 55 }),
  }),
  ambient: Object.freeze({
    surface: 0.24,
    twilight: 0.16,
    darkZone: 0.09,
    abyss: 0.055,
  }),
  exposure: Object.freeze({
    surface: 0.76,
    mid: 0.68,
    deep: 0.6,
    abyss: 0.56,
    flashlightBoost: 0.16,
    easing: 0.08,
  }),
  flashlightFogPush: Object.freeze({
    depthRange: Object.freeze({ start: 100, end: 600 }),
    nearAdd: Object.freeze({ min: 0.5, max: 3 }),
    farAdd: Object.freeze({ min: 8, max: 38 }),
  }),
});

/**
 * Centralized lighting-policy engine.
 *
 * Evaluates depth-zone profiles, applies encounter/effect modifiers, and
 * writes fog, ambient, background, and exposure to scene state in a single
 * per-frame update call.
 *
 * Encounters contribute named modifiers instead of directly mutating scene
 * state. The policy blends active modifiers on top of the base profile.
 */
export class LightingPolicy {
  constructor() {
    this.profiles = DEPTH_ZONE_PROFILES;
    this.depthThresholds = DEPTH_THRESHOLDS;

    this._modifiers = new Map();

    // Pre-allocated color temporaries (zero per-frame GC pressure)
    this._fogColor = new THREE.Color();
    this._colorA = new THREE.Color();
    this._colorB = new THREE.Color();
    this._colorC = new THREE.Color();
    this._colorD = new THREE.Color();

    // Base profile results (before modifiers)
    this._baseFogNear = 5;
    this._baseFogFar = 300;
    this._baseAmbient = 0.24;

    // Exposure state
    this._targetExposure = DEPTH_ZONE_PROFILES.exposure.surface;
  }

  /**
   * Register or update a named modifier overlay.
   *
   * Modifiers blend on top of the base depth-zone profile each frame.
   * @param {string} id
   * @param {{ fogNear?: number, fogFar?: number, ambientIntensity?: number, weight: number }} modifier
   */
  setModifier(id, modifier) {
    this._modifiers.set(id, modifier);
  }

  removeModifier(id) {
    this._modifiers.delete(id);
  }

  /**
   * Current base profile values for the most recently evaluated depth.
   * Useful for encounters blending back toward the base.
   */
  getBaseProfile() {
    return {
      fogNear: this._baseFogNear,
      fogFar: this._baseFogFar,
      ambient: this._baseAmbient,
    };
  }

  get targetExposure() {
    return this._targetExposure;
  }

  /**
   * Single per-frame update (convenience wrapper).
   * Use when no encounter/modifier needs to read the base between evaluation
   * and application (e.g. during preload warm-up).
   */
  update(depth, flashlightOn, fog, ambientLight, sceneBackground, renderer, underwaterEffect) {
    this.evaluateBase(depth, flashlightOn);
    this.applyToScene(depth, flashlightOn, fog, ambientLight, sceneBackground, renderer, underwaterEffect);
  }

  /**
   * Phase 1: evaluate the depth-zone base profile for the current depth.
   * After this call, getBaseProfile() returns values for this frame.
   * Call this before encounter updates so they can read the base.
   */
  evaluateBase(depth, flashlightOn) {
    this._evaluateBaseProfile(depth, flashlightOn);
  }

  /**
   * Phase 2: blend modifiers onto the base and write fog, ambient,
   * background, exposure, and depth-scale cap to the scene.
   */
  applyToScene(depth, flashlightOn, fog, ambientLight, sceneBackground, renderer, underwaterEffect) {

    // 2. Start with base values
    let fogNear = this._baseFogNear;
    let fogFar = this._baseFogFar;
    let ambient = this._baseAmbient;

    // 3. Apply active modifiers (blended by weight)
    for (const mod of this._modifiers.values()) {
      const w = THREE.MathUtils.clamp(mod.weight ?? 0, 0, 1);
      if (w === 0) continue;
      if (mod.fogNear !== undefined) fogNear = THREE.MathUtils.lerp(fogNear, mod.fogNear, w);
      if (mod.fogFar !== undefined) fogFar = THREE.MathUtils.lerp(fogFar, mod.fogFar, w);
      if (mod.ambientIntensity !== undefined) ambient = THREE.MathUtils.lerp(ambient, mod.ambientIntensity, w);
    }

    // 4. Write to scene state
    fog.color.copy(this._fogColor);
    fog.near = fogNear;
    fog.far = fogFar;
    sceneBackground.copy(this._fogColor);
    ambientLight.intensity = ambient;

    // 5. Update exposure
    this._updateExposure(depth, flashlightOn, renderer);

    // 6. Depth-band scale cap for underwater post-FX
    underwaterEffect.applyDepthScaleCap(depth);
  }

  // -- internal -----------------------------------------------------------

  _evaluateBaseProfile(depth, flashlightOn) {
    const p = this.profiles;
    const bands = p.fog.bands;

    const twilight = THREE.MathUtils.smoothstep(depth, bands.twilight.start, bands.twilight.end);
    const darkZone = THREE.MathUtils.smoothstep(depth, bands.darkZone.start, bands.darkZone.end);
    const abyss = THREE.MathUtils.smoothstep(depth, bands.abyss.start, bands.abyss.end);

    // Fog color
    this._colorA.set(p.fog.colors.surface);
    this._colorB.set(p.fog.colors.twilight);
    this._colorC.set(p.fog.colors.darkZone);
    this._colorD.set(p.fog.colors.abyss);

    this._fogColor.copy(this._colorA);
    this._fogColor.lerp(this._colorB, twilight);
    this._fogColor.lerp(this._colorC, darkZone);
    this._fogColor.lerp(this._colorD, abyss);

    // Fog near / far
    const nearTwilight = THREE.MathUtils.lerp(p.fog.near.surface, p.fog.near.twilight, twilight);
    const nearDark = THREE.MathUtils.lerp(nearTwilight, p.fog.near.darkZone, darkZone);
    let fogNear = THREE.MathUtils.lerp(nearDark, p.fog.near.abyss, abyss);

    const farTwilight = THREE.MathUtils.lerp(p.fog.far.surface, p.fog.far.twilight, twilight);
    const farDark = THREE.MathUtils.lerp(farTwilight, p.fog.far.darkZone, darkZone);
    let fogFar = THREE.MathUtils.lerp(farDark, p.fog.far.abyss, abyss);

    // Ambient
    const ambientTwilight = THREE.MathUtils.lerp(p.ambient.surface, p.ambient.twilight, twilight);
    const ambientDark = THREE.MathUtils.lerp(ambientTwilight, p.ambient.darkZone, darkZone);
    const ambientIntensity = THREE.MathUtils.lerp(ambientDark, p.ambient.abyss, abyss);

    // Flashlight fog push
    if (flashlightOn) {
      const push = p.flashlightFogPush;
      const pushStrength = THREE.MathUtils.smoothstep(depth, push.depthRange.start, push.depthRange.end);
      fogNear += THREE.MathUtils.lerp(push.nearAdd.min, push.nearAdd.max, pushStrength);
      fogFar += THREE.MathUtils.lerp(push.farAdd.min, push.farAdd.max, pushStrength);
    }

    this._baseFogNear = fogNear;
    this._baseFogFar = fogFar;
    this._baseAmbient = ambientIntensity;
  }

  _updateExposure(depth, flashlightOn, renderer) {
    const exp = this.profiles.exposure;
    const t = this.depthThresholds;

    const midBlend = THREE.MathUtils.smoothstep(depth, t.mid, t.deep);
    const deepBlend = THREE.MathUtils.smoothstep(depth, t.deep, t.abyss);

    let target = THREE.MathUtils.lerp(exp.surface, exp.mid, midBlend);
    target = THREE.MathUtils.lerp(target, exp.deep, deepBlend);

    const abyssBlend = THREE.MathUtils.smoothstep(depth, t.abyss, t.abyss + 280);
    target = THREE.MathUtils.lerp(target, exp.abyss, abyssBlend);

    if (flashlightOn) {
      const flashlightComp = THREE.MathUtils.lerp(
        exp.flashlightBoost,
        exp.flashlightBoost * 1.3,
        THREE.MathUtils.smoothstep(depth, t.mid, t.abyss + 180),
      );
      target += flashlightComp;
    }

    this._targetExposure = THREE.MathUtils.clamp(target, 0.5, 0.9);
    renderer.toneMappingExposure = THREE.MathUtils.lerp(
      renderer.toneMappingExposure,
      this._targetExposure,
      exp.easing,
    );
  }
}
