import * as THREE from 'three/webgpu';
import { abs, clamp, dot, materialEmissive, normalLocal, normalView, positionLocal, positionView, pow, sin, smoothstep, sub, uniform, vec3 } from 'three/tsl';
import { qualityManager } from '../QualityManager.js';

let detailMaps = null;

function createDetailMap(size, seed, asNormal = false) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const nx = x / size;
      const ny = y / size;
      const waves =
        Math.sin((nx * 37 + seed * 0.31) * Math.PI * 2) * 0.35
        + Math.sin((ny * 29 + seed * 0.19) * Math.PI * 2) * 0.28
        + Math.sin((nx * 17 + ny * 21 + seed * 0.07) * Math.PI * 2) * 0.37;
      const h = Math.floor(THREE.MathUtils.clamp((waves * 0.5 + 0.5) * 255, 0, 255));

      if (asNormal) {
        const right = Math.sin(((nx + 1 / size) * 37 + seed * 0.31) * Math.PI * 2) * 0.35;
        const up = Math.sin(((ny + 1 / size) * 29 + seed * 0.19) * Math.PI * 2) * 0.28;
        const sx = (right - waves) * 0.5;
        const sy = (up - waves) * 0.5;
        data[idx] = Math.floor((sx * 0.5 + 0.5) * 255);
        data[idx + 1] = Math.floor((sy * 0.5 + 0.5) * 255);
        data[idx + 2] = 255;
      } else {
        data[idx] = h;
        data[idx + 1] = h;
        data[idx + 2] = h;
      }
      data[idx + 3] = 255;
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

function getDetailMaps() {
  if (detailMaps) return detailMaps;
  detailMaps = {
    bodyNormal: createDetailMap(64, 11, true),
    bodyDisplace: createDetailMap(64, 13, false),
    palateNormal: createDetailMap(64, 21, true),
    fangNormal: createDetailMap(32, 31, true),
  };
  return detailMaps;
}

export class Anglerfish {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.alive = true;
    this.state = 'patrol';
    this.alertDistance = 34;
    this.chaseDistance = 22;
    this.time = Math.random() * 100;
    this.patrolCenter = position.clone();
    this.patrolRadius = 16 + Math.random() * 20;
    this.patrolAngle = Math.random() * Math.PI * 2;
    this.verticalOffset = 0;
    this.patrolPhase = Math.random() * Math.PI * 2;
    this.patrolVariance = 0.65 + Math.random() * 0.6;

    this.baseSpeed = 1.4 + Math.random() * 0.55;
    this.alertSpeed = 2.1 + Math.random() * 0.7;
    this.chaseSpeed = 4.2 + Math.random() * 1.15;
    this.lungeSpeed = this.chaseSpeed * 1.9;
    this.maxAcceleration = 2.25;
    this.turnResponsiveness = 1.8;

    this.lureFlickerFreq = 6.5 + Math.random() * 3.2;
    this.lureFlickerFreqB = 12 + Math.random() * 4.5;
    this.lurePulsePhase = Math.random() * Math.PI * 2;

    this._velocity = new THREE.Vector3();
    this._toPlayer = new THREE.Vector3();
    this._moveTarget = new THREE.Vector3();
    this._desiredVelocity = new THREE.Vector3();
    this._lookVec = new THREE.Vector3(0, 0, 1);
    this._localEyeTarget = new THREE.Vector3();
    this._patrolTarget = new THREE.Vector3();
    this._worldQuat = new THREE.Quaternion();

    this._frameCounter = 0;
    this._lodTier = 'near';
    this._lastLodTier = 'near';

    this._jawOpen = 0;
    this._jawOpenTarget = 0;
    this._gillPulse = 0;
    this._lungeTimer = 0;
    this._nextLungeAt = 2 + Math.random() * 2.5;

    this._lureAngleX = 0;
    this._lureAngleZ = 0;
    this._lureVelX = 0;
    this._lureVelZ = 0;
    this._lastYaw = 0;

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  _buildModel() {
    this.tiers = {
      near: this._buildTier('near'),
      medium: this._buildTier('medium'),
      far: this._buildTier('far'),
    };

    this.group.add(this.tiers.near.group);
    this.group.add(this.tiers.medium.group);
    this.group.add(this.tiers.far.group);
    this.tiers.medium.group.visible = false;
    this.tiers.far.group.visible = false;

    this.group.scale.setScalar(1.5 + Math.random() * 1);
  }

