import { describe, expect, it } from 'vitest';
import { buildConfig } from '../../config';

describe('buildConfig', () => {
  it('uses safe defaults when nothing is configured', () => {
    expect(buildConfig({})).toMatchObject({
      appName: 'CodeFlow',
      githubHost: 'https://github.com',
      appUrl: '',
      storageProvider: 'local',
      storagePrefix: 'codeflow',
    });
  });

  it('reads VITE_* overrides', () => {
    const config = buildConfig({
      VITE_GITHUB_HOST: 'https://github.contoso.com/',
      VITE_STORAGE_PROVIDER: 'memory',
      VITE_APP_STORAGE_PREFIX: 'review',
    });
    expect(config).toMatchObject({ githubHost: 'https://github.contoso.com', storageProvider: 'memory', storagePrefix: 'review' });
  });

  it('ignores a non-https GitHub host', () => {
    expect(buildConfig({ VITE_GITHUB_HOST: 'javascript:alert(1)' }).githubHost).toBe('https://github.com');
    expect(buildConfig({ VITE_GITHUB_HOST: 'http://github.example' }).githubHost).toBe('https://github.com');
  });
});
