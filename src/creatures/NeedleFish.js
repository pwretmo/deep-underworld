import * as THREE from 'three/webgpu';
import { abs, clamp, dot, materialEmissive, normalLocal, normalView, positionLocal, positionView, pow, sin, smoothstep, sub, uniform, vec3 } from 'three/tsl';
import { qualityManager } from '../QualityManager.js';

// LOD distance thresholds
const NEAR_DIST = 30;
const FAR_DIST = 80;

// Body cylinder half-length (CylinderGeometry height / 2) — must match geometry in _buildNear
const BODY_HALF_LEN = 2.0;

// Dorsal spine angles: retracted (lying along body) and erect (threat display)
const SPINE_RETRACTED_ANGLE = -1.2;
const SPINE_ERECT_ANGLE = 0.1;

// Far-LOD animation frame-skip intervals
const FAR_LOD_SKIP_ULTRA = 4;
const FAR_LOD_SKIP_DEFAULT = 3;

// Dart interval multiplier when player is within threat range (increases dart frequency)
const NEAR_PLAYER_DART_FREQUENCY_MULTIPLIER = 0.45;

// Extremely thin, fast needle fish — carangiform swimming + dart-and-stop + spine erection
export class NeedleFish {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();

    // Timing & per-instance randomized variation
    this.time = Math.random() * 100;
    this._phaseOffset = Math.random() * Math.PI * 2;
    this._dartAmplitude = 0.7 + Math.random() * 0.6;

    // Movement
    this.speed = 4 + Math.random() * 3;
    this.direction = new THREE.Vector3(Math.random() - 0.5, -0.05, Math.random() - 0.5).normalize();
    this.turnTimer = 0;
    this.turnInterval = 3 + Math.random() * 4;

    // Pre-allocated reusable objects — zero per-frame allocation
    this._velocity = new THREE.Vector3();
    this._desiredVel = new THREE.Vector3();
    this._toPlayer = new THREE.Vector3();
    this._tmpVec = new THREE.Vector3();
    this._tmpMatrix = new THREE.Matrix4();
    this._tmpPos = new THREE.Vector3();
    this._tmpQuat = new THREE.Quaternion();
    this._tmpScale = new THREE.Vector3(1, 1, 1);
    this._tmpEuler = new THREE.Euler();

    // Dart-and-stop state machine — cruise → dart → glide → cruise
    this._dartState = 'cruise';
    this._dartTimer = 0;
    this._dartInterval = 1.5 + Math.random() * 3;   // randomized per instance
    this._dartDuration = 0.3 + Math.random() * 0.4;
    this._glideDuration = 0.5 + Math.random() * 1.5;

    // Animation state
    this._swimPhase = this._phaseOffset;
    this._bodyFlex = 0;
    this._spineErection = 0;
    this._jawOpen = 0;
    this._distToPlayer = 999;

    // LOD state
    this._frameCounter = 0;
    this._lodTier = 'near';
    this._lastLodTier = 'near';

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  // ─── Build ─────────────────────────────────────────────────────────────────

  _buildModel() {
    this.tiers = {
      near:   this._buildNear(),
      medium: this._buildMedium(),
      far:    this._buildFar(),
    };
    this.group.add(this.tiers.near.group);
    this.group.add(this.tiers.medium.group);
    this.group.add(this.tiers.far.group);
    this.tiers.medium.group.visible = false;
    this.tiers.far.group.visible = false;

    const s = 1.5 + Math.random() * 1;
    this.group.scale.setScalar(s);
  }

  _applyBodyShader(mat) {
    mat.userData.shaderUniforms = {
      uSwimPhase: uniform(0),
      uBodyFlex:  uniform(0),
      uAmplitude: uniform(this._dartAmplitude),
    };
    const u = mat.userData.shaderUniforms;

    // TSL: vertex carangiform wave + scale relief
    const bodyT = clamp(positionLocal.y.negate().add(BODY_HALF_LEN).div(BODY_HALF_LEN * 2), 0.0, 1.0);
    const ampRamp = bodyT.mul(bodyT);
    const wave = sin(positionLocal.y.mul(2.8).sub(u.uSwimPhase)).mul(ampRamp).mul(u.uAmplitude).mul(0.11).mul(u.uBodyFlex);
    const scaleDetail = sin(positionLocal.y.mul(23.0).add(positionLocal.x.mul(17.0))).mul(0.007);
    mat.positionNode = vec3(positionLocal.x, positionLocal.y, positionLocal.z.add(wave)).add(normalLocal.mul(scaleDetail));

    // TSL: fragment Fresnel rim + lateral-line threat glow
    const viewDir = positionView.negate().normalize();
    const rim = pow(sub(1.0, abs(dot(normalView, viewDir))), 2.5);
    mat.emissiveNode = materialEmissive
      .add(vec3(0.07, 0.03, 0.12).mul(rim).mul(0.6))
      .add(vec3(0.35, 0.0, 0.25).mul(u.uBodyFlex).mul(0.25).mul(rim));

    mat.needsUpdate = true;
  }

