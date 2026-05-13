import * as THREE from 'three';
import { createNode } from '@found-in-space/touch-os';
import { SCALE as SCENE_SCALE } from '../services/octree/scene-scale.js';

const DEFAULT_COOL_K = 2500;
const DEFAULT_HOT_K = 40000;
const DEFAULT_MIN_MAG = -6;
const DEFAULT_MAX_MAG = 17;
const DEFAULT_MARGIN_PX = 28;
const DEFAULT_HEIGHT = 220;
const TEMP_TICKS = [3000, 5000, 8000, 15000, 30000];
const MAG_TICK_STEP = 4;
const INVALID_TEFF_LOG8 = 255;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeViewProjection(viewProjection) {
  if (!viewProjection) {
    return undefined;
  }
  if (Array.isArray(viewProjection) || ArrayBuffer.isView(viewProjection)) {
    return viewProjection;
  }
  if (Array.isArray(viewProjection.elements) || ArrayBuffer.isView(viewProjection.elements)) {
    return viewProjection.elements;
  }
  return undefined;
}

function resolveStarCount(starCount, positions, teffLog8, magAbs) {
  const maxCount = Math.min(
    Math.floor((positions?.length ?? 0) / 3),
    teffLog8?.length ?? 0,
    magAbs?.length ?? 0,
  );
  const requested = Number.isFinite(starCount) ? Math.floor(starCount) : maxCount;
  return clamp(requested, 0, maxCount);
}

export function decodeTeff(log8Byte) {
  const encoded = Number(log8Byte);
  if (!Number.isFinite(encoded) || encoded >= INVALID_TEFF_LOG8) {
    return null;
  }
  const log8 = encoded / 255;
  return 2000 * Math.pow(25, log8);
}

function teffToRgbComponents(tempK) {
  const t = clamp(tempK, 1000, 40000) / 100;

  let r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  let g;
  if (t <= 66) {
    g = 99.4708025861 * Math.log(t) - 161.119568166;
  } else {
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  }

  let b;
  if (t >= 66) {
    b = 255;
  } else if (t <= 19) {
    b = 0;
  } else {
    b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  }

  return [
    clamp(Math.round(r), 0, 255),
    clamp(Math.round(g), 0, 255),
    clamp(Math.round(b), 0, 255),
  ];
}

export function tempToX(tempK, width, margin, coolK, hotK) {
  const minLogT = Math.log10(coolK);
  const maxLogT = Math.log10(hotK);
  const logT = Math.log10(clamp(tempK, coolK, hotK));
  const tNorm = (logT - minLogT) / (maxLogT - minLogT);
  return width - margin - tNorm * (width - 2 * margin);
}

export function magToY(mag, height, margin, minMag, maxMag) {
  const mNorm = clamp((mag - minMag) / (maxMag - minMag), 0, 1);
  return margin + mNorm * (height - 2 * margin);
}

