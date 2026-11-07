/**
 * Obsidian Flavored Markdown -> standard mdast.
 *
 *   [[Note]]  [[Note|alias]]  [[Note#Heading]]   links (unresolved ones become ghost spans)
 *   ![[image.png]]                               attachment embeds
 *   > [!note] Title   > [!tip]- Folded           callouts
 *   ==highlight==                                <mark>
 *   %%comment%%                                  removed
 */
import { visit, SKIP } from 'unist-util-visit';
import { getVault, parseWikilink, slugify, MEDIA_URL } from '../lib/vault';

const INLINE = /(!?)\[\[([^\]\n]+?)\]\]|==([^=\n]+?)==|%%([^%\n]*?)%%/g;
const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;

const hast = (name: string, properties: Record<string, unknown> = {}) => ({
  hName: name,
  hProperties: properties,
});

function wikilinkNode(raw: string, embed: boolean) {
  const { target, heading, alias } = parseWikilink(raw);

  if (embed && IMAGE.test(target)) {
    return {
      type: 'image',
      url: `${MEDIA_URL}/${encodeURIComponent(target)}`,
      alt: alias && !/^\d+(x\d+)?$/.test(alias) ? alias : target,
      title: null,
    };
  }

  const note = target ? getVault().resolve(target) : undefined;
  const label = alias ?? (heading && target ? `${target} › ${heading}` : target || heading);
  const text = [{ type: 'text', value: label || raw }];

  // `[[#Heading]]` points inside the current note.
  if (!target && heading) {
    return { type: 'link', url: `#${slugify(heading)}`, title: null, children: text };
  }
  if (!note) {
    return {
      type: 'emphasis',
      data: hast('span', { className: ['wikilink', 'is-ghost'], title: target }),
      children: text,
    };
  }
  return {
    type: 'link',
    url: `/notes/${note.slug}/${heading ? `#${slugify(heading)}` : ''}`,
    title: null,
    data: hast('a', { className: ['wikilink'], 'data-note': note.slug }),
    children: text,
  };
}

function splitInline(value: string) {
  const out: unknown[] = [];
  let last = 0;
  for (const m of value.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ type: 'text', value: value.slice(last, at) });
    if (m[2] !== undefined) out.push(wikilinkNode(m[2], m[1] === '!'));
    else if (m[3] !== undefined) {
      out.push({ type: 'emphasis', data: hast('mark'), children: [{ type: 'text', value: m[3] }] });
    }
    last = at + m[0].length;
  }
  if (last === 0) return null;
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) });
  return out;
}

const CALLOUT = /^\[!([\w-]+)\]([+-]?)[ \t]*(.*)$/;

function transformCallout(node: any) {
  const first = node.children?.[0];
  const lead = first?.type === 'paragraph' ? first.children?.[0] : undefined;
  if (lead?.type !== 'text') return;
  const [head, ...restLines] = lead.value.split(/\r?\n/);
  const m = head.match(CALLOUT);
  if (!m) return;

  const type = m[1].toLowerCase();
  const title = m[3].trim();
  const foldable = m[2] !== '';
  const remainder = restLines.join('\n');

  // Whatever follows the marker line stays in the body, inline nodes included.
  const bodyInline = [
    ...(remainder ? [{ ...lead, value: remainder }] : []),
    ...first.children.slice(1),
  ];
  const body = [
    ...(bodyInline.length ? [{ type: 'paragraph', children: bodyInline }] : []),
    ...node.children.slice(1),
  ];

  node.type = 'paragraph';
  node.data = foldable
    ? hast('details', { className: ['callout'], 'data-callout': type, open: m[2] === '+' ? true : undefined })
    : hast('aside', { className: ['callout'], 'data-callout': type });
  node.children = [
    {
      type: 'paragraph',
      data: hast(foldable ? 'summary' : 'p', { className: ['callout-title'], 'data-label': type }),
      children: title ? [{ type: 'text', value: title }] : [],
    },
    { type: 'paragraph', data: hast('div', { className: ['callout-body'] }), children: body },
  ];
}

export function remarkObsidian() {
  return (tree: any) => {
    visit(tree, 'blockquote', (node) => transformCallout(node));
    visit(tree, 'text', (node: any, index, parent: any) => {
      if (index === undefined || !parent) return;
      if (parent.type === 'link' || parent.type === 'linkReference') return;
      const parts = splitInline(node.value);
      if (!parts) return;
      parent.children.splice(index, 1, ...parts);
      return [SKIP, index + parts.length];
    });
  };
}
