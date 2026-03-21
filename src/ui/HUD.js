import * as THREE from 'three';

const CREATURE_LABELS = {
  jellyfish: 'Jellyfish',
  anglerfish: 'Anglerfish',
  ghostshark: 'Ghost Shark',
  leviathan: 'Leviathan',
  deepone: 'Deep One',
};

export class HUD {
  constructor() {
    this.depthDisplay = document.getElementById('depth-display');
    this.depthZone = document.getElementById('depth-zone');
    this.oxygenBar = document.getElementById('oxygen-bar');
    this.batteryBar = document.getElementById('battery-bar');
    this.warningText = document.getElementById('warning-text');
    this.sonarCanvas = document.getElementById('sonar');
    this.sonarCtx = this.sonarCanvas.getContext('2d');
    this.warningTimer = 0;
    this.sonarPings = [];
    this.sonarAge = 0;
    this.lastDepthZone = '';

    // Creature locator
    this.locatorPanel = document.getElementById('creature-locator');
    this.creatureList = document.getElementById('creature-list');
    this.trackIndicator = document.getElementById('track-indicator');
    this.trackArrow = document.getElementById('track-arrow');
    this.trackName = document.getElementById('track-name');
    this.trackDist = document.getElementById('track-dist');
    this.locatorVisible = false;
    this.trackedType = null;
    this.creatureTypes = [];
  }

  update(depth, oxygen, battery, flashlightOn) {
    // Depth counter
    this.depthDisplay.textContent = `${Math.floor(depth)}m`;

    // Depth zone name
    let zone;
    if (depth < 50) zone = 'SUNLIT ZONE';
    else if (depth < 200) zone = 'TWILIGHT ZONE';
    else if (depth < 500) zone = 'MIDNIGHT ZONE';
    else if (depth < 1000) zone = 'THE ABYSS';
    else zone = 'THE UNDERWORLD';

    if (zone !== this.lastDepthZone) {
      this.lastDepthZone = zone;
      this.depthZone.textContent = zone;
      this.depthZone.style.color = depth > 500 ? '#ff4466' : depth > 200 ? '#6644aa' : '#4488aa';

      // Flash zone change
      if (depth > 50) {
        this._showWarning(`ENTERING ${zone}`, 3000);
      }
    }

    // Bars
    this.oxygenBar.style.width = `${oxygen}%`;
    this.oxygenBar.style.background = oxygen < 25
      ? `hsl(0, 80%, ${50 + Math.sin(Date.now() * 0.01) * 20}%)`
      : '#22aaff';

    this.batteryBar.style.width = `${battery}%`;
    this.batteryBar.style.background = battery < 20 ? '#ff6622' : '#ffaa22';

    // Low oxygen warning
    if (oxygen < 20 && oxygen > 0) {
      this.warningText.textContent = 'LOW OXYGEN';
      this.warningText.classList.add('visible');
      this.warningText.style.opacity = 0.5 + Math.sin(Date.now() * 0.005) * 0.5;
    } else if (this.warningTimer <= 0) {
      this.warningText.classList.remove('visible');
    }

    // Update sonar display
    this._drawSonar(depth);
  }

  _showWarning(text, duration) {
    this.warningText.textContent = text;
    this.warningText.classList.add('visible');
    this.warningTimer = duration;
    setTimeout(() => {
      if (this.warningText.textContent === text) {
        this.warningText.classList.remove('visible');
        this.warningTimer = 0;
      }
    }, duration);
  }

  sonarPing(playerPos, creaturePositions) {
    this.sonarPings = creaturePositions.map(pos => ({
      dx: pos.x - playerPos.x,
      dz: pos.z - playerPos.z,
      dist: pos.distanceTo(playerPos),
    })).filter(p => p.dist < 80);
    this.sonarAge = 0;
  }

