/**
 * @author hayden
 * @title  noise func — animated perlin noise texture
 */
const kDensityMap = '█▓▒░ ';
const kMidpoint = 0.5;
const kScale = 7;
const kSpeed = 0.035;
const kContrastStrength = 0.9;
import type { Program } from "ts-play-core";

// Permutation table — seeded once
const perm = new Uint8Array(512);
const p = Array.from({ length: 256 }, (_, i) => i);
for (let i = 255; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [p[i], p[j]] = [p[j], p[i]];
}
for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

function fade(t: number) { return t * t * t * (t * (t * 6 - 15) + 10); }
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
function grad(h: number, x: number, y: number, z: number) {
  h &= 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
  return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
}

function noise(x: number, y: number, z: number): number {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
  x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
  const u = fade(x), v = fade(y), w = fade(z);
  const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z;
  const B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
  return lerp(
    lerp(lerp(grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z), u),
         lerp(grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z), u), v),
    lerp(lerp(grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1), u),
         lerp(grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1), u), v), w);
}


export default {
  main(coord, context) {
    const { cols, rows, frame } = context;
    const { x, y } = coord;

    const nx = x / kScale;
    const ny = y / kScale;
    const nz = frame * kSpeed;

    // Octave noise for more organic texture
    let n = 0, amp = 1, freq = 1, max = 0;
    for (let i = 0; i < 4; i++) {
      n += noise(nx * freq, ny * freq, nz * freq) * amp;
      max += amp; amp *= 0.5; freq *= 2;
    }
    n = (n / max + 1) / 2; // normalize to [0, 1]
    n = kMidpoint - Math.cos(n * Math.PI) * (kContrastStrength); // sine-based S-curve
    const idx = Math.min(kDensityMap.length - 1, Math.floor(n * kDensityMap.length));
    return kDensityMap[idx];
  }
} satisfies Program;