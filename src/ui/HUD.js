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
    this._sonarForward = new THREE.Vector3(0, 0, -1);

    // Creature locator
    this.locatorPanel = document.getElementById('creature-locator');
    this.creatureList = document.getElementById('creature-list');
    this.trackIndicator = document.getElementById('track-indicator');
    this.trackArrow = document.getElementById('track-arrow');
    this.trackName = document.getElementById('track-name');
    this.trackDist = document.getElementById('track-dist');
    this.trackElev = document.getElementById('track-elev');
    this.locatorHint = this.locatorPanel.querySelector('.hint');
    this.locatorVisible = false;
    this.trackedType = null;
    this.creatureTypes = [];
    this._lastDepth = -1;
    this._sonarGradient = null;
    this.selectedCreatureType = null;
    this.selectedCreatureIndex = -1;
    this.diagnosticsPanel = document.getElementById('diagnostics-panel');
    this.diagnosticsContent = document.getElementById('diagnostics-content');
    this.diagnosticsVisible = false;
    this._diagLastUpdate = 0;
    this._diagStatusMemory = new Map();
    this._diagFlashUntil = new Map();
    this._bgLoading = document.getElementById('bg-loading');
    this._bgLoadingVisible = false;

    this.creatureList.addEventListener('click', (e) => {
      const entry = e.target.closest('.creature-entry');
      if (!entry || !entry.dataset.creatureType) return;
      this.selectedCreatureType = entry.dataset.creatureType;
      this.selectedCreatureIndex = this.creatureTypes.indexOf(this.selectedCreatureType);
      this.trackCreatureByType(entry.dataset.creatureType);
    });
  }

  update(depth, flashlightOn, camera) {
    // Depth counter — skip DOM mutation when unchanged
    const flooredDepth = Math.floor(depth);
    if (flooredDepth !== this._lastDepth) {
      this._lastDepth = flooredDepth;
      this.depthDisplay.textContent = `${flooredDepth}m`;
    }

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
    this._drawSonar(depth, camera);
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

  sonarPing(playerPos, creaturePositions) {
    this.sonarPings = creaturePositions.map(pos => ({
      dx: pos.x - playerPos.x,
      dz: pos.z - playerPos.z,
      dist: pos.distanceTo(playerPos),
    })).filter(p => p.dist < 80);
    this.sonarAge = 0;
  }

  _drawSonar(depth, camera) {
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

    // Fade trail — reuse cached gradient at angle 0, rotate canvas instead
    if (!this._sonarGradient) {
      this._sonarGradient = ctx.createConicGradient(0, 0, 0);
      this._sonarGradient.addColorStop(0, '#22ff4422');
      this._sonarGradient.addColorStop(0.15, '#22ff4400');
      this._sonarGradient.addColorStop(1, '#22ff4400');
    }
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(sweepAngle);
    ctx.fillStyle = this._sonarGradient;
    ctx.beginPath();
    ctx.arc(0, 0, 70, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Creature pings
    if (this.sonarPings.length > 0) {
      const pingAlpha = Math.max(0, 1 - this.sonarAge * 0.3);
      if (pingAlpha > 0) {
        if (camera) {
          camera.getWorldDirection(this._sonarForward);
          this._sonarForward.y = 0;
          if (this._sonarForward.lengthSq() > 0.0001) {
            this._sonarForward.normalize();
          } else {
            this._sonarForward.set(0, 0, -1);
          }
        } else {
          this._sonarForward.set(0, 0, -1);
        }

        const rightX = -this._sonarForward.z;
        const rightZ = this._sonarForward.x;
        ctx.fillStyle = '#ff3232';
        for (const ping of this.sonarPings) {
          const scale = 70 / 80; // max range
          const localRight = ping.dx * rightX + ping.dz * rightZ;
          const localForward = ping.dx * this._sonarForward.x + ping.dz * this._sonarForward.z;
          const px = cx + localRight * scale;
          const pz = cy - localForward * scale;
          if (px > 5 && px < w - 5 && pz > 5 && pz < h - 5) {
            ctx.globalAlpha = pingAlpha;
            ctx.beginPath();
            ctx.arc(px, pz, 3, 0, Math.PI * 2);
            ctx.fill();

            // Glow
            ctx.globalAlpha = pingAlpha * 0.3;
            ctx.beginPath();
            ctx.arc(px, pz, 6, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
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

  toggleDiagnostics() {
    this.diagnosticsVisible = !this.diagnosticsVisible;
    this.diagnosticsPanel.classList.toggle('visible', this.diagnosticsVisible);
    if (!this.diagnosticsVisible) {
      this._diagLastUpdate = 0;
    }
  }

  closeDiagnostics() {
    this.diagnosticsVisible = false;
    this.diagnosticsPanel.classList.remove('visible');
    this._diagLastUpdate = 0;
    this._diagStatusMemory.clear();
    this._diagFlashUntil.clear();
  }

  isDiagnosticsVisible() {
    return this.diagnosticsVisible;
  }

  resetRuntimeState() {
    this.closeLocator();
    this.stopTracking();
    this.closeDiagnostics();
    this.warningTimer = 0;
    this.warningText.textContent = '';
    this.warningText.classList.remove('visible');
    this.warningText.style.opacity = '';
    this.sonarPings = [];
    this.sonarAge = 0;
    this.lastDepthZone = '';
    this._lastDepth = -1;
    this.depthDisplay.textContent = '0m';
    this.depthZone.textContent = 'SURFACE';
    this.depthZone.style.color = '#4488aa';
    this.updateBackgroundLoading(false);
  }

  updateDiagnostics(snapshot) {
    if (!this.diagnosticsVisible || !snapshot) return;

    const now = performance.now();
    if (now - this._diagLastUpdate < 200) return;
    this._diagLastUpdate = now;

    const stallRiskClass = this._statusClass(snapshot.postProcess?.stallRisk);
    const emaClass = this._statusClass(snapshot.postProcess?.emaPressure);
    const renderClass = this._statusClass(snapshot.postProcess?.lastRenderPressure);
    const rendererClass = snapshot.graphics?.hardwareAccelerated === false ? 'status-fallback' : 'status-normal';
    const bloomClass = snapshot.postProcess?.bloomSuspended ? 'status-pressured' : 'status-normal';
    const bloomMode = snapshot.postProcess?.bloom?.mode === 'pipeline'
      ? 'Pipeline'
      : snapshot.postProcess?.bloom?.mode === 'unreal'
        ? 'Unreal'
        : snapshot.postProcess?.bloom?.mode === 'none'
          ? 'Off'
          : 'Shader';
    const bloomStatus = snapshot.postProcess?.bloom?.mode === 'none'
      ? 'off'
      : snapshot.postProcess?.bloomSuspended
        ? 'suspended'
        : snapshot.postProcess?.bloom?.passEnabled
          ? 'active'
          : 'shader-only';
    const emaFlashClass = this._flashClass('ema', snapshot.postProcess?.emaPressure, now);
    const renderFlashClass = this._flashClass('render', snapshot.postProcess?.lastRenderPressure, now);

    const rows = [
      this._diagRow('Stall risk', snapshot.postProcess?.stallRiskLabel ?? 'Unknown', stallRiskClass),
      this._diagRow('FPS / depth', `${this._fmtNumber(snapshot.fps, 0)} FPS | ${this._fmtNumber(snapshot.depth, 0)}m | max ${this._fmtNumber(snapshot.maxDepth, 0)}m`),
      this._diagRow('Light zone', `${this._formatZone(snapshot.lighting?.zone)} | tw ${this._fmtFixed(snapshot.lighting?.blends?.twilight, 2)} | dark ${this._fmtFixed(snapshot.lighting?.blends?.darkZone, 2)} | abyss ${this._fmtFixed(snapshot.lighting?.blends?.abyss, 2)}`),
      this._diagRow('Fog', `${snapshot.lighting?.fogColor ?? '--'} | near ${this._fmtFixed(snapshot.lighting?.fogNear, 2)} | far ${this._fmtFixed(snapshot.lighting?.fogFar, 1)}`),
      this._diagRow('Ambient', `${this._fmtFixed(snapshot.lighting?.ambientIntensity, 3)} | target exp ${this._fmtFixed(snapshot.lighting?.targetExposure, 2)}`),
      this._diagRow('Underwater FX', `trans ${this._formatRgb(snapshot.postProcess?.transmittance, 2)} | scatter ${this._fmtFixed(snapshot.postProcess?.scatter?.mix, 2)} @ ${this._fmtFixed(snapshot.postProcess?.scatter?.density, 4)}`),
      this._diagRow('Bloom mode', `${bloomMode} | ${bloomStatus}`, bloomClass),
      this._diagRow('Light budget', `${this._fmtNumber(snapshot.pointLights?.activeCount, 0)} active / ${this._fmtNumber(snapshot.pointLights?.maxLights, 0)} budget | ${this._fmtNumber(snapshot.pointLights?.managedCount, 0)} managed`),
      this._diagRow('Light cats', `active ${this._formatCategorySummary(snapshot.pointLights?.activeCategories)} | managed ${this._formatCategorySummary(snapshot.pointLights?.managedCategories)}`),
      this._diagRow('Light work', `${snapshot.pointLights?.registrationMode ?? 'scan'} | reg ${this._fmtFixed(snapshot.pointLights?.registrationEmaMs, 3)}ms | unreg ${this._fmtFixed(snapshot.pointLights?.unregistrationEmaMs, 3)}ms | retarget ${this._fmtFixed(snapshot.pointLights?.retargetEmaMs, 3)}ms | top ${this._fmtNumber(snapshot.pointLights?.selectedCount, 0)}/${this._fmtNumber(snapshot.pointLights?.candidateCount, 0)}`),
      this._diagRow('Modifiers', this._formatModifierSummary(snapshot.lighting?.modifiers)),
      this._diagRow('Creatures', `${this._fmtNumber(snapshot.creaturesActive, 0)} active | ${this._fmtNumber(snapshot.queuedSpawns, 0)} queued`),
      this._diagRow('Quality', `${snapshot.qualityTier ?? 'unknown'} | ${snapshot.graphics?.context ?? 'webgl'}`),
      this._diagRow('Renderer', snapshot.graphics?.hardwareAcceleratedLabel ?? 'Unknown', rendererClass),
      this._diagRow('GPU', this._truncateLine(snapshot.graphics?.renderer ?? 'Unavailable'), rendererClass),
      this._diagRow('Vendor', snapshot.graphics?.vendor ?? 'Unknown', 'muted'),
      this._diagRow('Post FX', `scale ${this._fmtFixed(snapshot.postProcess?.composerScale, 2)} | EMA ${this._fmtFixed(snapshot.postProcess?.renderEmaMs, 1)}ms`, `${emaClass} ${emaFlashClass}`.trim()),
      this._diagRow('Render', `last ${this._fmtFixed(snapshot.postProcess?.lastRenderMs, 1)}ms`, `${renderClass} ${renderFlashClass}`.trim()),
      this._diagRow('Bloom', snapshot.postProcess?.bloom?.mode === 'none' ? 'Off' : snapshot.postProcess?.bloomSuspended ? 'Suspended' : 'Active', bloomClass),
      this._diagRow('Exposure', `${this._fmtFixed(snapshot.exposure, 2)} | flashlight ${snapshot.flashlightOn ? 'on' : 'off'}`),
      this._diagRow('Player', `x ${this._fmtFixed(snapshot.playerPosition?.x, 1)}  y ${this._fmtFixed(snapshot.playerPosition?.y, 1)}  z ${this._fmtFixed(snapshot.playerPosition?.z, 1)}`),
      this._diagRow('State', `${snapshot.running ? 'running' : 'idle'}${snapshot.autoplay ? ' | autoplay' : ''}${snapshot.physicsReady ? ' | physics' : ''}`),
    ];

    this.diagnosticsContent.innerHTML = rows.join('');
  }

  _diagRow(label, value, valueClass = '') {
    return `<div class="diagnostics-row"><span class="diagnostics-label">${this._escapeHtml(label)}</span><span class="diagnostics-value ${valueClass}">${this._escapeHtml(value)}</span></div>`;
  }

  _statusClass(status) {
    if (status === 'emergency') return 'status-emergency';
    if (status === 'pressured') return 'status-pressured';
    return 'status-normal';
  }

  _flashClass(key, status, now) {
    const currentRank = this._statusRank(status);
    const previousStatus = this._diagStatusMemory.get(key) ?? 'normal';
    const previousRank = this._statusRank(previousStatus);

    if (currentRank > previousRank && currentRank >= this._statusRank('pressured')) {
      this._diagFlashUntil.set(key, now + 900);
    }

    this._diagStatusMemory.set(key, status ?? 'normal');

    const flashUntil = this._diagFlashUntil.get(key) ?? 0;
    if (now >= flashUntil) {
      this._diagFlashUntil.delete(key);
      return '';
    }

    return status === 'emergency' ? 'flash-emergency' : 'flash-pressured';
  }

  _statusRank(status) {
    if (status === 'emergency') return 2;
    if (status === 'pressured') return 1;
    return 0;
  }

  _fmtNumber(value, digits = 0) {
    if (!Number.isFinite(value)) return '--';
    return Number(value).toFixed(digits);
  }

  _fmtFixed(value, digits = 1) {
    if (!Number.isFinite(value)) return '--';
    return Number(value).toFixed(digits);
  }

  _formatZone(value) {
    if (!value) return 'Unknown';
    if (value === 'darkZone') return 'Dark Zone';
    return value
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/^./, (ch) => ch.toUpperCase());
  }

  _formatRgb(value, digits = 2) {
    if (!value) return '--/--/--';
    return `${this._fmtFixed(value.r, digits)}/${this._fmtFixed(value.g, digits)}/${this._fmtFixed(value.b, digits)}`;
  }

  _formatCategorySummary(categories) {
    if (!categories || Object.keys(categories).length === 0) return 'none';
    return Object.entries(categories)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([key, count]) => `${key}:${count}`)
      .join(', ');
  }

  _formatModifierSummary(modifiers) {
    if (!Array.isArray(modifiers) || modifiers.length === 0) return 'none';
    return modifiers
      .map((modifier) => `${modifier.id} ${this._fmtFixed(modifier.weight, 2)}`)
      .join(', ');
  }

  _truncateLine(text) {
    if (!text) return '--';
    return text.length > 42 ? `${text.slice(0, 39)}...` : text;
  }

  _escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
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

  updateBackgroundLoading(active) {
    if (active === this._bgLoadingVisible) return;
    this._bgLoadingVisible = active;
    if (active) {
      this._bgLoading.classList.add('visible');
    } else {
      this._bgLoading.classList.remove('visible');
    }
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
        const angle = Math.atan2(forward.x, forward.z) - Math.atan2(dir.x, dir.z);
        this.trackArrow.style.transform = `rotate(${angle}rad)`;

        // Vertical elevation indicator
        const dy = dir.y;
        if (Math.abs(dy) >= 3) {
          const sym = dy > 0 ? '▲' : '▼';
          this.trackElev.textContent = `${sym} ${Math.floor(Math.abs(dy))}m`;
        } else {
          this.trackElev.textContent = '';
        }
      } else {
        this.trackedType = null;
        this.trackIndicator.classList.remove('visible');
      }
    } else {
      this.trackIndicator.classList.remove('visible');
    }
  }
}
