import * as THREE from 'three';

const CREATURE_LABELS = {
  abyssalmaw: 'Abyssal Maw',
  abysswraith: 'Abyss Wraith',
  amalgam: 'Amalgam',
  anglerfish: 'Anglerfish',
  bioMechCrab: 'Bio-Mech Crab',
  biomechcrab: 'Bio-Mech Crab',
  birthsac: 'Birth Sac',
  boneworm: 'Bone Worm',
  chaindragger: 'Chain Dragger',
  deepone: 'Deep One',
  facelessone: 'Faceless One',
  ghostshark: 'Ghost Shark',
  harvester: 'Harvester',
  husk: 'Husk',
  ironwhale: 'Iron Whale',
  jellyfish: 'Jellyfish',
  lamprey: 'Lamprey',
  leviathan: 'Leviathan',
  mechoctopus: 'Mech Octopus',
  needlefish: 'Needle Fish',
  parasite: 'Parasite',
  pipeorgan: 'Pipe Organ',
  ribcage: 'Rib Cage',
  sentinel: 'Sentinel',
  sirenSkull: 'Siren Skull',
  spinaleel: 'Spinal Eel',
  sporecloud: 'Spore Cloud',
  tendrilhunter: 'Tendril Hunter',
  tubecluster: 'Tube Cluster',
  voidjelly: 'Void Jelly',
};

export class HUD {
  constructor() {
    this.depthDisplay = document.getElementById('depth-display');
    this.depthZone = document.getElementById('depth-zone');
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
    this.locatorHint = this.locatorPanel.querySelector('.hint');
    this.locatorVisible = false;
    this.trackedType = null;
    this.creatureTypes = [];
    this.selectedCreatureType = null;
    this.selectedCreatureIndex = -1;

    // Pickup notification
    this.pickupEl = document.createElement('div');
    this.pickupEl.id = 'pickup-text';
    this.pickupEl.style.cssText =
      'position:fixed;top:35%;left:50%;transform:translateX(-50%);' +
      'color:#22ffaa;font-family:monospace;font-size:18px;text-shadow:0 0 10px #22ffaa;' +
      'opacity:0;transition:opacity 0.3s;pointer-events:none;z-index:100;white-space:nowrap;';
    document.body.appendChild(this.pickupEl);
    this._pickupTimeout = null;

    this.creatureList.addEventListener('click', (e) => {
      const entry = e.target.closest('.creature-entry');
      if (!entry || !entry.dataset.creatureType) return;
      this.selectedCreatureType = entry.dataset.creatureType;
      this.selectedCreatureIndex = this.creatureTypes.indexOf(this.selectedCreatureType);
      this.trackCreatureByType(entry.dataset.creatureType);
    });
  }

  update(depth, flashlightOn) {
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

    if (this.warningTimer <= 0) {
      this.warningText.classList.remove('visible');
      this.warningText.style.opacity = '';
    }

    // Update sonar display
    this._drawSonar(depth);
  }

  _showWarning(text, duration) {
    this.warningText.textContent = text;
    this.warningText.classList.add('visible');
    this.warningText.style.opacity = '';
    this.warningTimer = duration;
    setTimeout(() => {
      if (this.warningText.textContent === text) {
        this.warningText.classList.remove('visible');
        this.warningTimer = 0;
      }
    }, duration);
  }

  showPickup(text) {
    this.pickupEl.textContent = text;
    this.pickupEl.style.opacity = '1';
    clearTimeout(this._pickupTimeout);
    this._pickupTimeout = setTimeout(() => {
      this.pickupEl.style.opacity = '0';
    }, 2000);
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
    this._syncLocatorSelection();
    this.locatorPanel.classList.toggle('visible', this.locatorVisible);
  }

  closeLocator() {
    this.locatorVisible = false;
    this.locatorPanel.classList.remove('visible');
  }

  handleLocatorNavigation(code) {
    if (!this.locatorVisible) return false;

    if (code === 'ArrowUp') {
      this._moveLocatorSelection(-1);
      return true;
    }
    if (code === 'ArrowDown') {
      this._moveLocatorSelection(1);
      return true;
    }
    if (code === 'Enter') {
      if (this.selectedCreatureType) {
        this.trackCreatureByType(this.selectedCreatureType);
      }
      return true;
    }

    return false;
  }

