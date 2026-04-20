/**
 * Mira Landing Page — Main JavaScript (ES Module)
 *
 * Features:
 *  1. Dotted Video Shader (Three.js r181) — Antimetal-style halftone dots + fluid sim
 *  2. Scroll-triggered animations (IntersectionObserver)
 *  3. Navigation behavior (scroll state, active section, smooth scroll)
 *  4. Solutions tab switching with auto-cycle
 *  5. Counter animation for stats
 *  6. Mobile menu toggle
 *  7. Lucide icons initialization
 *  8. Smooth page load reveal
 *  9. prefers-reduced-motion support
 */

import * as THREE from 'https://unpkg.com/three@0.181.0/build/three.module.min.js';

// =============================================================================
// Configuration
// =============================================================================

const DOTTED_VIDEO_CONFIG = {
  dotsEnabled: true,
  dotSize: 8,
  minDotSize: 1,
  dotMargin: 0,
  dotColor: '#A1A1AA',
  dotAlphaMultiplier: 0.45,
  videoSource: './assets/hero-video.mp4',
  maskSrc: './assets/hero-mask.avif',
  gridLayout: 'straight',
  enableMask: true,
  animSpeed: 4,
  gamma: 0.9,
  backgroundColor: '#FFFFFF',
  loopAt: 4,
  disableFluid: false,
  fluidCurl: 100,
  fluidVelocityDissipation: 0.93,
  fluidDyeDissipation: 0.95,
  fluidSplatRadius: 0.006,
  fluidPressureIterations: 1,
  fluidStrength: 0.15,
  baseFPS: 60,
};

// =============================================================================
// Utilities
// =============================================================================

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function shouldReduceMotion() {
  return prefersReducedMotion.matches;
}

function debounce(fn, ms) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

function rafThrottle(fn) {
  let ticking = false;
  return function (...args) {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      fn.apply(this, args);
      ticking = false;
    });
  };
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

/** Convert hex color (#RRGGBB) to [r, g, b] in 0-1 range */
function hexToVec3(hex) {
  const c = hex.replace('#', '');
  return [
    parseInt(c.substring(0, 2), 16) / 255,
    parseInt(c.substring(2, 4), 16) / 255,
    parseInt(c.substring(4, 6), 16) / 255,
  ];
}

// =============================================================================
// Shader Sources
// =============================================================================

const VERT_BASIC = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const VERT_TEXEL = /* glsl */ `
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;
uniform vec2 texelSize;
void main() {
  vUv = uv;
  vL = vUv - vec2(texelSize.x, 0.0);
  vR = vUv + vec2(texelSize.x, 0.0);
  vT = vUv + vec2(0.0, texelSize.y);
  vB = vUv - vec2(0.0, texelSize.y);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG_DISPLAY = /* glsl */ `
uniform sampler2D uDye;
uniform sampler2D uVideo;
uniform sampler2D uMask;
uniform bool enableMask;
uniform float fluidStrength;
uniform float gridCellSize;
uniform float dotRadius;
uniform float minDotRadius;
uniform vec2 videoResolution;
uniform vec2 videoNativeRes;
uniform float time;
uniform float animSpeed;
uniform float gamma;
uniform int gridLayout;
uniform vec3 dotColor;
uniform float dotAlphaMultiplier;
uniform bool dotsEnabled;
varying vec2 vUv;

// Cover-fit: remap UV so video fills container without distortion
vec2 coverUV(vec2 uv) {
  float containerAspect = videoResolution.x / videoResolution.y;
  float videoAspect = videoNativeRes.x / videoNativeRes.y;
  vec2 scale = vec2(1.0);
  if (containerAspect > videoAspect) {
    // Container wider than video — crop top/bottom
    scale.y = videoAspect / containerAspect;
  } else {
    // Container taller than video — crop left/right
    scale.x = containerAspect / videoAspect;
  }
  return (uv - 0.5) * scale + 0.5;
}

float random(vec2 st) {
  return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

void main() {
  vec2 gridPos;
  vec2 cellCenter;
  vec2 cellIndex;
  vec2 centerUv;
  float distanceFromCenter;
  float aspectRatio = videoResolution.x / videoResolution.y;

  if (gridLayout == 1) {
    vec2 pixelPos = vUv * videoResolution;
    vec2 center = videoResolution * 0.5;
    float minDim = min(videoResolution.x, videoResolution.y);
    vec2 normalizedPos = (pixelPos - center) / minDim;
    float angle = atan(normalizedPos.y, normalizedPos.x);
    float radius = length(normalizedPos) * minDim;
    float ringIndex = floor(radius / gridCellSize);
    vec2 dotCenterNormalized;
    float dotIndex;
    if (ringIndex < 0.5) {
      dotCenterNormalized = vec2(0.0, 0.0);
      dotIndex = 0.0;
    } else {
      float ringRadius = ringIndex * gridCellSize;
      float circumference = 6.28318 * ringRadius;
      float numDotsInRing = max(1.0, floor(circumference / gridCellSize));
      float anglePerDot = 6.28318 / numDotsInRing;
      dotIndex = floor(angle / anglePerDot);
      float dotAngle = (dotIndex + 0.5) * anglePerDot;
      float dotRadius2 = (ringIndex + 0.5) * gridCellSize;
      dotCenterNormalized = vec2(cos(dotAngle), sin(dotAngle)) * (dotRadius2 / minDim);
    }
    vec2 dotCenterPixel = dotCenterNormalized * minDim + center;
    vec2 toDotNormalized = normalizedPos - dotCenterNormalized;
    distanceFromCenter = length(toDotNormalized) * minDim;
    centerUv = dotCenterPixel / videoResolution;
    cellIndex = vec2(ringIndex, dotIndex);
    gridPos = vec2(0.0);
    cellCenter = vec2(0.0);
  } else if (gridLayout == 2) {
    cellIndex = floor(vUv * videoResolution / gridCellSize);
    float rowOffset = mod(cellIndex.y, 2.0) * gridCellSize * 0.5;
    vec2 offsetPixel = vUv * videoResolution + vec2(rowOffset, 0.0);
    cellIndex = floor(offsetPixel / gridCellSize);
    centerUv = ((cellIndex + 0.5) * gridCellSize - vec2(rowOffset, 0.0)) / videoResolution;
    gridPos = mod(offsetPixel, gridCellSize);
    cellCenter = vec2(gridCellSize * 0.5);
    distanceFromCenter = length(gridPos - cellCenter);
  } else {
    gridPos = mod(vUv * videoResolution, gridCellSize);
    cellCenter = vec2(gridCellSize * 0.5);
    cellIndex = floor(vUv * videoResolution / gridCellSize);
    centerUv = ((cellIndex + 0.5) * gridCellSize) / videoResolution;
    distanceFromCenter = length(gridPos - cellCenter);
  }

  vec2 coveredUv = coverUV(centerUv);
  vec4 video = texture2D(uVideo, coveredUv);
  vec4 dye = texture2D(uDye, centerUv);
  vec3 videoGammaCorrected = pow(video.rgb, vec3(gamma));
  vec3 scaledDye = dye.rgb * fluidStrength;
  scaledDye = pow(scaledDye + 0.001, vec3(0.7));
  vec3 blendedColor = videoGammaCorrected + scaledDye;
  float luminance = dot(blendedColor, vec3(0.299, 0.587, 0.114));

  // Fade out edges that fall outside the video's native frame
  if (coveredUv.x < 0.0 || coveredUv.x > 1.0 || coveredUv.y < 0.0 || coveredUv.y > 1.0) {
    luminance = 0.0;
  }

  if (enableMask) {
    vec4 mask = texture2D(uMask, coverUV(vUv));
    float maskAlpha = mask.a;
    luminance = luminance * maskAlpha;
  }

  if (!dotsEnabled) {
    gl_FragColor = vec4(dotColor, luminance * dotAlphaMultiplier);
    return;
  }

  float randomValue = random(cellIndex);
  float phase = randomValue * 6.28318;
  float scaleAnimation = sin(time * animSpeed + phase) * 0.5 + 0.5;
  float randomScale = 1.0 - (scaleAnimation * 0.5);
  float luminanceMinScale = min(minDotRadius / dotRadius, 1.0);
  float finalScale = (luminanceMinScale + (luminance * (1.0 - luminanceMinScale))) * randomScale;
  float scaledRadius = dotRadius * finalScale;
  float maxRadius = gridCellSize * 0.5;
  scaledRadius = min(scaledRadius, maxRadius);

  float edgeWidth = 0.5;
  float dotMask = 1.0 - smoothstep(scaledRadius - edgeWidth, scaledRadius + edgeWidth, distanceFromCenter);
  float luminanceCutoff = smoothstep(0.0, 0.1, luminance);
  float finalAlpha = dotMask * luminance * luminanceCutoff * dotAlphaMultiplier;

  gl_FragColor = vec4(dotColor, finalAlpha);
}
`;

const FRAG_SPLAT = /* glsl */ `
uniform sampler2D uTarget;
uniform float aspectRatio;
uniform vec3 color;
uniform vec2 point;
uniform float radius;
varying vec2 vUv;
void main() {
  vec2 p = vUv - point;
  p.x *= aspectRatio;
  vec3 splat = exp(-dot(p, p) / radius) * color;
  vec3 base = texture2D(uTarget, vUv).xyz;
  gl_FragColor = vec4(base + splat, 1.0);
}
`;

const FRAG_ADVECTION = /* glsl */ `
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 texelSize;
uniform float dt;
uniform float dissipation;
varying vec2 vUv;

vec4 bilerp(sampler2D sam, vec2 uv, vec2 tsize) {
  vec2 st = uv / tsize - 0.5;
  vec2 iuv = floor(st);
  vec2 fuv = fract(st);
  vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
  vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
  vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
  vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);
  return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
}

