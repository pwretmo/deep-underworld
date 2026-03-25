import * as THREE from 'three';

// Shared body normal/panel texture (created once per application lifetime)
let _sharedMaps = null;

function _buildSharedMaps() {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const nx = x / size, ny = y / size;
      const v =
        Math.sin(nx * 29 * Math.PI * 2) * 0.3
        + Math.sin(ny * 19 * Math.PI * 2) * 0.3
        + Math.sin((nx * 17 + ny * 13) * Math.PI * 2) * 0.4;
      const dvx =
        Math.sin((nx + 1 / size) * 29 * Math.PI * 2) * 0.3
        + Math.sin(ny * 19 * Math.PI * 2) * 0.3
        + Math.sin(((nx + 1 / size) * 17 + ny * 13) * Math.PI * 2) * 0.4;
      const dvy =
        Math.sin(nx * 29 * Math.PI * 2) * 0.3
        + Math.sin((ny + 1 / size) * 19 * Math.PI * 2) * 0.3
        + Math.sin((nx * 17 + (ny + 1 / size) * 13) * Math.PI * 2) * 0.4;
      data[idx]     = Math.floor(THREE.MathUtils.clamp((dvx - v) * 0.5 * 255 + 128, 0, 255));
      data[idx + 1] = Math.floor(THREE.MathUtils.clamp((dvy - v) * 0.5 * 255 + 128, 0, 255));
      data[idx + 2] = 255;
      data[idx + 3] = 255;
    }
  }
  const bodyNormal = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  bodyNormal.wrapS = bodyNormal.wrapT = THREE.RepeatWrapping;
  bodyNormal.needsUpdate = true;
  return { bodyNormal };
}

function getSharedMaps() {
  if (!_sharedMaps) _sharedMaps = _buildSharedMaps();
  return _sharedMaps;
}

