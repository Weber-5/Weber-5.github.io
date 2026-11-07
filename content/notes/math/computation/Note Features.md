---
title: Note Features
title_zh: 笔记功能演示
aliases: [Markdown Showcase]
tags: [meta, method]
status: evergreen
created: 2026-10-28
updated: 2026-11-07
summary: Everything a note can do. Safe to delete once you have your own.
---

This note exists to exercise the whole reading pipeline. Write in Obsidian, drop the file into `content/notes/`, and everything below just works. It is a demonstration, not part of your knowledge base.

## Internal links

Link with double brackets: [[Kalman Filter]], with an alias: [[Convex Optimization|an aliased link]], or to a section: [[#Mathematics]]. Hover any of them to preview the target.

A link to a note that does not exist yet stays visible as a [[Automatic Differentiation|ghost link]], and shows up as a hollow ring in the graph. Writing the note later connects it automatically.

## Mathematics

Inline math like $e^{i\pi} + 1 = 0$ sits in the line. Display math stands alone:

$$
\hat{x}_{k|k} = \hat{x}_{k|k-1} + K_k \left( z_k - H \hat{x}_{k|k-1} \right)
$$

## Code

```python
def gradient_descent(grad, x, lr=0.1, steps=100):
    """Follow the negative gradient for a fixed number of steps."""
    for _ in range(steps):
        x = x - lr * grad(x)
    return x
```

```ts
const neighbors = (id: string) => links.filter((l) => l.source === id);
```

## Callouts

> [!note] A note callout
> Obsidian callouts render as designed asides, with ==highlighted text== inside.

> [!tip] A tip

> [!warning] A warning
> Each type carries its own label.

> [!example]- A folded callout
> The minus sign keeps it closed until a reader opens it.

## Images

Keep images in `content/notes/_attachments/` and embed them the Obsidian way:

![[ink-sample.svg|An ink landscape]]

## Tables and lists

| Syntax | Result | Source |
| :-- | :-- | :-- |
| `[[Note]]` | Internal link | Obsidian |
| `==text==` | Highlight | Obsidian |
| `$x$` | Math | KaTeX |

1. Numbered lists
2. Task lists below
   - Nested bullets

- [x] Write in Markdown
- [ ] Replace this note

## Footnotes

A sentence can carry a footnote.[^1]

[^1]: The note appears at the end of the page, with a link back to where it was cited.