void main() {
  vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;
  gl_FragColor = dissipation * bilerp(uSource, coord, texelSize);
}
`;

const FRAG_DIVERGENCE = /* glsl */ `
uniform sampler2D uVelocity;
varying vec2 vUv;
varying vec2 vL, vR, vT, vB;
void main() {
  float L = texture2D(uVelocity, vL).x;
  float R = texture2D(uVelocity, vR).x;
  float T = texture2D(uVelocity, vT).y;
  float B = texture2D(uVelocity, vB).y;
  vec2 C = texture2D(uVelocity, vUv).xy;
  if (vL.x < 0.0) L = -C.x;
  if (vR.x > 1.0) R = -C.x;
  if (vT.y > 1.0) T = -C.y;
  if (vB.y < 0.0) B = -C.y;
  float div = 0.5 * (R - L + T - B);
  gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
}
`;

const FRAG_CURL = /* glsl */ `
uniform sampler2D uVelocity;
varying vec2 vUv;
varying vec2 vL, vR, vT, vB;
void main() {
  float L = texture2D(uVelocity, vL).y;
  float R = texture2D(uVelocity, vR).y;
  float T = texture2D(uVelocity, vT).x;
  float B = texture2D(uVelocity, vB).x;
  float vorticity = R - L - T + B;
  gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
}
`;

const FRAG_VORTICITY = /* glsl */ `
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform float curl;
uniform float dt;
varying vec2 vUv;
varying vec2 vL, vR, vT, vB;
void main() {
  float L = texture2D(uCurl, vL).x;
  float R = texture2D(uCurl, vR).x;
  float T = texture2D(uCurl, vT).x;
  float B = texture2D(uCurl, vB).x;
  float C = texture2D(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= length(force) + 0.0001;
  force *= curl * C;
  force.y *= -1.0;
  vec2 velocity = texture2D(uVelocity, vUv).xy;
  velocity += force * dt;
  velocity = min(max(velocity, -1000.0), 1000.0);
  gl_FragColor = vec4(velocity, 0.0, 1.0);
}
`;

const FRAG_PRESSURE = /* glsl */ `
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
varying vec2 vUv;
varying vec2 vL, vR, vT, vB;
void main() {
  float L = texture2D(uPressure, vL).x;
  float R = texture2D(uPressure, vR).x;
  float T = texture2D(uPressure, vT).x;
  float B = texture2D(uPressure, vB).x;
  float divergence = texture2D(uDivergence, vUv).x;
  float pressure = (L + R + B + T - divergence) * 0.25;
  gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
}
`;

const FRAG_GRADIENT_SUBTRACT = /* glsl */ `
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
varying vec2 vUv;
varying vec2 vL, vR, vT, vB;
void main() {
  float L = texture2D(uPressure, vL).x;
  float R = texture2D(uPressure, vR).x;
  float T = texture2D(uPressure, vT).x;
  float B = texture2D(uPressure, vB).x;
  vec2 velocity = texture2D(uVelocity, vUv).xy;
  velocity.xy -= vec2(R - L, T - B);
  gl_FragColor = vec4(velocity, 0.0, 1.0);
}
`;

const FRAG_CLEAR = /* glsl */ `
uniform sampler2D uTexture;
uniform float value;
varying vec2 vUv;
void main() {
  gl_FragColor = value * texture2D(uTexture, vUv);
}
`;

// =============================================================================
// DottedVideoEffect Class
// =============================================================================

class DottedVideoEffect {
  constructor(containerId, config) {
    this.config = { ...DOTTED_VIDEO_CONFIG, ...config };
    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.warn(`[DottedVideoEffect] Container #${containerId} not found.`);
      return;
    }

    this._destroyed = false;
    this._time = 0;
    this._lastFrameTime = 0;
    this._frameInterval = 1000 / this.config.baseFPS;
    this._videoLooped = false;
    this._lastMouseTime = Date.now();
    this._mousePos = { x: 0, y: 0 };
    this._prevMousePos = { x: 0, y: 0 };
    this._hasMouse = false;
    this._reducedMotion = shouldReduceMotion();

    this._initRenderer();
    this._initVideo();
    this._initMask();
    this._initFluidTargets();
    this._initFluidMaterials();
    this._initDisplayScene();
    this._initEventListeners();
    this._startAnimationLoop();
  }

  // ---------------------------------------------------------------------------
  // Renderer
  // ---------------------------------------------------------------------------

  _initRenderer() {
    const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    this._renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: true,
    });
    this._renderer.setPixelRatio(pixelRatio);
    this._renderer.setClearColor(0x000000, 0);
    this._renderer.autoClear = false;

    const rect = this.container.getBoundingClientRect();
    this._width = rect.width;
    this._height = rect.height;
    this._renderer.setSize(this._width, this._height);

    this._renderer.domElement.style.display = 'block';
    this._renderer.domElement.style.width = '100%';
    this._renderer.domElement.style.height = '100%';
    this.container.appendChild(this._renderer.domElement);
  }

  // ---------------------------------------------------------------------------
  // Video
  // ---------------------------------------------------------------------------

  _initVideo() {
    this._video = document.createElement('video');
    this._video.src = this.config.videoSource;
    this._video.crossOrigin = 'anonymous';
    this._video.loop = false;
    this._video.muted = true;
    this._video.playsInline = true;
    this._video.preload = 'auto';

    this._videoReady = false;

    this._video.addEventListener('canplaythrough', () => {
      this._videoReady = true;
    });

    this._video.addEventListener('loadedmetadata', () => {
      this._videoNativeWidth = this._video.videoWidth;
      this._videoNativeHeight = this._video.videoHeight;
      if (this._displayMaterial) {
        this._displayMaterial.uniforms.videoNativeRes.value.set(
          this._videoNativeWidth, this._videoNativeHeight
        );
      }
    });

    // Custom loop: on ended, seek to loopAt and play
    this._video.addEventListener('ended', () => {
      this._videoLooped = true;
      this._video.currentTime = this.config.loopAt;
      this._video.play().catch(() => {});
    });

    this._video.play().catch(() => {
      // Autoplay may be blocked; try playing on first interaction
      const tryPlay = () => {
        this._video.play().catch(() => {});
        document.removeEventListener('click', tryPlay);
        document.removeEventListener('touchstart', tryPlay);
      };
      document.addEventListener('click', tryPlay, { once: true });
      document.addEventListener('touchstart', tryPlay, { once: true });
    });

    this._videoTexture = new THREE.VideoTexture(this._video);
    this._videoTexture.minFilter = THREE.NearestFilter;
    this._videoTexture.magFilter = THREE.NearestFilter;
    this._videoTexture.format = THREE.RGBAFormat;
    this._videoTexture.generateMipmaps = false;
  }

  // ---------------------------------------------------------------------------
  // Mask
  // ---------------------------------------------------------------------------

  _initMask() {
    this._maskTexture = null;
    if (this.config.enableMask && this.config.maskSrc) {
      const loader = new THREE.TextureLoader();
      loader.load(this.config.maskSrc, (tex) => {
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        this._maskTexture = tex;
        if (this._displayMaterial) {
          this._displayMaterial.uniforms.uMask.value = tex;
        }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Fluid simulation render targets (half resolution, double-buffered)
  // ---------------------------------------------------------------------------

  _initFluidTargets() {
    const halfW = Math.max(1, Math.floor(this._width / 2));
    const halfH = Math.max(1, Math.floor(this._height / 2));

    this._fluidWidth = halfW;
    this._fluidHeight = halfH;
    this._texelSize = new THREE.Vector2(1.0 / halfW, 1.0 / halfH);

    const makeRT = () =>
      new THREE.WebGLRenderTarget(halfW, halfH, {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        depthBuffer: false,
        stencilBuffer: false,
      });

    // Double-buffered targets
    this._velocity = [makeRT(), makeRT()];
    this._dye = [makeRT(), makeRT()];
    this._pressure = [makeRT(), makeRT()];

    // Single targets
    this._divergenceRT = makeRT();
    this._curlRT = makeRT();

    // Fluid scene + camera
    this._fluidScene = new THREE.Scene();
    this._fluidCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._fluidQuad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      null // material set per pass
    );
    this._fluidScene.add(this._fluidQuad);
  }

  // ---------------------------------------------------------------------------
  // Fluid materials (one ShaderMaterial per pass)
  // ---------------------------------------------------------------------------

  _initFluidMaterials() {
    // Splat
    this._splatMaterial = new THREE.ShaderMaterial({
      vertexShader: VERT_BASIC,
      fragmentShader: FRAG_SPLAT,
      uniforms: {
        uTarget: { value: null },
        aspectRatio: { value: this._width / this._height },
        color: { value: new THREE.Vector3() },
        point: { value: new THREE.Vector2() },
        radius: { value: this.config.fluidSplatRadius },
      },
      depthTest: false,
      depthWrite: false,
    });

    // Advection
    this._advectionMaterial = new THREE.ShaderMaterial({
      vertexShader: VERT_BASIC,
      fragmentShader: FRAG_ADVECTION,
      uniforms: {
        uVelocity: { value: null },
        uSource: { value: null },
        texelSize: { value: this._texelSize },
        dt: { value: 1 / 60 },
        dissipation: { value: 1.0 },
      },
      depthTest: false,
      depthWrite: false,
    });

    // Curl
    this._curlMaterial = new THREE.ShaderMaterial({
      vertexShader: VERT_TEXEL,
      fragmentShader: FRAG_CURL,
      uniforms: {
        uVelocity: { value: null },
        texelSize: { value: this._texelSize },
      },
      depthTest: false,
      depthWrite: false,
    });

    // Vorticity
    this._vorticityMaterial = new THREE.ShaderMaterial({
      vertexShader: VERT_TEXEL,
      fragmentShader: FRAG_VORTICITY,
      uniforms: {
        uVelocity: { value: null },
        uCurl: { value: null },
        curl: { value: this.config.fluidCurl },
        dt: { value: 1 / 60 },
        texelSize: { value: this._texelSize },
      },
      depthTest: false,
      depthWrite: false,
    });

    // Divergence
    this._divergenceMaterial = new THREE.ShaderMaterial({
      vertexShader: VERT_TEXEL,
      fragmentShader: FRAG_DIVERGENCE,
      uniforms: {
        uVelocity: { value: null },
        texelSize: { value: this._texelSize },
      },
      depthTest: false,
      depthWrite: false,
    });

    // Pressure
    this._pressureMaterial = new THREE.ShaderMaterial({
      vertexShader: VERT_TEXEL,
      fragmentShader: FRAG_PRESSURE,
      uniforms: {
        uPressure: { value: null },
        uDivergence: { value: null },
        texelSize: { value: this._texelSize },
      },
      depthTest: false,
      depthWrite: false,
    });

    // Gradient Subtract
    this._gradientSubtractMaterial = new THREE.ShaderMaterial({
      vertexShader: VERT_TEXEL,
      fragmentShader: FRAG_GRADIENT_SUBTRACT,
      uniforms: {
        uPressure: { value: null },
        uVelocity: { value: null },
        texelSize: { value: this._texelSize },
      },
      depthTest: false,
      depthWrite: false,
    });

    // Clear / Decay
    this._clearMaterial = new THREE.ShaderMaterial({
      vertexShader: VERT_BASIC,
      fragmentShader: FRAG_CLEAR,
      uniforms: {
        uTexture: { value: null },
        value: { value: 0.0 },
      },
      depthTest: false,
      depthWrite: false,
    });
  }

  // ---------------------------------------------------------------------------
  // Display scene (main pass — dotted video overlay)
  // ---------------------------------------------------------------------------

  _initDisplayScene() {
    const gridLayoutInt = { straight: 0, radial: 1, hex: 2 }[this.config.gridLayout] ?? 0;
    const dotColorVec = hexToVec3(this.config.dotColor);
    const gridCellSize = this.config.dotSize + this.config.dotMargin;
    const dotRadius = this.config.dotSize * 0.5;
    const minDotRadius = this.config.minDotSize * 0.5;

    this._displayMaterial = new THREE.ShaderMaterial({
      vertexShader: VERT_BASIC,
      fragmentShader: FRAG_DISPLAY,
      uniforms: {
        uDye: { value: this._dye[0].texture },
        uVideo: { value: this._videoTexture },
        uMask: { value: this._maskTexture || new THREE.Texture() },
        enableMask: { value: this.config.enableMask },
        fluidStrength: { value: this.config.fluidStrength },
        gridCellSize: { value: gridCellSize },
        dotRadius: { value: dotRadius },
        minDotRadius: { value: minDotRadius },
        videoResolution: { value: new THREE.Vector2(this._width, this._height) },
        videoNativeRes: { value: new THREE.Vector2(this._width, this._height) },
        time: { value: 0 },
        animSpeed: { value: this._reducedMotion ? 0 : this.config.animSpeed },
        gamma: { value: this.config.gamma },
        gridLayout: { value: gridLayoutInt },
        dotColor: { value: new THREE.Vector3(dotColorVec[0], dotColorVec[1], dotColorVec[2]) },
        dotAlphaMultiplier: { value: this.config.dotAlphaMultiplier },
        dotsEnabled: { value: this.config.dotsEnabled },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    this._displayScene = new THREE.Scene();
    this._displayCamera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 1);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this._displayMaterial);
    this._displayScene.add(plane);
  }

  // ---------------------------------------------------------------------------
  // Event Listeners
  // ---------------------------------------------------------------------------

  _initEventListeners() {
    // Mouse / pointer tracking
    this._onPointerMove = (e) => {
      const rect = this.container.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = 1.0 - (e.clientY - rect.top) / rect.height; // flip Y for GL
      this._prevMousePos.x = this._mousePos.x;
      this._prevMousePos.y = this._mousePos.y;
      this._mousePos.x = x;
      this._mousePos.y = y;
      this._hasMouse = true;
      this._lastMouseTime = Date.now();
    };
    this.container.addEventListener('pointermove', this._onPointerMove);

    // Resize
    this._resizeObserver = new ResizeObserver(
      debounce(() => {
        if (this._destroyed) return;
        const rect = this.container.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        this._width = rect.width;
        this._height = rect.height;
        this._renderer.setSize(this._width, this._height);
        this._displayMaterial.uniforms.videoResolution.value.set(this._width, this._height);
        this._splatMaterial.uniforms.aspectRatio.value = this._width / this._height;

        // Rebuild fluid targets at new half-res
        this._disposeFluidTargets();
        this._initFluidTargets();
      }, 150)
    );
    this._resizeObserver.observe(this.container);

    // Intersection observer — pause/play video off-screen
    this._intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          this._video.play().catch(() => {});
        } else {
          this._video.pause();
        }
      },
      { threshold: 0.05 }
    );
    this._intersectionObserver.observe(this.container);
  }

  // ---------------------------------------------------------------------------
  // Fluid simulation helpers
  // ---------------------------------------------------------------------------

  _renderFluidPass(material, target) {
    this._fluidQuad.material = material;
    this._renderer.setRenderTarget(target);
    this._renderer.render(this._fluidScene, this._fluidCamera);
  }

  _swapBuffers(arr) {
    const tmp = arr[0];
    arr[0] = arr[1];
    arr[1] = tmp;
  }

  _splat(x, y, dx, dy, color, radius) {
    // Velocity splat
    this._splatMaterial.uniforms.uTarget.value = this._velocity[0].texture;
    this._splatMaterial.uniforms.point.value.set(x, y);
    this._splatMaterial.uniforms.color.value.set(dx, dy, 0);
    this._splatMaterial.uniforms.radius.value = radius * 0.5; // velocity radius smaller
    this._renderFluidPass(this._splatMaterial, this._velocity[1]);
    this._swapBuffers(this._velocity);

    // Dye splat
    this._splatMaterial.uniforms.uTarget.value = this._dye[0].texture;
    this._splatMaterial.uniforms.color.value.set(color[0], color[1], color[2]);
    this._splatMaterial.uniforms.radius.value = radius;
    this._renderFluidPass(this._splatMaterial, this._dye[1]);
    this._swapBuffers(this._dye);
  }

  _stepFluid(dt) {
    // 1. Curl
    this._curlMaterial.uniforms.uVelocity.value = this._velocity[0].texture;
    this._renderFluidPass(this._curlMaterial, this._curlRT);

    // 2. Vorticity
    this._vorticityMaterial.uniforms.uVelocity.value = this._velocity[0].texture;
    this._vorticityMaterial.uniforms.uCurl.value = this._curlRT.texture;
    this._vorticityMaterial.uniforms.dt.value = dt;
    this._renderFluidPass(this._vorticityMaterial, this._velocity[1]);
    this._swapBuffers(this._velocity);

    // 3. Divergence
    this._divergenceMaterial.uniforms.uVelocity.value = this._velocity[0].texture;
    this._renderFluidPass(this._divergenceMaterial, this._divergenceRT);

    // 4. Clear pressure
    this._clearMaterial.uniforms.uTexture.value = this._pressure[0].texture;
    this._clearMaterial.uniforms.value.value = 0.8;
    this._renderFluidPass(this._clearMaterial, this._pressure[1]);
    this._swapBuffers(this._pressure);

    // 5. Pressure solve (Jacobi iterations)
    for (let i = 0; i < this.config.fluidPressureIterations; i++) {
      this._pressureMaterial.uniforms.uPressure.value = this._pressure[0].texture;
      this._pressureMaterial.uniforms.uDivergence.value = this._divergenceRT.texture;
      this._renderFluidPass(this._pressureMaterial, this._pressure[1]);
      this._swapBuffers(this._pressure);
    }

    // 6. Gradient subtract
    this._gradientSubtractMaterial.uniforms.uPressure.value = this._pressure[0].texture;
    this._gradientSubtractMaterial.uniforms.uVelocity.value = this._velocity[0].texture;
    this._renderFluidPass(this._gradientSubtractMaterial, this._velocity[1]);
    this._swapBuffers(this._velocity);

    // 7. Advect velocity
    this._advectionMaterial.uniforms.uVelocity.value = this._velocity[0].texture;
    this._advectionMaterial.uniforms.uSource.value = this._velocity[0].texture;
    this._advectionMaterial.uniforms.dissipation.value = this.config.fluidVelocityDissipation;
    this._advectionMaterial.uniforms.dt.value = dt;
    this._renderFluidPass(this._advectionMaterial, this._velocity[1]);
    this._swapBuffers(this._velocity);

    // 8. Advect dye
    this._advectionMaterial.uniforms.uVelocity.value = this._velocity[0].texture;
    this._advectionMaterial.uniforms.uSource.value = this._dye[0].texture;
    this._advectionMaterial.uniforms.dissipation.value = this.config.fluidDyeDissipation;
    this._renderFluidPass(this._advectionMaterial, this._dye[1]);
    this._swapBuffers(this._dye);
  }

  // ---------------------------------------------------------------------------
  // Animation loop
  // ---------------------------------------------------------------------------

  _startAnimationLoop() {
    const dt = 1 / 60;
    const fluidDisabled = this.config.disableFluid || this._reducedMotion;

    const loop = (timestamp) => {
      if (this._destroyed) return;
      this._rafId = requestAnimationFrame(loop);

      // Frame throttle
      const targetFPS = this._getTargetFPS();
      const frameInterval = 1000 / targetFPS;
      if (timestamp - this._lastFrameTime < frameInterval) return;
      this._lastFrameTime = timestamp;

      if (!this._videoReady) return;

      // Update video texture
      if (this._video.readyState >= this._video.HAVE_CURRENT_DATA) {
        this._videoTexture.needsUpdate = true;
      }

      this._renderer.setRenderTarget(null);
      this._renderer.clear();

      // Fluid simulation
      if (!fluidDisabled) {
        // Mouse splat
        if (this._hasMouse) {
          const dx = (this._mousePos.x - this._prevMousePos.x) * 10;
          const dy = (this._mousePos.y - this._prevMousePos.y) * 10;
          if (Math.abs(dx) > 0.0001 || Math.abs(dy) > 0.0001) {
            this._splat(
              this._mousePos.x,
              this._mousePos.y,
              dx,
              dy,
              [0.5, 0.5, 0.5],
              this.config.fluidSplatRadius
            );
          }
          this._prevMousePos.x = this._mousePos.x;
          this._prevMousePos.y = this._mousePos.y;
        }

        this._stepFluid(dt);
      }

      // Update time
      this._time += dt;
      this._displayMaterial.uniforms.time.value = this._time;
      this._displayMaterial.uniforms.uDye.value = this._dye[0].texture;

      // Display pass
      this._renderer.setRenderTarget(null);
      this._renderer.render(this._displayScene, this._displayCamera);
    };

    this._rafId = requestAnimationFrame(loop);
  }

  /** Target FPS: drop to 30 after video has looped and no mouse for 2s */
  _getTargetFPS() {
    const noMouseRecently = Date.now() - this._lastMouseTime > 2000;
    if (this._videoLooped && noMouseRecently) {
      return 30;
    }
    return this.config.baseFPS;
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  _disposeFluidTargets() {
    [this._velocity, this._dye, this._pressure].forEach((pair) => {
      if (pair) pair.forEach((rt) => rt.dispose());
    });
    if (this._divergenceRT) this._divergenceRT.dispose();
    if (this._curlRT) this._curlRT.dispose();
  }

  destroy() {
    this._destroyed = true;

    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this._resizeObserver) this._resizeObserver.disconnect();
    if (this._intersectionObserver) this._intersectionObserver.disconnect();

    this.container.removeEventListener('pointermove', this._onPointerMove);

    this._video.pause();
    this._video.removeAttribute('src');
    this._video.load();

    this._videoTexture.dispose();
    if (this._maskTexture) this._maskTexture.dispose();

    this._disposeFluidTargets();

    // Dispose materials
    [
      this._splatMaterial,
      this._advectionMaterial,
      this._curlMaterial,
      this._vorticityMaterial,
      this._divergenceMaterial,
      this._pressureMaterial,
      this._gradientSubtractMaterial,
      this._clearMaterial,
      this._displayMaterial,
    ].forEach((m) => {
      if (m) m.dispose();
    });

    // Dispose geometries
    this._displayScene?.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
    });
    this._fluidScene?.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
    });

    this._renderer.dispose();
    if (this._renderer.domElement.parentNode) {
      this._renderer.domElement.parentNode.removeChild(this._renderer.domElement);
    }
  }
}

