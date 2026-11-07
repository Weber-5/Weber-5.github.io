/**
 * Signal shanshui: the hero landscape.
 *
 * Ink-wash mountains built the way a plot is built. Each range is ridged noise,
 * filled with a wash that dissolves into mist and traced by fine contour lines.
 * One ridge carries the academic-blue dab as a travelling pulse.
 *
 * The composition protects the text: ranges lie low along the bottom of the left
 * half, passing under the buttons, and only rise on the right behind the portrait.
 * The pointer lifts the terrain very slightly.
 */

interface Range {
  base: number;
  amp: number;
  seed: number;
  drift: number;
  contours: number;
  tone: number;
  freq: number;
}

const FPS = 30;

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

export function initShanshui(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ranges: Range[] = [
    { base: 0.86, amp: 0.74, seed: 3.1, drift: 0.006, contours: 2, tone: 0.32, freq: 3.4 },
    { base: 0.92, amp: 0.6, seed: 11.7, drift: 0.009, contours: 3, tone: 0.5, freq: 4.2 },
    { base: 0.98, amp: 0.46, seed: 23.4, drift: 0.013, contours: 4, tone: 0.7, freq: 5.1 },
    { base: 1.05, amp: 0.34, seed: 37.9, drift: 0.018, contours: 5, tone: 0.92, freq: 6.3 },
  ];
  const PULSE_RANGE = 2;

  let w = 0;
  let h = 0;
  let dark = document.documentElement.dataset.theme === 'dark';
  let pointerX = -1;
  let lift = 0;
  let raf = 0;
  let visible = true;
  let last = 0;

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 1.75);
    const rect = canvas.getBoundingClientRect();
    w = rect.width;
    h = rect.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** On wide screens the land rises to the right; stacked layouts stay level. */
  const envelope = (u: number) => {
    if (w < 820) return 0.42;
    const rise = Math.min(1, Math.max(0, (u - 0.46) / 0.3));
    return 0.14 + 0.86 * rise * rise * (3 - 2 * rise);
  };

  function ridgeY(r: Range, u: number, t: number) {
    const n = ridged(u * r.freq + r.seed + t * r.drift);
    const bump = pointerX >= 0 ? Math.exp(-(((u - pointerX) / 0.07) ** 2)) * lift * 0.03 : 0;
    return h * (r.base - r.amp * envelope(u) * n - bump);
  }

  function draw(t: number) {
    const c = ctx!;
    c.clearRect(0, 0, w, h);
    const rgb = dark ? '206, 214, 226' : '26, 30, 38';
    const blue = dark ? '141, 178, 242' : '31, 79, 168';
    const paper = dark ? '12, 14, 17' : '246, 247, 248';
    const step = Math.max(4, w / 300);
    const count = Math.ceil(w / step);

    ranges.forEach((r, index) => {
      const ys = new Float32Array(count + 1);
      let top = h;
      for (let i = 0; i <= count; i++) {
        ys[i] = ridgeY(r, i / count, t);
        if (ys[i] < top) top = ys[i];
      }

      const trace = () => {
        c.beginPath();
        c.moveTo(0, h + 2);
        for (let i = 0; i <= count; i++) c.lineTo(i * step, ys[i]);
        c.lineTo(w, h + 2);
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
        const offset = k * k * 2.2 + k * 4.5;
        c.beginPath();
        for (let i = 0; i <= count; i++) {
          const y = ys[i] + offset;
          if (i) c.lineTo(i * step, y);
          else c.moveTo(0, y);
        }
        c.strokeStyle = `rgba(${rgb}, ${(k === 0 ? 0.52 : 0.16 / k) * r.tone})`;
        c.lineWidth = k === 0 ? 1 : 0.7;
        c.stroke();
      }

      // A pulse of blue running along one ridge.
      if (index === PULSE_RANGE && !still) {
        const head = (t * 0.04) % 1.3;
        const from = Math.max(0, Math.floor((head - 0.18) * count));
        const to = Math.min(count, Math.floor(head * count));
        c.lineWidth = 1.4;
        for (let i = from; i < to; i++) {
          c.beginPath();
          c.moveTo(i * step, ys[i]);
          c.lineTo((i + 1) * step, ys[i + 1]);
          c.strokeStyle = `rgba(${blue}, ${((i - from) / Math.max(1, to - from)) * 0.9})`;
          c.stroke();
        }
      }
    });
  }

  function loop(now: number) {
    raf = requestAnimationFrame(loop);
    if (now - last < 1000 / FPS) return;
    last = now;
    lift *= 0.95;
    draw(now / 1000);
  }

  const start = () => {
    if (!raf && !still && visible && !document.hidden) raf = requestAnimationFrame(loop);
  };
  const stop = () => {
    cancelAnimationFrame(raf);
    raf = 0;
  };

  resize();
  draw(still ? 12 : performance.now() / 1000);
  canvas.classList.add('is-ready');

  new ResizeObserver(() => {
    resize();
    draw(performance.now() / 1000);
  }).observe(canvas);

  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) start();
    else stop();
  }).observe(canvas);

  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));

  addEventListener('themechange', ((e: CustomEvent<string>) => {
    dark = e.detail === 'dark';
    draw(performance.now() / 1000);
  }) as EventListener);

  if (!still) {
    canvas.parentElement?.addEventListener(
      'pointermove',
      (e) => {
        const rect = canvas.getBoundingClientRect();
        pointerX = (e.clientX - rect.left) / rect.width;
        lift = Math.min(1, lift + 0.12);
      },
      { passive: true },
    );
  }
  start();
}
