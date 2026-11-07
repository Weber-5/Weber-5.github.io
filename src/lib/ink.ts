/** Deterministic generative ink: the same seed always draws the same shapes. */

export function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface RidgeOptions {
  width: number;
  base: number;
  amp: number;
  steps?: number;
  /** Number of summed sine octaves; more reads as rougher terrain. */
  octaves?: number;
  /** Folded sines give sharp peaks: mountains rather than a smooth signal. */
  sharp?: boolean;
}

/** A ridgeline: summed sines with random phase, which reads as both terrain and signal. */
export function ridge(rand: () => number, { width, base, amp, steps = 72, octaves = 4, sharp = false }: RidgeOptions) {
  const waves = Array.from({ length: octaves }, (_, i) => ({
    freq: (0.6 + rand() * 0.9) * 2 ** i,
    phase: rand() * Math.PI * 2,
    gain: 0.5 ** i,
  }));
  const points: [number, number][] = [];
  for (let s = 0; s <= steps; s++) {
    const u = s / steps;
    let y = 0;
    for (const w of waves) {
      const wave = Math.sin(u * Math.PI * 2 * w.freq + w.phase);
      y += (sharp ? 1 - Math.abs(wave) * 2 : wave) * w.gain;
    }
    points.push([u * width, base - y * amp]);
  }
  return points;
}

const f = (n: number) => n.toFixed(1);

export const linePath = (points: [number, number][]) =>
  points.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join('');

/** Close a ridgeline down to the bottom edge so it can be filled. */
export const areaPath = (points: [number, number][], bottom: number) =>
  `${linePath(points)}L${f(points.at(-1)![0])} ${bottom}L${f(points[0][0])} ${bottom}Z`;
