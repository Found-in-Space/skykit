import * as THREE from 'three';

const DEFAULT_COOL_K = 2500;
const DEFAULT_HOT_K = 40000;
const DEFAULT_MARGIN_PX = 34;
const DEFAULT_MIN_MAG = -6;
const DEFAULT_MAX_MAG = 17;
const DEFAULT_VOLUME_RADIUS_PC = 1e9;
const SCENE_SCALE = 0.001;

// ── Shader ──────────────────────────────────────────────────────────────────

function createHRMaterial(opts) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uScale: { value: SCENE_SCALE },
      uCameraPosition: { value: new THREE.Vector3() },
      uMagLimit: { value: opts.appMagLimit },
      uMinLogT: { value: opts.minLogT },
      uMaxLogT: { value: opts.maxLogT },
      uMinMag: { value: opts.minMag },
      uMaxMag: { value: opts.maxMag },
      uMarginPx: { value: opts.marginPx },
      uWidth: { value: 480 },
      uHeight: { value: 320 },
      uMode: { value: opts.mode },
      uVolumeRadiusPc: { value: opts.volumeRadiusPc ?? DEFAULT_VOLUME_RADIUS_PC },
      uViewProjection: { value: new THREE.Matrix4() },
    },
    vertexShader: /* glsl */ `
      attribute float teff_log8;
      attribute float magAbs;

      uniform float uScale;
      uniform vec3  uCameraPosition;
      uniform float uMagLimit;
      uniform float uMinLogT;
      uniform float uMaxLogT;
      uniform float uMinMag;
      uniform float uMaxMag;
      uniform float uMarginPx;
      uniform float uWidth;
      uniform float uHeight;
      uniform int   uMode;
      uniform float uVolumeRadiusPc;
      uniform mat4  uViewProjection;

      varying vec3  vColor;
      varying float vAlpha;

      float decodeTemperature(float log8) {
        if (log8 >= 0.996) return 5800.0;
        return 2000.0 * pow(25.0, log8);
      }

      vec3 blackbodyToRGB(float temp) {
        float t = clamp(temp, 1000.0, 40000.0) / 100.0;
        vec3 c;
        if (t <= 66.0) c.r = 255.0;
        else c.r = 329.698727446 * pow(t - 60.0, -0.1332047592);
        if (t <= 66.0) c.g = 99.4708025861 * log(t) - 161.119568166;
        else c.g = 288.1221695283 * pow(t - 60.0, -0.0755148492);
        if (t >= 66.0) c.b = 255.0;
        else if (t <= 19.0) c.b = 0.0;
        else c.b = 138.5177312231 * log(t - 10.0) - 305.0447927307;
        return clamp(c / 255.0, 0.0, 1.0);
      }

      void main() {
        vec3 worldPos = position;

        // ── Mode 0: magnitude-limited (original behaviour) ──────────────
        if (uMode == 0) {
          float d    = length(worldPos - uCameraPosition);
          float dPc  = max(d / uScale, 0.001);
          float mApp = magAbs + 5.0 * log(dPc) / log(10.0) - 5.0;
          if (mApp > uMagLimit) {
            gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
            gl_PointSize = 0.0;
            vAlpha = 0.0;
            return;
          }
          float fade = 1.0 - smoothstep(uMagLimit - 1.5, uMagLimit, mApp);
          vAlpha = 0.55 * fade;
        }

        // ── Mode 1: volume-complete (show every star in the geometry) ───
        else if (uMode == 1) {
          float dPc = max(length(worldPos - uCameraPosition) / uScale, 0.001);
          if (dPc > uVolumeRadiusPc) {
            gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
            gl_PointSize = 0.0;
            vAlpha = 0.0;
            return;
          }
          vAlpha = 0.5;
        }

        // ── Mode 2: camera-frustum (only stars visible in the skyview) ──
        else {
          float d    = length(worldPos - uCameraPosition);
          float dPc  = max(d / uScale, 0.001);
          float mApp = magAbs + 5.0 * log(dPc) / log(10.0) - 5.0;
          if (mApp > uMagLimit) {
            gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
            gl_PointSize = 0.0;
            vAlpha = 0.0;
            return;
          }
          vec4 clip = uViewProjection * vec4(worldPos, 1.0);
          if (abs(clip.x) > clip.w * 1.05 || abs(clip.y) > clip.w * 1.05 || clip.z < 0.0) {
            gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
            gl_PointSize = 0.0;
            vAlpha = 0.0;
            return;
          }
          float fade = 1.0 - smoothstep(uMagLimit - 1.5, uMagLimit, mApp);
          vAlpha = 0.55 * fade;
        }

        float tempK = decodeTemperature(teff_log8);
        vColor = blackbodyToRGB(tempK);

        float logT  = log(tempK) / log(10.0);
        float tNorm = clamp((logT - uMinLogT) / (uMaxLogT - uMinLogT), 0.0, 1.0);
        float plotW = uWidth - 2.0 * uMarginPx;
        float xPx   = uWidth - uMarginPx - tNorm * plotW;
        float x     = xPx / uWidth * 2.0 - 1.0;

        float mNorm = clamp((magAbs - uMinMag) / (uMaxMag - uMinMag), 0.0, 1.0);
        float plotH = uHeight - 2.0 * uMarginPx;
        float yPx   = uMarginPx + mNorm * plotH;
        float y     = 1.0 - yPx / uHeight * 2.0;

        gl_Position  = vec4(x, y, 0.0, 1.0);
        gl_PointSize = 1.5;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3  vColor;
      varying float vAlpha;

      void main() {
        if (vAlpha <= 0.0) discard;
        gl_FragColor = vec4(vColor, vAlpha);
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// ── Axis helpers ────────────────────────────────────────────────────────────

function mapTemperatureToX(tempK, width, marginPx, coolK, hotK, minLogT, maxLogT) {
  const logT = Math.log10(Math.max(coolK, Math.min(hotK, tempK)));
  const tNorm = (logT - minLogT) / (maxLogT - minLogT);
  return width - marginPx - tNorm * (width - 2 * marginPx);
}

function mapMagnitudeToY(mag, height, marginPx, minMag, maxMag) {
  const mNorm = Math.max(0, Math.min(1, (mag - minMag) / (maxMag - minMag)));
  return marginPx + mNorm * (height - 2 * marginPx);
}

// ── Tick helpers ────────────────────────────────────────────────────────────

const ALL_TEMP_TICKS = [3000, 5000, 8000, 15000, 30000];
const MAG_TICK_STEP = 2;

function drawTempTicks(ctx, width, height, m, coolK, hotK, minLogT, maxLogT) {
  ctx.fillStyle = 'rgba(236, 238, 246, 0.45)';
  ctx.strokeStyle = 'rgba(236, 238, 246, 0.12)';
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (const t of ALL_TEMP_TICKS) {
    if (t < coolK || t > hotK) continue;
    const x = mapTemperatureToX(t, width, m, coolK, hotK, minLogT, maxLogT);
    if (x < m || x > width - m) continue;
    ctx.beginPath();
    ctx.moveTo(x, height - m);
    ctx.lineTo(x, height - m + 4);
    ctx.stroke();
    ctx.fillText(t >= 1000 ? `${(t / 1000).toFixed(0)}k` : String(t), x, height - m + 15);
  }
  ctx.textAlign = 'start';
}

function drawMagTicks(ctx, width, height, m, minMag, maxMag) {
  ctx.fillStyle = 'rgba(236, 238, 246, 0.45)';
  ctx.strokeStyle = 'rgba(236, 238, 246, 0.12)';
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'right';
  const start = Math.ceil(minMag / MAG_TICK_STEP) * MAG_TICK_STEP;
  for (let mag = start; mag <= maxMag; mag += MAG_TICK_STEP) {
    const y = mapMagnitudeToY(mag, height, m, minMag, maxMag);
    if (y < m || y > height - m) continue;
    ctx.beginPath();
    ctx.moveTo(m - 4, y);
    ctx.lineTo(m, y);
    ctx.stroke();
    ctx.fillText(String(mag), m - 6, y + 3);
  }
  ctx.textAlign = 'start';
}

// ── Renderer class ──────────────────────────────────────────────────────────

/**
 * WebGL HR-diagram renderer.
 *
 * Modes:
 *  - 0  magnitude-limited  (original — only stars brighter than appMagLimit)
 *  - 1  volume-complete     (every star in the geometry is plotted)
 *  - 2  camera-frustum      (only stars inside the 3-D camera frustum)
 *
 * Temperature axis can be configured via `coolK` / `hotK` (default 2 500–40 000 K).
 */
export class HRDiagramRenderer {
  constructor(hostCanvas, options = {}) {
    this.marginPx = options.marginPx ?? DEFAULT_MARGIN_PX;
    this.minMag = options.minMag ?? DEFAULT_MIN_MAG;
    this.maxMag = options.maxMag ?? DEFAULT_MAX_MAG;
    this.appMagLimit = options.appMagLimit ?? 6.5;
    this.mode = options.mode ?? 1;
    this.volumeRadiusPc = options.volumeRadiusPc ?? DEFAULT_VOLUME_RADIUS_PC;
    this.highlightRegion = options.highlightRegion ?? null;
    this.starCount = 0;
    this.width = 480;
    this.height = 320;

    this.coolK = options.coolK ?? DEFAULT_COOL_K;
    this.hotK = options.hotK ?? DEFAULT_HOT_K;
    this.minLogT = Math.log10(this.coolK);
    this.maxLogT = Math.log10(this.hotK);

    const wrapper = document.createElement('div');
    wrapper.style.position = 'relative';
    wrapper.style.width = '100%';
    wrapper.style.height = '100%';
    hostCanvas.parentNode.insertBefore(wrapper, hostCanvas);

    this.axesCanvas = hostCanvas;
    wrapper.appendChild(this.axesCanvas);
    this.axesCanvas.style.display = 'block';
    this.axesCanvas.style.width = '100%';
    this.axesCanvas.style.height = '100%';
    this.axesCtx = this.axesCanvas.getContext('2d');

    this.glCanvas = document.createElement('canvas');
    this.glCanvas.style.position = 'absolute';
    this.glCanvas.style.top = '0';
    this.glCanvas.style.left = '0';
    this.glCanvas.style.width = '100%';
    this.glCanvas.style.height = '100%';
    this.glCanvas.style.pointerEvents = 'none';
    wrapper.appendChild(this.glCanvas);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.glCanvas,
      alpha: true,
      antialias: false,
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
    this.camera.position.set(0, 0, 0);

    this.scene = new THREE.Scene();

    this.hrMaterial = createHRMaterial({
      appMagLimit: this.appMagLimit,
      minMag: this.minMag,
      maxMag: this.maxMag,
      marginPx: this.marginPx,
      mode: this.mode,
      volumeRadiusPc: this.volumeRadiusPc,
      minLogT: this.minLogT,
      maxLogT: this.maxLogT,
    });

    this.points = new THREE.Points(new THREE.BufferGeometry(), this.hrMaterial);
    this.points.frustumCulled = false;
    this.scene.add(this.points);

    this.axesDirty = true;
    this.resize();
  }

  resize() {
    const bounds = this.axesCanvas.getBoundingClientRect();
    const w = Math.max(200, Math.floor(bounds.width || 480));
    const h = Math.max(150, Math.floor(bounds.height || 320));
    this.width = w;
    this.height = h;

    this.renderer.setSize(w, h, false);
    this.hrMaterial.uniforms.uWidth.value = w;
    this.hrMaterial.uniforms.uHeight.value = h;

    this.axesDirty = true;
  }

  setMode(mode) {
    this.mode = mode;
    this.hrMaterial.uniforms.uMode.value = mode;
    this.axesDirty = true;
  }

  setAppMagLimit(limit) {
    this.appMagLimit = limit;
    this.hrMaterial.uniforms.uMagLimit.value = limit;
  }

  setVolumeRadiusPc(radiusPc) {
    this.volumeRadiusPc = Number.isFinite(radiusPc) && radiusPc > 0
      ? Number(radiusPc)
      : DEFAULT_VOLUME_RADIUS_PC;
    this.hrMaterial.uniforms.uVolumeRadiusPc.value = this.volumeRadiusPc;
  }

  setHighlightRegion(region) {
    this.highlightRegion = region || null;
    this.axesDirty = true;
  }

  setStarCount(count) {
    if (count !== this.starCount) {
      this.starCount = count;
      this.axesDirty = true;
    }
  }

  setGeometry(geometry) {
    if (geometry && geometry !== this.points.geometry) {
      this.points.geometry = geometry;
    }
  }

  // ── Axes ────────────────────────────────────────────────────────────────

  drawAxes() {
    const { width, height, marginPx: m, coolK, hotK, minLogT, maxLogT } = this;
    const dpr = this.renderer.getPixelRatio();
    this.axesCanvas.width = Math.floor(width * dpr);
    this.axesCanvas.height = Math.floor(height * dpr);
    const ctx = this.axesCtx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = 'rgba(1, 6, 16, 0.92)';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(242, 200, 121, 0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(m, m, width - m * 2, height - m * 2);

    drawTempTicks(ctx, width, height, m, coolK, hotK, minLogT, maxLogT);
    drawMagTicks(ctx, width, height, m, this.minMag, this.maxMag);

    ctx.fillStyle = 'rgba(236, 238, 246, 0.7)';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText('Hot', m + 4, height - m + 15);
    ctx.fillText('Cool', width - m - 26, height - m + 15);
    ctx.save();
    ctx.translate(10, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Abs. magnitude', 0, 0);
    ctx.restore();

    if (this.starCount > 0) {
      ctx.fillStyle = 'rgba(159, 233, 255, 0.75)';
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(
        `${this.starCount.toLocaleString()} stars`,
        width - m,
        m - 6,
      );
      ctx.textAlign = 'start';
    }

    if (this.highlightRegion) {
      const { teffMin, teffMax, magAbsMin, magAbsMax, color = '#8cffb8', label } = this.highlightRegion;
      const x0 = mapTemperatureToX(teffMin, width, m, coolK, hotK, minLogT, maxLogT);
      const x1 = mapTemperatureToX(teffMax, width, m, coolK, hotK, minLogT, maxLogT);
      const y0 = mapMagnitudeToY(magAbsMin, height, m, this.minMag, this.maxMag);
      const y1 = mapMagnitudeToY(magAbsMax, height, m, this.minMag, this.maxMag);
      const left = Math.min(x0, x1);
      const top = Math.min(y0, y1);
      const rw = Math.abs(x1 - x0);
      const rh = Math.abs(y1 - y0);

      ctx.fillStyle = `${color}33`;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.fillRect(left, top, rw, rh);
      ctx.strokeRect(left, top, rw, rh);
      if (label) {
        ctx.fillStyle = color;
        ctx.font = '11px system-ui, sans-serif';
        ctx.fillText(label, left + 6, Math.max(m + 12, top + 14));
      }
    }

    this.axesDirty = false;
  }

  // ── Render ──────────────────────────────────────────────────────────────

  render(cameraWorldPosition) {
    if (this.axesDirty) {
      this.drawAxes();
    }

    if (cameraWorldPosition) {
      this.hrMaterial.uniforms.uCameraPosition.value.copy(cameraWorldPosition);
    }

    this.renderer.render(this.scene, this.camera);
  }

  setViewProjection(matrix) {
    this.hrMaterial.uniforms.uViewProjection.value.copy(matrix);
  }

  dispose() {
    this.renderer.dispose();
    this.hrMaterial.dispose();
    this.points.geometry.dispose();
  }
}
