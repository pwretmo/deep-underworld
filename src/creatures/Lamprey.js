import * as THREE from 'three';
import { LOD_NEAR_DISTANCE, LOD_MEDIUM_DISTANCE } from './lodUtils.js';

// ─── constants ────────────────────────────────────────────────────────────────
const BODY_LENGTH            = 3.36;  // 12 × 0.28 — preserves original total length
const BASE_TUBE_RADIUS       = 0.25;
const LAMPREY_RESPAWN_DIST   = 200;
const PURSUIT_ACTIVE_DIST    = 15;   // scaled-space distance below which prey-chase modifiers kick in
const MIN_SCALE_DIVISOR      = 0.1;  // prevents division by zero when scale is near-zero
const GILL_BREATH_FREQ       = 2.0;  // gill pulse frequency multiplier relative to mouth phase
const GILL_PHASE_OFFSET      = 0.7;  // phase stagger between adjacent gill pairs
const GILL_PULSE_AMPLITUDE   = 0.18; // normalised scale amplitude of gill breathing

// Pre-allocated temp — zero per-frame allocation
const _tmpVec3 = new THREE.Vector3();

// ─── module-level singleton textures (never disposed per instance) ─────────────
let _bodyNormalTex = null;

function _getBodyNormalTexture() {
  if (_bodyNormalTex) return _bodyNormalTex;
  const W = 256, H = 128;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H;
      // muscle-band pattern along body (u), scale-ridge pattern around girth (v)
      const band  = Math.sin(u * 64.0) * 0.20;
      const ridge = Math.sin(v * 96.0 + u * 16.0) * 0.10;
      const nx = THREE.MathUtils.clamp(0.5 + ridge, 0, 1);
      const ny = THREE.MathUtils.clamp(0.5 + band,  0, 1);
      const nz = Math.sqrt(Math.max(0, 1 - (nx * 2 - 1) ** 2 - (ny * 2 - 1) ** 2)) * 0.5 + 0.5;
      const i = (y * W + x) * 4;
      d[i]     = Math.round(nx * 255);
      d[i + 1] = Math.round(ny * 255);
      d[i + 2] = Math.round(nz * 255);
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  _bodyNormalTex = new THREE.CanvasTexture(canvas);
  _bodyNormalTex.wrapS = THREE.RepeatWrapping;
  _bodyNormalTex.wrapT = THREE.RepeatWrapping;
  _bodyNormalTex.needsUpdate = true;
  return _bodyNormalTex;
}

// ─── geometry helpers ─────────────────────────────────────────────────────────

/** Spine curve: head at x = 0, tail at x = −BODY_LENGTH */
function _makeSpineCurve() {
  return new THREE.CatmullRomCurve3([
    new THREE.Vector3(0,                   0, 0),
    new THREE.Vector3(-BODY_LENGTH * 0.25, 0, 0),
    new THREE.Vector3(-BODY_LENGTH * 0.5,  0, 0),
    new THREE.Vector3(-BODY_LENGTH * 0.75, 0, 0),
    new THREE.Vector3(-BODY_LENGTH,        0, 0),
  ]);
}

/**
 * Tapered TubeGeometry along the spine.
 * Radius tapers from BASE_TUBE_RADIUS at head (uv.x = 0)
 * to BASE_TUBE_RADIUS × 0.5 at tail (uv.x = 1).
 * BufferGeometry attribute mutation only — no dispose/recreate.
 */
function _buildBodyTube(tubularSegs, radialSegs) {
  const curve = _makeSpineCurve();
  const geo   = new THREE.TubeGeometry(curve, tubularSegs, BASE_TUBE_RADIUS, radialSegs, false);
  const pos   = geo.attributes.position;
  const uvAttr = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const t     = uvAttr.getX(i);          // 0 = head, 1 = tail
    const taper = 1.0 - t * 0.5;           // 1.0 → 0.5
    pos.setY(i, pos.getY(i) * taper);
    pos.setZ(i, pos.getZ(i) * taper);
  }
  geo.computeVertexNormals();
  return geo;
}

