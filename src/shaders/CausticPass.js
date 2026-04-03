import * as THREE from "three/webgpu";
import {
  Fn,
  abs,
  clamp,
  cos,
  float,
  max,
  positionLocal,
  pow,
  sin,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { qualityManager } from "../QualityManager.js";

/** Cached matrix to avoid per-frame allocation. */
const _invProjView = new THREE.Matrix4();

/**
 * Quality-tier caustic settings.
 * Low tier uses an animated tiled texture (no refraction mesh).
 * Medium+ tiers render a refraction-based caustic pass via RTT.
 */
const CAUSTIC_TIER_SETTINGS = {
  low: { method: "tiled", bufferSize: 128, projectionArea: 60 },
  medium: { method: "refraction", bufferSize: 256, projectionArea: 80 },
  high: { method: "refraction", bufferSize: 512, projectionArea: 120 },
  ultra: { method: "refraction", bufferSize: 512, projectionArea: 160 },
};

/**
 * Player-relative refraction-based caustic texture pass.
 *
 * Architecture:
 * - A small light mesh derived from water-surface geometry is rendered from above
 *   with an orthographic camera into an off-screen render target.
 * - The vertex shader displaces mesh vertices with time-varying wave functions
 *   and computes per-vertex refraction offsets, concentrating light into caustic
 *   patterns.
 * - The projection origin snaps to texel-grid boundaries to prevent shimmer as
 *   the player moves.
 * - The resulting texture is sampled in UnderwaterEffect's TSL chain using
 *   scene-depth-based world-position reconstruction.
 */
export class CausticPass {
  constructor(renderer) {
    this._renderer = renderer;
    this._time = 0;

    const tier = qualityManager.tier;
    const settings = CAUSTIC_TIER_SETTINGS[tier] || CAUSTIC_TIER_SETTINGS.medium;
    this._settings = settings;
    this._method = settings.method;

    // Uniforms exposed to UnderwaterEffect's TSL chain
    this._timeUniform = uniform(0);
    this._playerXZ = uniform(new THREE.Vector2(0, 0));
    this._projectionArea = uniform(settings.projectionArea);
    this._texelSnappedOrigin = uniform(new THREE.Vector2(0, 0));

    // Inverse projection-view matrix uniform for world-position reconstruction
    this._invProjViewMatrix = uniform(new THREE.Matrix4());

    // Tiled fallback texture node for low tier (procedural, no RTT)
    this._tiledCausticNode = null;

    // RTT resources for medium+ tiers
    this._renderTarget = null;
    this._causticScene = null;
    this._causticCamera = null;
    this._causticMesh = null;

    // Stable texture node — created once so TSL closures always reference
    // the same node object. Its .value is updated on tier rebuild.
    this._causticTextureNode = texture(new THREE.Texture());

    if (this._method === "refraction") {
      this._initRefractionPass(settings);
    }

    // Optional: external wave heightfield from Ocean's compute pass.
    // When set, CausticPass can derive wave data from the shared heightfield
    // instead of duplicating sinusoidal functions. Not consumed yet — wired
    // for #196 follow-up.
    this._waveHeightfield = null;

    // Store handler reference so it can be removed in dispose()
    this._onQualityChange = (e) => {
      const newSettings =
        CAUSTIC_TIER_SETTINGS[e.detail.tier] || CAUSTIC_TIER_SETTINGS.medium;
      this._rebuildForTier(newSettings);
    };
    window.addEventListener("qualitychange", this._onQualityChange);
  }

  /** Current method — "tiled" or "refraction" */
  get method() {
    return this._method;
  }

  /**
   * Set the shared wave heightfield from Ocean's compute pass.
   * When set, future iterations of CausticPass can sample this heightfield
   * for richer wave-driven caustics instead of inline sinusoidal functions.
   * @param {import("../environment/WaveHeightfield.js").WaveHeightfield|null} heightfield
   */
  setWaveHeightfield(heightfield) {
    this._waveHeightfield = heightfield;
  }

  /**
   * Build the refraction caustic RTT resources.
   */
  _initRefractionPass(settings) {
    const size = settings.bufferSize;
    const area = settings.projectionArea;

    // Render target — single-channel intensity is enough, but we use RGBA
    // for maximum compatibility with WebGPU texture binding.
    this._renderTarget = new THREE.RenderTarget(size, size, {
      type: THREE.HalfFloatType,
      magFilter: THREE.LinearFilter,
      minFilter: THREE.LinearFilter,
      depthBuffer: false,
    });

    // Orthographic camera looking straight down
    const half = area / 2;
    this._causticCamera = new THREE.OrthographicCamera(
      -half,
      half,
      half,
      -half,
      0.1,
      200,
    );
    this._causticCamera.position.set(0, 80, 0);
    this._causticCamera.lookAt(0, 0, 0);

    // Scene containing only the light mesh
    this._causticScene = new THREE.Scene();

    // Light mesh: a subdivided plane with wave displacement + refraction
    const segments = settings.bufferSize >= 512 ? 128 : 64;
    const geo = new THREE.PlaneGeometry(area, area, segments, segments);
    geo.rotateX(-Math.PI / 2); // face downward

    const mat = this._createCausticMaterial(area);
    this._causticMesh = new THREE.Mesh(geo, mat);
    this._causticScene.add(this._causticMesh);

    // Update the stable texture node to reference the new render target
    this._causticTextureNode.value = this._renderTarget.texture;
  }

  /**
   * Create the TSL-based caustic material for the light mesh.
   * The vertex shader applies wave displacement + refraction offset.
   * The fragment shader outputs concentrated light intensity.
   */
  _createCausticMaterial(area) {
    const mat = new THREE.MeshBasicNodeMaterial({
      side: THREE.DoubleSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });

    const timeNode = this._timeUniform;

    // Wave displacement in the vertex shader — matches Ocean surface waves
    const worldXZ = vec2(positionLocal.x, positionLocal.z);

    // Multi-octave wave displacement for realism
    const wave1 = sin(worldXZ.x.mul(0.05).add(timeNode.mul(0.5))).mul(0.5);
    const wave2 = cos(worldXZ.y.mul(0.03).add(timeNode.mul(0.3))).mul(0.3);
    const wave3 = sin(
      worldXZ.x.mul(0.12).add(worldXZ.y.mul(0.08)).add(timeNode.mul(0.7)),
    ).mul(0.2);
    const waveHeight = wave1.add(wave2).add(wave3);

    // Compute approximate surface normal from wave partial derivatives
    const dWdx = cos(worldXZ.x.mul(0.05).add(timeNode.mul(0.5)))
      .mul(0.05 * 0.5)
      .add(
        cos(
          worldXZ.x.mul(0.12).add(worldXZ.y.mul(0.08)).add(timeNode.mul(0.7)),
        ).mul(0.12 * 0.2),
      );
    const dWdz = sin(worldXZ.y.mul(0.03).add(timeNode.mul(0.3)))
      .negate()
      .mul(0.03 * 0.3)
      .add(
        cos(
          worldXZ.x.mul(0.12).add(worldXZ.y.mul(0.08)).add(timeNode.mul(0.7)),
        ).mul(0.08 * 0.2),
      );

    // Refraction offset: Snell's law approximation for air->water (IOR 1.333)
    // The refraction bends the "light ray" direction based on surface normal tilt
    const refractionStrength = float(0.45);
    const refractOffsetX = dWdx.mul(refractionStrength);
    const refractOffsetZ = dWdz.mul(refractionStrength);

    // Displace vertices: wave height + refraction-based XZ shift
    mat.positionNode = vec3(
      positionLocal.x.add(refractOffsetX.mul(area * 0.15)),
      positionLocal.y.add(waveHeight),
      positionLocal.z.add(refractOffsetZ.mul(area * 0.15)),
    );

    // The caustic intensity comes from how much the refraction concentrates
    // light — areas where refracted rays converge get brighter.
    // We approximate this with the Jacobian determinant of the refraction map.
    const jacobianApprox = abs(
      float(1.0)
        .add(refractOffsetX.mul(area * 0.15 * 0.05))
        .mul(float(1.0).add(refractOffsetZ.mul(area * 0.15 * 0.03)))
        .sub(refractOffsetX.mul(area * 0.15 * 0.08).mul(refractOffsetZ.mul(area * 0.15 * 0.12))),
    );

    // Invert: where convergence is high (Jacobian < 1), light is concentrated
    const intensity = pow(
      clamp(float(1.0).div(max(jacobianApprox, 0.1)), 0.0, 8.0),
      1.8,
    );

    // Output as white with intensity-based alpha for additive blending
    mat.colorNode = vec3(1.0, 1.0, 1.0);
    mat.opacityNode = clamp(intensity.mul(0.35), 0.0, 1.0);

    return mat;
  }

  /**
   * Dispose refraction RTT resources.
   */
  _disposeRefractionPass() {
    if (this._renderTarget) {
      this._renderTarget.dispose();
      this._renderTarget = null;
    }
    if (this._causticMesh) {
      this._causticMesh.geometry.dispose();
      this._causticMesh.material.dispose();
      this._causticMesh = null;
    }
    this._causticScene = null;
    this._causticCamera = null;
    // Do not null _causticTextureNode — it is a stable node reference.
    // Its .value will be updated if/when a new render target is created.
  }

  /**
   * Rebuild for a new quality tier.
   */
  _rebuildForTier(settings) {
    if (
      settings.method === this._method &&
      settings.bufferSize === this._settings.bufferSize &&
      settings.projectionArea === this._settings.projectionArea
    ) {
      return;
    }

    this._disposeRefractionPass();
    this._settings = settings;
    this._method = settings.method;
    this._projectionArea.value = settings.projectionArea;
    this._tiledCausticNode = null;

    if (this._method === "refraction") {
      this._initRefractionPass(settings);
    }
  }

  /**
   * Snap the projection origin to texel-grid boundaries to prevent shimmer.
   * Returns the snapped XZ origin.
   */
  _snapToTexelGrid(playerX, playerZ) {
    const area = this._settings.projectionArea;
    const size = this._settings.bufferSize;
    const texelSize = area / size;
    const snappedX = Math.floor(playerX / texelSize) * texelSize;
    const snappedZ = Math.floor(playerZ / texelSize) * texelSize;
    return { x: snappedX, z: snappedZ };
  }

  /**
   * Update and render the caustic pass for this frame.
   * Call before UnderwaterEffect.render().
   *
   * @param {number} dt - Delta time
   * @param {THREE.Vector3} playerPos - Player world position
   * @param {THREE.Camera} camera - Scene camera for depth reconstruction
   */
  update(dt, playerPos, camera) {
    this._time += dt;
    this._timeUniform.value = this._time;
    this._playerXZ.value.set(playerPos.x, playerPos.z);

    // Update inverse projection-view matrix for world-position reconstruction
    if (camera) {
      _invProjView.copy(camera.projectionMatrixInverse).premultiply(camera.matrixWorld);
      this._invProjViewMatrix.value.copy(_invProjView);
    }

    if (this._method !== "refraction" || !this._renderTarget) {
      return;
    }

    // Snap projection center to texel grid
    const snapped = this._snapToTexelGrid(playerPos.x, playerPos.z);
    this._texelSnappedOrigin.value.set(snapped.x, snapped.z);

    // Position camera and mesh centered on snapped origin
    this._causticCamera.position.set(snapped.x, 80, snapped.z);
    this._causticCamera.lookAt(snapped.x, 0, snapped.z);

    const half = this._settings.projectionArea / 2;
    this._causticCamera.left = -half;
    this._causticCamera.right = half;
    this._causticCamera.top = half;
    this._causticCamera.bottom = -half;
    this._causticCamera.updateProjectionMatrix();

    // Center mesh on snapped origin
    this._causticMesh.position.set(snapped.x, 0, snapped.z);

    // Render caustic pass to the render target
    const prevRenderTarget = this._renderer.getRenderTarget();
    this._renderer.setRenderTarget(this._renderTarget);
    this._renderer.setClearColor(0x000000, 0);
    this._renderer.clear();
    this._renderer.render(this._causticScene, this._causticCamera);
    this._renderer.setRenderTarget(prevRenderTarget);
  }

  /**
   * Build a TSL node that samples the caustic intensity for the current fragment.
   * Reconstructs world position from screen UV + scene depth, then projects
   * into the caustic RTT's orthographic space.
   *
   * @param {Object} screenUVNode - Screen UV coordinate node
   * @param {Object} sceneDepthNode - Scene-pass depth texture node from PassNode
   * @returns {Object} TSL node outputting caustic intensity (float)
   */
  createCausticSampleNode(screenUVNode, sceneDepthNode) {
    const timeNode = this._timeUniform;
    const projArea = this._projectionArea;
    const snappedOrigin = this._texelSnappedOrigin;

    if (this._method === "tiled") {
      return this._createTiledCausticNode(screenUVNode, timeNode);
    }

    // Medium+ tier: sample from RTT caustic texture.
    // The texture node is stable — its .value is updated on tier rebuild.
    const causticTex = this._causticTextureNode;
    const invProjViewMat = this._invProjViewMatrix;

    return Fn(() => {
      // Reconstruct world position from screen UV + scene depth using the
      // inverse projection-view matrix updated each frame.
      const rawDepth = sceneDepthNode.sample(screenUVNode).x;

      // Screen UV -> NDC (clip space xy in [-1, 1])
      const ndcX = screenUVNode.x.mul(2.0).sub(1.0);
      const ndcY = screenUVNode.y.mul(2.0).sub(1.0);

      // Clip-space position (WebGPU depth range is [0, 1])
      const clipPos = vec4(ndcX, ndcY, rawDepth, 1.0);

      // Transform to world space
      const worldPos4 = invProjViewMat.mul(clipPos);
      const worldX = worldPos4.x.div(worldPos4.w);
      const worldZ = worldPos4.z.div(worldPos4.w);

      // Map world XZ into caustic texture UV via the orthographic projection
      const causticU = worldX.sub(snappedOrigin.x).div(projArea).add(0.5);
      const causticV = worldZ.sub(snappedOrigin.y).div(projArea).add(0.5);

      const causticUV = clamp(vec2(causticU, causticV), 0.0, 1.0);
      const sample = causticTex.sample(causticUV);
      return sample.r;
    })();
  }

  /**
   * Low-tier tiled caustic node — animated procedural pattern.
   * No RTT, just math in the fragment shader.
   */
  _createTiledCausticNode(screenUVNode, timeNode) {
    return Fn(() => {
      const causticUv = screenUVNode.mul(12.0);
      const causticTime = timeNode.mul(0.35);
      const causticOne = sin(causticUv.x.mul(3.7).add(causticTime)).mul(
        sin(causticUv.y.mul(4.1).sub(causticTime.mul(0.8))),
      );
      const causticTwo = sin(
        causticUv.x.mul(2.3).sub(causticTime.mul(1.2)).add(1.7),
      ).mul(sin(causticUv.y.mul(3.3).add(causticTime.mul(0.9))));
      const causticThree = sin(
        causticUv.x.add(causticUv.y).mul(2.8).add(causticTime.mul(0.6)),
      );
      const causticValue = pow(
        max(
          0.0,
          causticOne.add(causticTwo.mul(0.7)).add(causticThree.mul(0.5)),
        ).mul(0.33),
        2.2,
      );
      return causticValue;
    })();
  }

  /**
   * Dispose all resources.
   */
  dispose() {
    window.removeEventListener("qualitychange", this._onQualityChange);
    this._disposeRefractionPass();
  }
}
