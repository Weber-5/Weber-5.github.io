/** Gallery: category filter and a full-screen viewer with keyboard and swipe. */

interface Meta {
  id: string;
  title: string;
  place: string;
  caption: string;
  full?: string;
  rows: [string, string][];
  placeholder: boolean;
}

const EASE = 'cubic-bezier(0.22, 0.8, 0.24, 1)';
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function initGallery(root: HTMLElement, viewer: HTMLDialogElement) {
  const strings = JSON.parse(root.dataset.strings ?? '{}');
  const tiles = [...root.querySelectorAll<HTMLElement>('[data-photo]')];
  const $ = <T extends HTMLElement>(s: string) => viewer.querySelector<T>(s)!;
  const stage = $('[data-v-stage]');
  const prev = $<HTMLButtonElement>('[data-v-prev]');
  const next = $<HTMLButtonElement>('[data-v-next]');

  /* --- Filter ---------------------------------------------------------------- */

  const buttons = root.querySelectorAll<HTMLButtonElement>('[data-photo-filter]');
  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const category = button.dataset.photoFilter;
      buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
      for (const tile of tiles) {
        tile.hidden = !!category && tile.dataset.category !== category;
        if (!tile.hidden) tile.classList.add('is-in');
      }
    });
  });

  /* --- Viewer ---------------------------------------------------------------- */

  const visible = () => tiles.filter((t) => !t.hidden);
  let current = -1;
  let opener: HTMLElement | null = null;

  /** The tile's own image appears at once; the large file replaces it when ready. */
  function media(tile: HTMLElement, meta: Meta) {
    const frame = document.createElement('div');
    frame.className = 'frame';
    const thumb = tile.querySelector('img');
    if (thumb) {
      const img = document.createElement('img');
      img.alt = meta.title;
      img.src = thumb.currentSrc || thumb.src;
      frame.append(img);
      if (meta.full) {
        const large = new Image();
        large.src = meta.full;
        large.decode().then(
          () => {
            if (frame.isConnected) img.src = meta.full!;
          },
          () => undefined,
        );
      }
    } else {
      const art = tile.querySelector('svg')?.cloneNode(true);
      const box = document.createElement('div');
      box.className = 'ph';
      box.style.setProperty('--r', getComputedStyle(tile).getPropertyValue('--r'));
      if (art) box.append(art);
      frame.append(box);
    }
    return frame;
  }

  function show(index: number, direction = 0) {
    const list = visible();
    if (!list.length) return;
    current = (index + list.length) % list.length;
    const tile = list[current];
    const meta: Meta = JSON.parse(tile.dataset.meta!);

    const frame = media(tile, meta);
    stage.replaceChildren(frame);
    if (direction && !still()) {
      frame.animate([{ opacity: 0, transform: `translateX(${direction * 28}px)` }, { opacity: 1, transform: 'none' }], {
        duration: 300,
        easing: EASE,
      });
    }

    $('[data-v-count]').textContent = `${current + 1} ${strings.of ?? '/'} ${list.length}`;
    $('[data-v-title]').textContent = meta.title;
    $('[data-v-place]').textContent = meta.place;
    $('[data-v-caption]').textContent = meta.caption;
    $('[data-v-rows]').replaceChildren(
      ...meta.rows.map(([label, value]) => {
        const row = document.createElement('div');
        const dt = document.createElement('dt');
        const dd = document.createElement('dd');
        dt.textContent = label;
        dd.textContent = value;
        row.append(dt, dd);
        return row;
      }),
    );
    prev.disabled = next.disabled = list.length < 2;
    history.replaceState(null, '', `#photo=${encodeURIComponent(meta.id)}`);

    // Warm the neighbours so the next step is instant.
    for (const step of [1, -1]) {
      const near = list[(current + step + list.length) % list.length];
      const full = near && (JSON.parse(near.dataset.meta!) as Meta).full;
      if (full) new Image().src = full;
    }
  }

  function open(tile: HTMLElement) {
    opener = tile.querySelector('button');
    document.documentElement.style.overflow = 'hidden';
    viewer.showModal();
    show(visible().indexOf(tile));
  }

  function close() {
    if (!viewer.open) return;
    viewer.close();
  }
  viewer.addEventListener('close', () => {
    document.documentElement.style.overflow = '';
    stage.replaceChildren();
    history.replaceState(null, '', location.pathname);
    opener?.focus({ preventScroll: true });
  });

  for (const tile of tiles) tile.querySelector('button')?.addEventListener('click', () => open(tile));
  prev.addEventListener('click', () => show(current - 1, -1));
  next.addEventListener('click', () => show(current + 1, 1));
  $('[data-v-close]').addEventListener('click', close);
  viewer.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') show(current + 1, 1);
    else if (e.key === 'ArrowLeft') show(current - 1, -1);
  });
  // Clicking the dark around the photo closes, as in every photo viewer.
  stage.addEventListener('click', (e) => {
    if (e.target === stage || (e.target as HTMLElement).classList.contains('frame')) close();
  });

  // Swipe between photographs on touch screens.
  let startX = 0;
  let startY = 0;
  stage.addEventListener('pointerdown', (e) => {
    startX = e.clientX;
    startY = e.clientY;
  });
  stage.addEventListener('pointerup', (e) => {
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(e.clientY - startY) * 1.4) show(current + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
  });

  // Arriving from a link to one photograph opens it directly.
  const fromHash = decodeURIComponent(location.hash.match(/photo=([^&]+)/)?.[1] ?? '');
  const linked = tiles.find((t) => t.dataset.photo === fromHash);
  if (linked) open(linked);
}
