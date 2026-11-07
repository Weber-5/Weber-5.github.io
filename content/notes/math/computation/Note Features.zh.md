---
title: 笔记功能演示
summary: 一篇笔记能做到的所有事情。有了自己的笔记后可以删除。
---

这篇笔记用来演示完整的阅读管线。在 Obsidian 中写作，把文件放进 `content/notes/`，下面这些功能都会自动生效。它只是一个演示，不属于你的知识库。

## 内部链接

用双中括号建立链接：[[Kalman Filter]]；也可以起别名：[[Convex Optimization|这是一个别名链接]]；或者跳到章节：[[#数学公式]]。把鼠标悬停在链接上，可以预览目标笔记。

指向尚未存在的笔记的链接，会显示为[[Automatic Differentiation|幽灵链接]]，并在图谱中呈现为空心圆环。之后写下这篇笔记，它就会自动连接起来。

## 数学公式

行内公式 $e^{i\pi} + 1 = 0$ 嵌在文字中，独立公式单独成行：

$$
\hat{x}_{k|k} = \hat{x}_{k|k-1} + K_k \left( z_k - H \hat{x}_{k|k-1} \right)
$$

## 代码

```python
def gradient_descent(grad, x, lr=0.1, steps=100):
    """沿负梯度方向走固定步数。"""
    for _ in range(steps):
        x = x - lr * grad(x)
    return x
```

## 提示块

> [!note] 笔记提示块
> Obsidian 的 callout 会渲染成设计过的侧注，其中可以使用==高亮文字==。

> [!tip] 技巧

> [!warning] 注意
> 每种类型都有自己的标签。

> [!example]- 可折叠的提示块
> 减号让它保持折叠，读者点击后才展开。

## 图片

把图片放在 `content/notes/_attachments/`，用 Obsidian 的方式嵌入：

![[ink-sample.svg|一幅水墨风景]]

## 表格与列表

| 语法 | 效果 | 来源 |
| :-- | :-- | :-- |
| `[[Note]]` | 内部链接 | Obsidian |
| `==text==` | 高亮 | Obsidian |
| `$x$` | 公式 | KaTeX |

- [x] 用 Markdown 写作
- [ ] 替换这篇笔记

## 脚注

一句话可以带一个脚注。[^1]

[^1]: 脚注会出现在页面末尾，并带有回到引用处的链接。
