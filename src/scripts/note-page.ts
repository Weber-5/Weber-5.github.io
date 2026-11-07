/** Reading aids for notes: progress, contents, previews, section links, figures, code copy. */
import { toast } from './toast';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const EASE = 'cubic-bezier(0.22, 0.8, 0.24, 1)';

export function initNotePage(root: HTMLElement) {
  const lang = root.dataset.lang as 'en' | 'zh';
  const strings: Record<string, string> = JSON.parse(root.dataset.strings ?? '{}');
  const article = root.querySelector<HTMLElement>('[data-article]')!;

  /* Reading progress */
  const bar = root.querySelector<HTMLElement>('[data-progress]');
  if (bar) {
    let queued = false;
    const paint = () => {
      queued = false;
      const rect = article.getBoundingClientRect();
      const total = rect.height - innerHeight * 0.6;
      const u = total > 0 ? Math.min(1, Math.max(0, -rect.top / total)) : 1;
      bar.style.transform = `scaleX(${u})`;
    };
    addEventListener(
      'scroll',
      () => {
        if (!queued) {
          queued = true;
          requestAnimationFrame(paint);
        }
      },
      { passive: true },
    );
    paint();
  }

  /* Table of contents: highlight the section being read */
  const links = new Map(
    [...root.querySelectorAll<HTMLAnchorElement>('[data-toc] a')].map((a) => [a.hash.slice(1), a]),
  );
  if (links.size) {
    const headings = [...links.keys()]
      .map((id) => document.getElementById(id))
      .filter((h): h is HTMLElement => !!h);
    let queued = false;
    const mark = () => {
      queued = false;
      let current = headings[0];
      for (const h of headings) {
        if (h.getBoundingClientRect().top < 140) current = h;
      }
      links.forEach((a, id) => a.classList.toggle('is-active', id === current?.id));
    };
    addEventListener(
      'scroll',
      () => {
        if (!queued) {
          queued = true;
          requestAnimationFrame(mark);
        }
      },
      { passive: true },
    );
    mark();
  }

  /* Section links: the # beside a heading copies a link straight to it */
  article.addEventListener('click', async (e) => {
    const anchor = (e.target as Element).closest<HTMLAnchorElement>('a.heading-anchor');
    if (!anchor) return;
    e.preventDefault();
    const hash = anchor.getAttribute('href')!;
    // Setting the hash scrolls smoothly and lets :target mark the arrival.
    location.hash = hash;
    try {
      await navigator.clipboard.writeText(location.origin + location.pathname + hash);
      toast(strings.linkCopied);
    } catch {
      /* Clipboard refused: the hash is still updated, so the address bar has the link. */
    }
  });

  /* Code blocks: copy button */
  const copyLabel = lang === 'zh' ? '复制' : 'Copy';
  const copiedLabel = lang === 'zh' ? '已复制' : 'Copied';
  article.querySelectorAll('pre').forEach((pre) => {
    const wrap = document.createElement('div');
    wrap.className = 'code-block';
    pre.replaceWith(wrap);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'code-copy';
    button.textContent = copyLabel;
    button.dataset.copy = '';
    button.dataset.copied = copiedLabel;
    wrap.append(pre, button);
  });

  initLightbox(article, strings.close);
  initPreviews(article, lang, strings.footnote);
}

