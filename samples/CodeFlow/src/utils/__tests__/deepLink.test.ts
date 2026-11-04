import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildDeepLink,
  copyRichLink,
  deepLinkQuery,
  deepLinkUrl,
  parseDeepLink,
  parseDeepLinkParams,
  playerAppUrl,
  readDeepLink,
  serializeDeepLink,
  type LocationLike,
} from '../deepLink';

const DEPLOYED: LocationLike = {
  hostname: 'apps.example.com',
  origin: 'https://apps.example.com',
  search: '',
  hash: '',
};

const LOCAL: LocationLike = {
  hostname: 'localhost',
  origin: 'http://localhost:5173',
  search: '',
  hash: '',
};

describe('parseDeepLink (legacy dl format)', () => {
  it('parses a bare PR target', () => {
    expect(parseDeepLink('pr:octo-org/octo-repo#114')).toEqual({
      owner: 'octo-org',
      repo: 'octo-repo',
      number: 114,
    });
  });

  it('parses a file target with slashes in the path', () => {
    expect(parseDeepLink('pr:octo-org/repo#7/file:src/components/App.tsx')).toEqual({
      owner: 'octo-org',
      repo: 'repo',
      number: 7,
      file: 'src/components/App.tsx',
    });
  });

  it('parses a comment target', () => {
    expect(parseDeepLink('pr:octo-org/repo#7/comment:PRRT_kwDOExyz123')).toEqual({
      owner: 'octo-org',
      repo: 'repo',
      number: 7,
      commentId: 'PRRT_kwDOExyz123',
    });
  });

  it('keeps file and comment separate when both are present', () => {
    expect(parseDeepLink('pr:octo-org/repo#7/file:src/a.ts/comment:42')).toEqual({
      owner: 'octo-org',
      repo: 'repo',
      number: 7,
      file: 'src/a.ts',
      commentId: '42',
    });
  });

  it('rejects malformed links', () => {
    expect(parseDeepLink('')).toBeNull();
    expect(parseDeepLink('https://example.com')).toBeNull();
    expect(parseDeepLink('pr:octo-org/repo#abc')).toBeNull();
    expect(parseDeepLink('pr:octo-org/repo#0')).toBeNull();
  });

  it('round-trips through serialization', () => {
    const target = { owner: 'o', repo: 'r', number: 3, file: 'a/b.ts' };
    expect(parseDeepLink(serializeDeepLink(target))).toEqual(target);
  });
});

describe('parseDeepLinkParams', () => {
  const params = (q: string) => new URLSearchParams(q);

  it('parses a bare PR target', () => {
    expect(parseDeepLinkParams(params('org=octo-org&repo=octo-repo&pull=114'))).toEqual({
      owner: 'octo-org',
      repo: 'octo-repo',
      number: 114,
    });
  });

  it('picks up the optional file and comment params', () => {
    expect(
      parseDeepLinkParams(params('org=o&repo=r&pull=7&file=src/a.ts&comment=PRRT_x')),
    ).toEqual({ owner: 'o', repo: 'r', number: 7, file: 'src/a.ts', commentId: 'PRRT_x' });
  });

  it('ignores unrelated params the player adds', () => {
    expect(parseDeepLinkParams(params('ms_appInstanceId=xyz&org=o&repo=r&pull=7'))).toEqual({
      owner: 'o',
      repo: 'r',
      number: 7,
    });
  });

  it('requires the full PR coordinate', () => {
    expect(parseDeepLinkParams(params('org=o&repo=r'))).toBeNull();
    expect(parseDeepLinkParams(params('org=o&pull=7'))).toBeNull();
    expect(parseDeepLinkParams(params('repo=r&pull=7'))).toBeNull();
    expect(parseDeepLinkParams(params(''))).toBeNull();
  });

  it('rejects a non-positive or non-numeric pull number', () => {
    expect(parseDeepLinkParams(params('org=o&repo=r&pull=abc'))).toBeNull();
    expect(parseDeepLinkParams(params('org=o&repo=r&pull=0'))).toBeNull();
    expect(parseDeepLinkParams(params('org=o&repo=r&pull=-3'))).toBeNull();
  });

  it('drops empty optional params rather than carrying blanks', () => {
    expect(parseDeepLinkParams(params('org=o&repo=r&pull=7&file=&comment='))).toEqual({
      owner: 'o',
      repo: 'r',
      number: 7,
    });
  });
});

describe('deepLinkQuery', () => {
  it('emits one param per field', () => {
    expect(deepLinkQuery({ owner: 'octo-org', repo: 'octo-repo', number: 123 })).toBe(
      'org=octo-org&repo=octo-repo&pull=123',
    );
  });

  it('leaves slashes readable in file paths', () => {
    expect(deepLinkQuery({ owner: 'o', repo: 'r', number: 7, file: 'src/a.ts' })).toBe(
      'org=o&repo=r&pull=7&file=src/a.ts',
    );
  });

  it('omits file and comment when absent, and escapes what needs it', () => {
    expect(
      deepLinkQuery({ owner: 'o', repo: 'r', number: 7, commentId: 'a b&c' }),
    ).toBe('org=o&repo=r&pull=7&comment=a%20b%26c');
  });
});