function createCanvas(width, height, preferDom = false) {
  const scope = globalThis;

  if (preferDom && scope.document?.createElement) {
    const canvas = scope.document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  if (typeof scope.OffscreenCanvas === 'function') {
    return new scope.OffscreenCanvas(width, height);
  }

  if (scope.document?.createElement) {
    const canvas = scope.document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  return null;
}

function createHRMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uScale: { value: SCENE_SCALE },
      uCameraPosition: { value: new THREE.Vector3() },
      uMagLimit: { value: 6.5 },
      uMinLogT: { value: Math.log10(DEFAULT_COOL_K) },
      uMaxLogT: { value: Math.log10(DEFAULT_HOT_K) },
      uMinMag: { value: DEFAULT_MIN_MAG },
      uMaxMag: { value: DEFAULT_MAX_MAG },
      uMarginPx: { value: DEFAULT_MARGIN_PX },
      uWidth: { value: 480 },
      uHeight: { value: 320 },
      uMode: { value: 1 },
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

        if (uMode == 0) {
          float dPc = max(length(worldPos - uCameraPosition) / uScale, 0.001);
          float mApp = magAbs + 5.0 * log(dPc) / log(10.0) - 5.0;
          if (mApp > uMagLimit) {
            gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
            gl_PointSize = 0.0;
            vAlpha = 0.0;
            return;
          }
          float fade = 1.0 - smoothstep(uMagLimit - 1.5, uMagLimit, mApp);
          vAlpha = 0.55 * fade;
        } else if (uMode == 1) {
          vAlpha = 0.5;
        } else {
          float dPc = max(length(worldPos - uCameraPosition) / uScale, 0.001);
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

        float logT = log(tempK) / log(10.0);
        float tNorm = clamp((logT - uMinLogT) / (uMaxLogT - uMinLogT), 0.0, 1.0);
        float plotW = uWidth - 2.0 * uMarginPx;
        float xPx = uWidth - uMarginPx - tNorm * plotW;
        float x = xPx / uWidth * 2.0 - 1.0;

        float mNorm = clamp((magAbs - uMinMag) / (uMaxMag - uMinMag), 0.0, 1.0);
        float plotH = uHeight - 2.0 * uMarginPx;
        float yPx = uMarginPx + mNorm * plotH;
        float y = 1.0 - yPx / uHeight * 2.0;

        gl_Position = vec4(x, y, 0.0, 1.0);
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

function drawAxes(ctx, width, height, options) {
  const {
    margin,
    coolK,
    hotK,
    minMag,
    maxMag,
    starCount,
    highlightRegion,
    placeholderText,
    theme,
  } = options;

  ctx.fillStyle = theme.itemBg;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 1;
  ctx.strokeRect(margin, margin, width - margin * 2, height - margin * 2);

  ctx.fillStyle = theme.textDim;
  ctx.strokeStyle = 'rgba(236, 238, 246, 0.12)';
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (const tempK of TEMP_TICKS) {
    if (tempK < coolK || tempK > hotK) {
      continue;
    }
    const x = tempToX(tempK, width, margin, coolK, hotK);
    if (x < margin || x > width - margin) {
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(x, height - margin);
    ctx.lineTo(x, height - margin + 4);
    ctx.stroke();
    ctx.fillText(tempK >= 1000 ? `${Math.round(tempK / 1000)}k` : String(tempK), x, height - margin + 15);
  }

  ctx.textAlign = 'right';
  const startMag = Math.ceil(minMag / MAG_TICK_STEP) * MAG_TICK_STEP;
  for (let mag = startMag; mag <= maxMag; mag += MAG_TICK_STEP) {
    const y = magToY(mag, height, margin, minMag, maxMag);
    if (y < margin || y > height - margin) {
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(margin - 4, y);
    ctx.lineTo(margin, y);
    ctx.stroke();
    ctx.fillText(String(mag), margin - 6, y + 3);
  }

  ctx.textAlign = 'start';
  ctx.fillText('Hot', margin + 4, height - margin + 15);
  ctx.fillText('Cool', width - margin - 26, height - margin + 15);
  ctx.save();
  ctx.translate(10, height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('Abs. magnitude', 0, 0);
  ctx.restore();

  if (starCount > 0) {
    ctx.fillStyle = theme.accent;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${starCount.toLocaleString()} stars`, width - margin, margin - 6);
    ctx.textAlign = 'start';
  } else if (placeholderText) {
    ctx.fillStyle = theme.textDim;
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(placeholderText, width / 2, height / 2);
    ctx.textAlign = 'start';
  }

  if (!highlightRegion) {
    return;
  }

  const {
    teffMin,
    teffMax,
    magAbsMin,
    magAbsMax,
    color = '#8cffb8',
    label,
  } = highlightRegion;
  const x0 = tempToX(teffMin, width, margin, coolK, hotK);
  const x1 = tempToX(teffMax, width, margin, coolK, hotK);
  const y0 = magToY(magAbsMin, height, margin, minMag, maxMag);
  const y1 = magToY(magAbsMax, height, margin, minMag, maxMag);
  const left = Math.min(x0, x1);
  const top = Math.min(y0, y1);
  const regionWidth = Math.abs(x1 - x0);
  const regionHeight = Math.abs(y1 - y0);

  ctx.fillStyle = `${color}33`;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.fillRect(left, top, regionWidth, regionHeight);
  ctx.strokeRect(left, top, regionWidth, regionHeight);

  if (label) {
    ctx.fillStyle = color;
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(label, left + 6, Math.max(margin + 12, top + 14));
  }
}

function drawSelectedStars(ctx, width, height, options) {
  const { margin, coolK, hotK, minMag, maxMag, selectedStars } = options;
  if (!Array.isArray(selectedStars) || selectedStars.length === 0) {
    return;
  }

  ctx.save();
  for (const star of selectedStars) {
    const teff = Number(star?.teffK);
    const magAbs = Number(star?.magAbs);
    if (!Number.isFinite(teff) || !Number.isFinite(magAbs)) {
      continue;
    }

    const x = tempToX(teff, width, margin, coolK, hotK);
    const y = magToY(magAbs, height, margin, minMag, maxMag);
    ctx.strokeStyle = 'rgba(255, 236, 138, 0.96)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(21, 30, 51, 0.95)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - 6, y);
    ctx.lineTo(x + 6, y);
    ctx.moveTo(x, y - 6);
    ctx.lineTo(x, y + 6);
    ctx.stroke();
  }
  ctx.restore();
}

function createHRDiagramSurfaceHandle() {
  const imageCanvas = createCanvas(1, 1);
  const imageContext = imageCanvas?.getContext?.('2d');
  const glCanvas = createCanvas(1, 1, true);

  if (!imageCanvas || !imageContext || !glCanvas) {
    return null;
  }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: glCanvas,
      alpha: true,
      antialias: false,
    });
  } catch {
    return null;
  }

  renderer.setClearColor(0x000000, 0);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
  const scene = new THREE.Scene();
  const material = createHRMaterial();
  const geometry = new THREE.BufferGeometry();
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  scene.add(points);

  let width = 1;
  let height = 1;
  let pixelDensity = 1;
  let revision = 0;
  let geometryRefs = {
    positions: null,
    teffLog8: null,
    magAbs: null,
  };

  function syncSize(nextWidth, nextHeight, nextPixelDensity) {
    width = Math.max(1, Math.round(nextWidth));
    height = Math.max(1, Math.round(nextHeight));
    pixelDensity = clamp(
      Number.isFinite(nextPixelDensity) ? Number(nextPixelDensity) : 1,
      1,
      2,
    );

    const physicalWidth = Math.max(1, Math.round(width * pixelDensity));
    const physicalHeight = Math.max(1, Math.round(height * pixelDensity));
    imageCanvas.width = physicalWidth;
    imageCanvas.height = physicalHeight;
    renderer.setPixelRatio(pixelDensity);
    renderer.setSize(width, height, false);
    material.uniforms.uWidth.value = width;
    material.uniforms.uHeight.value = height;
  }

  function syncGeometry(value) {
    const positions = value?.positions ?? null;
    const teffLog8 = value?.teffLog8 ?? null;
    const magAbs = value?.magAbs ?? null;
    const starCount = Number.isFinite(value?.starCount) ? Math.floor(value.starCount) : 0;

    if (!positions || !teffLog8 || !magAbs || starCount <= 0) {
      geometry.setDrawRange(0, 0);
      return 0;
    }

    if (geometryRefs.positions !== positions) {
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometryRefs.positions = positions;
    }
    if (geometryRefs.teffLog8 !== teffLog8) {
      geometry.setAttribute('teff_log8', new THREE.Uint8BufferAttribute(teffLog8, 1, true));
      geometryRefs.teffLog8 = teffLog8;
    }
    if (geometryRefs.magAbs !== magAbs) {
      geometry.setAttribute('magAbs', new THREE.BufferAttribute(magAbs, 1));
      geometryRefs.magAbs = magAbs;
    }

    geometry.setDrawRange(0, starCount);
    return starCount;
  }

  function drawCompositeFrame(signature) {
    syncSize(signature.width, signature.height, signature.pixelDensity);
    const starCount = syncGeometry(signature.value);
    const theme = signature.theme;
    const placeholderText = signature.value ? '' : 'Awaiting star field';

    material.uniforms.uCameraPosition.value.set(
      signature.value?.observerX ?? 0,
      signature.value?.observerY ?? 0,
      signature.value?.observerZ ?? 0,
    );
    material.uniforms.uMagLimit.value = signature.value?.appMagLimit ?? 6.5;
    material.uniforms.uMode.value = signature.value?.mode ?? 1;
    material.uniforms.uMinLogT.value = Math.log10(signature.coolK);
    material.uniforms.uMaxLogT.value = Math.log10(signature.hotK);
    material.uniforms.uMinMag.value = signature.minMag;
    material.uniforms.uMaxMag.value = signature.maxMag;
    material.uniforms.uMarginPx.value = signature.margin;
    material.uniforms.uViewProjection.value.fromArray(
      signature.value?.viewProjection ?? IDENTITY_MATRIX,
    );

    imageContext.setTransform(pixelDensity, 0, 0, pixelDensity, 0, 0);
    imageContext.clearRect(0, 0, width, height);
    drawAxes(imageContext, width, height, {
      margin: signature.margin,
      coolK: signature.coolK,
      hotK: signature.hotK,
      minMag: signature.minMag,
      maxMag: signature.maxMag,
      starCount,
      highlightRegion: signature.highlightRegion,
      placeholderText,
      theme,
    });

    if (starCount > 0) {
      renderer.render(scene, camera);
      imageContext.drawImage(glCanvas, 0, 0, width, height);
      drawSelectedStars(imageContext, width, height, {
        margin: signature.margin,
        coolK: signature.coolK,
        hotK: signature.hotK,
        minMag: signature.minMag,
        maxMag: signature.maxMag,
        selectedStars: signature.value?.selectedStars ?? null,
      });
    }

    revision += 1;
  }

  return {
    kind: 'skykit-hr-diagram-surface',
    image: imageCanvas,
    width: 1,
    height: 1,
    revision: 0,

    update(signature) {
      drawCompositeFrame(signature);
      this.width = imageCanvas.width;
      this.height = imageCanvas.height;
      this.revision = revision;
    },

    draw(context, rect) {
      if (typeof context.drawImage === 'function') {
        context.drawImage(this.image, rect.x, rect.y, rect.width, rect.height);
        return;
      }
      context.fillStyle = '#08111d';
      context.fillRect(rect.x, rect.y, rect.width, rect.height);
    },

    dispose() {
      renderer.dispose();
      material.dispose();
      geometry.dispose();
    },
  };
}

const IDENTITY_MATRIX = new Float32Array([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]);

const HRDiagramComponent = {
  kind: 'skykit-hr-diagram',

  mount() {
    return {
      surfaceHandle: createHRDiagramSurfaceHandle(),
      signature: null,
    };
  },

  measure(ctx) {
    return {
      width: ctx.constraints.maxWidth,
      height: ctx.props.height ?? DEFAULT_HEIGHT,
    };
  },

  layout(ctx) {
    ctx.setContentBounds(ctx.bounds);

    const width = Math.max(1, Math.round(ctx.bounds.width));
    const height = Math.max(1, Math.round(ctx.bounds.height));
    const pixelDensity = ctx.services.surface.getMetrics().pixelDensity ?? 1;
    const themeTokens = ctx.services.theme.getTokens();
    const signature = {
      width,
      height,
      pixelDensity,
      value: ctx.props.value ?? null,
      coolK: ctx.props.coolK ?? DEFAULT_COOL_K,
      hotK: ctx.props.hotK ?? DEFAULT_HOT_K,
      minMag: ctx.props.minMag ?? DEFAULT_MIN_MAG,
      maxMag: ctx.props.maxMag ?? DEFAULT_MAX_MAG,
      margin: ctx.props.margin ?? DEFAULT_MARGIN_PX,
      highlightRegion: ctx.props.highlightRegion ?? null,
      compositionMode: ctx.props.compositionMode ?? 'composite',
      theme: {
        itemBg: themeTokens.backgroundColor,
        border: themeTokens.borderColor,
        textDim: themeTokens.mutedTextColor,
        accent: themeTokens.accentColor,
      },
    };

    const previous = ctx.state.signature;
    if (
      previous &&
      previous.width === signature.width &&
      previous.height === signature.height &&
      previous.pixelDensity === signature.pixelDensity &&
      previous.value === signature.value &&
      previous.coolK === signature.coolK &&
      previous.hotK === signature.hotK &&
      previous.minMag === signature.minMag &&
      previous.maxMag === signature.maxMag &&
      previous.margin === signature.margin &&
      previous.highlightRegion === signature.highlightRegion &&
      previous.compositionMode === signature.compositionMode &&
      previous.theme.itemBg === signature.theme.itemBg &&
      previous.theme.border === signature.theme.border &&
      previous.theme.textDim === signature.theme.textDim &&
      previous.theme.accent === signature.theme.accent
    ) {
      return;
    }

    ctx.state.surfaceHandle?.update(signature);
    ctx.state.signature = signature;
  },

  render(ctx) {
    const handle = ctx.state.surfaceHandle;
    const signature = ctx.state.signature;
    if (!handle || !signature) {
      return [
        {
          type: 'rect',
          componentId: ctx.id,
          role: 'hr-diagram-fallback',
          rect: ctx.bounds,
          fill: '#08111d',
          stroke: '#27405e',
          strokeWidth: 1,
          radius: 10,
        },
        {
          type: 'text',
          componentId: ctx.id,
          role: 'hr-diagram-fallback-label',
          rect: ctx.bounds,
          text: 'HR diagram requires WebGL',
          color: '#93a3b8',
          align: 'center',
          verticalAlign: 'middle',
          fontSize: 14,
          fontWeight: 600,
        },
      ];
    }

    return [
      {
        type: 'surface',
        componentId: ctx.id,
        role: 'hr-diagram',
        rect: ctx.bounds,
        handle,
        surfaceRevision: handle.revision,
        compositionMode: signature.compositionMode,
      },
    ];
  },

  dispose(ctx) {
    ctx.state.surfaceHandle?.dispose?.();
  },
};

export function buildHRDiagramValue(geometry, options = {}) {
  const positions = geometry?.attributes?.position?.array;
  const teffLog8 = geometry?.attributes?.teff_log8?.array;
  const magAbs = geometry?.attributes?.magAbs?.array;
  if (!positions || !teffLog8 || !magAbs) {
    return null;
  }

  const observerPc = options.observerPc ?? { x: 0, y: 0, z: 0 };
  const viewProjection = normalizeViewProjection(options.viewProjection);
  const starCount = resolveStarCount(
    options.starCount,
    positions,
    teffLog8,
    magAbs,
  );

  return {
    positions,
    teffLog8,
    magAbs,
    starCount,
    observerX: (observerPc.x ?? 0) * SCENE_SCALE,
    observerY: (observerPc.y ?? 0) * SCENE_SCALE,
    observerZ: (observerPc.z ?? 0) * SCENE_SCALE,
    mode: Number.isFinite(options.mode) ? Number(options.mode) : 1,
    appMagLimit: Number.isFinite(options.appMagLimit) ? Number(options.appMagLimit) : 6.5,
    viewProjection,
    selectedStars: Array.isArray(options.selectedStars)
      ? options.selectedStars.map((star) => ({
        teffK: Number(star?.teffK),
        magAbs: Number(star?.magAbs),
      }))
      : null,
  };
}

export function createHRDiagramControl(id, props = {}) {
  return createNode(id, HRDiagramComponent, props);
}