  _applyTailShader(mat) {
    mat.userData.shaderUniforms = {
      uSwimPhase: uniform(0),
      uBodyFlex:  uniform(0),
    };
    const u = mat.userData.shaderUniforms;

    // TSL: vertex caudal fin oscillation
    const finEdge = smoothstep(0.0, 0.15, positionLocal.y.abs());
    const tailFlutter = sin(positionLocal.y.mul(9.0).sub(u.uSwimPhase.mul(1.6))).mul(0.045).mul(u.uBodyFlex).mul(finEdge);
    mat.positionNode = vec3(positionLocal.x, positionLocal.y, positionLocal.z.add(tailFlutter));

    mat.needsUpdate = true;
  }

  /** Near tier — full detail, vertex shaders, InstancedMesh spines, jaw, pectoral fins. */
  _buildNear() {
    const g = new THREE.Group();

    // ── Materials ──
    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: 0x181828,
      roughness: 0.08, metalness: 0,
      clearcoat: 1.0, clearcoatRoughness: 0.04,
      iridescence: 0.75,
      iridescenceIOR: 1.38,
      iridescenceThicknessRange: [200, 600],
      emissive: 0x502040, emissiveIntensity: 0.55,
    });
    this._applyBodyShader(bodyMat);

    const spineMat = new THREE.MeshPhysicalMaterial({
      color: 0x3a3228, roughness: 0.2, metalness: 0,
      clearcoat: 0.9,
      emissive: 0x504030, emissiveIntensity: 0.4,
    });

    const tailMat = new THREE.MeshPhysicalMaterial({
      color: 0x181828, roughness: 0.1, metalness: 0,
      clearcoat: 1.0, side: THREE.DoubleSide,
      transparent: true, opacity: 0.85,
      emissive: 0x502040, emissiveIntensity: 0.4,
    });
    this._applyTailShader(tailMat);

    const finMat = new THREE.MeshPhysicalMaterial({
      color: 0x1a1828, roughness: 0.12, metalness: 0,
      clearcoat: 0.7, side: THREE.DoubleSide,
      transparent: true, opacity: 0.7,
      emissive: 0x401838, emissiveIntensity: 0.3,
    });

    // ── Body — 16 × 20 for smooth cross-section + axial deformation ──
    const bodyGeo = new THREE.CylinderGeometry(0.06, 0.02, 4, 16, 20);
    {
      const bp = bodyGeo.attributes.position;
      for (let i = 0; i < bp.count; i++) {
        const y = bp.getY(i);
        const bulge = Math.max(0, 1 - Math.abs(y) * 0.5) * 0.04;
        bp.setX(i, bp.getX(i) + bulge);
        bp.setZ(i, bp.getZ(i) + bulge);
      }
      bodyGeo.computeVertexNormals();
    }
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.rotation.z = Math.PI / 2;
    g.add(body);

    // ── Needle snout — 12-segment blade edge ──
    const snout = new THREE.Mesh(new THREE.ConeGeometry(0.04, 1.5, 12), bodyMat);
    snout.rotation.z = -Math.PI / 2;
    snout.position.x = 2.7;
    g.add(snout);

    // ── Upper mandible ──
    const upperJaw = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.7, 8), bodyMat);
    upperJaw.rotation.z = -Math.PI / 2;
    upperJaw.position.set(3.22, 0.013, 0);
    g.add(upperJaw);

    // ── Lower mandible ──
    const lowerJaw = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.65, 8), bodyMat);
    lowerJaw.rotation.z = -Math.PI / 2;
    lowerJaw.position.set(3.17, -0.013, 0);
    g.add(lowerJaw);

    // ── Dorsal spines — InstancedMesh (single draw call, 8 instances) ──
    const dorsalCount = 8;
    const dorsalInst = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.008, 0.35, 8), spineMat, dorsalCount
    );
    dorsalInst.castShadow = false;
    this._tmpQuat.identity();
    for (let i = 0; i < dorsalCount; i++) {
      this._tmpPos.set(i * 0.4 - 1.5, 0.07, 0);
      this._tmpMatrix.compose(this._tmpPos, this._tmpQuat, this._tmpScale);
      dorsalInst.setMatrixAt(i, this._tmpMatrix);
    }
    dorsalInst.instanceMatrix.needsUpdate = true;
    g.add(dorsalInst);

    // ── Ventral spines — InstancedMesh (6 instances) ──
    const ventralCount = 6;
    const ventralInst = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.006, 0.25, 8), spineMat, ventralCount
    );
    ventralInst.castShadow = false;
    this._tmpEuler.set(0, 0, Math.PI);
    this._tmpQuat.setFromEuler(this._tmpEuler);
    for (let i = 0; i < ventralCount; i++) {
      this._tmpPos.set(i * 0.5 - 1, -0.065, 0);
      this._tmpMatrix.compose(this._tmpPos, this._tmpQuat, this._tmpScale);
      ventralInst.setMatrixAt(i, this._tmpMatrix);
    }
    ventralInst.instanceMatrix.needsUpdate = true;
    g.add(ventralInst);

    // ── Lateral barbs — InstancedMesh (10 instances) ──
    const barbCount = 10;
    const barbInst = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.005, 0.15, 8), spineMat, barbCount
    );
    barbInst.castShadow = false;
    let bi = 0;
    for (let i = 0; i < 5; i++) {
      for (const side of [-1, 1]) {
        this._tmpPos.set(i * 0.5 - 0.8, 0, side * 0.07);
        this._tmpEuler.set(side * -Math.PI / 3, 0, 0);
        this._tmpQuat.setFromEuler(this._tmpEuler);
        this._tmpMatrix.compose(this._tmpPos, this._tmpQuat, this._tmpScale);
        barbInst.setMatrixAt(bi++, this._tmpMatrix);
      }
    }
    barbInst.instanceMatrix.needsUpdate = true;
    g.add(barbInst);

    // ── Pectoral fins ──
    for (const side of [-1, 1]) {
      const pFin = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.15, 4, 3), finMat);
      pFin.position.set(1.1, -0.02, side * 0.08);
      pFin.rotation.set(0, side * 0.25, side * 0.35);
      g.add(pFin);
    }

    // ── Eyes — high-res ──
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.015, 12, 12),
        new THREE.MeshPhysicalMaterial({
          color: 0xff0000, emissive: 0xff2200, emissiveIntensity: 3.0, roughness: 0,
        })
      );
      eye.position.set(1.8, 0.02, side * 0.05);
      g.add(eye);
    }

    // ── Tail fin — 6 × 4 with vertex shader ──
    const tail = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.15, 6, 4), tailMat);
    tail.position.x = -2.1;
    tail.rotation.y = Math.PI / 2;
    g.add(tail);

    // Secondary tail lobes (fin rays)
    for (const side of [-1, 1]) {
      const lobe = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.07, 3, 2), finMat);
      lobe.position.set(-2.2, side * 0.085, 0);
      lobe.rotation.set(0, Math.PI / 2, side * 0.32);
      g.add(lobe);
    }

    return {
      group: g,
      bodyMat, tailMat,
      dorsalInst, dorsalCount,
      ventralInst, ventralCount,
      barbInst, barbCount,
      upperJaw, lowerJaw,
      isNear: true, isMedium: false, isFar: false,
    };
  }

  /** Medium tier — simplified materials (MeshStandard), 50% spines, no jaw, no shader. */
  _buildMedium() {
    const g = new THREE.Group();

    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x181828, roughness: 0.15, metalness: 0,
      emissive: 0x502040, emissiveIntensity: 0.5,
    });
    const spineMat = new THREE.MeshStandardMaterial({
      color: 0x3a3228, roughness: 0.25, metalness: 0,
      emissive: 0x504030, emissiveIntensity: 0.3,
    });

    // Body
    const bodyGeo = new THREE.CylinderGeometry(0.06, 0.02, 4, 10, 10);
    {
      const bp = bodyGeo.attributes.position;
      for (let i = 0; i < bp.count; i++) {
        const y = bp.getY(i);
        const b = Math.max(0, 1 - Math.abs(y) * 0.5) * 0.04;
        bp.setX(i, bp.getX(i) + b);
        bp.setZ(i, bp.getZ(i) + b);
      }
      bodyGeo.computeVertexNormals();
    }
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.rotation.z = Math.PI / 2;
    g.add(body);

    // Snout
    const snout = new THREE.Mesh(new THREE.ConeGeometry(0.04, 1.5, 8), bodyMat);
    snout.rotation.z = -Math.PI / 2;
    snout.position.x = 2.7;
    g.add(snout);

    // Dorsal spines — 4 instances (50% of near tier)
    const dorsalCount = 4;
    const dorsalInst = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.008, 0.35, 6), spineMat, dorsalCount
    );
    dorsalInst.castShadow = false;
    this._tmpQuat.identity();
    for (let i = 0; i < dorsalCount; i++) {
      this._tmpPos.set(i * 0.8 - 1.5, 0.07, 0);
      this._tmpMatrix.compose(this._tmpPos, this._tmpQuat, this._tmpScale);
      dorsalInst.setMatrixAt(i, this._tmpMatrix);
    }
    dorsalInst.instanceMatrix.needsUpdate = true;
    g.add(dorsalInst);

    // Eyes
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.015, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff2200, emissiveIntensity: 2.5, roughness: 0 })
      );
      eye.position.set(1.8, 0.02, side * 0.05);
      g.add(eye);
    }

    // Simple tail fin
    const tail = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 0.15, 3, 2),
      new THREE.MeshStandardMaterial({
        color: 0x181828, side: THREE.DoubleSide,
        emissive: 0x502040, emissiveIntensity: 0.3, roughness: 0.15,
      })
    );
    tail.position.x = -2.1;
    tail.rotation.y = Math.PI / 2;
    g.add(tail);

    return {
      group: g,
      dorsalInst, dorsalCount,
      isNear: false, isMedium: true, isFar: false,
    };
  }

  /** Far tier — < 50 triangles, MeshBasicMaterial silhouette. */
  _buildFar() {
    const g = new THREE.Group();

    const mat = new THREE.MeshBasicMaterial({
      color: 0x14101e,
      transparent: true, opacity: 0.92,
    });

    // Elongated body silhouette: CylinderGeometry 5 radial × 1 height = ~20 tris
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.012, 5, 5, 1), mat);
    body.rotation.z = Math.PI / 2;
    g.add(body);

    // Snout extension
    const snout = new THREE.Mesh(new THREE.ConeGeometry(0.028, 1.4, 4), mat);
    snout.rotation.z = -Math.PI / 2;
    snout.position.x = 2.9;
    g.add(snout);

    // Eye emissive
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff1100 });
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.015, 3, 3), eyeMat);
      eye.position.set(1.8, 0.02, side * 0.04);
      g.add(eye);
    }

    return {
      group: g,
      isNear: false, isMedium: false, isFar: true,
    };
  }

  // ─── LOD ───────────────────────────────────────────────────────────────────

  _resolveLodTier(dist) {
    const h = 4;
    if (this._lastLodTier === 'near'   && dist < NEAR_DIST + h) return 'near';
    if (this._lastLodTier === 'medium' && dist > NEAR_DIST - h && dist < FAR_DIST + h) return 'medium';
    if (this._lastLodTier === 'far'    && dist > FAR_DIST - h) return 'far';
    if (dist < NEAR_DIST) return 'near';
    if (dist < FAR_DIST)  return 'medium';
    return 'far';
  }

  // ─── Movement ──────────────────────────────────────────────────────────────

  _updateMovement(dt, playerPos) {
    this.turnTimer += dt;
    if (this.turnTimer > this.turnInterval) {
      this.turnTimer = 0;
      this.turnInterval = 3 + Math.random() * 4;
      if (Math.random() < 0.4) {
        this.direction.subVectors(playerPos, this.group.position).normalize();
        this.direction.y *= 0.2;
      } else {
        this.direction.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.1, Math.random() - 0.5).normalize();
      }
    }

    // Dart-and-stop state machine
    this._dartTimer += dt;
    const nearPlayer = this._distToPlayer < 20;
    const dartIntervalScale = nearPlayer ? NEAR_PLAYER_DART_FREQUENCY_MULTIPLIER : 1.0;

    if (this._dartState === 'cruise') {
      if (this._dartTimer > this._dartInterval * dartIntervalScale) {
        this._dartState = 'dart';
        this._dartTimer = 0;
        // Slight direction variation on each dart
        if (Math.random() < 0.35) {
          this.direction.subVectors(playerPos, this.group.position).normalize();
          this.direction.y *= 0.12;
        } else {
          this._tmpVec.set((Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.5);
          this.direction.add(this._tmpVec).normalize();
        }
      }
    } else if (this._dartState === 'dart') {
      if (this._dartTimer > this._dartDuration) {
        this._dartState = 'glide';
        this._dartTimer = 0;
      }
    } else { // glide
      if (this._dartTimer > this._glideDuration) {
        this._dartState = 'cruise';
        this._dartTimer = 0;
        this._dartInterval = (1.5 + Math.random() * 3) * dartIntervalScale;
      }
    }

    // Speed per state: burst during dart, decelerate during glide, normal cruise
    const targetSpeed = this._dartState === 'dart'
      ? this.speed * (2.5 + this._dartAmplitude)
      : this._dartState === 'glide'
        ? this.speed * 0.25
        : this.speed;

    // Smooth acceleration / deceleration (weight + inertia)
    this._desiredVel.copy(this.direction).multiplyScalar(targetSpeed);
    this._velocity.lerp(this._desiredVel, 1 - Math.exp(-5.5 * dt));
    this.group.position.addScaledVector(this._velocity, dt);

    // Face direction of travel
    const angle = Math.atan2(this.direction.x, this.direction.z);
    const turnRate = this._dartState === 'dart' ? 10 : 6;
    this.group.rotation.y = THREE.MathUtils.lerp(this.group.rotation.y, angle + Math.PI / 2, dt * turnRate);

    // Respawn if too far
    if (this.group.position.distanceTo(playerPos) > 200) {
      const a = Math.random() * Math.PI * 2;
      this.group.position.set(
        playerPos.x + Math.cos(a) * 60,
        playerPos.y - Math.random() * 10,
        playerPos.z + Math.sin(a) * 60
      );
      this._dartState = 'cruise';
    }
  }

  // ─── Animation ─────────────────────────────────────────────────────────────

  _animateNear(dt) {
    const tier = this.tiers.near;
    const isDart  = this._dartState === 'dart';
    const isGlide = this._dartState === 'glide';

    // Swim phase drives GPU carangiform wave
    this._swimPhase += (isDart ? 18 : isGlide ? 3 : 9) * dt;

    // Body flex: high during dart, near-zero during glide
    const flexTarget = isDart ? 1.0 : isGlide ? 0.06 : 0.45;
    this._bodyFlex = THREE.MathUtils.lerp(this._bodyFlex, flexTarget, 1 - Math.exp(-5 * dt));

    // Update body and tail vertex shader uniforms
    if (tier.bodyMat?.userData?.shaderUniforms) {
      tier.bodyMat.userData.shaderUniforms.uSwimPhase.value = this._swimPhase;
      tier.bodyMat.userData.shaderUniforms.uBodyFlex.value  = this._bodyFlex;
    }
    if (tier.tailMat?.userData?.shaderUniforms) {
      tier.tailMat.userData.shaderUniforms.uSwimPhase.value = this._swimPhase;
      tier.tailMat.userData.shaderUniforms.uBodyFlex.value  = this._bodyFlex;
    }

    // Spine erection: raises during dart or when player is nearby (threat display)
    const spineTarget = (isDart || this._distToPlayer < 20) ? 1.0 : isGlide ? 0.1 : 0.18;
    this._spineErection = THREE.MathUtils.lerp(this._spineErection, spineTarget, 1 - Math.exp(-6 * dt));

    // Dorsal spines: erect = near-vertical (+0.1 rad), retracted = lying along body (-1.2 rad)
    const erectionZ = THREE.MathUtils.lerp(SPINE_RETRACTED_ANGLE, SPINE_ERECT_ANGLE, this._spineErection);
    for (let i = 0; i < tier.dorsalCount; i++) {
      // Secondary motion: inertia lag per spine
      const wobble = Math.sin(this._swimPhase * 0.25 + i * 0.28) * this._spineErection * 0.07;
      this._tmpPos.set(i * 0.4 - 1.5, 0.07 + this._spineErection * 0.05, 0);
      this._tmpEuler.set(0, 0, erectionZ + wobble);
      this._tmpQuat.setFromEuler(this._tmpEuler);
      this._tmpMatrix.compose(this._tmpPos, this._tmpQuat, this._tmpScale);
      tier.dorsalInst.setMatrixAt(i, this._tmpMatrix);
    }
    tier.dorsalInst.instanceMatrix.needsUpdate = true;

    // Jaw snap: opens during dart when close to player
    const jawTarget = (isDart && this._distToPlayer < 12) ? 0.55 : 0.04;
    this._jawOpen = THREE.MathUtils.lerp(this._jawOpen, jawTarget, 1 - Math.exp(-8 * dt));
    if (tier.upperJaw) tier.upperJaw.rotation.z = -Math.PI / 2 + this._jawOpen * 0.4;
    if (tier.lowerJaw) tier.lowerJaw.rotation.z = -Math.PI / 2 - this._jawOpen * 0.4;

    // Body roll with inertia during bursts
    const rollTarget = isDart ? Math.sin(this._swimPhase * 0.5) * 0.06 : 0;
    this.group.rotation.z = THREE.MathUtils.lerp(this.group.rotation.z, rollTarget, 1 - Math.exp(-5 * dt));
  }

  _animateMedium(dt) {
    const isDart = this._dartState === 'dart';
    this._swimPhase += (isDart ? 16 : 8) * dt;

    // Simple body sway — no vertex shader at this tier
    const sway = Math.sin(this._swimPhase * 0.4) * (isDart ? 0.06 : 0.025);
    this.group.rotation.z = THREE.MathUtils.lerp(this.group.rotation.z, sway, 1 - Math.exp(-4 * dt));

    // Simplified spine erection
    const spineTarget = isDart ? 0.9 : 0.15;
    this._spineErection = THREE.MathUtils.lerp(this._spineErection, spineTarget, 1 - Math.exp(-4 * dt));

    const tier = this.tiers.medium;
    const erectionZ = THREE.MathUtils.lerp(SPINE_RETRACTED_ANGLE, SPINE_ERECT_ANGLE, this._spineErection);
    this._tmpQuat.identity();
    for (let i = 0; i < tier.dorsalCount; i++) {
      this._tmpPos.set(i * 0.8 - 1.5, 0.07 + this._spineErection * 0.04, 0);
      this._tmpEuler.set(0, 0, erectionZ);
      this._tmpQuat.setFromEuler(this._tmpEuler);
      this._tmpMatrix.compose(this._tmpPos, this._tmpQuat, this._tmpScale);
      tier.dorsalInst.setMatrixAt(i, this._tmpMatrix);
    }
    tier.dorsalInst.instanceMatrix.needsUpdate = true;
  }

  _animateFar(dt) {
    // Minimal animation — vertex shader only (group rotation)
    const isDart = this._dartState === 'dart';
    this._swimPhase += (isDart ? 16 : 7) * dt;
    this.group.rotation.z = Math.sin(this._swimPhase * 0.35) * (isDart ? 0.05 : 0.02);
  }

  // ─── Update ────────────────────────────────────────────────────────────────

  update(dt, playerPos) {
    this.time += dt;
    this._frameCounter++;

    this._toPlayer.subVectors(playerPos, this.group.position);
    this._distToPlayer = this._toPlayer.length();

    this._lodTier = this._resolveLodTier(this._distToPlayer);
    this._lastLodTier = this._lodTier;

    this.tiers.near.group.visible   = this._lodTier === 'near';
    this.tiers.medium.group.visible = this._lodTier === 'medium';
    this.tiers.far.group.visible    = this._lodTier === 'far';

    // Far LOD: skip animation most frames (ultra: skip 3/4, else skip 2/3)
    const farStep = qualityManager.tier === 'ultra' ? FAR_LOD_SKIP_ULTRA : FAR_LOD_SKIP_DEFAULT;
    const skipFarAnim = this._lodTier === 'far' && (this._frameCounter % farStep) !== 0;

    this._updateMovement(dt, playerPos);

    if (!skipFarAnim) {
      if (this._lodTier === 'near')        this._animateNear(dt);
      else if (this._lodTier === 'medium') this._animateMedium(dt);
      else                                 this._animateFar(dt);
    }
  }

  // ─── Public ────────────────────────────────────────────────────────────────

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
