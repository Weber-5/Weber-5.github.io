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
  await navigator.clipboard.writeText(source.textContent);
  const label = button.querySelector('[data-copy-label]') ?? button;
  const previous = label.textContent;
  label.textContent = button.dataset.copied ?? 'Copied';
  setTimeout(() => (label.textContent = previous), 1400);
});

/* --- Hero landscape: only pages that have one load the code ------------------ */

const hero = document.querySelector<HTMLElement>('[data-shanshui]');
if (hero) import('./shanshui').then((m) => m.initShanshui(hero));
