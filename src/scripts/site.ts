/** Site-wide behaviour. Page-specific code lives beside its page and loads on demand. */

const root = document.documentElement;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const store = {
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* Private mode: the choice just won't persist. */
    }
  },
};

/* Chinese webfont: ~100 unicode-range chunks of CSS, so only pages that need it pay. */
if (root.lang.startsWith('zh') || document.querySelector('[lang^="zh"]')) {
  import('@fontsource-variable/noto-sans-sc');
}

/* --- Scroll reveal ---------------------------------------------------------- */

const reveals = document.querySelectorAll<HTMLElement>('[data-reveal]');
if (reveals.length) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        }
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
  );
  reveals.forEach((el) => io.observe(el));
}

/* --- Navigation ------------------------------------------------------------- */

const nav = document.querySelector<HTMLElement>('[data-nav]');
const menuButton = document.querySelector<HTMLButtonElement>('[data-menu-toggle]');

if (nav) {
  // An observer instead of a scroll listener: no work at all during a scroll.
  const sentinel = document.createElement('div');
  sentinel.style.cssText = 'position:absolute;top:24px;left:0;width:1px;height:1px;pointer-events:none';
  sentinel.setAttribute('aria-hidden', 'true');
  document.body.prepend(sentinel);
  new IntersectionObserver(([entry]) => nav.classList.toggle('is-scrolled', !entry.isIntersecting)).observe(sentinel);
}

/* The hover block glides from item to item instead of each item lighting up alone. */
const navList = nav?.querySelector<HTMLElement>('.links ul');
const hoverPill = navList?.querySelector<HTMLElement>('[data-hover-pill]');
if (navList && hoverPill && matchMedia('(hover: hover)').matches) {
  const place = (link: HTMLElement) => {
    const arriving = !hoverPill.classList.contains('is-on');
    // Arriving from outside, it appears in place; only moves between items slide.
    if (arriving) hoverPill.style.transition = 'opacity 200ms';
    hoverPill.style.width = `${link.offsetWidth}px`;
    hoverPill.style.transform = `translateX(${link.offsetLeft}px)`;
    if (arriving) {
      void hoverPill.offsetWidth;
      hoverPill.style.transition = '';
    }
    hoverPill.classList.add('is-on');
  };
  navList.querySelectorAll<HTMLElement>('a').forEach((link) => link.addEventListener('pointerenter', () => place(link)));
  navList.addEventListener('pointerleave', () => hoverPill.classList.remove('is-on'));
}

const setMenu = (open: boolean) => {
  nav?.classList.toggle('is-open', open);
  menuButton?.setAttribute('aria-expanded', String(open));
};
menuButton?.addEventListener('click', () => setMenu(!nav?.classList.contains('is-open')));

/* --- Card light: one delegated listener for every card ----------------------- */