// =============================================================================
// LaserBeamEffect Class — Pure WebGL (no Three.js dependency)
// =============================================================================

class LaserBeamEffect {
  constructor(containerId) {
    this._container = document.getElementById(containerId);
    if (!this._container) {
      console.warn(`[LaserBeamEffect] Container #${containerId} not found.`);
      return;
    }

    this._destroyed = false;
    this._startTime = 0;
    this._rafId = null;

    // Create canvas
    this._canvas = document.createElement('canvas');
    this._canvas.style.display = 'block';
    this._canvas.style.width = '100%';
    this._canvas.style.height = '100%';
    this._container.appendChild(this._canvas);

    // Get WebGL context
    this._gl = this._canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false });
    if (!this._gl) {
      console.warn('[LaserBeamEffect] WebGL not supported.');
      return;
    }

    this._initShaders();
    this._initBuffers();
    this._getUniformLocations();
    this.resize();
    this._initEventListeners();
    this._startRenderLoop();
  }

  _initShaders() {
    const gl = this._gl;

    // Vertex shader
    const vertSrc = `
      attribute vec2 position;
      void main() { gl_Position = vec4(position, 0.0, 1.0); }
    `;

    // Fragment shader — laser beam with cold gray-blue tones
    const fragSrc = `
      precision highp float;
      uniform vec2 u_resolution;
      uniform float u_time;

      float hash(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      float noise(vec2 x) {
        vec2 i = floor(x);
        vec2 f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        float res = mix(
          mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), f.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
          f.y
        );
        return res;
      }

      float fbm(vec2 x) {
        float value = 0.0;
        float amplitude = 0.5;
        vec2 shift = vec2(100.0);
        mat2 rotation = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.50));
        for (int index = 0; index < 5; ++index) {
          value += amplitude * noise(x);
          x = rotation * x * 2.0 + shift;
          amplitude *= 0.5;
        }
        return value;
      }

      void main() {
        vec2 uv = gl_FragCoord.xy / u_resolution.xy;
        vec2 st = uv;
        st.x *= u_resolution.x / u_resolution.y;

        float targetX = (u_resolution.x / u_resolution.y) * 0.5;
        float dist = abs(st.x - targetX);

        float core = 0.0015 / (dist + 0.0001);
        core = pow(core, 1.2);

        float glow = 0.02 / (dist + 0.01);

        vec2 noiseUv = vec2(st.x * 3.0, st.y * 2.0 - u_time * 0.15);
        float smokeNoise = fbm(noiseUv);
        float smokeMask = smoothstep(0.6, 0.0, dist);
        float smoke = smokeNoise * smokeMask * 2.5;

        vec3 coreColor = vec3(1.0, 1.0, 1.0);
        vec3 glowColor = vec3(0.55, 0.58, 0.75);
        vec3 smokeColor = vec3(0.35, 0.38, 0.55);

        vec3 finalColor = vec3(0.0);
        finalColor += coreColor * core;
        finalColor += glowColor * glow;
        finalColor += smokeColor * smoke * glow;

        float verticalFade = smoothstep(0.0, 0.2, uv.y) * smoothstep(1.0, 0.7, uv.y);
        finalColor *= verticalFade;
        finalColor *= 0.9 + 0.1 * sin(u_time * 2.0);
        finalColor = clamp(finalColor, 0.0, 1.0);

        gl_FragColor = vec4(finalColor, 1.0);
      }
    `;

    // Compile vertex shader
    const vert = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vert, vertSrc);
    gl.compileShader(vert);
    if (!gl.getShaderParameter(vert, gl.COMPILE_STATUS)) {
      console.error('[LaserBeamEffect] Vertex shader error:', gl.getShaderInfoLog(vert));
      return;
    }

    // Compile fragment shader
    const frag = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(frag, fragSrc);
    gl.compileShader(frag);
    if (!gl.getShaderParameter(frag, gl.COMPILE_STATUS)) {
      console.error('[LaserBeamEffect] Fragment shader error:', gl.getShaderInfoLog(frag));
      return;
    }

    // Link program
    this._program = gl.createProgram();
    gl.attachShader(this._program, vert);
    gl.attachShader(this._program, frag);
    gl.linkProgram(this._program);
    if (!gl.getProgramParameter(this._program, gl.LINK_STATUS)) {
      console.error('[LaserBeamEffect] Program link error:', gl.getProgramInfoLog(this._program));
      return;
    }

    // Store shader refs for cleanup
    this._vertShader = vert;
    this._fragShader = frag;

    gl.useProgram(this._program);
  }

  _initBuffers() {
    const gl = this._gl;

    // Full-screen quad: two triangles covering -1,-1 to 1,1
    const vertices = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
      -1,  1,
       1, -1,
       1,  1,
    ]);

    this._buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const posLoc = gl.getAttribLocation(this._program, 'position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
  }

  _getUniformLocations() {
    const gl = this._gl;
    this._uResolution = gl.getUniformLocation(this._program, 'u_resolution');
    this._uTime = gl.getUniformLocation(this._program, 'u_time');
  }

  resize() {
    if (this._destroyed || !this._canvas) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this._container.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    this._canvas.width = Math.round(w * dpr);
    this._canvas.height = Math.round(h * dpr);

    const gl = this._gl;
    gl.viewport(0, 0, this._canvas.width, this._canvas.height);
    gl.useProgram(this._program);
    gl.uniform2f(this._uResolution, this._canvas.width, this._canvas.height);
  }

  _initEventListeners() {
    this._onResize = debounce(() => {
      if (!this._destroyed) this.resize();
    }, 150);
    window.addEventListener('resize', this._onResize);
  }

  _startRenderLoop() {
    this._startTime = performance.now();

    const render = (timestamp) => {
      if (this._destroyed) return;
      this._rafId = requestAnimationFrame(render);

      const gl = this._gl;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(this._program);
      const elapsed = (timestamp - this._startTime) * 0.001;
      gl.uniform1f(this._uTime, elapsed);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };

    this._rafId = requestAnimationFrame(render);
  }

  destroy() {
    this._destroyed = true;

    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }

    window.removeEventListener('resize', this._onResize);

    const gl = this._gl;
    if (gl) {
      if (this._buffer) gl.deleteBuffer(this._buffer);
      if (this._program) {
        gl.deleteProgram(this._program);
      }
      if (this._vertShader) gl.deleteShader(this._vertShader);
      if (this._fragShader) gl.deleteShader(this._fragShader);
    }

    if (this._canvas && this._canvas.parentNode) {
      this._canvas.parentNode.removeChild(this._canvas);
    }
    this._canvas = null;
  }
}

