import { describe, it, expect } from 'vitest';
import { languageForPath, isLanguageId, LANGUAGE_IDS } from '../languages';

describe('languageForPath', () => {
  it('returns null when there is nothing to go on', () => {
    expect(languageForPath(null)).toBeNull();
    expect(languageForPath(undefined)).toBeNull();
    expect(languageForPath('')).toBeNull();
    expect(languageForPath('   ')).toBeNull();
  });

  it('renders unrecognised languages plain rather than guessing', () => {
    // The issue asks for exactly this: no highlighting beats wrong highlighting.
    expect(languageForPath('src/thing.zzz')).toBeNull();
    expect(languageForPath('LICENSE')).toBeNull();
    expect(languageForPath('bin/data.bin')).toBeNull();
  });

  it('resolves the languages the issue named by hand', () => {
    expect(languageForPath('src/Program.cs')).toBe('csharp');
    expect(languageForPath('src/app.ts')).toBe('typescript');
    expect(languageForPath('src/App.tsx')).toBe('tsx');
  });

  it('is case insensitive', () => {
    expect(languageForPath('SRC/PROGRAM.CS')).toBe('csharp');
    expect(languageForPath('Dockerfile')).toBe('dockerfile');
    expect(languageForPath('DOCKERFILE')).toBe('dockerfile');
  });

  it('takes the last path segment, with either separator', () => {
    expect(languageForPath('a/b/c/main.go')).toBe('go');
    expect(languageForPath('a\\b\\c\\main.go')).toBe('go');
    // A directory that looks like a file must not win.
    expect(languageForPath('weird.py/notes')).toBeNull();
  });

  it('matches suffixless build files by name', () => {
    expect(languageForPath('Makefile')).toBe('make');
    expect(languageForPath('build/CMakeLists.txt')).toBe('make');
    expect(languageForPath('Gemfile')).toBe('ruby');
  });

  it('falls back to the stem for compound names', () => {
    expect(languageForPath('docker/Dockerfile.prod')).toBe('dockerfile');
    expect(languageForPath('Makefile.am')).toBe('make');
  });

  it('prefers a known extension over the stem', () => {
    // 'appsettings' means nothing; '.json' does.
    expect(languageForPath('appsettings.Development.json')).toBe('json');
  });

  it('handles dotfiles, where the name is all suffix', () => {
    expect(languageForPath('.gitignore')).toBe('ini');
    expect(languageForPath('.bashrc')).toBe('shellscript');
  });

  it('maps C headers to the C++ grammar', () => {
    // A .h file is as likely to be C++ as C, and the C++ grammar reads both.
    expect(languageForPath('include/thing.h')).toBe('cpp');
  });
});

describe('isLanguageId', () => {
  it('accepts every shipped id', () => {
    for (const id of LANGUAGE_IDS) expect(isLanguageId(id)).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isLanguageId('brainfuck')).toBe(false);
    expect(isLanguageId('')).toBe(false);
  });
});

describe('LANGUAGE_IDS', () => {
  it('has no duplicates', () => {
    expect(new Set(LANGUAGE_IDS).size).toBe(LANGUAGE_IDS.length);
  });
});