if (matchMedia('(hover: hover)').matches) {
  let pending: PointerEvent | null = null;
  const flush = () => {
    const e = pending!;
    pending = null;
    const card = (e.target as Element).closest?.<HTMLElement>('.card');
    if (!card) return;
    const rect = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${e.clientX - rect.left}px`);
    card.style.setProperty('--my', `${e.clientY - rect.top}px`);
  };
  // Pointers report faster than the display refreshes: at most one update per frame.
  document.addEventListener(
    'pointermove',
    (e) => {
      if (!pending) requestAnimationFrame(flush);
      pending = e;
    },
    { passive: true },
  );
}

/* --- Press feedback: a drop of ink spreads from where the pointer landed ------ */

const PRESSABLE =
  '.btn:not([aria-disabled="true"]), .filter, .tool, .to-top, [data-domain], [data-field], [data-type]';
document.addEventListener(
  'pointerdown',
  (e) => {
    if (e.button !== 0 || reducedMotion()) return;
    const host = (e.target as Element).closest?.<HTMLElement>(PRESSABLE);
    if (!host) return;
    const rect = host.getBoundingClientRect();
    let clip = host.querySelector<HTMLElement>(':scope > .ink-clip');
    if (!clip) {
      clip = document.createElement('span');
      clip.className = 'ink-clip';
      clip.setAttribute('aria-hidden', 'true');
      host.append(clip);
    }
    const drop = document.createElement('span');
    drop.className = 'ink-drop';
    drop.style.cssText = `left:${e.clientX - rect.left}px;top:${e.clientY - rect.top}px;--s:${Math.hypot(rect.width, rect.height) * 2}px`;
    clip.append(drop);
    drop.addEventListener('animationend', () => drop.remove(), { once: true });
  },
  { passive: true },
);

/* --- Counters run up to their value the first time they come into view ------- */

const counters = document.querySelectorAll<HTMLElement>('[data-count]');
if (counters.length && !reducedMotion()) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        io.unobserve(entry.target);
        const el = entry.target as HTMLElement;
        const end = Number(el.dataset.count);
        const start = performance.now();
        const tick = (now: number) => {
          const u = Math.min(1, (now - start) / 1100);
          el.textContent = String(Math.round(end * (1 - (1 - u) ** 3)));
          if (u < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }
    },
    { threshold: 0.6 },
  );
  counters.forEach((el) => {
    el.textContent = '0';
    io.observe(el);
  });
}

/* --- Theme: dark ink spreads across the page from the toggle ----------------- */

/** An irregular blot as polygon vertices. Equal vertex counts let it animate. */
function inkBlot(x: number, y: number, radius: number) {
  const steps = 128;
  const phase = Math.random() * 10;
  const points: string[] = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const wobble =
      1 +
      0.1 * Math.sin(a * 3 + phase) +
      0.055 * Math.sin(a * 7 - phase) +
      0.03 * Math.sin(a * 17 + phase * 2) +
      0.014 * Math.sin(a * 41 - phase * 3);
    const r = radius * wobble;
    points.push(`${(x + Math.cos(a) * r).toFixed(1)}px ${(y + Math.sin(a) * r).toFixed(1)}px`);
  }
  return `polygon(${points.join(',')})`;
}

function setTheme(next: string) {
  root.dataset.theme = next;
  store.set('theme', next);
  dispatchEvent(new CustomEvent('themechange', { detail: next }));
}

document.querySelectorAll<HTMLElement>('[data-theme-toggle]').forEach((button) => {
  button.addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    if (!document.startViewTransition || reducedMotion()) return setTheme(next);

    const rect = button.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const reach = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) * 1.22;

    root.classList.add('theme-switching');
    const transition = document.startViewTransition(() => setTheme(next));
    transition.ready
      .then(() => {
        root.animate(
          { clipPath: [inkBlot(x, y, 0), inkBlot(x, y, reach)] },
          { duration: 680, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', pseudoElement: '::view-transition-new(root)' },
        );
      })
      .catch(() => {
        /* A skipped transition still applies the theme; there is just no animation. */
      });
    transition.finished.finally(() => root.classList.remove('theme-switching'));
  });
});

/* --- Language: an explicit choice beats the time-zone guess ------------------- */

document.querySelectorAll<HTMLAnchorElement>('[data-lang-switch]').forEach((link) => {
  link.addEventListener('click', () => store.set('lang', link.dataset.langSwitch!));
});

/* --- Command palette --------------------------------------------------------- */

const palette = document.querySelector<HTMLDialogElement>('[data-palette]');

async function openPalette() {
  if (!palette || palette.open) return;
  const { initPalette } = await import('./palette');
  initPalette(palette);
  palette.showModal();
}

document.querySelectorAll('[data-palette-open]').forEach((el) => el.addEventListener('click', openPalette));

/* --- Reading comfort: the nav steps aside going down; a ring tracks progress -- */

const toTop = document.querySelector<HTMLButtonElement>('[data-to-top]');
const ring = toTop?.querySelector<SVGElement>('[data-ring]');
if (nav || toTop) {
  let lastY = scrollY;
  let travel = 0;
  let max = 1;
  let queued = false;
  const measure = () => {
    max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
  };
  measure();
  new ResizeObserver(measure).observe(document.body);

  let hidden = false;
  let shown = false;
  let offset = '';
  const update = () => {
    queued = false;
    const y = scrollY;
    const dy = y - lastY;
    lastY = y;
    // Direction must hold for a stretch, so trackpad jitter never flickers the bar.
    travel = Math.sign(dy) === Math.sign(travel) ? travel + dy : dy;
    if (nav) {
      const pinned =
        y < innerHeight * 0.5 || nav.classList.contains('is-open') || nav.contains(document.activeElement) || !!palette?.open;
      const hide = pinned || travel < -24 ? false : travel > 32 ? true : hidden;
      if (hide !== hidden) nav.classList.toggle('is-hidden', (hidden = hide));
    }
    if (toTop && ring) {
      const show = y > innerHeight * 1.1;
      if (show !== shown) toTop.classList.toggle('is-on', (shown = show));
      // Whole percent steps are invisible at this size and spare most style passes.
      const next = String(Math.round(100 - Math.min(1, y / max) * 100));
      if (show && next !== offset) ring.style.strokeDashoffset = offset = next;
    }
  };
  addEventListener(
    'scroll',
    () => {
      if (!queued) {
        queued = true;
        requestAnimationFrame(update);
      }
    },
    { passive: true },
  );
  nav?.addEventListener('focusin', () => {
    hidden = false;
    nav.classList.remove('is-hidden');
  });
  toTop?.addEventListener('click', () => scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' }));
}

addEventListener('keydown', (e) => {
  const typing = (e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable]');
  if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
    e.preventDefault();
    openPalette();
  }
  if (e.key === 'Escape') setMenu(false);
});

/* --- Copy buttons (BibTeX, code blocks) -------------------------------------- */

document.addEventListener('click', async (e) => {
  const button = (e.target as Element).closest?.<HTMLButtonElement>('[data-copy]');
  if (!button) return;
  const source = button.dataset.copy
    ? document.getElementById(button.dataset.copy)
    : button.parentElement?.querySelector('code, pre');
  if (!source?.textContent) return;
  try {
    await navigator.clipboard.writeText(source.textContent);
  } catch {
    return;
  }
  const label = button.querySelector('[data-copy-label]') ?? button;
  const previous = label.textContent;
  label.textContent = button.dataset.copied ?? 'Copied';
  button.classList.add('is-done');
  setTimeout(() => {
    label.textContent = previous;
    button.classList.remove('is-done');
  }, 1400);
});

/* --- Hero landscape: only pages that have one load the code ------------------ */

const hero = document.querySelector<HTMLElement>('[data-shanshui]');
if (hero) import('./shanshui').then((m) => m.initShanshui(hero));
