// Simplex-style noise for procedural terrain generation
// Based on improved Perlin noise algorithm

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const F3 = 1 / 3;
const G3 = 1 / 6;

const grad3 = [
  [1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],
  [1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],
  [0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1],
];

const perm = new Uint8Array(512);
const gradP = new Array(512);

function seed(s) {
  if (s > 0 && s < 1) s *= 65536;
  s = Math.floor(s);
  if (s < 256) s |= s << 8;
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let v;
    if (i & 1) {
      v = p[i] ^ (s & 255);
    } else {
      v = p[i] ^ ((s >> 8) & 255);
    }
    // Simple hash
    v = ((i * 1664525 + 1013904223 + s) >>> 0) & 255;
    perm[i] = perm[i + 256] = v;
    gradP[i] = gradP[i + 256] = grad3[v % 12];
  }
}

seed(42);

export function noise2D(xin, yin) {
  let n0, n1, n2;
  const s = (xin + yin) * F2;
  let i = Math.floor(xin + s);
  let j = Math.floor(yin + s);
  const t = (i + j) * G2;
  const x0 = xin - i + t;
  const y0 = yin - j + t;
  let i1, j1;
  if (x0 > y0) { i1 = 1; j1 = 0; }
  else { i1 = 0; j1 = 1; }
  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2;
  const y2 = y0 - 1 + 2 * G2;
  i &= 255; j &= 255;
  const gi0 = gradP[i + perm[j]] || grad3[0];
  const gi1 = gradP[i + i1 + perm[j + j1]] || grad3[0];
  const gi2 = gradP[i + 1 + perm[j + 1]] || grad3[0];
  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 < 0) n0 = 0;
  else { t0 *= t0; n0 = t0 * t0 * (gi0[0] * x0 + gi0[1] * y0); }
  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 < 0) n1 = 0;
  else { t1 *= t1; n1 = t1 * t1 * (gi1[0] * x1 + gi1[1] * y1); }
  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 < 0) n2 = 0;
  else { t2 *= t2; n2 = t2 * t2 * (gi2[0] * x2 + gi2[1] * y2); }
  return 70 * (n0 + n1 + n2);
}

export function noise3D(xin, yin, zin) {
  let n0, n1, n2, n3;
  const s = (xin + yin + zin) * F3;
  let i = Math.floor(xin + s);
  let j = Math.floor(yin + s);
  let k = Math.floor(zin + s);
  const t = (i + j + k) * G3;
  const x0 = xin - i + t;
  const y0 = yin - j + t;
  const z0 = zin - k + t;
  let i1, j1, k1, i2, j2, k2;
  if (x0 >= y0) {
    if (y0 >= z0) { i1=1; j1=0; k1=0; i2=1; j2=1; k2=0; }
    else if (x0 >= z0) { i1=1; j1=0; k1=0; i2=1; j2=0; k2=1; }
    else { i1=0; j1=0; k1=1; i2=1; j2=0; k2=1; }
  } else {
    if (y0 < z0) { i1=0; j1=0; k1=1; i2=0; j2=1; k2=1; }
    else if (x0 < z0) { i1=0; j1=1; k1=0; i2=0; j2=1; k2=1; }
    else { i1=0; j1=1; k1=0; i2=1; j2=1; k2=0; }
  }
  const x1 = x0 - i1 + G3;
  const y1 = y0 - j1 + G3;
  const z1 = z0 - k1 + G3;
  const x2 = x0 - i2 + 2 * G3;
  const y2 = y0 - j2 + 2 * G3;
  const z2 = z0 - k2 + 2 * G3;
  const x3 = x0 - 1 + 3 * G3;
  const y3 = y0 - 1 + 3 * G3;
  const z3 = z0 - 1 + 3 * G3;
  i &= 255; j &= 255; k &= 255;
  const gi0 = gradP[i + perm[j + perm[k]]] || grad3[0];
  const gi1 = gradP[i + i1 + perm[j + j1 + perm[k + k1]]] || grad3[0];
  const gi2 = gradP[i + i2 + perm[j + j2 + perm[k + k2]]] || grad3[0];
  const gi3 = gradP[i + 1 + perm[j + 1 + perm[k + 1]]] || grad3[0];
  let t0 = 0.6 - x0*x0 - y0*y0 - z0*z0;
  if (t0 < 0) n0 = 0;
  else { t0 *= t0; n0 = t0 * t0 * (gi0[0]*x0 + gi0[1]*y0 + gi0[2]*z0); }
  let t1 = 0.6 - x1*x1 - y1*y1 - z1*z1;
  if (t1 < 0) n1 = 0;
  else { t1 *= t1; n1 = t1 * t1 * (gi1[0]*x1 + gi1[1]*y1 + gi1[2]*z1); }
  let t2 = 0.6 - x2*x2 - y2*y2 - z2*z2;
  if (t2 < 0) n2 = 0;
  else { t2 *= t2; n2 = t2 * t2 * (gi2[0]*x2 + gi2[1]*y2 + gi2[2]*z2); }
  let t3 = 0.6 - x3*x3 - y3*y3 - z3*z3;
  if (t3 < 0) n3 = 0;
  else { t3 *= t3; n3 = t3 * t3 * (gi3[0]*x3 + gi3[1]*y3 + gi3[2]*z3); }
  return 32 * (n0 + n1 + n2 + n3);
}

export function fbm2D(x, y, octaves = 6, lacunarity = 2, gain = 0.5) {
  let sum = 0, amp = 1, freq = 1, max = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise2D(x * freq, y * freq) * amp;
    max += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / max;
}
