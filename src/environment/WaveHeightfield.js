import * as THREE from "three/webgpu";
import {
  Fn,
  clamp,
  cos,
  float,
  floor,
  fract,
  instanceIndex,
  int,
  min,
  mix,
  sin,
  storage,
  uniform,
  vec3,
} from "three/tsl";

/**
 * Quality-tier grid sizes for the compute-driven wave heightfield.
 * Low tier does not use compute — the inline TSL vertex path is kept as fallback.
 */
const HEIGHTFIELD_TIER_CONFIG = {
  medium: { gridSize: 64, worldSize: 200 },
  high: { gridSize: 128, worldSize: 200 },
  ultra: { gridSize: 256, worldSize: 200 },
};

/**
 * Wave parameters — match the existing inline sinusoidal constants from Ocean.js
 * so the visual output is consistent when switching tiers.
 */
const WAVE_X_SCALE = 0.05;
const WAVE_X_SPEED = 0.5;
const WAVE_X_AMP = 0.5;
const WAVE_Z_SCALE = 0.03;
const WAVE_Z_SPEED = 0.3;
const WAVE_Z_AMP = 0.3;
const WAVE3_X_SCALE = 0.12;
const WAVE3_Z_SCALE = 0.08;
const WAVE3_SPEED = 0.7;
const WAVE3_AMP = 0.2;

/**
 * TSL compute-driven wave heightfield.
 *
 * Stores wave heights (and approximate normals) in a flat storage buffer
 * that covers a worldSize x worldSize area centered on the player.
 * Each frame the compute kernel evaluates multi-octave sinusoidal waves
 * at every grid cell and writes height + normal data to the buffer.
 *
 * The same buffer can be sampled by the water surface positionNode AND
 * the CausticPass for richer refraction data.
 */
export class WaveHeightfield {
  /**
   * @param {string} tier - Quality tier ("medium", "high", "ultra")
   */
  constructor(tier) {
    const config = HEIGHTFIELD_TIER_CONFIG[tier];
    if (!config) {
      throw new Error(`WaveHeightfield: unsupported tier "${tier}"`);
    }

    this.gridSize = config.gridSize;
    this.worldSize = config.worldSize;
    this._totalCells = this.gridSize * this.gridSize;

    // --- Storage buffers ---
    // Heights: 1 float per cell
    const heightData = new Float32Array(this._totalCells);
    this._heightAttr = new THREE.StorageBufferAttribute(heightData, 1);
    this._heightStorageWrite = storage(
      this._heightAttr,
      "float",
      this._totalCells,
    );
    this._heightStorageRead = storage(
      this._heightAttr,
      "float",
      this._totalCells,
    ).toReadOnly();

    // Normals: vec3 per cell (dx, 1, dz — unnormalized tangent-space)
    const normalData = new Float32Array(this._totalCells * 4);
    this._normalAttr = new THREE.StorageBufferAttribute(normalData, 4);
    this._normalStorageWrite = storage(
      this._normalAttr,
      "vec4",
      this._totalCells,
    );
    this._normalStorageRead = storage(
      this._normalAttr,
      "vec4",
      this._totalCells,
    ).toReadOnly();

    // --- Compute uniforms ---
    this._uniforms = {
      time: uniform(0.0),
      gridSize: uniform(this.gridSize),
      worldSize: uniform(this.worldSize),
      centerX: uniform(0.0),
      centerZ: uniform(0.0),
    };

    // --- Build compute kernel ---
    this._computeNode = this._buildComputeKernel();

    // --- Disposed flag ---
    this._disposed = false;
  }