// =============================================================================
// 2. Scroll-triggered animations
// =============================================================================

function initScrollAnimations() {
  if (shouldReduceMotion()) {
    document.querySelectorAll('[data-animate]').forEach((el) => {
      el.classList.add('is-visible');
      if (el.getAttribute('data-animate') === 'stagger') {
        Array.from(el.children).forEach((child) => child.classList.add('is-visible'));
      }
    });
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        const animType = el.getAttribute('data-animate');
        if (animType === 'stagger') {
          Array.from(el.children).forEach((child, i) => {
            setTimeout(() => child.classList.add('is-visible'), i * 50);
          });
        }
        el.classList.add('is-visible');
        observer.unobserve(el);
      });
    },
    { threshold: 0.1 }
  );

  document.querySelectorAll('[data-animate]').forEach((el) => observer.observe(el));
}

// =============================================================================
// 3. Navigation behavior
// =============================================================================

function initNavigation() {
  const nav = document.querySelector('nav, .nav');
  if (!nav) return;

  const SCROLL_THRESHOLD = 100;
  let lastScrollY = window.scrollY;

  if (window.scrollY > SCROLL_THRESHOLD) nav.classList.add('nav--scrolled');

  const handleScroll = rafThrottle(() => {
    const currentY = window.scrollY;
    if (currentY > SCROLL_THRESHOLD) {
      nav.classList.add('nav--scrolled');
    } else {
      nav.classList.remove('nav--scrolled');
    }
    if (currentY > lastScrollY && currentY > SCROLL_THRESHOLD) {
      nav.classList.add('nav--hidden');
      nav.classList.remove('nav--visible');
    } else {
      nav.classList.remove('nav--hidden');
      nav.classList.add('nav--visible');
    }
    lastScrollY = currentY;
  });

  window.addEventListener('scroll', handleScroll, { passive: true });

  initActiveSectionHighlight(nav);

  nav.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener('click', (e) => {
      const targetId = link.getAttribute('href');
      if (targetId === '#') return;
      const target = document.querySelector(targetId);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth' });
      history.pushState(null, '', targetId);
    });
  });
}

