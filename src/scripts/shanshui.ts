/**
 * Signal shanshui: the hero landscape.
 *
 * Ink-wash mountains built the way a plot is built. Each range is ridged noise,
 * filled with a wash that dissolves into mist and traced by fine contour lines.
 * The composition protects the text: ranges lie low along the bottom of the left
 * half, passing under the buttons, and only rise on the right behind the portrait.
 *
 * Distance is told the way ink painting tells it: the far ranges are ink with indigo
 * mixed in, the near ones plain ink.
 *
 * Every range is painted exactly once, into its own canvas. All motion after that
 * is compositing: CSS sways the layers and the pointer shifts them for parallax.
 * Nothing repaints per frame, so the animation runs at the display's full refresh
 * rate, even on a busy main thread.
 */

interface Range {
  base: number;
  amp: number;
  seed: number;
  contours: number;
  tone: number;
  freq: number;
  /** Pointer parallax, in px at full deflection. */
  depth: number;
  /** Sway distance in px, and its period in seconds. */
  sway: number;
  period: number;
  /** How much indigo is mixed into this range's ink: 1 for the farthest. */
  distance: number;
}

const RANGES: Range[] = [
  { base: 0.86, amp: 0.74, seed: 3.1, contours: 2, tone: 0.32, freq: 3.4, depth: 4, sway: 9, period: 47, distance: 1 },
  { base: 0.92, amp: 0.6, seed: 11.7, contours: 3, tone: 0.5, freq: 4.2, depth: 8, sway: 15, period: 39, distance: 0.6 },
  { base: 0.98, amp: 0.46, seed: 23.4, contours: 4, tone: 0.7, freq: 5.1, depth: 14, sway: 23, period: 31, distance: 0.15 },
  { base: 1.05, amp: 0.34, seed: 37.9, contours: 5, tone: 0.92, freq: 6.3, depth: 22, sway: 33, period: 26, distance: 0 },
];
const MIST_AFTER = 1;

/** Ink, and ink with indigo mixed in, for each theme. */
const INKS = {
  light: { near: [26, 30, 38], far: [62, 84, 118] },
  dark: { near: [206, 214, 226], far: [150, 172, 206] },
};
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(', ');
/** Extra canvas on each side, so swaying never exposes an edge. */
const BLEED = 64;

function hash(n: number) {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

/** 1D value noise with smoothstep interpolation. */
function noise(x: number) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash(i) * (1 - u) + hash(i + 1) * u;
}

/** Folding the noise at its midline turns soft hills into sharp ink-painting peaks. */
function ridged(x: number) {
  const fold = (v: number) => 1 - Math.abs(v * 2 - 1);
  return (
    fold(noise(x)) * 0.58 +
    fold(noise(x * 2.1 + 7.1)) * 0.27 +
    fold(noise(x * 4.3 + 13.7)) * 0.11 +
    noise(x * 9 + 29.3) * 0.04
  );
}