  /**
   * Build the TSL compute kernel that writes heights and normals.
   */
  _buildComputeKernel() {
    const heightBuf = this._heightStorageWrite;
    const normalBuf = this._normalStorageWrite;
    const u = this._uniforms;

    const computeFn = Fn(() => {
      const idx = instanceIndex;
      const gs = u.gridSize.toFloat();

      // 2D grid indices from flat index
      const ix = idx.modInt(int(u.gridSize)).toFloat();
      const iz = idx.div(int(u.gridSize)).toFloat();

      // Map grid cell to world XZ centered on player
      const cellU = ix.div(gs.sub(1.0));
      const cellV = iz.div(gs.sub(1.0));
      const worldX = u.centerX.add(cellU.sub(0.5).mul(u.worldSize));
      const worldZ = u.centerZ.add(cellV.sub(0.5).mul(u.worldSize));

      // Multi-octave sinusoidal waves — two primary octaves match Ocean.js
      // inline path, third octave adds detail for compute tiers.
      // The inline path operates on positionLocal.y which equals -worldZ
      // due to the plane's -PI/2 X-rotation, so we negate worldZ here.
      const negWorldZ = worldZ.negate();
      const wave1 = sin(
        worldX.mul(WAVE_X_SCALE).add(u.time.mul(WAVE_X_SPEED)),
      ).mul(WAVE_X_AMP);
      const wave2 = cos(
        negWorldZ.mul(WAVE_Z_SCALE).add(u.time.mul(WAVE_Z_SPEED)),
      ).mul(WAVE_Z_AMP);
      const wave3 = sin(
        worldX
          .mul(WAVE3_X_SCALE)
          .add(negWorldZ.mul(WAVE3_Z_SCALE))
          .add(u.time.mul(WAVE3_SPEED)),
      ).mul(WAVE3_AMP);
      const h = wave1.add(wave2).add(wave3);

      heightBuf.element(idx).assign(h);

      // Analytical partial derivatives for normal computation
      const dHdx = cos(
        worldX.mul(WAVE_X_SCALE).add(u.time.mul(WAVE_X_SPEED)),
      )
        .mul(WAVE_X_SCALE * WAVE_X_AMP)
        .add(
          cos(
            worldX
              .mul(WAVE3_X_SCALE)
              .add(worldZ.mul(WAVE3_Z_SCALE))
              .add(u.time.mul(WAVE3_SPEED)),
          ).mul(WAVE3_X_SCALE * WAVE3_AMP),
        );

      const dHdz = sin(
        negWorldZ.mul(WAVE_Z_SCALE).add(u.time.mul(WAVE_Z_SPEED)),
      )
        .negate()
        .mul(WAVE_Z_SCALE * WAVE_Z_AMP)
        .add(
          cos(
            worldX
              .mul(WAVE3_X_SCALE)
              .add(negWorldZ.mul(WAVE3_Z_SCALE))
              .add(u.time.mul(WAVE3_SPEED)),
          ).mul(WAVE3_Z_SCALE * WAVE3_AMP),
        );

      // Store normal as (dHdx, 1.0, dHdz, 0.0) — consumers normalize as needed
      normalBuf.element(idx).assign(
        vec3(dHdx.negate(), float(1.0), dHdz.negate()).normalize().toVec4(),
      );
    });

    return computeFn().compute(this._totalCells);
  }

  /**
   * Dispatch the compute pass.
   * @param {number} time - Elapsed time
   * @param {THREE.Vector3} playerPos - Player world position
   * @param {THREE.WebGPURenderer} renderer - Renderer for compute dispatch
   */
  update(time, playerPos, renderer) {
    if (this._disposed) return;
    this._uniforms.time.value = time;
    this._uniforms.centerX.value = playerPos.x;
    this._uniforms.centerZ.value = playerPos.z;
    this._renderer = renderer;
    renderer.computeAsync(this._computeNode);
  }