function initActiveSectionHighlight(nav) {
  const navLinks = Array.from(nav.querySelectorAll('a[href^="#"]')).filter(
    (link) => link.getAttribute('href') !== '#'
  );
  if (navLinks.length === 0) return;

  const sections = navLinks
    .map((link) => document.getElementById(link.getAttribute('href').slice(1)))
    .filter(Boolean);
  if (sections.length === 0) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          navLinks.forEach((link) => {
            link.classList.toggle('active', link.getAttribute('href') === `#${id}`);
          });
        }
      });
    },
    { rootMargin: '-20% 0px -60% 0px', threshold: 0 }
  );

  sections.forEach((section) => observer.observe(section));
}

// =============================================================================
// 4. Solutions tab switching
// =============================================================================

function initTabSwitcher() {
  const tabButtons = document.querySelectorAll('[data-tab]');
  const tabPanels = document.querySelectorAll('[data-panel]');
  if (tabButtons.length === 0 || tabPanels.length === 0) return;

  let autoCycleInterval = null;
  let currentIndex = 0;

  function activateTab(tabValue) {
    tabButtons.forEach((btn) => {
      const isTarget = btn.getAttribute('data-tab') === tabValue;
      btn.classList.toggle('is-active', isTarget);
      btn.classList.toggle('solutions__tab--active', isTarget);
      btn.setAttribute('aria-selected', isTarget ? 'true' : 'false');
    });
    tabPanels.forEach((panel) => {
      const isTarget = panel.getAttribute('data-panel') === tabValue;
      if (isTarget) {
        panel.classList.add('is-active', 'solutions__panel--active');
        panel.removeAttribute('hidden');
        panel.style.opacity = '0';
        requestAnimationFrame(() => {
          panel.style.transition = 'opacity 0.35s ease';
          panel.style.opacity = '1';
        });
      } else {
        panel.classList.remove('is-active', 'solutions__panel--active');
        panel.setAttribute('hidden', '');
        panel.style.opacity = '0';
      }
    });
    const idx = Array.from(tabButtons).findIndex(
      (btn) => btn.getAttribute('data-tab') === tabValue
    );
    if (idx !== -1) currentIndex = idx;
  }

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      activateTab(btn.getAttribute('data-tab'));
      resetAutoCycle();
    });
  });

  function startAutoCycle() {
    autoCycleInterval = setInterval(() => {
      currentIndex = (currentIndex + 1) % tabButtons.length;
      activateTab(tabButtons[currentIndex].getAttribute('data-tab'));
    }, 5000);
  }

  function stopAutoCycle() {
    clearInterval(autoCycleInterval);
    autoCycleInterval = null;
  }

  function resetAutoCycle() {
    stopAutoCycle();
    startAutoCycle();
  }

  const tabContainer =
    tabButtons[0].closest('.solutions, .tabs, .tab-container, [class*="tab"]') ||
    tabButtons[0].parentElement;

  if (tabContainer) {
    tabContainer.addEventListener('mouseenter', stopAutoCycle);
    tabContainer.addEventListener('mouseleave', startAutoCycle);
  }

  activateTab(tabButtons[0].getAttribute('data-tab'));
  startAutoCycle();
}

