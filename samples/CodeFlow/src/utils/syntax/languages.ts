/**
 * Which language a file is written in, decided from its path alone.
 *
 * The issue this implements asks to "default to no highlighting if unrecognized
 * language", so that is the shape of the API: {@link languageForPath} returns
 * `null` rather than guessing, and every caller downstream treats `null` as
 * "render this file plain". Nothing here reads file *contents* — shebang lines
 * and modelines would be a second, fuzzier source of truth for very little gain,
 * and a wrong guess is worse than no colour at all.
 *
 * The id strings are TextMate grammar ids. They are the one place the engine's
 * vocabulary leaks into shared code, and that is a deliberate trade: inventing a
 * parallel naming scheme would buy nothing but a translation table to keep in
 * sync.
 */

/** Languages the viewer ships a grammar for. */
export const LANGUAGE_IDS = [
  'c',
  'cpp',
  'csharp',
  'css',
  'diff',
  'dockerfile',
  'go',
  'graphql',
  'html',
  'ini',
  'java',
  'javascript',
  'json',
  'jsonc',
  'jsx',
  'kotlin',
  'less',
  'make',
  'markdown',
  'php',
  'powershell',
  'proto',
  'python',
  'ruby',
  'rust',
  'scss',
  'shellscript',
  'sql',
  'swift',
  'toml',
  'tsx',
  'typescript',
  'vue',
  'xml',
  'yaml',
] as const;

export type LanguageId = (typeof LANGUAGE_IDS)[number];

const IS_LANGUAGE_ID = new Set<string>(LANGUAGE_IDS);

/** True when `value` names a language the viewer can highlight. */
export function isLanguageId(value: string): value is LanguageId {
  return IS_LANGUAGE_ID.has(value);
}

/**
 * Extension → language, without the leading dot, lower-cased.
 *
 * Only extensions that are genuinely unambiguous appear here. `.h` is the
 * awkward one: it is C in a C project and C++ in a C++ one, and nothing in the
 * path says which. It maps to `cpp`, whose grammar is a superset — a C header
 * highlighted by the C++ grammar looks right, where the reverse does not.
 */
const BY_EXTENSION: Readonly<Record<string, LanguageId>> = {
  // C family
  c: 'c',
  h: 'cpp',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  hh: 'cpp',
  hpp: 'cpp',
  hxx: 'cpp',
  ino: 'cpp',
  // .NET
  cs: 'csharp',
  csx: 'csharp',
  // Web
  css: 'css',
  scss: 'scss',
  sass: 'scss',
  less: 'less',
  html: 'html',
  htm: 'html',
  xhtml: 'html',
  vue: 'vue',
  svg: 'xml',
  xml: 'xml',
  xaml: 'xml',
  csproj: 'xml',
  props: 'xml',
  targets: 'xml',
  plist: 'xml',
  // JS / TS
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  // Data & config
  json: 'json',
  jsonc: 'jsonc',
  json5: 'jsonc',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  cfg: 'ini',
  conf: 'ini',
  editorconfig: 'ini',
  properties: 'ini',
  // Shells
  sh: 'shellscript',
  bash: 'shellscript',
  zsh: 'shellscript',
  ksh: 'shellscript',
  ps1: 'powershell',
  psm1: 'powershell',
  psd1: 'powershell',
  // Everything else
  go: 'go',
  graphql: 'graphql',
  gql: 'graphql',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  patch: 'diff',
  diff: 'diff',
  php: 'php',
  proto: 'proto',
  py: 'python',
  pyi: 'python',
  pyw: 'python',
  rb: 'ruby',
  rake: 'ruby',
  gemspec: 'ruby',
  rs: 'rust',
  sql: 'sql',
  swift: 'swift',
};

/**
 * Files recognised by name rather than extension, lower-cased.
 *
 * These are the build-system files that carry no suffix at all, which is exactly
 * the set an extension-only lookup would silently render plain.
 */
const BY_FILENAME: Readonly<Record<string, LanguageId>> = {
  dockerfile: 'dockerfile',
  containerfile: 'dockerfile',
  makefile: 'make',
  gnumakefile: 'make',
  'cmakelists.txt': 'make',
  gemfile: 'ruby',
  rakefile: 'ruby',
  podfile: 'ruby',
  brewfile: 'ruby',
  '.gitignore': 'ini',
  '.gitattributes': 'ini',
  '.npmrc': 'ini',
  '.editorconfig': 'ini',
  '.env': 'ini',
  '.bashrc': 'shellscript',
  '.zshrc': 'shellscript',
  '.bash_profile': 'shellscript',
};

/** Last path segment of `path`, tolerating both separators. */
function baseName(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return cut === -1 ? path : path.slice(cut + 1);
}

/**
 * Decide the language for a repository path, or `null` when nothing recognises
 * it and the file should be rendered without highlighting.
 *
 * Matching runs name-first, then extension, then a second extension pass for
 * compound suffixes so `Dockerfile.prod` and `appsettings.Development.json` land
 * on the same grammar as their plain counterparts.
 */
export function languageForPath(path: string | null | undefined): LanguageId | null {
  if (!path) return null;
  const name = baseName(path.trim()).toLowerCase();
  if (!name) return null;

  const byName = BY_FILENAME[name];
  if (byName) return byName;

  const dot = name.lastIndexOf('.');
  if (dot > 0 || (dot === 0 && name.length > 1)) {
    const ext = name.slice(dot + 1);
    const byExt = BY_EXTENSION[ext];
    if (byExt) return byExt;
  }

  // `Dockerfile.prod`, `Makefile.am` — the *stem* is the recognisable part.
  if (dot > 0) {
    const stem = name.slice(0, dot);
    const byStem = BY_FILENAME[stem];
    if (byStem) return byStem;
  }

  return null;
}
