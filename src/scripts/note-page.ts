/** Reading aids for notes: progress, table of contents, link previews, code copy. */

export function initNotePage(root: HTMLElement) {
  const lang = root.dataset.lang as 'en' | 'zh';
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
    const mark = () => {
      let current = headings[0];
      for (const h of headings) {
        if (h.getBoundingClientRect().top < 140) current = h;
      }
      links.forEach((a, id) => a.classList.toggle('is-active', id === current?.id));
    };
    addEventListener('scroll', mark, { passive: true });
    mark();
  }

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

  /* Wikilink previews */
  if (!matchMedia('(hover: hover)').matches) return;
  const wikilinks = article.querySelectorAll<HTMLAnchorElement>('a.wikilink[data-note]');
  if (!wikilinks.length) return;

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
  wikilinks.forEach((link) => {
    link.addEventListener('pointerenter', () => {
      clearTimeout(timer);
      timer = window.setTimeout(async () => {
        const node = (await getIndex()).get(link.dataset.note!);
        if (!node) return;
        heading.textContent = node.title[lang] || node.title.en;
        text.textContent = node.summary?.[lang] ?? '';
        const rect = link.getBoundingClientRect();
        const height = card.offsetHeight;
        const below = rect.bottom + height + 16 < innerHeight;
        card.style.left = `${Math.max(16, Math.min(rect.left, innerWidth - card.offsetWidth - 16))}px`;
        card.style.top = `${below ? rect.bottom + 8 : rect.top - height - 8}px`;
        card.classList.add('is-on');
      }, 180);
    });
    link.addEventListener('pointerleave', () => {
      clearTimeout(timer);
      card.classList.remove('is-on');
    });
  });
}
