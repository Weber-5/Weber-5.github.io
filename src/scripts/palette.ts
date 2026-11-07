/** Command palette: a bilingual, zero-dependency search across the site. */

interface Item {
  type: 'page' | 'note' | 'paper' | 'project';
  title: { en: string; zh: string };
  detail?: { en: string; zh: string };
  keys?: string;
  url: string;
}

let ready = false;

const PAGES: Item[] = [
  { type: 'page', title: { en: 'Home', zh: '首页' }, url: '/' },
  { type: 'page', title: { en: 'Research', zh: '科研成果' }, url: '/research/' },
  { type: 'page', title: { en: 'Projects', zh: '开源项目' }, url: '/projects/' },
  { type: 'page', title: { en: 'Knowledge Graph', zh: '知识图谱' }, url: '/graph/' },
  { type: 'page', title: { en: 'Notes', zh: '学习笔记' }, url: '/notes/' },
  { type: 'page', title: { en: 'CV', zh: '简历' }, url: '/cv/' },
];

/** Prefix beats word start beats substring beats a loose subsequence. */
function score(query: string, text: string) {
  const hay = text.toLowerCase();
  const at = hay.indexOf(query);
  if (at === 0) return 100;
  if (at > 0) return /[\s\-_/]/.test(hay[at - 1]) ? 80 : 60;
  let i = 0;
  for (const ch of hay) if (ch === query[i]) i++;
  return i === query.length ? 20 : 0;
}

export function initPalette(dialog: HTMLDialogElement) {
  if (ready) return;
  ready = true;

  const lang = dialog.dataset.lang as 'en' | 'zh';
  const labels = JSON.parse(dialog.dataset.labels!);
  const input = dialog.querySelector<HTMLInputElement>('[data-palette-input]')!;
  const list = dialog.querySelector<HTMLUListElement>('[data-palette-results]')!;
  const prefix = lang === 'zh' ? '/zh' : '';

  let items: Item[] = PAGES;
  let shown: Item[] = [];
  let active = 0;

  fetch('/search.json')
    .then((r) => r.json())
    .then((data: Item[]) => {
      items = [...PAGES, ...data];
      render();
    })
    .catch(() => {
      /* Pages stay searchable even if the index fails to load. */
    });

  const label = (item: Item) => item.title[lang] || item.title.en;

  function search(raw: string) {
    const q = raw.trim().toLowerCase();
    if (!q) return items.filter((i) => i.type === 'page');
    return items
      .map((item) => ({
        item,
        rank: Math.max(
          score(q, item.title.en) + 10,
          score(q, item.title.zh) + 10,
          score(q, item.keys ?? '') * 0.6,
          score(q, item.detail?.[lang] ?? '') * 0.3,
        ),
      }))
      .filter((r) => r.rank > 10)
      .sort((a, b) => b.rank - a.rank)
      .slice(0, 30)
      .map((r) => r.item);
  }

  function render() {
    shown = search(input.value);
    active = Math.min(active, Math.max(shown.length - 1, 0));
    list.replaceChildren(
      ...shown.map((item, i) => {
        const li = document.createElement('li');
        li.className = 'result';
        li.id = `palette-${i}`;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', String(i === active));
        const title = document.createElement('strong');
        title.textContent = label(item);
        const kind = document.createElement('span');
        kind.className = 'label kind';
        kind.textContent = labels[item.type];
        li.append(title, kind);
        const detail = item.detail?.[lang];
        if (detail) {
          const small = document.createElement('small');
          small.textContent = detail;
          li.append(small);
        }
        li.addEventListener('pointermove', () => select(i));
        li.addEventListener('click', () => go(item));
        return li;
      }),
    );
    if (!shown.length) {
      const li = document.createElement('li');
      li.className = 'none';
      li.textContent = labels.empty;
      list.append(li);
    }
    input.setAttribute('aria-activedescendant', shown.length ? `palette-${active}` : '');
  }

  function select(i: number) {
    if (i === active) return;
    list.children[active]?.setAttribute('aria-selected', 'false');
    active = i;
    list.children[active]?.setAttribute('aria-selected', 'true');
    list.children[active]?.scrollIntoView({ block: 'nearest' });
    input.setAttribute('aria-activedescendant', `palette-${active}`);
  }

  const go = (item: Item) => {
    location.href = prefix + item.url;
  };

  input.addEventListener('input', () => {
    active = 0;
    render();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!shown.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      select((active + step + shown.length) % shown.length);
    } else if (e.key === 'Enter' && shown[active]) {
      e.preventDefault();
      go(shown[active]);
    }
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    input.value = '';
    active = 0;
    render();
  });

  render();
}