// =============================================================================
// 5. Counter animation
// =============================================================================

function initCounterAnimation() {
  const statElements = document.querySelectorAll('.stat-number[data-target]');
  if (statElements.length === 0) return;

  if (shouldReduceMotion()) {
    statElements.forEach((el) => {
      const target = parseFloat(el.getAttribute('data-target'));
      const prefix = el.getAttribute('data-prefix') || '';
      const suffix = el.getAttribute('data-suffix') || '';
      const decimals = el.getAttribute('data-decimals') || '0';
      el.textContent = prefix + target.toFixed(parseInt(decimals, 10)) + suffix;
    });
    return;
  }

  const DURATION = 1500;

  function animateCounter(el) {
    const target = parseFloat(el.getAttribute('data-target'));
    const prefix = el.getAttribute('data-prefix') || '';
    const suffix = el.getAttribute('data-suffix') || '';
    const decimals = parseInt(el.getAttribute('data-decimals') || '0', 10);
    const startTime = performance.now();

    function tick(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / DURATION, 1);
      const current = easeOutCubic(progress) * target;
      el.textContent = prefix + current.toFixed(decimals) + suffix;
      if (progress < 1) requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        animateCounter(entry.target);
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.3 }
  );

  statElements.forEach((el) => observer.observe(el));
}