// ─── material helpers ─────────────────────────────────────────────────────────

/**
 * Build the body tube material.
 * Non-far tiers receive a vertex-shader anguilliform wave and a Fresnel rim-light.
 * Returns { mat, shaderUniforms } — shaderUniforms is null for the far tier.
 */
function _buildBodyMat(useFarMat) {
  if (useFarMat) {
    return {
      mat: new THREE.MeshStandardMaterial({
        color: 0x0c0a08, roughness: 0.15, metalness: 0.8,
        emissive: 0x502040, emissiveIntensity: 0.5,
      }),
      shaderUniforms: null,
    };
  }

  // Per-instance uniform objects — each Lamprey instance gets its own set
  const shaderUniforms = {
    uWavePhase:  { value: 0.0 },
    uWaveNumber: { value: 2.5 },
    uAmplitude:  { value: 0.18 },
  };

  const mat = new THREE.MeshPhysicalMaterial({
    color: 0x0c0a08, roughness: 0.12, metalness: 0.85,
    clearcoat: 1.0, clearcoatRoughness: 0.05,
    emissive: 0x502040, emissiveIntensity: 0.5,
    normalMap: _getBodyNormalTexture(),
    normalScale: new THREE.Vector2(0.5, 0.5),
  });

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shaderUniforms);

    // Vertex shader: GPU anguilliform body wave
    // uv.x: 0 = head, 1 = tail; lateral displacement grows toward tail
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uWavePhase;
uniform float uWaveNumber;
uniform float uAmplitude;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
float _bodyT = uv.x;
float _wave  = sin(uWavePhase - _bodyT * uWaveNumber * 6.2832) * uAmplitude * _bodyT;
transformed.z += _wave;`
      );

    // Fragment shader: Fresnel rim-light for deep-zone silhouette visibility
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
float _fresnel = pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 3.0);
totalEmissiveRadiance += vec3(0.25, 0.10, 0.35) * _fresnel * 0.55;`
      );
  };

  return { mat, shaderUniforms };
}

// ─── LOD tier profiles ────────────────────────────────────────────────────────
const _LAMPREY_TIERS = [
  { name: 'near',   tubularSegs: 80, radialSegs: 16, mouthDetail: true,  gillDetail: true,  dist: 0                  },
  { name: 'medium', tubularSegs: 40, radialSegs: 8,  mouthDetail: true,  gillDetail: false, dist: LOD_NEAR_DISTANCE   },
  { name: 'far',    tubularSegs: 16, radialSegs: 6,  mouthDetail: false, gillDetail: false, dist: LOD_MEDIUM_DISTANCE },
];

