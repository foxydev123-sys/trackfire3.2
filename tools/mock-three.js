// Test-only stand-in for Three.js (no WebGL). Implements just enough of the
// API for the game's logic, networking and UI to run in a headless browser.
export const AdditiveBlending = 2, NormalBlending = 1, DoubleSide = 2, PCFShadowMap = 1, PCFSoftShadowMap = 2, GreaterDepth = 5;
export class Vector2 { constructor(x = 0, y = 0) { this.x = x; this.y = y; } set(x, y) { this.x = x; this.y = y; return this; } }
export class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  setY(y) { this.y = y; return this; } sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  lerp(v, t) { this.x += (v.x - this.x) * t; this.y += (v.y - this.y) * t; this.z += (v.z - this.z) * t; return this; }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
  distanceToSquared(v) { const a = this.x - v.x, b = this.y - v.y, c = this.z - v.z; return a * a + b * b + c * c; }
  length() { return Math.sqrt(this.lengthSq()); }
  normalize() { const l = this.length() || 1; return this.multiplyScalar(1 / l); }
  applyEuler() { return this; } applyMatrix4() { return this; }
  fromBufferAttribute(a, i) { this.x = a.getX(i); this.y = a.getY(i); this.z = a.getZ(i); return this; }
  project(cam) {
    // Real perspective projection, matching Three.js: build the camera basis the way lookAt does
    // (z points back from the target to the camera, x = up X z, y = z X x), then divide through
    // by depth. The old stand-in was a flat linear guess that ignored the field of view, the
    // aspect and the camera's height, so any test measuring screen positions measured a fiction.
    const P = cam.position, T = cam._t || new Vector3();
    let zx = P.x - T.x, zy = P.y - T.y, zz = P.z - T.z;
    const zl = Math.hypot(zx, zy, zz) || 1; zx /= zl; zy /= zl; zz /= zl;
    let xx = 1 * zz - 0 * zy, xy = 0 * zx - 0 * zz, xz = 0 * zy - 1 * zx;   // worldUp(0,1,0) X z
    const xl = Math.hypot(xx, xy, xz) || 1; xx /= xl; xy /= xl; xz /= xl;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;   // z X x
    const dx = this.x - P.x, dy = this.y - P.y, dz = this.z - P.z;
    const cx = dx * xx + dy * xy + dz * xz;
    const cy = dx * yx + dy * yy + dz * yz;
    const depth = -(dx * zx + dy * zy + dz * zz);      // metres in front of the camera
    const fov = (cam.fov || 36) * Math.PI / 180, asp = cam.aspect || (16 / 9);
    const tn = Math.tan(fov / 2), near = cam.near || 1, far = cam.far || 400;
    if (depth <= 1e-4) { this.x = 0; this.y = 0; this.z = 2; return this; }   // behind the camera
    this.x = cx / (depth * tn * asp);
    this.y = cy / (depth * tn);
    this.z = ((far + near) / (far - near)) - (2 * far * near) / ((far - near) * depth);
    return this;
  }
}
export class Euler { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } }
export class Quaternion { setFromEuler() { return this; } }
export class Matrix4 {
  compose() { return this; } premultiply() { return this; } multiply() { return this; } clone() { return new Matrix4(); }
  makeRotationY() { return this; } makeRotationX() { return this; } makeRotationZ() { return this; } setPosition() { return this; }
}
export class Color {
  constructor(c) { this.r = 0.5; this.g = 0.5; this.b = 0.5; if (c instanceof Color) this.copy(c); }
  set() { return this; } setHex() { return this; } setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; return this; } getHex() { return 0x808080; } copy(c) { this.r = c.r; this.g = c.g; this.b = c.b; return this; }
  clone() { return new Color(this); } lerp() { return this; } multiplyScalar(s) { this.r *= s; this.g *= s; this.b *= s; return this; }
}
export class BufferAttribute {
  constructor(arr, size) { this.array = arr; this.itemSize = size; this.count = arr.length / size; }
  getX(i) { return this.array[i * this.itemSize]; } getY(i) { return this.array[i * this.itemSize + 1]; } getZ(i) { return this.array[i * this.itemSize + 2]; }
  setY(i, v) { this.array[i * this.itemSize + 1] = v; } setXYZ(i, x, y, z) { const o = i * this.itemSize; this.array[o] = x; this.array[o + 1] = y; this.array[o + 2] = z; }
}
export class BufferGeometry {
  constructor(n = 36) { this.attributes = { position: new BufferAttribute(new Float32Array(n * 3), 3) }; this.index = null; }
  setAttribute(k, a) { this.attributes[k] = a; return this; } deleteAttribute(k) { delete this.attributes[k]; }
  toNonIndexed() { return this; } clone() { const g = new BufferGeometry(0); g.attributes.position = new BufferAttribute(this.attributes.position.array.slice(), 3); return g; }
  rotateX() { return this; } translate() { return this; } dispose() {} computeVertexNormals() {} computeBoundingSphere() {} computeBoundingBox() {}
  setFromPoints(p) { this.attributes.position = new BufferAttribute(new Float32Array(p.length * 3), 3); return this; }
}
export class BoxGeometry extends BufferGeometry { constructor() { super(36); } }
export class IcosahedronGeometry extends BufferGeometry { constructor() { super(60); } }
export class SphereGeometry extends BufferGeometry { constructor() { super(72); } }
export class CylinderGeometry extends BufferGeometry { constructor() { super(48); } }
export class ConeGeometry extends BufferGeometry { constructor() { super(24); } }
export class RingGeometry extends BufferGeometry { constructor() { super(48); } }
export class CircleGeometry extends BufferGeometry { constructor() { super(9); } }
export class ExtrudeGeometry extends BufferGeometry { constructor() { super(36); } }
export class Shape { moveTo() {} lineTo() {} closePath() {} }
export class PlaneGeometry extends BufferGeometry {
  constructor(w, h, sx = 1, sy = 1) { super(0); const a = []; for (let j = 0; j <= sy; j++) for (let i = 0; i <= sx; i++) a.push(-w / 2 + (w * i) / sx, 0, -h / 2 + (h * j) / sy); this.attributes.position = new BufferAttribute(new Float32Array(a), 3); }
}
class Mat { constructor(o = {}) { Object.assign(this, o); this.color = new Color(); this.opacity = o.opacity ?? 1; } clone() { const m = new this.constructor({ ...this }); m.color = this.color.clone(); return m; } dispose() {} }
export class MeshStandardMaterial extends Mat {} export class MeshBasicMaterial extends Mat {} export class LineDashedMaterial extends Mat {}
export class SpriteMaterial extends Mat {} export class PointsMaterial extends Mat {}
export class CanvasTexture { constructor(c) { this.image = c; } dispose() {} }
export class TorusGeometry extends BufferGeometry { constructor() { super(48); } } export class OctahedronGeometry extends BufferGeometry { constructor() { super(24); } }
export class Object3D {
  constructor() { this.position = new Vector3(); this.rotation = new Euler(); this.scale = { x: 1, y: 1, z: 1, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }, setScalar(v) { this.x = this.y = this.z = v; return this; } }; this.children = []; this.visible = true; this.userData = {}; }
  add(...o) { for (const c of o) { this.children.push(c); c.parent = this; } return this; }
  remove(...o) { for (const c of o) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); } return this; }
  traverse(fn) { fn(this); for (const c of this.children) c.traverse(fn); }
  updateMatrixWorld() {}
  getWorldPosition(v) { let o = this, x = 0, y = 0, z = 0; while (o) { x += o.position.x; y += o.position.y; z += o.position.z; o = o.parent; } return v.set(x, y, z); }
  lookAt(x, y, z) { this._t = typeof x === 'object' ? x.clone() : new Vector3(x, y, z); }
}
export class Group extends Object3D {}
export class Scene extends Object3D { constructor() { super(); this.fog = null; this.background = null; } }
export class Mesh extends Object3D { constructor(g, m) { super(); this.geometry = g; this.material = m; } }
export class Line extends Mesh { computeLineDistances() {} }
export class Sprite extends Mesh { constructor(m) { super(null, m); } } export class Points extends Mesh {}
export class PerspectiveCamera extends Object3D { constructor(f, a, n, fa) { super(); this.fov = f || 36; this.aspect = a || 16 / 9; this.near = n || 1; this.far = fa || 400; } updateProjectionMatrix() {} }
export class Fog { constructor(c) { this.color = new Color(c); } }
class Light extends Object3D { constructor() { super(); this.color = new Color(); this.groundColor = new Color(); this.intensity = 1; this.target = new Object3D(); this.shadow = { camera: {}, mapSize: { x: 1024, set(a) { this.x = a; } }, map: null }; } }
export class DirectionalLight extends Light {} export class HemisphereLight extends Light {} export class PointLight extends Light {} export class SpotLight extends Light {}
export class Plane { constructor(n, c) { this.normal = n; this.constant = c; } }
export class Raycaster { constructor() { this.ray = { intersectPlane: (p, v) => v.set(this._x || 0, 0, this._z || 0) }; } setFromCamera(n, cam) { const t = cam._t || new Vector3(); this._x = t.x + n.x * 45; this._z = t.z - n.y * 28; } }
export class WebGLRenderer {
  constructor(o = {}) { this.domElement = o.canvas || document.createElement('canvas'); this.shadowMap = { enabled: false, type: 0 }; this.renders = 0; window.__renders = 0; }
  setSize(w, h) { this.domElement.width = Math.round(w * (this.pr || 1)); this.domElement.height = Math.round(h * (this.pr || 1)); } setPixelRatio(p) { this.pr = p; }
  render() { window.__renders++; } setClearColor() {} dispose() {} forceContextLoss() {}
}
