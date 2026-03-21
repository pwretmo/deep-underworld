import * as THREE from 'three';

// Biomechanical predator with hydraulic tendrils that seek and grasp
export class TendrilHunter {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time = Math.random() * 100;
    this.speed = 1.8 + Math.random() * 1.2;
    this.direction = new THREE.Vector3(Math.random() - 0.5, -0.1, Math.random() - 0.5).normalize();
    this.turnTimer = 0;
    this.turnInterval = 6 + Math.random() * 8;
    this.tendrils = [];

    this._buildModel();
    this.group.position.copy(position);
    scene.add(this.group);
  }

  _buildModel() {
    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: 0x080610, roughness: 0.2, metalness: 0.65,
      clearcoat: 1.0, clearcoatRoughness: 0.1,
    });
    const metalMat = new THREE.MeshPhysicalMaterial({
      color: 0x141414, roughness: 0.1, metalness: 0.9,
      clearcoat: 1.0,
    });
    const organicMat = new THREE.MeshPhysicalMaterial({
      color: 0x1a0812, roughness: 0.3, metalness: 0.3,
      clearcoat: 0.8,
    });

    // Central body - elongated with mechanical ridging
    const bodyGeo = new THREE.SphereGeometry(1, 18, 14);
    bodyGeo.scale(1.8, 0.9, 0.8);
    const bp = bodyGeo.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i);
      // Mechanical ridging
      bp.setX(i, x + Math.sin(y * 8) * 0.05);
      bp.setZ(i, z + Math.cos(x * 6) * 0.04);
    }
    bodyGeo.computeVertexNormals();
    this.group.add(new THREE.Mesh(bodyGeo, bodyMat));

    // Dorsal exoskeleton plates
    for (let i = 0; i < 5; i++) {
      const plateGeo = new THREE.BoxGeometry(0.5, 0.08, 0.6, 2, 1, 2);
      const plate = new THREE.Mesh(plateGeo, metalMat);
      plate.position.set(i * 0.5 - 1, 0.75, 0);
      plate.rotation.z = Math.sin(i) * 0.1;
      this.group.add(plate);
    }

    // Six articulated hydraulic tendrils
    for (let i = 0; i < 6; i++) {
      const tendrilGroup = new THREE.Group();
      const angle = (i / 6) * Math.PI * 2;
      const segments = 6;

      for (let s = 0; s < segments; s++) {
        // Hydraulic segment
        const segGeo = new THREE.CylinderGeometry(0.05 - s * 0.005, 0.04 - s * 0.004, 0.6, 6);
        const seg = new THREE.Mesh(segGeo, metalMat);
        seg.position.y = -s * 0.55;
        tendrilGroup.add(seg);

        // Joint ball
        if (s < segments - 1) {
          const jointGeo = new THREE.SphereGeometry(0.06, 6, 6);
          const joint = new THREE.Mesh(jointGeo, organicMat);
          joint.position.y = -s * 0.55 - 0.3;
          tendrilGroup.add(joint);
        }
      }

      // Hook tip
      const hookGeo = new THREE.ConeGeometry(0.03, 0.2, 5);
      const hook = new THREE.Mesh(hookGeo, metalMat);
      hook.position.y = -segments * 0.55;
      tendrilGroup.add(hook);

      tendrilGroup.position.set(Math.cos(angle) * 0.8, -0.3, Math.sin(angle) * 0.6);
      this.tendrils.push(tendrilGroup);
      this.group.add(tendrilGroup);
    }

    // Sensor cluster on front - array of small eyes
    for (let i = 0; i < 5; i++) {
      const eyeGeo = new THREE.SphereGeometry(0.05, 6, 6);
      const eyeMat = new THREE.MeshPhysicalMaterial({
        color: 0x88ff00, emissive: 0x44ff00, emissiveIntensity: 2,
        roughness: 0, clearcoat: 1.0,
      });
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(1.6, 0.1 + (Math.random() - 0.5) * 0.2, (i - 2) * 0.12);
      this.group.add(eye);
    }

    this.sensorLight = new THREE.PointLight(0x88ff00, 0.8, 10);
    this.sensorLight.position.set(1.6, 0.1, 0);
    this.group.add(this.sensorLight);

    const s = 1.5 + Math.random() * 1;
    this.group.scale.setScalar(s);
  }

  update(dt, playerPos) {
    this.time += dt;
    this.turnTimer += dt;

    if (this.turnTimer > this.turnInterval) {
      this.turnTimer = 0;
      this.turnInterval = 6 + Math.random() * 8;
      if (Math.random() < 0.5) {
        this.direction.subVectors(playerPos, this.group.position).normalize();
        this.direction.y *= 0.3;
      } else {
        this.direction.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.1, Math.random() - 0.5).normalize();
      }
    }

    this.group.position.add(this.direction.clone().multiplyScalar(this.speed * dt));

    // Face movement direction
    const angle = Math.atan2(this.direction.x, this.direction.z);
    this.group.rotation.y = THREE.MathUtils.lerp(this.group.rotation.y, angle, dt * 3);

    // Animate tendrils - grasping motion
    for (let i = 0; i < this.tendrils.length; i++) {
      const phase = this.time * 2 + i * Math.PI / 3;
      this.tendrils[i].rotation.x = Math.sin(phase) * 0.3;
      this.tendrils[i].rotation.z = Math.cos(phase * 0.7) * 0.2;
    }

    // Sensor flicker
    this.sensorLight.intensity = 0.5 + Math.sin(this.time * 8) * 0.2;

    if (this.group.position.distanceTo(playerPos) > 200) {
      const a = Math.random() * Math.PI * 2;
      this.group.position.set(playerPos.x + Math.cos(a) * 70, playerPos.y - Math.random() * 10, playerPos.z + Math.sin(a) * 70);
    }
  }

  getPosition() { return this.group.position; }
  dispose() {
    this.scene.remove(this.group);
    this.group.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); });
  }
}
