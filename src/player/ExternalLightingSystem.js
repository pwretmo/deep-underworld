import * as THREE from 'three';
import {
  createAdvancedVolumetricBeamMaterial,
  createFallbackBeamMaterial,
} from '../shaders/VolumetricBeamMaterial.js';

const DEFAULTS = {
  headlightIntensity: 140,
  headlightRange: 120,
  coneAngle: Math.PI / 9,
  penumbra: 0.45,
  decay: 1.8,
  headlightSpacing: 2.2,
  beamLength: 48,
  beamBaseOpacity: 0.018,
  hullIntensity: 6,
  hullRange: 38,
  hullDecay: 2,
};

const HULL_LIGHT_LAYOUT = [
  { position: [0, 1.5, -0.6], multiplier: 1.0 },   // top
  { position: [0, -1.5, -0.6], multiplier: 0.9 },  // bottom
  { position: [-1.7, 0, -0.6], multiplier: 0.95 }, // left
  { position: [1.7, 0, -0.6], multiplier: 0.95 },  // right
  { position: [0, 0.15, -2.3], multiplier: 1.1 },  // forward
  { position: [0, 0.15, 2.2], multiplier: 0.85 },  // aft
];

function createBeamGeometry(beamLength, coneAngle) {
  const coneRadius = Math.tan(coneAngle) * beamLength;
  const coneGeo = new THREE.ConeGeometry(coneRadius, beamLength, 32, 8, true);
  coneGeo.translate(0, -beamLength / 2, 0);
  coneGeo.rotateX(Math.PI / 2);
  return coneGeo;
}

export class ExternalLightingSystem {
  constructor(options = {}) {
    this.config = { ...DEFAULTS, ...options.config };
    this._volumetricEnabled = options.volumetricEnabled !== false;

    this.group = new THREE.Group();
    this.group.visible = false;

    this._beamMaterials = [];
    this.headlights = [];
    this.hullLights = [];

    this._buildHeadlights();
    this._buildHullLights();
  }

  _buildHeadlights() {
    const cfg = this.config;
    const beamGeo = createBeamGeometry(cfg.beamLength, cfg.coneAngle);
    const offsets = [-cfg.headlightSpacing * 0.5, cfg.headlightSpacing * 0.5];

    for (let i = 0; i < offsets.length; i++) {
      const x = offsets[i];

      const spot = new THREE.SpotLight(
        0xcce2ff,
        cfg.headlightIntensity,
        cfg.headlightRange,
        cfg.coneAngle,
        cfg.penumbra,
        cfg.decay
      );
      spot.position.set(x, 0, 0);
      spot.target.position.set(x, 0, -1);
      spot.userData.baseIntensity = cfg.headlightIntensity;
      spot.userData.baseRange = cfg.headlightRange;
      this.group.add(spot);
      this.group.add(spot.target);
      this.headlights.push(spot);

      let beamMaterial;
      if (this._volumetricEnabled) {
        beamMaterial = createAdvancedVolumetricBeamMaterial();
        beamMaterial.uniforms.beamLength.value = cfg.beamLength;
        beamMaterial.uniforms.baseOpacity.value = cfg.beamBaseOpacity;
        beamMaterial.uniforms.coneTanHalfAngle.value = Math.tan(cfg.coneAngle);
      } else {
        beamMaterial = createFallbackBeamMaterial();
        beamMaterial.userData.baseOpacity = cfg.beamBaseOpacity * 0.55;
        beamMaterial.opacity = beamMaterial.userData.baseOpacity;
      }

      const beam = new THREE.Mesh(beamGeo, beamMaterial);
      beam.position.set(x, 0, 0);
      beam.renderOrder = 2;
      this.group.add(beam);
      this._beamMaterials.push(beamMaterial);
    }
  }

  _buildHullLights() {
    const cfg = this.config;

    for (let i = 0; i < HULL_LIGHT_LAYOUT.length; i++) {
      const item = HULL_LIGHT_LAYOUT[i];
      const intensity = cfg.hullIntensity * item.multiplier;
      const light = new THREE.PointLight(0x88a8cc, intensity, cfg.hullRange, cfg.hullDecay);
      light.position.set(item.position[0], item.position[1], item.position[2]);
      light.userData.baseIntensity = intensity;
      light.userData.baseRange = cfg.hullRange;
      this.group.add(light);
      this.hullLights.push(light);
    }
  }

  setEnabled(enabled) {
    this.group.visible = enabled;
  }

  update(_dt, depth, time) {
    // Keep lamp output stable across depth; scene fog/scattering handles perceived attenuation.
    const intensityAttenuation = 1.0;
    const rangeAttenuation = 1.0;
    const beamOpacityScale = 1.0;

    for (let i = 0; i < this.headlights.length; i++) {
      const light = this.headlights[i];
      const baseIntensity = light.userData.baseIntensity ?? this.config.headlightIntensity;
      const baseRange = light.userData.baseRange ?? this.config.headlightRange;
      light.intensity = baseIntensity * intensityAttenuation;
      light.distance = baseRange * rangeAttenuation;
    }

    for (let i = 0; i < this.hullLights.length; i++) {
      const light = this.hullLights[i];
      const baseIntensity = light.userData.baseIntensity ?? this.config.hullIntensity;
      const baseRange = light.userData.baseRange ?? this.config.hullRange;
      light.intensity = baseIntensity;
      light.distance = baseRange;
    }

    for (let i = 0; i < this._beamMaterials.length; i++) {
      const mat = this._beamMaterials[i];
      if (mat.uniforms) {
        mat.uniforms.time.value = time;
        mat.uniforms.depthAttenuation.value = intensityAttenuation;
        mat.uniforms.depthOpacityScale.value = beamOpacityScale;
        mat.uniforms.waterDepth.value = depth;
        continue;
      }

      const baseOpacity = mat.userData.baseOpacity ?? mat.opacity;
      mat.opacity = baseOpacity * beamOpacityScale;
    }
  }

  updateFogUniforms(fog) {
    if (!fog) return;

    for (let i = 0; i < this._beamMaterials.length; i++) {
      const mat = this._beamMaterials[i];
      if (!mat.uniforms) continue;
      mat.uniforms.fogColor.value.copy(fog.color);
      mat.uniforms.fogNear.value = fog.near;
      mat.uniforms.fogFar.value = fog.far;
    }
  }
}
