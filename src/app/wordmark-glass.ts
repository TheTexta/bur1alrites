import * as THREE from "three";

type GradientStop = { offset: number; color: string };

const GLASS_STOPS: GradientStop[] = [
  { offset: 0, color: "rgba(255,255,255,0.98)" },
  { offset: 0.16, color: "rgba(255,255,255,0.45)" },
  { offset: 0.32, color: "rgba(20,20,20,0.55)" },
  { offset: 0.44, color: "rgba(20,20,20,0.7)" },
  { offset: 0.56, color: "rgba(255,255,255,0.85)" },
  { offset: 0.68, color: "rgba(20,20,20,0.6)" },
  { offset: 0.84, color: "rgba(255,255,255,0.5)" },
  { offset: 1, color: "rgba(255,255,255,0.95)" },
];

const SHEEN_STOPS: GradientStop[] = [
  { offset: 0.26, color: "rgba(255,255,255,0)" },
  { offset: 0.44, color: "rgba(255,255,255,0.9)" },
  { offset: 0.52, color: "rgba(255,255,255,0.25)" },
  { offset: 0.62, color: "rgba(255,255,255,0)" },
];

function buildGradientTexture(stops: GradientStop[], angleDeg: number, size = 256) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");

  // Matches CSS linear-gradient's angle convention (0deg = bottom to top).
  const angle = ((angleDeg - 90) * Math.PI) / 180;
  const dx = Math.cos(angle) * size;
  const dy = Math.sin(angle) * size;
  const gradient = ctx.createLinearGradient(
    size / 2 - dx / 2,
    size / 2 - dy / 2,
    size / 2 + dx / 2,
    size / 2 + dy / 2,
  );
  stops.forEach((stop) => gradient.addColorStop(stop.offset, stop.color));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createGlassGradientTexture() {
  return buildGradientTexture(GLASS_STOPS, 152);
}

export function createSheenGradientTexture() {
  return buildGradientTexture(SHEEN_STOPS, 112);
}

// Uses the logo's alpha channel (not luminance) as the mask so transparent PNG areas stay transparent.
export function createGlassMaterial(
  gradientTexture: THREE.Texture,
  maskTexture: THREE.Texture,
  blending: THREE.Blending = THREE.NormalBlending,
) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uGradient: { value: gradientTexture },
      uMask: { value: maskTexture },
      uOpacity: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D uGradient;
      uniform sampler2D uMask;
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        vec4 gradient = texture2D(uGradient, vUv);
        float mask = texture2D(uMask, vUv).a;
        // The composer works in linear space and encodes to sRGB on output, so emit linear here.
        gl_FragColor = vec4(pow(gradient.rgb, vec3(2.2)), gradient.a * mask * uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending,
  });
}
