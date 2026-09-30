/* Small textures drawn once on a canvas: soft glow dots, a headlight beam,
   a smoke puff, a star-shaped muzzle flash and a scorch mark. */
import * as THREE from '../three.js';

const cache = {};
function canvasTex(key, size, draw) {
  if (cache[key]) return cache[key];
  if (typeof document === 'undefined') return (cache[key] = null);
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  draw(cv.getContext('2d'), size);
  const t = new THREE.CanvasTexture(cv); t.needsUpdate = true;
  return (cache[key] = t);
}
// White radial glow (tinted by the material colour).
export const glowTex = () => canvasTex('glow', 64, (x, S) => {
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,.75)'); g.addColorStop(0.6, 'rgba(255,255,255,.18)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, S, S);
});
// Headlight beam seen from above: bright near the tank, wide and faint far away.
export const beamTex = () => canvasTex('beam', 128, (x, S) => {
  const img = x.createImageData(S, S);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const v = j / S, u = (i / S - 0.5) * 2;                    // v: 0 = near the tank, 1 = far
    const halfW = 0.18 + v * 0.82; const side = Math.max(0, 1 - Math.abs(u) / halfW);
    const a = Math.pow(side, 1.4) * Math.pow(1 - v, 1.3) * Math.min(1, v * 8);
    const k = (j * S + i) * 4; img.data[k] = img.data[k + 1] = img.data[k + 2] = 255; img.data[k + 3] = a * 255;
  }
  x.putImageData(img, 0, 0);
});
// Four-point star for muzzle flashes.
export const starTex = () => canvasTex('star', 128, (x, S) => {
  const c = S / 2; x.translate(c, c);
  const g = x.createRadialGradient(0, 0, 0, 0, 0, c);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  for (let k = 0; k < 4; k++) { x.rotate(Math.PI / 4 + (k % 2) * Math.PI / 4); x.beginPath(); x.moveTo(-c, 0); x.lineTo(0, -c * 0.1); x.lineTo(c, 0); x.lineTo(0, c * 0.1); x.closePath(); x.fill(); }
  x.setTransform(1, 0, 0, 1, 0, 0);
  const g2 = x.createRadialGradient(c, c, 0, c, c, c * 0.55); g2.addColorStop(0, 'rgba(255,255,255,1)'); g2.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g2; x.fillRect(0, 0, S, S);
});
// Soft cloudy puff for smoke and dust.
export const puffTex = () => canvasTex('puff', 64, (x, S) => {
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * Math.PI * 2, r = i ? S * 0.16 : 0, cx = S / 2 + Math.cos(a) * r, cy = S / 2 + Math.sin(a) * r, R = S * (i ? 0.24 : 0.34);
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, R); g.addColorStop(0, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, S, S);
  }
});
// Dark blast mark left on the ground.
export const scorchTex = () => canvasTex('scorch', 64, (x, S) => {
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(0,0,0,.85)'); g.addColorStop(0.5, 'rgba(0,0,0,.5)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  for (let i = 0; i < 9; i++) { const a = Math.random() * 6.28; x.strokeStyle = 'rgba(0,0,0,.35)'; x.lineWidth = 2; x.beginPath(); x.moveTo(S / 2, S / 2); x.lineTo(S / 2 + Math.cos(a) * S * 0.46, S / 2 + Math.sin(a) * S * 0.46); x.stroke(); }
});