/** Figures open full size, growing out of their place in the text and back into it. */
function initLightbox(article: HTMLElement, closeLabel: string) {
  const images = [...article.querySelectorAll<HTMLImageElement>('.prose img')];
  if (!images.length) return;

  const dialog = document.createElement('dialog');
  dialog.className = 'lightbox';
  dialog.setAttribute('aria-label', closeLabel);
  const big = document.createElement('img');
  dialog.append(big);
  document.body.append(dialog);
  let source: HTMLImageElement | null = null;

  /** The transform that makes the large image sit exactly over the small one. */
  const fromSource = () => {
    const a = source!.getBoundingClientRect();
    const b = big.getBoundingClientRect();
    return `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width})`;
  };

  const open = async (img: HTMLImageElement) => {
    source = img;
    big.src = img.currentSrc || img.src;
    big.alt = img.alt;
    await big.decode().catch(() => undefined);
    dialog.showModal();
    if (reduced()) return;
    img.style.visibility = 'hidden';
    const flight = big.animate([{ transform: fromSource() }, { transform: 'none' }], { duration: 380, easing: EASE });
    dialog.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, pseudoElement: '::backdrop' });
    flight.finished.finally(() => (img.style.visibility = ''));
  };

  const close = async () => {
    if (!dialog.open) return;
    if (!reduced() && source) {
      source.style.visibility = 'hidden';
      dialog.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, pseudoElement: '::backdrop', fill: 'forwards' });
      await big
        .animate([{ transform: 'none' }, { transform: fromSource() }], { duration: 320, easing: EASE, fill: 'forwards' })
        .finished.catch(() => undefined);
      source.style.visibility = '';
    }
    dialog.close();
    big.getAnimations().forEach((a) => a.cancel());
    source?.focus({ preventScroll: true });
  };

  for (const img of images) {
    img.classList.add('is-zoomable');
    img.tabIndex = 0;
    img.setAttribute('role', 'button');
    img.addEventListener('click', () => open(img));
    img.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open(img);
      }
    });
  }
  dialog.addEventListener('click', close);
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });
}

/** Hover previews for wikilinks and footnotes: read the aside without losing your place. */
function initPreviews(article: HTMLElement, lang: 'en' | 'zh', footnoteLabel: string) {
  if (!matchMedia('(hover: hover)').matches) return;
  const wikilinks = [...article.querySelectorAll<HTMLAnchorElement>('a.wikilink[data-note]')];
  const footnotes = [...article.querySelectorAll<HTMLAnchorElement>('a[data-footnote-ref]')];
  if (!wikilinks.length && !footnotes.length) return;

  type Preview = { title: { en: string; zh: string }; summary?: { en: string; zh: string } };
  let index: Promise<Map<string, Preview>> | undefined;
  const getIndex = () =>
    (index ??= fetch('/graph.json')
      .then((r) => r.json())
      .then((data) => new Map(data.nodes.map((n: Preview & { id: string }) => [n.id, n]))));

  const card = document.createElement('div');
  card.className = 'note-preview';
  card.setAttribute('role', 'tooltip');
  const heading = document.createElement('strong');
  const text = document.createElement('p');
  card.append(heading, text);
  document.body.append(card);

  let timer = 0;
  const show = (link: HTMLElement, title: string, body: string) => {
    heading.textContent = title;
    text.textContent = body;
    const rect = link.getBoundingClientRect();
    const height = card.offsetHeight;
    const below = rect.bottom + height + 16 < innerHeight;
    card.style.left = `${Math.max(16, Math.min(rect.left, innerWidth - card.offsetWidth - 16))}px`;
    card.style.top = `${below ? rect.bottom + 8 : rect.top - height - 8}px`;
    card.classList.add('is-on');
  };
  const hide = () => {
    clearTimeout(timer);
    card.classList.remove('is-on');
  };
  const hover = (link: HTMLElement, load: () => Promise<[string, string] | null>) => {
    link.addEventListener('pointerenter', () => {
      clearTimeout(timer);
      timer = window.setTimeout(async () => {
        const content = await load();
        if (content) show(link, ...content);
      }, 180);
    });
    link.addEventListener('pointerleave', hide);
  };

  for (const link of wikilinks) {
    hover(link, async () => {
      const node = (await getIndex()).get(link.dataset.note!);
      return node ? [node.title[lang] || node.title.en, node.summary?.[lang] ?? ''] : null;
    });
  }
  for (const link of footnotes) {
    hover(link, async () => {
      const item = document.getElementById(decodeURIComponent(link.hash.slice(1)));
      if (!item) return null;
      const clone = item.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('[data-footnote-backref]').forEach((b) => b.remove());
      return [`${footnoteLabel} ${link.textContent?.trim() ?? ''}`, clone.textContent?.trim() ?? ''];
    });
  }
}