  _buildTier(tierName) {
    const isNear = tierName === 'near';
    const isMedium = tierName === 'medium';
    const isFar = tierName === 'far';

    const group = new THREE.Group();
    const maps = getDetailMaps();

    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: isFar ? 0x0f1d18 : 0x132923,
      roughness: isNear ? 0.2 : 0.32,
      metalness: 0.03,
      clearcoat: isNear ? 0.95 : 0.4,
      clearcoatRoughness: 0.18,
      emissive: 0x1a4f3a,
      emissiveIntensity: isFar ? 0.52 : 0.32,
      normalMap: isFar ? null : maps.bodyNormal,
      displacementMap: isFar ? null : maps.bodyDisplace,
      displacementScale: isFar ? 0 : isNear ? 0.035 : 0.015,
      normalScale: new THREE.Vector2(0.55, 0.55),
    });

    const gumMat = new THREE.MeshPhysicalMaterial({
      color: 0x3d2222,
      roughness: 0.68,
      metalness: 0,
      emissive: 0x1b0808,
      emissiveIntensity: 0.24,
      normalMap: isFar ? null : maps.palateNormal,
      normalScale: new THREE.Vector2(0.35, 0.35),
    });

    const boneMat = new THREE.MeshPhysicalMaterial({
      color: 0xded7bc,
      roughness: 0.24,
      metalness: 0.06,
      clearcoat: 0.88,
      clearcoatRoughness: 0.12,
      emissive: 0x3a2b1d,
      emissiveIntensity: 0.22,
      normalMap: maps.fangNormal,
      normalScale: new THREE.Vector2(0.4, 0.4),
    });

    const lureShellMat = new THREE.MeshPhysicalMaterial({
      color: 0x53ffbd,
      emissive: 0x36f79f,
      emissiveIntensity: isNear ? 2.4 : isMedium ? 1.9 : 1.35,
      transparent: true,
      opacity: isNear ? 0.84 : 0.72,
      roughness: 0.14,
      metalness: 0,
      transmission: isNear ? 0.55 : 0.28,
      thickness: isNear ? 0.62 : 0.2,
    });

    const bodyGeo = isFar
      ? new THREE.OctahedronGeometry(0.95, 0)
      : new THREE.SphereGeometry(1, isNear ? 64 : 34, isNear ? 48 : 24);
    bodyGeo.scale(isFar ? 1.35 : 1.65, isFar ? 0.55 : 0.78, isFar ? 0.72 : 0.98);

    if (!isFar) {
      const bp = bodyGeo.attributes.position;
      for (let i = 0; i < bp.count; i++) {
        const x = bp.getX(i);
        const y = bp.getY(i);
        const z = bp.getZ(i);
        const radial = Math.max(0.0001, Math.sqrt(y * y + z * z));
        const scaleRidge = Math.sin((x + 1.35) * 14) * 0.022;
        const microScales = Math.sin(x * 26 + z * 24) * 0.012;
        const gillBand = Math.exp(-Math.pow((x - 0.18) * 4.2, 2));
        const gillRidges = Math.sin(y * 26 + x * 11) * 0.012 * gillBand;
        const push = scaleRidge + microScales + gillRidges;
        bp.setX(i, x + x * push * 0.8);
        bp.setY(i, y + (y / radial) * push * 0.55);
        bp.setZ(i, z + (z / radial) * push * 0.55);
      }
      bodyGeo.computeVertexNormals();
    }

    const body = new THREE.Mesh(bodyGeo, bodyMat);
    if (!isFar) this._applyBodyShader(bodyMat, isNear ? 1 : 0.35);
    group.add(body);

    const dorsalRidges = [];
    if (!isFar) {
      const ridgeCount = isNear ? 12 : 6;
      for (let i = 0; i < ridgeCount; i++) {
        const t = i / Math.max(1, ridgeCount - 1);
        const ridgeGeo = new THREE.ConeGeometry(0.06 - t * 0.02, 0.22 - t * 0.06, isNear ? 10 : 6);
        const ridge = new THREE.Mesh(ridgeGeo, gumMat);
        ridge.position.set(-0.95 + t * 1.9, 0.74 + Math.sin(t * Math.PI) * 0.08, 0);
        ridge.rotation.z = Math.PI;
        ridge.rotation.x = (Math.random() - 0.5) * 0.12;
        dorsalRidges.push(ridge);
        group.add(ridge);
      }
    }

    const gillSlits = [];
    if (!isFar) {
      for (const side of [-1, 1]) {
        for (let i = 0; i < (isNear ? 4 : 2); i++) {
          const slitGeo = new THREE.CapsuleGeometry(0.03, 0.26, 2, 8);
          const slit = new THREE.Mesh(slitGeo, gumMat);
          slit.position.set(0.22 + i * 0.07, 0.08 - i * 0.025, side * (0.72 - i * 0.025));
          slit.rotation.z = side * Math.PI * 0.5;
          slit.rotation.y = side * (0.35 + i * 0.04);
          gillSlits.push(slit);
          group.add(slit);
        }
      }
    }

    if (!isFar) {
      for (const side of [-1, 1]) {
        const pipeCurve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(-1.15, 0.04, side * 0.74),
          new THREE.Vector3(-0.15, 0.2, side * 0.9),
          new THREE.Vector3(0.64, 0.1, side * 0.84),
          new THREE.Vector3(1.15, -0.02, side * 0.58),
        ]);
        const pipe = new THREE.Mesh(
          new THREE.TubeGeometry(pipeCurve, isNear ? 24 : 12, 0.035, isNear ? 12 : 10, false),
          bodyMat
        );
        group.add(pipe);
      }
    }

    const fins = [];
    if (!isFar) {
      for (const side of [-1, 1]) {
        const finGeo = isNear
          ? new THREE.PlaneGeometry(0.85, 0.5, 16, 8)
          : new THREE.PlaneGeometry(0.55, 0.34, 6, 3);
        const fp = finGeo.attributes.position;
        for (let i = 0; i < fp.count; i++) {
          const x = fp.getX(i);
          const y = fp.getY(i);
          const fan = 1 + x * 0.35;
          fp.setY(i, y * fan);
          fp.setZ(i, Math.sin((x + 0.5) * 6) * 0.02);
        }
        finGeo.computeVertexNormals();
        const finMat = bodyMat.clone();
        finMat.transparent = true;
        finMat.opacity = isNear ? 0.68 : 0.52;
        finMat.side = THREE.DoubleSide;
        if (isNear) this._applyFinShader(finMat);
        const fin = new THREE.Mesh(finGeo, finMat);
        fin.position.set(-0.2, -0.06, side * 0.92);
        fin.rotation.y = side * (Math.PI * 0.33);
        fin.rotation.x = side * -0.22;
        fins.push(fin);
        group.add(fin);
      }
    }

    const jawGeo = isFar
      ? null
      : new THREE.ConeGeometry(isNear ? 0.58 : 0.52, isNear ? 1.24 : 1.02, isNear ? 36 : 22, isNear ? 12 : 6, false);
    let jaw = null;
    let jawMat = null;
    let innerMouth = null;
    const fangs = [];
    if (!isFar) {
      jawGeo.rotateZ(-Math.PI * 0.5);
      jawGeo.translate(0.62, 0, 0);
      jawMat = bodyMat.clone();
      jawMat.userData = {};
      jawMat.emissiveIntensity = isNear ? 0.3 : 0.55;
      if (isNear) this._applyJawShader(jawMat);
      jaw = new THREE.Mesh(jawGeo, jawMat);
      jaw.position.set(0.96, -0.23, 0);
      jaw.rotation.z = -0.04;
      group.add(jaw);

      const palateGeo = new THREE.SphereGeometry(0.42, isNear ? 24 : 12, isNear ? 20 : 10, 0, Math.PI * 2, 0, Math.PI * 0.55);
      innerMouth = new THREE.Mesh(palateGeo, gumMat);
      innerMouth.position.set(1.03, -0.05, 0);
      innerMouth.scale.set(1.1, 0.56, 0.84);
      group.add(innerMouth);

      if (isNear) {
        const tongueGeo = new THREE.CapsuleGeometry(0.1, 0.35, 4, 10);
        const tongue = new THREE.Mesh(tongueGeo, gumMat);
        tongue.position.set(1.1, -0.16, 0);
        tongue.rotation.z = Math.PI * 0.5;
        group.add(tongue);

        const fangGeo = new THREE.ConeGeometry(0.034, 0.32, 12, 5);
        const fangPos = fangGeo.attributes.position;
        for (let i = 0; i < fangPos.count; i++) {
          const fy = fangPos.getY(i);
          const fz = fangPos.getZ(i);
          const serration = Math.sin((fy + 0.16) * 44) * 0.0025;
          fangPos.setZ(i, fz + serration);
        }
        fangGeo.computeVertexNormals();
        const fangGumGeo = new THREE.TorusGeometry(0.03, 0.009, 4, 8);
        for (let i = 0; i < 18; i++) {
          const angle = (i / 18) * Math.PI;
          const fang = new THREE.Mesh(fangGeo, boneMat);
          fang.position.set(
            0.96 + Math.cos(angle) * 0.44,
            -0.07 + Math.sin(angle) * 0.28,
            Math.sin(angle * 2.2) * 0.3
          );
          fang.rotation.z = Math.PI + (Math.random() - 0.5) * 0.2;
          fang.rotation.x = (Math.random() - 0.5) * 0.18;
          fang.scale.y = 0.72 + Math.random() * 0.6;
          group.add(fang);
          fangs.push(fang);

          const gumRing = new THREE.Mesh(fangGumGeo, gumMat);
          gumRing.position.copy(fang.position);
          gumRing.rotation.y = Math.PI * 0.5;
          group.add(gumRing);
        }
      }
    }

    const eyes = [];
    const irises = [];
    if (!isFar) {
      const eyeShellGeo = new THREE.SphereGeometry(isNear ? 0.12 : 0.095, isNear ? 18 : 10, isNear ? 18 : 10);
      const eyeCoreGeo = new THREE.SphereGeometry(isNear ? 0.048 : 0.04, isNear ? 14 : 8, isNear ? 14 : 8);
      const eyeShellMat = new THREE.MeshPhysicalMaterial({
        color: 0x291612,
        emissive: 0xff4a22,
        emissiveIntensity: isNear ? 0.75 : 0.52,
        roughness: 0.12,
        clearcoat: 1,
      });
      const irisMat = new THREE.MeshPhysicalMaterial({
        color: 0x080301,
        emissive: 0xffb06a,
        emissiveIntensity: isNear ? 0.9 : 0.5,
        roughness: 0.05,
      });
      for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(eyeShellGeo, eyeShellMat);
        eye.position.set(0.89, 0.28, side * 0.45);
        const iris = new THREE.Mesh(eyeCoreGeo, irisMat);
        iris.position.set(0.045, 0, 0);
        eye.add(iris);
        eyes.push(eye);
        irises.push({ iris, side });
        group.add(eye);
      }
    }

    const lurePivot = new THREE.Group();
    lurePivot.position.set(0.12, 0.65, 0);
    group.add(lurePivot);

    const lureStemCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.22, 0.6, 0),
      new THREE.Vector3(0.84, 1.05, 0.04),
      new THREE.Vector3(1.35, 0.92, 0),
    ]);
    const lureStem = new THREE.Mesh(
      isFar
        ? new THREE.CylinderGeometry(0.018, 0.03, 1.2, 4, 1)
        : new THREE.TubeGeometry(lureStemCurve, isNear ? 22 : 10, isNear ? 0.035 : 0.03, isNear ? 14 : 8, false),
      bodyMat
    );
    if (isFar) {
      lureStem.position.set(0.7, 0.56, 0);
      lureStem.rotation.z = -0.9;
    }
    lurePivot.add(lureStem);

    if (isNear) {
      for (let i = 0; i < 3; i++) {
        const branchCurve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(1.15 + i * 0.06, 0.92 + i * 0.02, 0),
          new THREE.Vector3(1.28 + i * 0.07, 1.08 + i * 0.03, 0.06 - i * 0.06),
          new THREE.Vector3(1.42 + i * 0.08, 1.02 + i * 0.04, 0.12 - i * 0.12),
        ]);
        const branch = new THREE.Mesh(new THREE.TubeGeometry(branchCurve, 8, 0.01, 6, false), bodyMat);
        lurePivot.add(branch);
      }
    }

    const lureBulb = new THREE.Mesh(
      isFar
        ? new THREE.OctahedronGeometry(0.14, 0)
        : new THREE.SphereGeometry(isNear ? 0.2 : 0.17, isNear ? 24 : 14, isNear ? 24 : 10),
      lureShellMat
    );
    lureBulb.position.set(1.35, 0.92, 0);
    lurePivot.add(lureBulb);

    let lureCore = null;
    if (!isFar) {
      lureCore = new THREE.Mesh(
        new THREE.IcosahedronGeometry(isNear ? 0.07 : 0.055, isNear ? 2 : 1),
        new THREE.MeshBasicMaterial({ color: 0xb6ffd8 })
      );
      lureBulb.add(lureCore);
    }

    let lureLight = null;
    if (isNear) {
      lureLight = new THREE.PointLight(0x46ffb0, 2.8, 24);
      lureLight.userData.duwCategory = 'creature_bio';
      lureLight.position.copy(lureBulb.position);
      lurePivot.add(lureLight);
    }

    const tailSegments = [];
    const tailCount = isFar ? 2 : isNear ? 6 : 4;
    for (let i = 0; i < tailCount; i++) {
      const t = i / Math.max(1, tailCount - 1);
      const segGeo = new THREE.BoxGeometry(0.32 - t * 0.12, 0.17 - t * 0.06, 0.15 - t * 0.07);
      const seg = new THREE.Mesh(segGeo, bodyMat);
      seg.position.set(-1.52 - i * 0.28, 0.03 * Math.sin(t * Math.PI), 0);
      tailSegments.push(seg);
      group.add(seg);
    }

    if (!isFar) {
      const blade = new THREE.Mesh(
        new THREE.ConeGeometry(isNear ? 0.14 : 0.1, isNear ? 0.55 : 0.4, isNear ? 8 : 5),
        bodyMat
      );
      blade.rotation.z = Math.PI * 0.5;
      blade.position.set(-3.05, 0, 0);
      group.add(blade);
    }

    return {
      group,
      body,
      bodyMaterial: bodyMat,
      jaw,
      jawMaterial: jawMat,
      innerMouth,
      fangs,
      dorsalRidges,
      gillSlits,
      fins,
      eyes,
      irises,
      lurePivot,
      lureBulb,
      lureCore,
      lureLight,
      tailSegments,
      isNear,
      isMedium,
      isFar,
    };
  }

  _applyBodyShader(material, intensityScale) {
    material.userData.shaderUniforms = {
      uFishTime: uniform(0),
      uBodyFlex: uniform(0),
      uBreath: uniform(0),
      uFlexIntensity: uniform(intensityScale),
    };
    const u = material.userData.shaderUniforms;

    // TSL: vertex body flex + breathing + scale relief
    const bodyAxis = positionLocal.x.add(1.8).div(3.6);
    const tailMask = smoothstep(0.15, 1.0, bodyAxis);
    const flexWave = sin(positionLocal.x.mul(3.8).add(u.uFishTime.mul(6.2))).mul(u.uBodyFlex).mul(tailMask);
    const breathDisp = sin(u.uFishTime.mul(2.2).add(bodyAxis.mul(6.0))).mul(0.04).mul(u.uBreath).mul(sub(1.0, tailMask.mul(0.5)));
    const scaleRelief = sin(positionLocal.x.mul(25.0).add(positionLocal.y.mul(17.0)).add(positionLocal.z.mul(21.0))).mul(0.012).mul(u.uFlexIntensity);
    material.positionNode = vec3(
      positionLocal.x,
      positionLocal.y.add(breathDisp),
      positionLocal.z.add(flexWave.mul(0.2).mul(u.uFlexIntensity))
    ).add(normalLocal.mul(scaleRelief));

    // TSL: fragment Fresnel rim
    const viewDir = positionView.negate().normalize();
    const rim = pow(sub(1.0, abs(dot(normalView, viewDir))), 2.3);
    material.emissiveNode = materialEmissive.add(vec3(0.06, 0.16, 0.12).mul(rim).mul(u.uBodyFlex.mul(0.7).add(0.7)));

    material.needsUpdate = true;
  }

  _applyJawShader(material) {
    material.userData.shaderUniforms = {
      uJawOpen: uniform(0),
    };

    // TSL: vertex jaw opening displacement
    const jawTip = smoothstep(0.08, 1.18, positionLocal.x);
    const jawCurve = sin(positionLocal.x.mul(7.8).add(positionLocal.z.abs().mul(10.0))).mul(0.02);
    material.positionNode = vec3(
      positionLocal.x.add(jawTip.mul(material.userData.shaderUniforms.uJawOpen).mul(0.03)),
      positionLocal.y.sub(jawTip.mul(jawTip).mul(material.userData.shaderUniforms.uJawOpen).mul(0.6)),
      positionLocal.z.add(jawCurve.mul(material.userData.shaderUniforms.uJawOpen))
    );

    material.needsUpdate = true;
  }

  _applyFinShader(material) {
    material.userData.shaderUniforms = {
      uFinTime: uniform(0),
      uFinWave: uniform(0),
    };
    const u = material.userData.shaderUniforms;

    // TSL: vertex fin flutter
    const finMask = smoothstep(-0.35, 0.45, positionLocal.x);
    const flutter = sin(positionLocal.x.mul(10.0).add(u.uFinTime.mul(8.2)).add(positionLocal.y.mul(12.0))).mul(0.06).mul(u.uFinWave).mul(finMask);
    const yFlutter = sin(positionLocal.x.mul(6.0).add(u.uFinTime.mul(5.3))).mul(0.02).mul(u.uFinWave);
    material.positionNode = vec3(
      positionLocal.x,
      positionLocal.y.add(yFlutter),
      positionLocal.z.add(flutter)
    );

    material.needsUpdate = true;
  }

  _resolveLodTier(distanceToPlayer) {
    const hysteresis = 4;
    if (this._lastLodTier === 'near' && distanceToPlayer < 30 + hysteresis) return 'near';
    if (this._lastLodTier === 'medium' && distanceToPlayer > 30 - hysteresis && distanceToPlayer < 80 + hysteresis) return 'medium';
    if (this._lastLodTier === 'far' && distanceToPlayer > 80 - hysteresis) return 'far';
    if (distanceToPlayer < 30) return 'near';
    if (distanceToPlayer < 80) return 'medium';
    return 'far';
  }

  _updateStateAndVelocity(dt, playerPos, distToPlayer) {
    if (this.state === 'patrol') {
      if (distToPlayer < this.alertDistance) this.state = 'alert';
    } else if (this.state === 'alert') {
      if (distToPlayer < this.chaseDistance) {
        this.state = 'chase';
        this._lungeTimer = 0;
      } else if (distToPlayer > this.alertDistance * 1.5) {
        this.state = 'patrol';
      }
    } else if (this.state === 'chase') {
      if (distToPlayer > this.chaseDistance * 2.2) {
        this.state = 'patrol';
        this.patrolCenter.copy(this.group.position);
      }
    }

    let targetSpeed = this.baseSpeed;

    if (this.state === 'patrol') {
      this.patrolAngle += dt * (0.22 + this.patrolVariance * 0.14);
      this.patrolPhase += dt * 0.18;
      const radialWarp = 0.72 + Math.sin(this.patrolPhase * 1.7) * 0.21;
      const radius = this.patrolRadius * radialWarp;
      this.verticalOffset = Math.sin(this.time * (0.42 + this.patrolVariance * 0.15)) * 2.1;

      this._patrolTarget.set(
        this.patrolCenter.x + Math.cos(this.patrolAngle) * radius,
        this.patrolCenter.y + this.verticalOffset,
        this.patrolCenter.z + Math.sin(this.patrolAngle * (1.0 + this.patrolVariance * 0.1)) * radius
      );
      this._moveTarget.copy(this._patrolTarget);
      targetSpeed = this.baseSpeed;
    } else {
      this._moveTarget.copy(playerPos);
      if (this.state === 'alert') {
        targetSpeed = this.alertSpeed;
      } else {
        this._lungeTimer += dt;
        const lungeTrigger = this._nextLungeAt;
        const lunging = this._lungeTimer >= lungeTrigger && distToPlayer < this.chaseDistance * 1.35;
        if (lunging) {
          this._lungeTimer = 0;
          this._nextLungeAt = 1.65 + Math.random() * 2.2;
          targetSpeed = this.lungeSpeed;
        } else {
          targetSpeed = this.chaseSpeed;
        }
      }
    }

    this._desiredVelocity.subVectors(this._moveTarget, this.group.position);
    const desiredLength = this._desiredVelocity.length();
    if (desiredLength > 0.0001) {
      this._desiredVelocity.multiplyScalar(targetSpeed / desiredLength);
    } else {
      this._desiredVelocity.set(0, 0, 0);
    }

    const accelScale = this.state === 'chase' ? 1.1 : this.state === 'alert' ? 0.8 : 0.55;
    const blend = 1 - Math.exp(-this.maxAcceleration * accelScale * dt);
    this._velocity.lerp(this._desiredVelocity, blend);
    this.group.position.addScaledVector(this._velocity, dt);
  }

  _updateOrientation(dt) {
    const toPlayerLen = this._toPlayer.length();
    if (toPlayerLen > 0.0001) this._toPlayer.multiplyScalar(1 / toPlayerLen);

    const velLen = this._velocity.length();
    if (velLen > 0.001) {
      this._lookVec.copy(this._velocity).multiplyScalar(1 / velLen);
    } else {
      this._lookVec.copy(this._toPlayer);
    }

    const targetYaw = Math.atan2(this._lookVec.x, this._lookVec.z) + Math.PI * 0.5;
    const yawBlend = 1 - Math.exp(-this.turnResponsiveness * dt);
    this.group.rotation.y = THREE.MathUtils.lerp(this.group.rotation.y, targetYaw, yawBlend);
  }

  _updateLurePhysics(dt, swayInput, verticalInput) {
    const spring = 12.5;
    const damping = 7.2;
    const targetX = THREE.MathUtils.clamp(-verticalInput * 0.14, -0.38, 0.38);
    const targetZ = THREE.MathUtils.clamp(-swayInput * 0.22, -0.5, 0.5);

    this._lureVelX += (targetX - this._lureAngleX) * spring * dt;
    this._lureVelZ += (targetZ - this._lureAngleZ) * spring * dt;
    this._lureVelX *= Math.exp(-damping * dt);
    this._lureVelZ *= Math.exp(-damping * dt);
    this._lureAngleX += this._lureVelX * dt;
    this._lureAngleZ += this._lureVelZ * dt;
  }

  _animateTier(tier, dt, proximity, simplified = false) {
    const stateOpen = this.state === 'chase' ? 0.6 : this.state === 'alert' ? 0.35 : 0.18;
    this._jawOpenTarget = stateOpen + proximity * 0.35;
    this._jawOpen += (this._jawOpenTarget - this._jawOpen) * (1 - Math.exp(-(simplified ? 5 : 9) * dt));
    this._gillPulse = 0.6 + Math.sin(this.time * (simplified ? 3.2 : 5.4)) * 0.4;

    if (tier.bodyMaterial?.userData?.shaderUniforms) {
      const uniforms = tier.bodyMaterial.userData.shaderUniforms;
      uniforms.uFishTime.value = this.time;
      uniforms.uBodyFlex.value = simplified ? 0.3 + Math.sin(this.time * 2.2) * 0.1 : THREE.MathUtils.clamp(this._velocity.length() * 0.15, 0.12, 0.82);
      uniforms.uBreath.value = 0.75 + Math.sin(this.time * 1.35) * 0.25;
    }

    if (tier.jawMaterial?.userData?.shaderUniforms) {
      tier.jawMaterial.userData.shaderUniforms.uJawOpen.value = this._jawOpen;
    } else if (tier.jaw) {
      tier.jaw.rotation.z = -0.04 - this._jawOpen * (simplified ? 0.5 : 0.72);
    }

    if (tier.innerMouth) {
      tier.innerMouth.scale.y = 0.46 + this._jawOpen * 0.34;
    }

    for (let i = 0; i < tier.gillSlits.length; i++) {
      const slit = tier.gillSlits[i];
      const pulse = 0.8 + this._gillPulse * (0.16 + i * 0.02);
      slit.scale.y = pulse;
    }

    for (let i = 0; i < tier.fins.length; i++) {
      const fin = tier.fins[i];
      const uniforms = fin.material?.userData?.shaderUniforms;
      if (uniforms?.uFinTime) {
        uniforms.uFinTime.value = this.time;
        uniforms.uFinWave.value = 0.5 + THREE.MathUtils.clamp(this._velocity.length() * 0.1, 0.15, 0.8);
      } else if (!tier.isMedium) {
        fin.rotation.z = Math.sin(this.time * 2.6 + i * Math.PI) * 0.14;
      }
    }

    this.group.getWorldQuaternion(this._worldQuat);
    this._localEyeTarget.copy(this._toPlayer).applyQuaternion(this._worldQuat.invert());
    for (let i = 0; i < tier.irises.length; i++) {
      const irisData = tier.irises[i];
      const iris = irisData.iris;
      iris.position.x = 0.038 + this._localEyeTarget.x * 0.012;
      iris.position.y = this._localEyeTarget.y * 0.011;
      iris.position.z = irisData.side * this._localEyeTarget.z * 0.006;
    }

    const yawDelta = THREE.MathUtils.euclideanModulo(this.group.rotation.y - this._lastYaw + Math.PI, Math.PI * 2) - Math.PI;
    const velocityInput = this._velocity.length();
    this._updateLurePhysics(dt, yawDelta, this._velocity.y);
    this._lastYaw = this.group.rotation.y;

    const lureBaseFlicker = 0.75
      + Math.sin(this.time * this.lureFlickerFreq + this.lurePulsePhase) * 0.16
      + Math.sin(this.time * this.lureFlickerFreqB + this.lurePulsePhase * 0.7) * 0.12;
    const threatBoost = this.state === 'chase' ? 0.9 : this.state === 'alert' ? 0.45 : 0;
    const lureIntensity = lureBaseFlicker + threatBoost + proximity * 0.5;

    tier.lurePivot.rotation.x = this._lureAngleX + Math.sin(this.time * 1.2) * 0.04;
    tier.lurePivot.rotation.z = this._lureAngleZ + Math.cos(this.time * 0.9) * 0.05;
    tier.lureBulb.material.emissiveIntensity = tier.isFar ? 1.05 + lureIntensity * 0.28 : 1.25 + lureIntensity * (tier.isNear ? 0.65 : 0.34);

    if (tier.lureCore) {
      const c = 0.9 + Math.sin(this.time * 9.5) * 0.14;
      tier.lureCore.scale.setScalar(c);
    }

    if (tier.lureLight) {
      tier.lureLight.intensity = tier.isNear ? 2.2 + lureIntensity * 2.4 : 0;
      tier.lureLight.distance = tier.isNear ? 24 : 0;
    }

    if (tier.jawMaterial && tier.isMedium) {
      tier.jawMaterial.emissiveIntensity = 0.4 + lureIntensity * 0.35;
    }

    for (let i = 0; i < tier.tailSegments.length; i++) {
      const t = i / Math.max(1, tier.tailSegments.length - 1);
      const sway = Math.sin(this.time * (simplified ? 2.8 : 4.6) - t * 2.4) * (simplified ? 0.05 : 0.11);
      tier.tailSegments[i].rotation.y = sway;
    }

    const bodyRoll = THREE.MathUtils.clamp(yawDelta * 2.2, -0.3, 0.3);
    this.group.rotation.z = THREE.MathUtils.lerp(this.group.rotation.z, bodyRoll * (0.45 + velocityInput * 0.02), 1 - Math.exp(-4 * dt));
  }

  update(dt, playerPos, distSq) {
    this.time += dt;
    this._frameCounter += 1;

    const preMoveDistToPlayer = Math.sqrt(distSq);

    this._updateStateAndVelocity(dt, playerPos, preMoveDistToPlayer);
    this._toPlayer.subVectors(playerPos, this.group.position);
    const distToPlayer = this._toPlayer.length();
    this._updateOrientation(dt);

    this._lodTier = this._resolveLodTier(distToPlayer);
    this._lastLodTier = this._lodTier;

    const proximity = THREE.MathUtils.clamp(1 - distToPlayer / 26, 0, 1);
    this.tiers.near.group.visible = this._lodTier === 'near';
    this.tiers.medium.group.visible = this._lodTier === 'medium';
    this.tiers.far.group.visible = this._lodTier === 'far';

    const farStep = qualityManager.tier === 'ultra' ? 4 : 3;
    const shouldSkipFarAnimation = this._lodTier === 'far' && (this._frameCounter % farStep) !== 0;
    if (shouldSkipFarAnimation) return;

    if (this._lodTier === 'near') {
      this._animateTier(this.tiers.near, dt, proximity, false);
    } else if (this._lodTier === 'medium') {
      this._animateTier(this.tiers.medium, dt, proximity, true);
    } else {
      this._animateTier(this.tiers.far, dt, proximity * 0.5, true);
    }
  }

  getPosition() { return this.group.position; }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          for (const mat of child.material) mat.dispose();
        } else {
          child.material.dispose();
        }
      }
    });
  }
}