// ─── Lamprey class ─────────────────────────────────────────────────────────────
// Parasitic lamprey with continuous TubeGeometry body, anguilliform vertex-shader
// wave, 3-tier LOD, counter-rotating tooth rings, bioluminescent lip ring.
export class Lamprey {
  constructor(scene, position) {
    this.scene     = scene;
    this.group     = new THREE.Group();
    this.time      = Math.random() * 100;
    this.speed     = 2.5 + Math.random() * 1.5;
    this.direction = new THREE.Vector3(Math.random() - 0.5, -0.1, Math.random() - 0.5).normalize();
    this.turnTimer    = 0;
    this.turnInterval = 4 + Math.random() * 5;

    // Per-instance procedural variation
    this._wavePhase  = Math.random() * Math.PI * 2;
    this._waveFreq   = 2.8 + Math.random() * 0.8;
    this._mouthPhase = Math.random() * Math.PI * 2;

    // Body shader uniform refs (updated each frame, zero alloc)
    this._bodyShaderUniforms = [];

    // Near-tier animated mesh refs
    this._outerRing  = null;   // outer tooth ring — forward rotation
    this._innerRing  = null;   // inner tooth ring — counter-rotation
    this._lipMesh    = null;   // torus lip for dilation pulsation
    this._gillMeshes = [];     // gill slit planes for breathing animation
    this._mouthLight = null;

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  // ── build ───────────────────────────────────────────────────────────────────
  _buildModel() {
    const lod = new THREE.LOD();
    let nearGroup = null;

    for (const cfg of _LAMPREY_TIERS) {
      const useFar = (cfg.name === 'far');
      const isNear = (cfg.name === 'near');
      const tierGroup = this._buildTier(cfg, useFar, isNear);
      if (isNear) nearGroup = tierGroup;
      lod.addLevel(tierGroup, cfg.dist);
    }

    this.group.add(lod);

    // Mouth glow light — attached to near tier only (inside LOD)
    this._mouthLight = new THREE.PointLight(0xff2200, 0.8, 12);
    this._mouthLight.position.set(0.42, 0, 0);
    if (nearGroup) nearGroup.add(this._mouthLight);

    this.group.scale.setScalar(2 + Math.random() * 2);
  }

  _buildTier(cfg, useFarMat, isNear) {
    const g = new THREE.Group();

    // ── continuous body tube ───────────────────────────────────────────────
    const tubeGeo = _buildBodyTube(cfg.tubularSegs, cfg.radialSegs);
    const { mat: bodyMat, shaderUniforms } = _buildBodyMat(useFarMat);
    if (shaderUniforms) this._bodyShaderUniforms.push(shaderUniforms);
    g.add(new THREE.Mesh(tubeGeo, bodyMat));

    // ── gill openings (near tier only) ────────────────────────────────────
    if (cfg.gillDetail) {
      const gillMat = new THREE.MeshPhysicalMaterial({
        color: 0x080408, roughness: 0.9, metalness: 0,
        emissive: 0x300a10, emissiveIntensity: 0.5,
        side: THREE.DoubleSide,
      });
      const spine = _makeSpineCurve();
      for (let gi = 0; gi < 7; gi++) {
        const t  = 0.10 + gi * 0.10;
        const cp = spine.getPointAt(t);
        const r  = BASE_TUBE_RADIUS * (1 - t * 0.5) + 0.01;
        for (const side of [-1, 1]) {
          const gillGeo = new THREE.PlaneGeometry(0.05, 0.10);
          const gill    = new THREE.Mesh(gillGeo, gillMat);
          gill.position.set(cp.x, 0, side * r);
          gill.rotation.y = Math.PI / 2;
          g.add(gill);
          if (isNear) this._gillMeshes.push(gill);
        }
      }
    }

    // ── mouth + teeth ──────────────────────────────────────────────────────
    if (cfg.mouthDetail) {
      const mouthGrp = new THREE.Group();
      mouthGrp.position.set(0.34, 0, 0);   // just ahead of tube head at x = 0

      const toothMat = useFarMat
        ? new THREE.MeshStandardMaterial({
            color: 0x504038, roughness: 0.2, metalness: 0,
            emissive: 0x504030, emissiveIntensity: 0.4,
          })
        : new THREE.MeshPhysicalMaterial({
            color: 0x504038, roughness: 0.2, metalness: 0, clearcoat: 1.0,
            emissive: 0x504030, emissiveIntensity: 0.5,
          });

      // Two independently rotating rings for counter-rotation effect
      const outerRing = new THREE.Group();
      const innerRing = new THREE.Group();

      // 3 concentric rings: 12, 10, 8 teeth (8+ segment cones with serration)
      for (let ring = 0; ring < 3; ring++) {
        const r      = 0.22 - ring * 0.05;
        const count  = 12 - ring * 2;
        const parent = ring <= 1 ? outerRing : innerRing;
        for (let ti = 0; ti < count; ti++) {
          const ang  = (ti / count) * Math.PI * 2;
          const tGeo = new THREE.ConeGeometry(0.013, 0.09 + ring * 0.015, 8, 1);
          // serration: displace tip vertices radially
          const tPos = tGeo.attributes.position;
          for (let vi = 0; vi < tPos.count; vi++) {
            if (tPos.getY(vi) > 0.03) {
              const serr = Math.sin(Math.atan2(tPos.getX(vi), tPos.getZ(vi)) * 4.0) * 0.006;
              tPos.setX(vi, tPos.getX(vi) + serr);
            }
          }
          tGeo.computeVertexNormals();
          const tooth = new THREE.Mesh(tGeo, toothMat);
          tooth.position.set(0, Math.cos(ang) * r, Math.sin(ang) * r);
          tooth.rotation.z = Math.PI / 2;
          parent.add(tooth);
        }
      }

      // Rasping tongue geometry inside mouth
      if (!useFarMat) {
        const tongueMat = new THREE.MeshPhysicalMaterial({
          color: 0x3a1018, roughness: 0.5, metalness: 0, clearcoat: 0.4,
          emissive: 0x601020, emissiveIntensity: 0.6,
        });
        const tongueGeo = new THREE.CylinderGeometry(0.06, 0.03, 0.10, 8, 2);
        const tongue    = new THREE.Mesh(tongueGeo, tongueMat);
        tongue.rotation.z = Math.PI / 2;
        mouthGrp.add(tongue);
      }

      mouthGrp.add(outerRing);
      mouthGrp.add(innerRing);

      // High-quality fleshy lip ring — bioluminescent + fleshy transmission
      const lipMat = useFarMat
        ? new THREE.MeshStandardMaterial({
            color: 0x1a1020, roughness: 0.3, metalness: 0,
            emissive: 0x602040, emissiveIntensity: 0.6,
          })
        : new THREE.MeshPhysicalMaterial({
            color: 0x1a1020, roughness: 0.35, metalness: 0,
            clearcoat: 0.8, clearcoatRoughness: 0.1,
            emissive: 0x802050, emissiveIntensity: 0.9,
            transmission: 0.12,    // SSS-like fleshy translucency
          });
      const lip = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.04, 16, 32), lipMat);
      lip.rotation.y = Math.PI / 2;
      mouthGrp.add(lip);

      // Sensor eyes × 4 — improved 10×10 sphere geometry
      for (let ei = 0; ei < 4; ei++) {
        const eyeAng = (ei / 4) * Math.PI * 2;
        const eyeGeo = new THREE.SphereGeometry(0.022, 10, 10);
        const eyeMat = new THREE.MeshPhysicalMaterial({
          color: 0xff4400, emissive: 0xff2200, emissiveIntensity: 2.5, roughness: 0,
        });
        const eye = new THREE.Mesh(eyeGeo, eyeMat);
        eye.position.set(0.10, Math.cos(eyeAng) * 0.28, Math.sin(eyeAng) * 0.28);
        mouthGrp.add(eye);
      }

      g.add(mouthGrp);

      // Store animated refs for near tier only
      if (isNear) {
        this._outerRing = outerRing;
        this._innerRing = innerRing;
        this._lipMesh   = lip;
      }
    } else {
      // Far tier: minimal mouth silhouette
      const simpleMouth = new THREE.Mesh(
        new THREE.TorusGeometry(0.20, 0.03, 6, 12),
        new THREE.MeshStandardMaterial({
          color: 0x1a1020, emissive: 0x602040, emissiveIntensity: 0.5,
        })
      );
      simpleMouth.position.set(0.34, 0, 0);
      simpleMouth.rotation.y = Math.PI / 2;
      g.add(simpleMouth);
    }