export class GhostShark {
  constructor(scene, position) {
    this.scene     = scene;
    this.group     = new THREE.Group();
    this.time      = Math.random() * 100;

    // Procedural variation per instance
    this.swimSpeed      = 0.85 + Math.random() * 0.45;
    this.swimPhase      = Math.random() * Math.PI * 2;
    this.phaseShiftSpeed = 1.4 + Math.random() * 0.7;
    this.speed          = 3.5 + Math.random() * 2.0;

    this.direction    = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    this.turnTimer    = 0;
    this.turnInterval = 7 + Math.random() * 10;

    // Heavy inertia / body-roll spring-damper
    this._bankAngle = 0;
    this._bankVel   = 0;

    // LOD tracking
    this._lodTier      = 'near';
    this._lastLodTier  = 'near';
    this._frameCounter = 0;

    // Pre-allocated temp vector — zero per-frame allocations
    this._tmpDir = new THREE.Vector3();

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  // ── Model ────────────────────────────────────────────────────────────────

  _buildModel() {
    this.tiers = {
      near:   this._buildTier('near'),
      medium: this._buildTier('medium'),
      far:    this._buildTier('far'),
    };
    this.group.add(this.tiers.near.group);
    this.group.add(this.tiers.medium.group);
    this.group.add(this.tiers.far.group);
    this.tiers.medium.group.visible = false;
    this.tiers.far.group.visible    = false;
    this.group.scale.setScalar(1 + Math.random() * 0.6);
  }

  _buildTier(tierName) {
    const isNear   = tierName === 'near';
    const isMedium = tierName === 'medium';
    const isFar    = tierName === 'far';
    const group    = new THREE.Group();
    const maps     = isNear ? getSharedMaps() : null;

    // ── Materials ───────────────────────────────────────────────────────

    const bodyMat = isNear
      ? new THREE.MeshPhysicalMaterial({
          color: 0x1a1a30, roughness: 0.22, metalness: 0.04,
          transmission: 0.28, thickness: 0.9,
          transparent: true, opacity: 0.84,
          emissive: 0x282050, emissiveIntensity: 0.55,
          normalMap: maps.bodyNormal,
          normalScale: new THREE.Vector2(0.45, 0.45),
        })
      : new THREE.MeshStandardMaterial({
          color: 0x1a1a30, roughness: 0.35, metalness: 0,
          transparent: true, opacity: isFar ? 0.70 : 0.78,
          emissive: 0x282050, emissiveIntensity: isFar ? 0.70 : 0.55,
        });

    const boneMat = new THREE.MeshStandardMaterial({
      color: 0x504030, roughness: 0.4, metalness: 0,
      emissive: 0x504030, emissiveIntensity: isNear ? 0.50 : 0.35,
    });

    const metalMat = new THREE.MeshStandardMaterial({
      color: 0x282838, roughness: 0.25, metalness: 0.35,
      emissive: 0x282050, emissiveIntensity: 0.4,
    });

    const finMat = isNear
      ? new THREE.MeshPhysicalMaterial({
          color: 0x1a1a30, side: THREE.DoubleSide,
          transparent: true, opacity: 0.52,
          roughness: 0.28, metalness: 0,
          transmission: 0.38, thickness: 0.18,
          emissive: 0x282050, emissiveIntensity: 0.6,
        })
      : new THREE.MeshStandardMaterial({
          color: 0x1a1a30, side: THREE.DoubleSide,
          transparent: true, opacity: isFar ? 0.45 : 0.55,
          roughness: 0.4,
          emissive: 0x282050, emissiveIntensity: isFar ? 0.70 : 0.50,
        });

    const eyeMat = new THREE.MeshPhysicalMaterial({
      color: 0x66ffaa, emissive: 0x66ffaa,
      emissiveIntensity: isFar ? 2.5 : 1.8,
      roughness: 0.05, clearcoat: isNear ? 1.0 : 0,
    });

    // ── Body ────────────────────────────────────────────────────────────
    // Far LOD: OctahedronGeometry — absolute minimum triangles (<50 total)
    // Near LOD: 48×32 vertex density (issue requirement)
    let bodyGeo;
    if (isFar) {
      bodyGeo = new THREE.OctahedronGeometry(1, 0);
      bodyGeo.scale(2.5, 0.65, 0.75);
    } else {
      const [wSeg, hSeg] = isNear ? [48, 32] : [32, 24];
      bodyGeo = new THREE.SphereGeometry(1, wSeg, hSeg);
      bodyGeo.scale(2.5, 0.7, 0.8);
      const bp = bodyGeo.attributes.position;
      for (let i = 0; i < bp.count; i++) {
        const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i);
        const r    = Math.sqrt(x * x + y * y + z * z) || 1;
        const rib  = Math.sin(x * 10) * 0.02;
        const panel = Math.sin(x * 18 + z * 15) * 0.008;
        // Micro-detail: panel-line scarring and pore textures (near only)
        const scar = isNear ? Math.sin(x * 7.3 + y * 5.1) * 0.006 : 0;
        const pore = isNear ? Math.sin(x * 38 + z * 29) * 0.004 : 0;
        const disp = rib + panel + scar + pore;
        bp.setX(i, x + (x / r) * disp);
        bp.setY(i, y + (y / r) * disp);
        bp.setZ(i, z + (z / r) * disp);
      }
      bodyGeo.computeVertexNormals();
    }

    const body = new THREE.Mesh(bodyGeo, bodyMat);
    if (isNear)   this._applyBodyShader(bodyMat);
    if (isMedium) this._applyBodyShaderSimple(bodyMat);
    group.add(body);

    // ── Snout + lower jaw ───────────────────────────────────────────────
    let jaw = null;
    if (!isFar) {
      const snoutGeo = new THREE.ConeGeometry(0.45, 1.6, isNear ? 20 : 12);
      snoutGeo.rotateZ(-Math.PI / 2);
      const snout = new THREE.Mesh(snoutGeo, bodyMat);
      snout.position.set(2.3, 0, 0);
      group.add(snout);

      // Lower jaw — subtle gape synchronized with swim cycle
      const jawGeo = new THREE.ConeGeometry(0.2, 0.6, isNear ? 10 : 6);
      jawGeo.rotateZ(-Math.PI / 2);
      jaw = new THREE.Mesh(jawGeo, bodyMat);
      jaw.position.set(2.0, -0.18, 0);
      group.add(jaw);
    }

    // ── Cranial ridge: organic ConeGeometry (replaces BoxGeometry) ──────
    if (!isFar) {
      const ridgeCount = isNear ? 6 : 4;
      for (let i = 0; i < ridgeCount; i++) {
        const h    = 0.10 + (ridgeCount - 1 - i) * 0.025;
        const rGeo = new THREE.ConeGeometry(0.038 + (ridgeCount - 1 - i) * 0.01, h, isNear ? 7 : 5);
        const r    = new THREE.Mesh(rGeo, boneMat);
        r.position.set(2.0 - i * (3.5 / ridgeCount), 0.35 + Math.sin(i * 0.5) * 0.04, 0);
        r.rotation.z = Math.PI; // spike upward
        group.add(r);
      }
    }

    // ── Vertebrae: organic ConeGeometry (replaces BoxGeometry) ──────────
    if (!isFar) {
      const vertCount = isNear ? 12 : 8;
      for (let i = 0; i < vertCount; i++) {
        const t    = (i / (vertCount - 1)) * 4 - 1.8;
        const vGeo = new THREE.ConeGeometry(0.03, 0.13, isNear ? 7 : 5);
        const v    = new THREE.Mesh(vGeo, boneMat);
        v.position.set(t, 0.58 + Math.sin(i * 0.4) * 0.04, 0);
        v.rotation.z = Math.PI; // spike upward
        group.add(v);
      }
    }

    // ── Gill slits: near LOD only ────────────────────────────────────────
    const gillSlits = [];
    if (isNear) {
      const gillMat = new THREE.MeshStandardMaterial({
        color: 0x0a0a18, emissive: 0x1a0830, emissiveIntensity: 0.8, roughness: 0.8,
      });
      for (const side of [-1, 1]) {
        for (let i = 0; i < 4; i++) {
          const gillGeo = new THREE.CapsuleGeometry(0.025, 0.18, 2, 8);
          const gill    = new THREE.Mesh(gillGeo, gillMat);
          gill.position.set(0.85 + i * 0.12, 0, side * (0.72 - i * 0.02));
          gill.rotation.z = side * Math.PI * 0.5;
          gill.rotation.y = side * (0.3 + i * 0.05);
          group.add(gill);
          gillSlits.push(gill);
        }
      }
    }

    // ── Lateral pipes: 12+ radial segments ──────────────────────────────
    if (!isFar) {
      for (const side of [-1, 1]) {
        const pipeCurve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(-1.8, 0,     side * 0.65),
          new THREE.Vector3(-0.5, 0.1,   side * 0.78),
          new THREE.Vector3(0.8,  0.08,  side * 0.70),
          new THREE.Vector3(1.8, -0.05,  side * 0.40),
        ]);
        const pipeGeo = new THREE.TubeGeometry(pipeCurve, isNear ? 16 : 12, 0.035, isNear ? 12 : 6, false);
        group.add(new THREE.Mesh(pipeGeo, metalMat));
      }
    }

    // ── Eyes ─────────────────────────────────────────────────────────────
    {
      const eyeGeo = new THREE.SphereGeometry(0.2, isNear ? 24 : 12, isNear ? 24 : 12);
      eyeGeo.scale(1, 0.35, 1);
      for (const side of [-1, 1]) {
        if (!isFar) {
          const socketGeo = new THREE.SphereGeometry(0.28, isNear ? 12 : 8, isNear ? 12 : 8);
          const socket    = new THREE.Mesh(socketGeo, new THREE.MeshPhysicalMaterial({
            color: 0x030303, roughness: 0.9, metalness: 0.1,
          }));
          socket.position.set(1.5, 0.28, side * 0.5);
          group.add(socket);
        }
        const eye = new THREE.Mesh(eyeGeo, eyeMat);
        eye.position.set(isFar ? 0.5 : 1.52, 0.28, side * 0.5);
        group.add(eye);
      }
    }

    // ── Dorsal fin: 12×12 near, 6×6 medium, 3×3 far ─────────────────────
    {
      const [fW, fH] = isNear ? [12, 12] : isMedium ? [6, 6] : [3, 3];
      const finGeo   = new THREE.PlaneGeometry(1.2, 1.4, fW, fH);
      const dorsal   = new THREE.Mesh(finGeo, finMat);
      dorsal.position.set(0, 1.1, 0);
      dorsal.rotation.z = -0.2;
      if (isNear) this._applyFinShader(finMat);
      group.add(dorsal);

      // Fin rays (near + medium)
      if (!isFar) {
        const rayCount = isNear ? 5 : 3;
        for (let i = 0; i < rayCount; i++) {
          const h       = 1.0 - i * 0.12;
          const strutGeo = new THREE.CylinderGeometry(0.014, 0.007, h, isNear ? 6 : 4);
          const strut   = new THREE.Mesh(strutGeo, boneMat);
          strut.position.set(-0.32 + i * 0.26, 0.62 + i * 0.08, 0);
          strut.rotation.z = -0.2 + i * 0.05;
          group.add(strut);
        }
      }
    }

    // ── Pectoral fins: increased subdivisions for deformation ───────────
    const pectoralFins = [];
    if (!isFar) {
      const [pW, pH] = isNear ? [8, 6] : [4, 4];
      for (const side of [-1, 1]) {
        const pGeo = new THREE.PlaneGeometry(1.6, 0.5, pW, pH);
        const pFin = new THREE.Mesh(pGeo, finMat);
        pFin.position.set(0.5, -0.2, side * 0.8);
        pFin.rotation.x = side * 0.3;
        pFin.rotation.z = side * 0.4;
        pFin.userData.side     = side;
        pFin.userData.baseRotX = side * 0.3;
        pFin.userData.baseRotZ = side * 0.4;
        group.add(pFin);
        pectoralFins.push(pFin);

        // Mechanical tendon / strut geometry
        const tendonGeo = new THREE.CylinderGeometry(0.012, 0.012, 1.4, isNear ? 6 : 4);
        const tendon    = new THREE.Mesh(tendonGeo, metalMat);
        tendon.position.set(0.5, -0.22, side * 0.82);
        tendon.rotation.z = side * 0.4;
        group.add(tendon);
      }
    }

    // ── Tail segments + connecting tissue ────────────────────────────────
    const tailSegments   = [];
    const tailConnectors = [];
    {
      const segCount = isFar ? 4 : 8;
      for (let i = 0; i < segCount; i++) {
        const segGeo = new THREE.CylinderGeometry(
          0.18 - i * 0.018, 0.16 - i * 0.016, 0.6,
          isNear ? 10 : isMedium ? 8 : 5,
        );
        segGeo.rotateZ(Math.PI / 2);
        const seg = new THREE.Mesh(segGeo, i % 2 === 0 ? bodyMat : metalMat);
        const bx  = -2.0 - i * 0.55;
        const by  = Math.sin(i * 0.4) * 0.08;
        seg.position.set(bx, by, 0);
        seg.userData.baseY = by;
        group.add(seg);
        tailSegments.push(seg);

        // Connecting tissue between segments (near LOD only)
        if (isNear && i < segCount - 1) {
          const cr   = 0.165 - i * 0.016;
          const cGeo = new THREE.CylinderGeometry(cr * 0.88, cr * 0.94, 0.12, 8);
          cGeo.rotateZ(Math.PI / 2);
          const conn = new THREE.Mesh(cGeo, bodyMat);
          const cx   = bx - 0.275;
          const cy   = Math.sin((i + 0.5) * 0.4) * 0.08;
          conn.position.set(cx, cy, 0);
          conn.userData.baseY = cy;
          group.add(conn);
          tailConnectors.push(conn);
        }
      }
    }

    // ── Tail blade: improved segment count ──────────────────────────────
    {
      const bladeSegs = isNear ? 8 : isMedium ? 5 : 3;
      const bladeGeo  = new THREE.ConeGeometry(0.15, 0.65, bladeSegs);
      bladeGeo.rotateZ(Math.PI / 2);
      const blade = new THREE.Mesh(bladeGeo, metalMat);
      blade.position.set(-6.45, 0, 0);
      group.add(blade);
    }

    // ── Barnacle clusters: ventral micro-detail (near only) ─────────────
    if (isNear) {
      const barnMat = new THREE.MeshStandardMaterial({
        color: 0x303035, roughness: 0.85, metalness: 0.1,
        emissive: 0x080808, emissiveIntensity: 0.2,
      });
      for (let i = 0; i < 6; i++) {
        const bGeo    = new THREE.SphereGeometry(0.03 + Math.random() * 0.025, 5, 5);
        const barnacle = new THREE.Mesh(bGeo, barnMat);
        barnacle.position.set(-1.5 + i * 0.6, -0.67, 0.08 + Math.random() * 0.12);
        group.add(barnacle);
      }
    }

    // ── Glow: dim fill light — emissive materials carry the primary glow ─
    const glow = new THREE.PointLight(0x66ffaa, isFar ? 0.08 : 0.12, 10);
    group.add(glow);

    return {
      group, jaw, tailSegments, tailConnectors, pectoralFins, gillSlits,
      bodyMaterial: bodyMat, finMaterial: finMat, glow,
      isNear, isMedium, isFar,
    };
  }

  // ── Shaders ──────────────────────────────────────────────────────────────

  /**
   * Full near-LOD body shader:
   *   Vertex: thunniform S-curve undulation + body roll from turns + breathing swell
   *   Fragment: Fresnel rim-light + animated emissive phase-shift pulse head→tail
   */
  _applyBodyShader(material) {
    material.userData.shaderUniforms = {
      uSwimTime:  { value: 0 },
      uSwimAmp:   { value: 0.5 },
      uTurnBend:  { value: 0 },
      uProximity: { value: 0 },
      uPhaseSpd:  { value: this.phaseShiftSpeed },
    };

    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, material.userData.shaderUniforms);

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
uniform float uSwimTime;
uniform float uSwimAmp;
uniform float uTurnBend;
varying float vBodyX;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
vBodyX = position.x;
// Thunniform S-curve: amplitude grows from head toward tail
float axisT  = clamp((position.x + 2.5) / 5.0, 0.0, 1.0);
float tMask  = 1.0 - smoothstep(0.28, 0.82, axisT);
float sWave  = sin(position.x * 2.2 - uSwimTime * 5.5) * uSwimAmp * tMask * 0.18;
// Lateral bend from turns
float bMask  = smoothstep(0.45, 1.0, 1.0 - axisT);
transformed.z += sWave + uTurnBend * bMask * 0.15;
// Subtle breathing swell
transformed.y += sin(uSwimTime * 1.8 + axisT * 4.0) * 0.012 * (1.0 - tMask * 0.6);`,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying float vBodyX;
uniform float uSwimTime;
uniform float uProximity;
uniform float uPhaseSpd;`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
// Fresnel rim-light: ghostly silhouette glow
float rim = pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 2.5);
totalEmissiveRadiance += vec3(0.15, 0.70, 0.40) * rim * (0.75 + uProximity * 0.55);
// Animated emissive phase-shift pulse traveling head-to-tail
float pWave = sin(uSwimTime * uPhaseSpd - vBodyX * 1.3) * 0.5 + 0.5;
totalEmissiveRadiance += vec3(0.10, 0.42, 0.22) * pWave * 0.35;`,
        );

      material.userData.shader = shader;
    };
    material.needsUpdate = true;
  }

  /** Simplified medium-LOD body shader: thunniform S-curve only (no fragment injection) */
  _applyBodyShaderSimple(material) {
    material.userData.shaderUniforms = {
      uSwimTime: { value: 0 },
      uSwimAmp:  { value: 0.5 },
    };

    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, material.userData.shaderUniforms);

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
uniform float uSwimTime;
uniform float uSwimAmp;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
float axisT = clamp((position.x + 2.5) / 5.0, 0.0, 1.0);
float tMask = 1.0 - smoothstep(0.28, 0.82, axisT);
transformed.z += sin(position.x * 2.2 - uSwimTime * 5.5) * uSwimAmp * tMask * 0.14;`,
        );

      material.userData.shader = shader;
    };
    material.needsUpdate = true;
  }

  /** Dorsal fin flutter shader: per-vertex sinusoidal wave, tip flutters more than base */
  _applyFinShader(material) {
    material.userData.shaderUniforms = {
      uFinTime: { value: 0 },
      uFinWave: { value: 0.5 },
    };

    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, material.userData.shaderUniforms);

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
uniform float uFinTime;
uniform float uFinWave;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
// Fin flutter — tip (high position.y) flutters more than base
float tipMask = smoothstep(-0.25, 0.55, position.y);
float flutter = sin(position.x * 9.0 + uFinTime * 7.5 + position.y * 11.0) * 0.05 * uFinWave * tipMask;
transformed.z += flutter;`,
        );

      material.userData.shader = shader;
    };
    material.needsUpdate = true;
  }

  // ── LOD ──────────────────────────────────────────────────────────────────

  _resolveLodTier(dist) {
    const h = 4; // hysteresis band to prevent thrashing
    if (this._lastLodTier === 'near'   && dist < 30 + h)                  return 'near';
    if (this._lastLodTier === 'medium' && dist > 30 - h && dist < 80 + h) return 'medium';
    if (this._lastLodTier === 'far'    && dist > 80 - h)                   return 'far';
    if (dist < 30) return 'near';
    if (dist < 80) return 'medium';
    return 'far';
  }

  // ── Update ───────────────────────────────────────────────────────────────

  update(dt, playerPos) {
    this.time += dt;
    this._frameCounter++;

    const dist     = this.group.position.distanceTo(playerPos);
    const tierName = this._resolveLodTier(dist);

    // LOD switch
    if (tierName !== this._lastLodTier) {
      this.tiers[this._lastLodTier].group.visible = false;
      this.tiers[tierName].group.visible          = true;
      this._lastLodTier = tierName;
      this._lodTier     = tierName;
    }
    const activeTier = this.tiers[tierName];

    // ── Steering ─────────────────────────────────────────────────────────
    this.turnTimer += dt;
    if (this.turnTimer > this.turnInterval) {
      this.turnTimer    = 0;
      this.turnInterval = 7 + Math.random() * 10;
      if (Math.random() < 0.3) {
        this._tmpDir.subVectors(playerPos, this.group.position).normalize();
        this._tmpDir.y *= 0.3;
        this.direction.copy(this._tmpDir);
      } else {
        this.direction.set(
          Math.random() - 0.5,
          (Math.random() - 0.5) * 0.2,
          Math.random() - 0.5,
        ).normalize();
      }
    }

    // Reaction to player proximity: drift toward player, glow intensifies
    const proximity = THREE.MathUtils.clamp(1.0 - dist / 60.0, 0, 1);
    if (proximity > 0.4 && Math.random() < 0.006) {
      this._tmpDir.subVectors(playerPos, this.group.position).normalize();
      this._tmpDir.y *= 0.25;
      this.direction.lerp(this._tmpDir, 0.35);
    }

    // Move — no allocation: reuse _tmpDir
    this._tmpDir.copy(this.direction).multiplyScalar(this.speed * dt);
    this.group.position.add(this._tmpDir);

    // Respawn when out of range
    if (dist > 200) {
      const a = Math.random() * Math.PI * 2;
      this.group.position.set(
        playerPos.x + Math.cos(a) * 80,
        playerPos.y + (Math.random() - 0.5) * 20,
        playerPos.z + Math.sin(a) * 80,
      );
    }

    // ── Orientation: heavy inertia for thunniform swimmer ────────────────
    const targetYaw = Math.atan2(this.direction.x, this.direction.z) + Math.PI * 0.5;
    const yawBlend  = 1.0 - Math.exp(-1.4 * dt); // slow turn for realism
    this.group.rotation.y = THREE.MathUtils.lerp(this.group.rotation.y, targetYaw, yawBlend);

    // Body roll into turns — spring-damper for weight and inertia
    const yawErr     = targetYaw - this.group.rotation.y;
    this._bankVel   += (-this._bankAngle * 8.0 - this._bankVel * 5.0 + yawErr * 3.5) * dt;
    this._bankAngle += this._bankVel * dt;
    this._bankAngle  = THREE.MathUtils.clamp(this._bankAngle, -0.25, 0.25);

    const swimTime = this.time * this.swimSpeed + this.swimPhase;
    const swimAmp  = THREE.MathUtils.clamp(0.35 + this.speed / 14.0, 0.3, 0.8);

    // Base body roll: swim undulation + turn banking
    this.group.rotation.z = Math.sin(swimTime * 1.8) * 0.04 + this._bankAngle;

    // ── Ghostly glow: proximity-boosted (updated every frame for all tiers) ─
    const glowBase = tierName === 'far' ? 0.06 : 0.08;
    const glowAmp  = tierName === 'far' ? 0.04 : 0.05;
    activeTier.glow.intensity = (glowBase + Math.sin(swimTime * 2.8) * glowAmp) * (1.0 + proximity * 0.4);

    // Far LOD: throttle remaining detail animation to every 4th frame.
    // Shader uniforms are unused at far LOD (no _applyBodyShader on MeshStandardMaterial),
    // so the implicit uniform skip below is intentional.
    if (tierName === 'far' && (this._frameCounter & 3) !== 0) return;

    // ── Tail undulation: per-segment sinusoidal wave propagating tail-ward
    const segs  = activeTier.tailSegments;
    const conns = activeTier.tailConnectors;
    const n     = segs.length;
    for (let i = 0; i < n; i++) {
      const t     = n > 1 ? i / (n - 1) : 0;
      const wAmp  = 0.08 + t * 0.32; // amplitude grows toward tail tip
      const phase = swimTime * 2.2 - i * 0.6;
      segs[i].rotation.y = Math.sin(phase) * wAmp;
      segs[i].position.z = Math.sin(phase) * wAmp * 0.28;
      segs[i].position.y = segs[i].userData.baseY + Math.sin(phase * 0.5) * t * 0.06;
    }
    // Animate connecting tissue to follow tail wave.
    // Connectors are indexed by segment (0..n-2), parameterized the same way as segments
    // so their wave amplitude matches their adjacent segment.
    for (let i = 0; i < conns.length; i++) {
      const t     = n > 1 ? i / (n - 1) : 0;
      const wAmp  = 0.08 + t * 0.32;
      const phase = swimTime * 2.2 - i * 0.6 - 0.3;
      conns[i].rotation.y = Math.sin(phase) * wAmp;
      conns[i].position.z = Math.sin(phase) * wAmp * 0.28;
      conns[i].position.y = conns[i].userData.baseY + Math.sin(phase * 0.5) * t * 0.06;
    }

    // ── Vertex shader uniforms ────────────────────────────────────────────
    const bUni = activeTier.bodyMaterial?.userData?.shaderUniforms;
    if (bUni) {
      bUni.uSwimTime.value = swimTime;
      bUni.uSwimAmp.value  = swimAmp;
      if (bUni.uTurnBend  !== undefined) bUni.uTurnBend.value  = this._bankAngle * 3.0;
      if (bUni.uProximity !== undefined) bUni.uProximity.value = proximity;
      if (bUni.uPhaseSpd  !== undefined) bUni.uPhaseSpd.value  = this.phaseShiftSpeed;
    }

    // ── Dorsal fin flutter ────────────────────────────────────────────────
    const fUni = activeTier.finMaterial?.userData?.shaderUniforms;
    if (fUni) {
      fUni.uFinTime.value = swimTime;
      fUni.uFinWave.value = 0.45 + swimAmp * 0.55;
    }

    // ── Pectoral fin banking + secondary membrane flex ────────────────────
    for (const pFin of activeTier.pectoralFins) {
      // Bank into turns
      pFin.rotation.z = pFin.userData.baseRotZ + this._bankAngle * pFin.userData.side * 0.45;
      // Secondary motion: membrane flexes with lag behind body
      pFin.rotation.x = pFin.userData.baseRotX + Math.sin(swimTime * 1.6 + pFin.userData.side * 0.4) * 0.08;
    }

    // ── Gill slit pulsation: breathing / idle cycle ───────────────────────
    if (activeTier.gillSlits.length > 0) {
      const breath = 0.85 + Math.sin(this.time * 1.25) * 0.15;
      for (let i = 0; i < activeTier.gillSlits.length; i++) {
        activeTier.gillSlits[i].scale.y = breath * (0.9 + (i % 4) * 0.05);
      }
    }

    // ── Jaw gape: synchronized with swim cycle ────────────────────────────
    if (activeTier.jaw) {
      activeTier.jaw.rotation.z = -0.08 - Math.abs(Math.sin(swimTime * 1.1)) * 0.08;
    }
  }

  getPosition() { return this.group.position; }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
  }
}