  _moveLocatorSelection(direction) {
    const count = this.creatureTypes.length;
    if (count === 0) {
      this.selectedCreatureType = null;
      this.selectedCreatureIndex = -1;
      return;
    }

    this._syncLocatorSelection();
    const current = this.selectedCreatureIndex >= 0 ? this.selectedCreatureIndex : 0;
    const wrappedIndex = (current + direction + count) % count;
    this.selectedCreatureIndex = wrappedIndex;
    this.selectedCreatureType = this.creatureTypes[wrappedIndex];
  }

  _syncLocatorSelection() {
    const count = this.creatureTypes.length;
    if (count === 0) {
      this.selectedCreatureType = null;
      this.selectedCreatureIndex = -1;
      return;
    }

    if (this.selectedCreatureType && this.creatureTypes.includes(this.selectedCreatureType)) {
      this.selectedCreatureIndex = this.creatureTypes.indexOf(this.selectedCreatureType);
      return;
    }

    if (this.trackedType && this.creatureTypes.includes(this.trackedType)) {
      this.selectedCreatureType = this.trackedType;
      this.selectedCreatureIndex = this.creatureTypes.indexOf(this.trackedType);
      return;
    }

    const fallbackIndex = this.selectedCreatureIndex >= 0
      ? Math.min(this.selectedCreatureIndex, count - 1)
      : 0;
    this.selectedCreatureIndex = fallbackIndex;
    this.selectedCreatureType = this.creatureTypes[fallbackIndex];
  }

  trackCreature(index) {
    if (index >= 0 && index < this.creatureTypes.length) {
      this.selectedCreatureType = this.creatureTypes[index];
      this.selectedCreatureIndex = index;
      this.trackCreatureByType(this.creatureTypes[index]);
    }
  }

  trackCreatureByType(type) {
    if (!type || !this.creatureTypes.includes(type)) return;
    this.trackedType = type;
  }

  stopTracking() {
    this.trackedType = null;
    this.trackIndicator.classList.remove('visible');
  }

  _formatCreatureLabel(type) {
    const key = String(type || '').trim();
    if (!key) return 'Unknown Creature';
    if (CREATURE_LABELS[key]) return CREATURE_LABELS[key];

    const spaced = key
      .replace(/[_-]+/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim();

    if (!spaced) return 'Unknown Creature';
    return spaced
      .split(' ')
      .map(word => word ? word[0].toUpperCase() + word.slice(1) : word)
      .join(' ');
  }

  _getLocatorHint() {
    return this.creatureTypes.length > 9
      ? 'Use Arrow keys to select and Enter to track. 1-9 track first nine, click any row to track the rest. 0 stops tracking.'
      : 'Use Arrow keys to select and Enter to track. 1-9 track, click any row to track with the mouse. 0 stops tracking.';
  }

  updateLocator(creaturesByType, playerPos, camera) {
    this.creatureTypes = Object.keys(creaturesByType);
    this._syncLocatorSelection();
    if (this.locatorHint) {
      this.locatorHint.textContent = this._getLocatorHint();
    }

    // Update the panel list
    if (this.locatorVisible) {
      let html = '';
      this.creatureTypes.forEach((type, i) => {
        const info = creaturesByType[type];
        const label = this._formatCreatureLabel(type);
        const dist = info.nearest < Infinity ? `${Math.floor(info.nearest)}m` : '---';
        const tracked = this.trackedType === type ? ' tracked' : '';
        const selected = this.selectedCreatureType === type ? ' selected' : '';
        html += `<div class="creature-entry${tracked}${selected}" data-creature-type="${type}">` +
          `<span class="creature-key">${i + 1}</span>` +
          `<span class="creature-name">${label}</span>` +
          `<span class="creature-count">x${info.count}</span>` +
          `<span class="creature-dist">${dist}</span>` +
          `</div>`;
      });
      this.creatureList.innerHTML = html;
    }

    // Update tracking indicator
    if (this.trackedType) {
      const info = creaturesByType[this.trackedType];
      if (info && info.nearestPos) {
        this.trackIndicator.classList.add('visible');
        this.trackName.textContent = this._formatCreatureLabel(this.trackedType);
        this.trackDist.textContent = `${Math.floor(info.nearest)}m`;

        // Calculate direction arrow
        const dir = info.nearestPos.clone().sub(playerPos);
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);

        // Horizontal angle between camera forward and creature direction
        const angle = Math.atan2(dir.x, dir.z) - Math.atan2(forward.x, forward.z);
        this.trackArrow.style.transform = `rotate(${angle}rad)`;
      } else {
        this.trackedType = null;
        this.trackIndicator.classList.remove('visible');
      }
    } else {
      this.trackIndicator.classList.remove('visible');
    }
  }
}