  _drawSonar(depth) {
    const ctx = this.sonarCtx;
    const w = 150, h = 150, cx = w / 2, cy = h / 2;

    // Background
    ctx.fillStyle = '#000a10';
    ctx.fillRect(0, 0, w, h);

    // Rings
    ctx.strokeStyle = '#113322';
    ctx.lineWidth = 0.5;
    for (let r = 15; r < 70; r += 15) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Cross
    ctx.beginPath();
    ctx.moveTo(cx, 5); ctx.lineTo(cx, h - 5);
    ctx.moveTo(5, cy); ctx.lineTo(w - 5, cy);
    ctx.stroke();

    // Center dot (player)
    ctx.fillStyle = '#44ff88';
    ctx.beginPath();
    ctx.arc(cx, cy, 2, 0, Math.PI * 2);
    ctx.fill();

    // Sonar sweep line
    this.sonarAge += 0.02;
    const sweepAngle = this.sonarAge * 2;
    ctx.strokeStyle = '#22ff6644';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(sweepAngle) * 70, cy + Math.sin(sweepAngle) * 70);
    ctx.stroke();

    // Fade trail
    const gradient = ctx.createConicGradient(sweepAngle, cx, cy);
    gradient.addColorStop(0, '#22ff4422');
    gradient.addColorStop(0.15, '#22ff4400');
    gradient.addColorStop(1, '#22ff4400');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cx, cy, 70, 0, Math.PI * 2);
    ctx.fill();

    // Creature pings
    if (this.sonarPings.length > 0) {
      const pingAlpha = Math.max(0, 1 - this.sonarAge * 0.3);
      if (pingAlpha > 0) {
        for (const ping of this.sonarPings) {
          const scale = 70 / 80; // max range
          const px = cx + ping.dx * scale;
          const pz = cy + ping.dz * scale;
          if (px > 5 && px < w - 5 && pz > 5 && pz < h - 5) {
            ctx.fillStyle = `rgba(255, 50, 50, ${pingAlpha})`;
            ctx.beginPath();
            ctx.arc(px, pz, 3, 0, Math.PI * 2);
            ctx.fill();

            // Glow
            ctx.fillStyle = `rgba(255, 50, 50, ${pingAlpha * 0.3})`;
            ctx.beginPath();
            ctx.arc(px, pz, 6, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }

    // Depth text on sonar
    ctx.fillStyle = '#226644';
    ctx.font = '9px Courier New';
    ctx.fillText(`${Math.floor(depth)}m`, 5, h - 5);
  }

  toggleLocator() {
    this.locatorVisible = !this.locatorVisible;
    this.locatorPanel.classList.toggle('visible', this.locatorVisible);
  }

  trackCreature(index) {
    if (index >= 0 && index < this.creatureTypes.length) {
      this.trackedType = this.creatureTypes[index];
    }
  }

  stopTracking() {
    this.trackedType = null;
    this.trackIndicator.classList.remove('visible');
  }

  updateLocator(creaturesByType, playerPos, camera) {
    this.creatureTypes = Object.keys(creaturesByType);

    // Update the panel list
    if (this.locatorVisible) {
      let html = '';
      this.creatureTypes.forEach((type, i) => {
        const info = creaturesByType[type];
        const label = CREATURE_LABELS[type] || type;
        const dist = info.nearest < Infinity ? `${Math.floor(info.nearest)}m` : '---';
        const tracked = this.trackedType === type ? ' tracked' : '';
        html += `<div class="creature-entry${tracked}">` +
          `<span class="creature-key">${i + 1}</span>` +
          `<span class="creature-name">${label}</span>` +
          `<span class="creature-count">x${info.count}</span>` +
          `<span class="creature-dist">${dist}</span>` +
          `</div>`;
      });
      this.creatureList.innerHTML = html;
    }

    // Update tracking indicator
    if (this.trackedType && creaturesByType[this.trackedType]) {
      const info = creaturesByType[this.trackedType];
      if (info.nearestPos) {
        this.trackIndicator.classList.add('visible');
        this.trackName.textContent = CREATURE_LABELS[this.trackedType] || this.trackedType;
        this.trackDist.textContent = `${Math.floor(info.nearest)}m`;

        // Calculate direction arrow
        const dir = info.nearestPos.clone().sub(playerPos);
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);

        // Horizontal angle between camera forward and creature direction
        const angle = Math.atan2(dir.x, dir.z) - Math.atan2(forward.x, forward.z);
        this.trackArrow.style.transform = `rotate(${angle}rad)`;
      }
    } else if (!this.trackedType) {
      this.trackIndicator.classList.remove('visible');
    }
  }
}
