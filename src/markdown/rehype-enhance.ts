/**
 * Reading-experience passes over a rendered note: heading anchors, scrollable
 * tables, and external link hygiene.
 */
import { visit } from 'unist-util-visit';
import { toString } from 'hast-util-to-string';
import { slugify } from '../lib/vault';

const HEADINGS = new Set(['h2', 'h3', 'h4']);

export function rehypeEnhance() {
  return (tree: any) => {
    const seen = new Map<string, number>();

    visit(tree, 'element', (node: any, index, parent: any) => {
      if (HEADINGS.has(node.tagName)) {
        const base = node.properties.id || slugify(toString(node)) || 'section';
        const n = seen.get(base) ?? 0;
        seen.set(base, n + 1);
        const id = n ? `${base}-${n}` : base;
        node.properties.id = id;
        node.children.push({
          type: 'element',
          tagName: 'a',
          properties: { href: `#${id}`, className: ['heading-anchor'], ariaHidden: 'true', tabIndex: -1 },
          children: [{ type: 'text', value: '#' }],
        });
      }

      if (node.tagName === 'input' && node.properties.type === 'checkbox') {
        const label = parent ? toString(parent).trim() : '';
        node.properties.ariaLabel = label || 'Task';
      }

      if (node.tagName === 'img') {
        node.properties.loading = 'lazy';
        node.properties.decoding = 'async';
      }

      if (node.tagName === 'a' && /^https?:/.test(String(node.properties.href ?? ''))) {
        node.properties.target = '_blank';
        node.properties.rel = 'noopener noreferrer';
      }

      if (node.tagName === 'table' && parent && index !== undefined) {
        parent.children[index] = {
          type: 'element',
          tagName: 'div',
          properties: { className: ['table-wrap'], tabIndex: 0 },
          children: [node],
        };
        return 'skip';
      }
    });
  };
}