// =============================================================================
// 6. Mobile menu
// =============================================================================

function initMobileMenu() {
  const toggle = document.querySelector('.nav__toggle');
  const menu = document.querySelector('.nav__menu');
  if (!toggle || !menu) return;

  function openMenu() {
    menu.classList.add('nav__menu--open');
    toggle.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }

  function closeMenu() {
    menu.classList.remove('nav__menu--open');
    toggle.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  function isOpen() {
    return menu.classList.contains('nav__menu--open');
  }

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    isOpen() ? closeMenu() : openMenu();
  });

  menu.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', closeMenu);
  });

  document.addEventListener('click', (e) => {
    if (isOpen() && !menu.contains(e.target) && !toggle.contains(e.target)) {
      closeMenu();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) closeMenu();
  });
}

// =============================================================================
// 7. Lucide icons
// =============================================================================

function initLucideIcons() {
  if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') {
    lucide.createIcons();
  }
}

// =============================================================================
// 8. Page load
// =============================================================================

function initPageLoad() {
  setTimeout(() => {
    document.body.classList.add('loaded');
  }, 100);
}

// =============================================================================
// 9. Hero reveal animation (Antimetal-style staggered entrance)
// =============================================================================

function initHeroReveal() {
  const hero = document.getElementById('hero');
  if (!hero) return;

  // Short delay to let dotted video start, then reveal content
  setTimeout(() => {
    hero.classList.add('hero--revealed');
  }, 300);
}

// =============================================================================
// Stats Banner — Floating Geometry WebGL Effect
// =============================================================================