export function initShanshui(root: HTMLElement) {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let dark = document.documentElement.dataset.theme === 'dark';

  const layers = RANGES.map((range, index) => {
    const layer = document.createElement('div');
    layer.className = 'ls-layer';
    const sway = document.createElement('div');
    sway.className = 'ls-sway';
    sway.style.setProperty('--sway', `${range.sway}px`);
    sway.style.setProperty('--period', `${range.period}s`);
    const canvas = document.createElement('canvas');
    sway.append(canvas);
    layer.append(sway);
    root.append(layer);
    if (index === MIST_AFTER) {
      const mist = document.createElement('div');
      mist.className = 'ls-mist';
      root.append(mist);
    }
    return { range, layer, sway, canvas };
  });


  /** On wide screens the land rises to the right; stacked layouts stay level. */
  const envelope = (u: number, w: number) => {
    if (w < 820) return 0.42;
    const rise = Math.min(1, Math.max(0, (u - 0.46) / 0.3));
    return 0.14 + 0.86 * rise * rise * (3 - 2 * rise);
  };

  function paintRange(entry: (typeof layers)[number], w: number, h: number) {
    const { range: r, canvas } = entry;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const full = w + BLEED * 2;
    const step = Math.max(3, full / 360);
    const count = Math.ceil(full / step);

    const ys = new Float32Array(count + 1);
    let top = h;
    for (let i = 0; i <= count; i++) {
      const u = (i * step - BLEED) / w;
      const n = ridged(u * r.freq + r.seed);
      ys[i] = h * (r.base - r.amp * envelope(u, w) * n);
      if (ys[i] < top) top = ys[i];
    }

    // Only the band this range occupies is allocated; far less memory than full size.
    const offset = Math.max(0, Math.floor(top) - 2);
    const height = h - offset;
    canvas.style.cssText = `left:${-BLEED}px;top:${offset}px;width:${full}px;height:${height}px`;
    canvas.width = Math.round(full * dpr);
    canvas.height = Math.round(height * dpr);

    const c = canvas.getContext('2d')!;
    c.setTransform(dpr, 0, 0, dpr, 0, -offset * dpr);
    const ink = INKS[dark ? 'dark' : 'light'];
    const rgb = mix(ink.near, ink.far, r.distance);
    const paper = dark ? '12, 14, 17' : '246, 247, 248';

    const trace = () => {
      c.beginPath();
      c.moveTo(0, h + 2);
      for (let i = 0; i <= count; i++) c.lineTo(i * step, ys[i]);
      c.lineTo(full, h + 2);
      c.closePath();
    };

    // Mist first: the nearer range veils the one behind it.
    trace();
    c.fillStyle = `rgba(${paper}, 0.62)`;
    c.fill();

    // Wash: darkest along the ridge, dissolving as it falls.
    const wash = c.createLinearGradient(0, top, 0, Math.min(h, top + h * 0.5));
    wash.addColorStop(0, `rgba(${rgb}, ${(dark ? 0.24 : 0.22) * r.tone})`);
    wash.addColorStop(0.45, `rgba(${rgb}, ${(dark ? 0.09 : 0.08) * r.tone})`);
    wash.addColorStop(1, `rgba(${rgb}, 0)`);
    trace();
    c.fillStyle = wash;
    c.fill();

    // Contours: the ridge repeated, fainter, like a plot of the same signal.
    for (let k = 0; k < r.contours; k++) {
      const shift = k * k * 2.2 + k * 4.5;
      c.beginPath();
      for (let i = 0; i <= count; i++) {
        const y = ys[i] + shift;
        if (i) c.lineTo(i * step, y);
        else c.moveTo(0, y);
      }
      c.strokeStyle = `rgba(${rgb}, ${(k === 0 ? 0.52 : 0.16 / k) * r.tone})`;
      c.lineWidth = k === 0 ? 1 : 0.7;
      c.stroke();
    }

  }

  function paint() {
    const rect = root.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    layers.forEach((entry) => paintRange(entry, rect.width, rect.height));
    root.classList.add('is-ready');
  }

  paint();

  let resizing = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(resizing);
    resizing = requestAnimationFrame(paint);
  }).observe(root);

  addEventListener('themechange', ((e: CustomEvent<string>) => {
    dark = e.detail === 'dark';
    paint();
  }) as EventListener);

  if (still) return;

  // Compositor animations are cheap, but off screen they should cost nothing at all.
  new IntersectionObserver(([entry]) => {
    root.classList.toggle('is-paused', !entry.isIntersecting);
  }).observe(root);

  // Pointer parallax: a few transforms per frame, and only while the pointer moves.
  if (!matchMedia('(hover: hover)').matches) return;
  let targetX = 0;
  let targetY = 0;
  let x = 0;
  let y = 0;
  let raf = 0;
  let last = 0;

  const step = (now: number) => {
    const ease = 1 - Math.exp(-Math.min(now - last, 64) / 170);
    last = now;
    x += (targetX - x) * ease;
    y += (targetY - y) * ease;
    for (const { layer, range } of layers) {
      layer.style.transform = `translate3d(${(-x * range.depth).toFixed(2)}px, ${(-y * range.depth * 0.3).toFixed(2)}px, 0)`;
    }
    raf = Math.abs(targetX - x) + Math.abs(targetY - y) > 0.002 ? requestAnimationFrame(step) : 0;
  };

  root.parentElement?.addEventListener(
    'pointermove',
    (e) => {
      targetX = (e.clientX / innerWidth) * 2 - 1;
      targetY = (e.clientY / innerHeight) * 2 - 1;
      if (!raf) {
        last = performance.now();
        raf = requestAnimationFrame(step);
      }
    },
    { passive: true },
  );
}