    // ── tail fin ───────────────────────────────────────────────────────────
    const tailProps = { color: 0x0c0a08, roughness: 0.15, metalness: 0.8, emissive: 0x502040, emissiveIntensity: 0.4, side: THREE.DoubleSide };
    const tailMat   = useFarMat
      ? new THREE.MeshStandardMaterial(tailProps)
      : new THREE.MeshPhysicalMaterial({ ...tailProps, clearcoat: 0.6 });
    const tail = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.35, 2, 4), tailMat);
    tail.position.set(-BODY_LENGTH - 0.06, 0, 0);
    tail.rotation.y = Math.PI / 2;
    g.add(tail);

    return g;
  }

  // ── update ──────────────────────────────────────────────────────────────────
  update(dt, playerPos) {
    this.time        += dt;
    this._wavePhase  += dt * this._waveFreq;
    this._mouthPhase += dt * 1.2;
    this.turnTimer   += dt;

    // Direction changes
    if (this.turnTimer > this.turnInterval) {
      this.turnTimer    = 0;
      this.turnInterval = 4 + Math.random() * 5;
      if (Math.random() < 0.5) {
        this.direction.subVectors(playerPos, this.group.position).normalize();
        this.direction.y *= 0.3;
      } else {
        this.direction.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.15, Math.random() - 0.5).normalize();
      }
    }

    // Movement — zero allocation via pre-allocated _tmpVec3
    _tmpVec3.copy(this.direction).multiplyScalar(this.speed * dt);
    this.group.position.add(_tmpVec3);

    // Face direction of travel
    const angle = Math.atan2(this.direction.x, this.direction.z);
    this.group.rotation.y = THREE.MathUtils.lerp(this.group.rotation.y, angle + Math.PI / 2, dt * 4);

    // Body corkscrew roll (occasional, more aggressive near player)
    const scaledDist   = this.group.position.distanceTo(playerPos) / Math.max(this.group.scale.x, MIN_SCALE_DIVISOR);
    const pursuitFactor = scaledDist < PURSUIT_ACTIVE_DIST ? (1.0 - scaledDist / PURSUIT_ACTIVE_DIST) : 0;
    this.group.rotation.x = Math.sin(this.time * (0.5 + pursuitFactor)) * (0.06 + pursuitFactor * 0.08);

    // ── GPU body wave: update shader uniforms (breathing amplitude variation) ──
    const breathAmp = 0.18 + Math.sin(this.time * 0.3) * 0.03;
    for (const su of this._bodyShaderUniforms) {
      su.uWavePhase.value = this._wavePhase;
      su.uAmplitude.value = breathAmp;
    }

    // ── near-tier mouth animations ──
    if (this._outerRing) {
      this._outerRing.rotation.x += dt * 1.8;           // forward
    }
    if (this._innerRing) {
      this._innerRing.rotation.x -= dt * 2.6;           // counter-rotation
    }

    // Lip dilation pulsation — opens wider when player is close
    if (this._lipMesh) {
      const reactivity = pursuitFactor > 0 ? 1.0 + pursuitFactor * 1.5 : 1.0;
      const dil = 1.0 + Math.sin(this._mouthPhase) * 0.07 * reactivity;
      this._lipMesh.scale.set(dil, dil, 1);
    }

    // Mouth light pulsing (keyed to dilation cycle)
    if (this._mouthLight) {
      this._mouthLight.intensity = 0.6 + Math.sin(this._mouthPhase * 1.5) * 0.3;
    }

    // Gill flap pulse (secondary breathing motion)
    for (let gi = 0; gi < this._gillMeshes.length; gi++) {
      this._gillMeshes[gi].scale.y = 1.0 + Math.sin(this._mouthPhase * GILL_BREATH_FREQ + gi * GILL_PHASE_OFFSET) * GILL_PULSE_AMPLITUDE;
    }

    // Respawn when too far from player
    if (this.group.position.distanceTo(playerPos) > LAMPREY_RESPAWN_DIST) {
      const a = Math.random() * Math.PI * 2;
      this.group.position.set(
        playerPos.x + Math.cos(a) * 60,
        playerPos.y - Math.random() * 10,
        playerPos.z + Math.sin(a) * 60
      );
    }
  }

  getPosition() { return this.group.position; }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(c => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
        else c.material.dispose();
      }
    });
  }
}
