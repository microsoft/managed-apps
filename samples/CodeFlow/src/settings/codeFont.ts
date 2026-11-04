export const CODE_FONTS = {
  default: { label: 'Default monospace', family: '' },
  'cascadia-code': { label: 'Cascadia Code', family: '"Cascadia Code", monospace' },
  consolas: { label: 'Consolas', family: 'Consolas, monospace' },
  menlo: { label: 'Menlo', family: 'Menlo, monospace' },
  'fira-code': { label: 'Fira Code', family: '"Fira Code", monospace' },
  'courier-new': { label: 'Courier New', family: '"Courier New", monospace' },
} as const;

export type CodeFont = keyof typeof CODE_FONTS;
export const CODE_FONT_NAMES = Object.keys(CODE_FONTS) as CodeFont[];

export function applyCodeFontToDocument(font: CodeFont, ligatures: boolean): void {
  if (typeof document === 'undefined') return;
  const { style } = document.documentElement;
  const { family } = CODE_FONTS[font];
  // Removing the override preserves each code surface's original font stack.
  if (family) style.setProperty('--code-font-family', family);
  else style.removeProperty('--code-font-family');
  style.setProperty('--code-font-ligatures', ligatures ? 'normal' : 'none');
  // Cascadia Code and Fira Code use contextual alternates for operators, too.
  style.setProperty(
    '--code-font-features',
    ligatures ? 'normal' : '"liga" 0, "clig" 0, "dlig" 0, "hlig" 0, "calt" 0',
  );
}