class GeometryFieldEffect {
  constructor(containerId) {
    this._container = document.getElementById(containerId);
    if (!this._container) return;
    this._destroyed = false;
    this._rafId = null;
    this._startTime = 0;

    this._canvas = document.createElement('canvas');
    this._canvas.style.display = 'block';
    this._canvas.style.width = '100%';
    this._canvas.style.height = '100%';
    this._container.appendChild(this._canvas);

    this._gl = this._canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false });
    if (!this._gl) return;

    this._initShaders();
    this._initBuffers();
    this._getUniformLocations();
    this.resize();
    this._onResize = () => { if (!this._destroyed) this.resize(); };
    window.addEventListener('resize', this._onResize);

    // Pause when off-screen
    this._visible = false;
    this._io = new IntersectionObserver(([entry]) => {
      this._visible = entry.isIntersecting;
    }, { threshold: 0.05 });
    this._io.observe(this._container);

    this._startRenderLoop();
  }

  _initShaders() {
    const gl = this._gl;
    const vertSrc = `attribute vec2 position; void main() { gl_Position = vec4(position, 0.0, 1.0); }`;
    const fragSrc = `
      precision highp float;
      uniform vec2 u_resolution;
      uniform float u_time;

      float hash(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      float sdRhombus(vec2 p, vec2 b) {
        vec2 q = abs(p);
        float h = clamp((-2.0 * dot(q, b) + dot(b, b)) / dot(b, b), -1.0, 1.0);
        float d = length(q - 0.5 * b * vec2(1.0 - h, 1.0 + h));
        return d * sign(q.x * b.y + q.y * b.x - b.x * b.y);
      }

      float sdHexagon(vec2 p, float r) {
        const vec3 k = vec3(-0.866025, 0.5, 0.57735);
        p = abs(p);
        p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
        p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
        return length(p) * sign(p.y);
      }

      float sdTriangle(vec2 p, float r) {
        const float k = sqrt(3.0);
        p.x = abs(p.x) - r;
        p.y = p.y + r / k;
        if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
        p.x -= clamp(p.x, -2.0 * r, 0.0);
        return -length(p) * sign(p.y);
      }

      void main() {
        vec2 uv = gl_FragCoord.xy / u_resolution.xy;
        float aspect = u_resolution.x / u_resolution.y;
        vec2 st = vec2(uv.x * aspect, uv.y);
        float t = u_time * 0.12;

        vec3 totalColor = vec3(0.0);
        float totalAlpha = 0.0;

        for (int i = 0; i < 10; i++) {
          float fi = float(i);
          float seed = hash(vec2(fi * 7.31, fi * 13.17));
          float seed2 = hash(vec2(fi * 3.71, fi * 9.43));

          vec2 center = vec2(
            fract(seed + t * (0.02 + seed2 * 0.03)) * (aspect + 0.4) - 0.2,
            fract(seed2 + t * (0.015 + seed * 0.02) + fi * 0.1) * 1.4 - 0.2
          );

          vec2 p = st - center;
          float angle = t * (0.3 + seed * 0.5) + fi * 1.047;
          float ca = cos(angle), sa = sin(angle);
          p = vec2(p.x * ca - p.y * sa, p.x * sa + p.y * ca);

          float size = 0.06 + seed * 0.08;

          float d;
          int shapeType = int(mod(fi, 3.0));
          if (shapeType == 0) {
            d = sdRhombus(p, vec2(size, size * 1.4));
          } else if (shapeType == 1) {
            d = sdHexagon(p, size);
          } else {
            d = sdTriangle(p, size);
          }

          // Thick outline stroke
          float strokeW = 0.004;
          float shape = 1.0 - smoothstep(0.0, 0.002, abs(d) - strokeW);

          // Visible glow halo
          float glow = 0.015 / (abs(d) + 0.015);
          glow *= glow;

          // Color tint per shape
          vec3 shapeColor = vec3(0.45, 0.5, 0.7);
          if (shapeType == 1) shapeColor = vec3(0.5, 0.55, 0.75);
          if (shapeType == 2) shapeColor = vec3(0.4, 0.48, 0.68);

          float shapeAlpha = shape * 0.5 + glow * 0.25;
          totalColor += shapeColor * shapeAlpha;
          totalAlpha += shapeAlpha;
        }

        // Faint dot grid
        vec2 gridUv = st * 12.0;
        vec2 gridId = floor(gridUv);
        vec2 gridF = fract(gridUv) - 0.5;
        float dotDist = length(gridF);
        float dot2 = smoothstep(0.06, 0.03, dotDist) * 0.06;
        totalColor += vec3(0.4, 0.45, 0.6) * dot2;
        totalAlpha += dot2;

        vec3 finalColor = totalAlpha > 0.001 ? totalColor / totalAlpha : vec3(0.0);
        gl_FragColor = vec4(finalColor * totalAlpha, clamp(totalAlpha, 0.0, 0.5));
      }
    `;

    const vert = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vert, vertSrc);
    gl.compileShader(vert);

    const frag = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(frag, fragSrc);
    gl.compileShader(frag);

    this._program = gl.createProgram();
    gl.attachShader(this._program, vert);
    gl.attachShader(this._program, frag);
    gl.linkProgram(this._program);
    this._vertShader = vert;
    this._fragShader = frag;
    gl.useProgram(this._program);
  }

  _initBuffers() {
    const gl = this._gl;
    const verts = new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]);
    this._buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._buffer);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(this._program, 'position');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
  }

  _getUniformLocations() {
    const gl = this._gl;
    this._uRes = gl.getUniformLocation(this._program, 'u_resolution');
    this._uTime = gl.getUniformLocation(this._program, 'u_time');
  }

  resize() {
    if (this._destroyed) return;
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    const r = this._container.getBoundingClientRect();
    this._canvas.width = Math.round(r.width * dpr);
    this._canvas.height = Math.round(r.height * dpr);
    const gl = this._gl;
    gl.viewport(0, 0, this._canvas.width, this._canvas.height);
    gl.useProgram(this._program);
    gl.uniform2f(this._uRes, this._canvas.width, this._canvas.height);
  }

  _startRenderLoop() {
    this._startTime = performance.now();
    const render = (ts) => {
      if (this._destroyed) return;
      this._rafId = requestAnimationFrame(render);
      if (!this._visible) return;
      const gl = this._gl;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(this._program);
      gl.uniform1f(this._uTime, (ts - this._startTime) * 0.001);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };
    this._rafId = requestAnimationFrame(render);
  }

  destroy() {
    this._destroyed = true;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this._io) this._io.disconnect();
    window.removeEventListener('resize', this._onResize);
    const gl = this._gl;
    if (gl) {
      if (this._buffer) gl.deleteBuffer(this._buffer);
      if (this._program) gl.deleteProgram(this._program);
      if (this._vertShader) gl.deleteShader(this._vertShader);
      if (this._fragShader) gl.deleteShader(this._fragShader);
    }
    if (this._canvas && this._canvas.parentNode) this._canvas.parentNode.removeChild(this._canvas);
  }
}

// =============================================================================
// Bootstrap
// =============================================================================

let dottedVideoInstance = null;
let geometryFieldInstance = null;

document.addEventListener('DOMContentLoaded', () => {
  initPageLoad();
  initHeroReveal();
  initLucideIcons();
  initScrollAnimations();
  initNavigation();
  initTabSwitcher();
  initCounterAnimation();
  initMobileMenu();

  // Dotted Video Effect (Antimetal-style halftone dots + fluid sim)
  const heroContainer = document.getElementById('hero-dotted-video-container');
  if (heroContainer) {
    const prefersReducedMotionNow = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (window.innerWidth >= 1024 && !prefersReducedMotionNow) {
      dottedVideoInstance = new DottedVideoEffect('hero-dotted-video-container', DOTTED_VIDEO_CONFIG);
    }
  }

  // Stats Banner Geometry Field Effect
  const statsBannerCanvas = document.getElementById('stats-banner-canvas');
  if (statsBannerCanvas) {
    const prefersReducedMotionNow2 = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!prefersReducedMotionNow2) {
      geometryFieldInstance = new GeometryFieldEffect('stats-banner-canvas');
    }
  }

  // Laser Beam Background Effect — disabled (saved in effects/laser-beam-standalone.html)
  // const heroContainer = document.getElementById('hero-dotted-video-container');
  // if (heroContainer) {
  //   const prefersReducedMotionNow = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  //   if (window.innerWidth >= 1024 && !prefersReducedMotionNow) {
  //     window.__laserBeamInstance = new LaserBeamEffect('hero-dotted-video-container');
  //   }
  // }
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  if (dottedVideoInstance) {
    dottedVideoInstance.destroy();
    dottedVideoInstance = null;
  }
  if (window.__laserBeamInstance) {
    window.__laserBeamInstance.destroy();
    window.__laserBeamInstance = null;
  }
  if (geometryFieldInstance) {
    geometryFieldInstance.destroy();
    geometryFieldInstance = null;
  }
});
