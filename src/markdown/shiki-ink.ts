/** A custom code theme: ink greys with one blue accent, matching the site palette. */
export function inkTheme(mode: 'light' | 'dark') {
  const c =
    mode === 'light'
      ? { fg: '#262B33', dim: '#6E7886', soft: '#4B5563', blue: '#1F4FA8', deep: '#14315F', str: '#34607F' }
      : { fg: '#D9DEE5', dim: '#87919E', soft: '#A9B2BE', blue: '#8DB2F2', deep: '#B9CFF5', str: '#9CC0D6' };
  return {
    name: `ink-${mode}`,
    type: mode,
    colors: { 'editor.foreground': c.fg, 'editor.background': '#00000000' },
    settings: [
      { settings: { foreground: c.fg, background: '#00000000' } },
      { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: c.dim, fontStyle: 'italic' } },
      { scope: ['keyword', 'storage', 'storage.type', 'keyword.control'], settings: { foreground: c.blue } },
      { scope: ['string', 'string.quoted', 'markup.inline.raw'], settings: { foreground: c.str } },
      { scope: ['constant', 'constant.numeric', 'constant.language', 'support.constant'], settings: { foreground: c.deep } },
      { scope: ['entity.name.function', 'support.function', 'meta.function-call'], settings: { foreground: c.fg, fontStyle: 'bold' } },
      { scope: ['entity.name.type', 'entity.name.class', 'support.type', 'support.class'], settings: { foreground: c.deep } },
      { scope: ['variable.parameter', 'punctuation', 'meta.brace', 'keyword.operator'], settings: { foreground: c.soft } },
      { scope: ['entity.name.tag', 'entity.other.attribute-name'], settings: { foreground: c.blue } },
    ],
  };
}