  /**
   * Build a TSL node that bilinearly samples the heightfield given local XY coords.
   * The returned node outputs a float height value.
   *
   * @param {Object} localXY - TSL vec2 node with local-space coordinates
   *   (plane-local: X = world X offset from player, Y = world Z offset due to plane rotation)
   * @returns {Object} TSL float node — interpolated wave height
   */
  createHeightSampleNode(localXY) {
    const heightBuf = this._heightStorageRead;
    const gs = float(this.gridSize);
    const gsInt = int(this.gridSize);
    const ws = float(this.worldSize);

    return Fn(() => {
      // Convert local position to grid UV [0, 1]
      const gu = localXY.x.div(ws).add(0.5);
      const gv = localXY.y.div(ws).add(0.5);

      // Continuous grid coordinates
      const gx = clamp(gu, 0.0, 1.0).mul(gs.sub(1.0));
      const gz = clamp(gv, 0.0, 1.0).mul(gs.sub(1.0));

      // Integer cell corners
      const ix0 = int(floor(gx));
      const iz0 = int(floor(gz));
      const ix1 = min(ix0.add(1), gsInt.sub(1));
      const iz1 = min(iz0.add(1), gsInt.sub(1));

      // Fractional blend factors
      const fx = fract(gx);
      const fz = fract(gz);

      // Bilinear sample
      const h00 = heightBuf.element(iz0.mul(gsInt).add(ix0)).toFloat();
      const h10 = heightBuf.element(iz0.mul(gsInt).add(ix1)).toFloat();
      const h01 = heightBuf.element(iz1.mul(gsInt).add(ix0)).toFloat();
      const h11 = heightBuf.element(iz1.mul(gsInt).add(ix1)).toFloat();

      return mix(mix(h00, h10, fx), mix(h01, h11, fx), fz);
    })();
  }

  /**
   * Build a TSL node that bilinearly samples the normal field.
   * Returns a vec3 (normalized wave-surface normal).
   *
   * @param {Object} localXY - TSL vec2 node with local-space coordinates
   * @returns {Object} TSL vec3 node — interpolated surface normal
   */
  createNormalSampleNode(localXY) {
    const normalBuf = this._normalStorageRead;
    const gs = float(this.gridSize);
    const gsInt = int(this.gridSize);
    const ws = float(this.worldSize);

    return Fn(() => {
      const gu = localXY.x.div(ws).add(0.5);
      const gv = localXY.y.div(ws).add(0.5);

      const gx = clamp(gu, 0.0, 1.0).mul(gs.sub(1.0));
      const gz = clamp(gv, 0.0, 1.0).mul(gs.sub(1.0));

      const ix0 = int(floor(gx));
      const iz0 = int(floor(gz));
      const ix1 = min(ix0.add(1), gsInt.sub(1));
      const iz1 = min(iz0.add(1), gsInt.sub(1));

      const fx = fract(gx);
      const fz = fract(gz);

      const n00 = normalBuf.element(iz0.mul(gsInt).add(ix0)).toVec3();
      const n10 = normalBuf.element(iz0.mul(gsInt).add(ix1)).toVec3();
      const n01 = normalBuf.element(iz1.mul(gsInt).add(ix0)).toVec3();
      const n11 = normalBuf.element(iz1.mul(gsInt).add(ix1)).toVec3();

      return mix(mix(n00, n10, fx), mix(n01, n11, fx), fz).normalize();
    })();
  }

  /**
   * Expose the heightfield configuration for external consumers (e.g. CausticPass).
   * @returns {{ gridSize: number, worldSize: number, heightStorageRead: Object, normalStorageRead: Object, uniforms: Object }}
   */
  getDescriptor() {
    return {
      gridSize: this.gridSize,
      worldSize: this.worldSize,
      heightStorageRead: this._heightStorageRead,
      normalStorageRead: this._normalStorageRead,
      uniforms: this._uniforms,
    };
  }

  /**
   * Dispose compute resources.
   */
  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._computeNode.dispose();

    // Compute-only storage attributes are not owned by render geometry.
    // Delete them from the renderer's attribute manager to free GPU buffers.
    const attributeManager = this._renderer?._attributes;
    if (attributeManager) {
      if (this._heightAttr) attributeManager.delete(this._heightAttr);
      if (this._normalAttr) attributeManager.delete(this._normalAttr);
    }

    this._heightAttr = null;
    this._normalAttr = null;
    this._heightStorageWrite = null;
    this._heightStorageRead = null;
    this._normalStorageWrite = null;
    this._normalStorageRead = null;
    this._renderer = null;
  }
}