describe('readDeepLink', () => {
  it('reads discrete params the player forwards on the query string', () => {
    const loc = { ...DEPLOYED, search: '?ms_appInstanceId=xyz&org=o&repo=r&pull=12' };
    expect(readDeepLink(loc)).toEqual({ owner: 'o', repo: 'r', number: 12 });
  });

  it('reads a file and comment target', () => {
    const loc = { ...DEPLOYED, search: '?org=o&repo=r&pull=12&file=src/a.ts&comment=42' };
    expect(readDeepLink(loc)).toEqual({
      owner: 'o',
      repo: 'r',
      number: 12,
      file: 'src/a.ts',
      commentId: '42',
    });
  });

  it('still reads the legacy dl param so old links keep working', () => {
    const loc = { ...DEPLOYED, search: '?ms_appInstanceId=xyz&dl=pr%3Ao%2Fr%2312' };
    expect(readDeepLink(loc)).toEqual({ owner: 'o', repo: 'r', number: 12 });
  });

  it('still reads a legacy dl param with a file target', () => {
    const loc = { ...DEPLOYED, search: '?dl=pr%3Ao%2Fr%2312%2Ffile%3Asrc%2Fa.ts' };
    expect(readDeepLink(loc)).toEqual({ owner: 'o', repo: 'r', number: 12, file: 'src/a.ts' });
  });

  it('prefers discrete params when a stale dl param is also present', () => {
    const loc = { ...DEPLOYED, search: '?dl=pr%3Ao%2Fr%231&org=o&repo=r&pull=2' };
    expect(readDeepLink(loc)).toEqual({ owner: 'o', repo: 'r', number: 2 });
  });

  it('falls back to the hash fragment', () => {
    const loc = { ...DEPLOYED, hash: '#org=o&repo=r&pull=12&file=src/a.ts' };
    expect(readDeepLink(loc)).toEqual({
      owner: 'o',
      repo: 'r',
      number: 12,
      file: 'src/a.ts',
    });
  });

  it('falls back to a legacy hash fragment', () => {
    const loc = { ...DEPLOYED, hash: '#dl=pr%3Ao%2Fr%2312%2Ffile%3Asrc%2Fa.ts' };
    expect(readDeepLink(loc)).toEqual({
      owner: 'o',
      repo: 'r',
      number: 12,
      file: 'src/a.ts',
    });
  });

  it('returns null when there is no deep link', () => {
    expect(readDeepLink({ ...DEPLOYED, search: '?ms_appInstanceId=xyz' })).toBeNull();
  });
});

describe('buildDeepLink', () => {
  it('points at the current page when no app URL is configured', () => {
    const link = buildDeepLink({ owner: 'o', repo: 'r', number: 12 }, DEPLOYED);
    expect(link).toBe(`${DEPLOYED.origin}${DEPLOYED.pathname ?? '/'}?org=o&repo=r&pull=12`);
  });

  it('appends to the dev player URL, which already carries params', () => {
    const link = buildDeepLink({ owner: 'o', repo: 'r', number: 12, file: 'src/a.ts' }, LOCAL);
    const url = new URL(link);
    expect(url.pathname).toBe('/apps/dev');
    expect(url.searchParams.get('ms_appUrl')).toBe('http://localhost:5173/');
    expect(url.searchParams.get('ms_appConfigUrl')).toBe(
      'http://localhost:5173/__vite_managedapps_plugin__/ms.config.json',
    );
    expect(url.searchParams.get('org')).toBe('o');
    expect(url.searchParams.get('repo')).toBe('r');
    expect(url.searchParams.get('pull')).toBe('12');
    expect(url.searchParams.get('file')).toBe('src/a.ts');
  });

  it('never emits the legacy dl param', () => {
    const link = buildDeepLink({ owner: 'o', repo: 'r', number: 12, file: 'a.ts' }, DEPLOYED);
    expect(new URL(link).searchParams.get('dl')).toBeNull();
  });

  it('encodes the target so spaces and # survive the round trip', () => {
    const target = { owner: 'o', repo: 'r', number: 12, file: 'src/a b#c.ts' };
    const link = buildDeepLink(target, DEPLOYED);
    expect(link).not.toContain('#c.ts');
    const roundTripped = readDeepLink({ ...DEPLOYED, search: new URL(link).search });
    expect(roundTripped).toEqual(target);
  });
});

describe('playerAppUrl', () => {
  it('falls back to the current page when deployed without VITE_APP_URL', () => {
    expect(playerAppUrl(DEPLOYED)).toBe(`${DEPLOYED.origin}${DEPLOYED.pathname ?? '/'}`);
  });

  it('uses the dev player when running against local Vite', () => {
    expect(playerAppUrl(LOCAL)).toContain('/apps/dev');
  });
});

describe('deepLinkUrl', () => {
  const parts = { pathname: '/app', search: '?org=o&repo=r&pull=7', hash: '' };

  it('repoints an existing deep link at another PR', () => {
    const url = deepLinkUrl(parts, { owner: 'o', repo: 'r', number: 8 });
    expect(readDeepLink({ ...DEPLOYED, search: new URL(url, 'https://x').search })).toEqual({
      owner: 'o',
      repo: 'r',
      number: 8,
    });
  });

  it('strips the deep link when there is no target', () => {
    expect(deepLinkUrl(parts, null)).toBe('/app');
  });

  it('keeps unrelated params', () => {
    const url = deepLinkUrl({ ...parts, search: '?theme=dark&org=o&repo=r&pull=7' }, null);
    expect(url).toBe('/app?theme=dark');
  });

  it('leaves file paths readable', () => {
    const url = deepLinkUrl(parts, { owner: 'o', repo: 'r', number: 8, file: 'src/a.ts' });
    expect(url).toContain('file=src/a.ts');
  });

  it('drops a hash deep link so it cannot outlive the rewrite', () => {
    const url = deepLinkUrl({ pathname: '/app', search: '', hash: '#org=o&repo=r&pull=7' }, {
      owner: 'o',
      repo: 'r',
      number: 8,
    });
    expect(url).not.toContain('pull=7');
  });

  it('keeps a hash that is not a deep link', () => {
    const url = deepLinkUrl({ pathname: '/app', search: '', hash: '#section' }, null);
    expect(url).toBe('/app#section');
  });
});

describe('copyRichLink', () => {
  const url = 'https://apps.example.com/codeflow?org=o&repo=r&pull=42';
  const label = 'Pull Request 42: Fix the widget';
  const write = vi.fn<(items: ClipboardItem[]) => Promise<void>>();
  const writeText = vi.fn<(text: string) => Promise<void>>();
  const clipboardItem = vi.fn(function (data: Record<string, Blob>) {
    return { data };
  });
  const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');

  beforeEach(() => {
    write.mockReset().mockResolvedValue(undefined);
    writeText.mockReset().mockResolvedValue(undefined);
    clipboardItem.mockClear();
    vi.stubGlobal('navigator', { clipboard: { write, writeText } });
    vi.stubGlobal('ClipboardItem', clipboardItem);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalExecCommand) {
      Object.defineProperty(document, 'execCommand', originalExecCommand);
    } else {
      Reflect.deleteProperty(document, 'execCommand');
    }
  });

  it('copies the URL as plain text while preserving the titled HTML link', async () => {
    expect(await copyRichLink(url, label)).toBe(true);

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith([clipboardItem.mock.results[0].value]);
    const data = clipboardItem.mock.calls[0][0];
    expect(Object.keys(data).sort()).toEqual(['text/html', 'text/plain']);
    expect(data['text/plain'].type).toBe('text/plain');
    expect(data['text/html'].type).toBe('text/html');
    expect(await data['text/plain'].text()).toBe(url);
    expect(await data['text/html'].text()).toBe(
      `<a href="${url.replaceAll('&', '&amp;')}">${label}</a>`,
    );
    expect(writeText).not.toHaveBeenCalled();
  });

  it('escapes an author-controlled title so it cannot inject markup into the pasted link', async () => {
    const hostile = 'Pull Request 1: x</a> <a href="https://evil.example/">Re-authenticate</a>';
    expect(await copyRichLink(url, hostile)).toBe(true);

    const html = await clipboardItem.mock.calls[0][0]['text/html'].text();
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain('x&lt;/a&gt; &lt;a href=&quot;https://evil.example/&quot;&gt;');
  });

  it.each(['missing ClipboardItem', 'missing clipboard.write', 'rejected write'])(
    'falls back to copying the URL with %s',
    async (scenario) => {
      if (scenario === 'missing ClipboardItem') {
        vi.stubGlobal('ClipboardItem', undefined);
      } else if (scenario === 'missing clipboard.write') {
        vi.stubGlobal('navigator', { clipboard: { writeText } });
      } else {
        write.mockRejectedValue(new Error('Clipboard write blocked'));
      }

      expect(await copyRichLink(url, label)).toBe(true);
      expect(writeText).toHaveBeenCalledExactlyOnceWith(url);
    },
  );

  it.each([true, false])(
    'copies the URL through the legacy fallback and reports its result (%s)',
    async (result) => {
      write.mockRejectedValue(new Error('Rich clipboard write blocked'));
      writeText.mockRejectedValue(new Error('Plain clipboard write blocked'));
      let copiedText: string | undefined;
      const execCommand = vi.fn(() => {
        copiedText = document.querySelector('textarea')?.value;
        return result;
      });
      Object.defineProperty(document, 'execCommand', {
        configurable: true,
        value: execCommand,
      });

      expect(await copyRichLink(url, label)).toBe(result);
      expect(writeText).toHaveBeenCalledExactlyOnceWith(url);
      expect(execCommand).toHaveBeenCalledExactlyOnceWith('copy');
      expect(copiedText).toBe(url);
      expect(document.querySelector('textarea')).toBeNull();
    },
  );
});
