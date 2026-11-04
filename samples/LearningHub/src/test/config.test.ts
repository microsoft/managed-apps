import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, readConfig } from '../config';

describe('config', () => {
  it('uses neutral defaults when nothing is set', () => {
    const config = readConfig({});
    expect(config).toEqual({ ...DEFAULT_CONFIG, warnings: [] });
    expect(config.storageProvider).toBe('local');
    expect(config.storagePrefix).toBe('learninghub');
    expect(config.appName).toBe('Learning Hub');
  });

  it('reads valid values', () => {
    const config = readConfig({
      VITE_APP_NAME: 'Contoso Learning',
      VITE_SERIES_WEEKDAY: '2',
      VITE_SERIES_START_TIME: '13:30',
      VITE_SERIES_END_TIME: '14:15',
      VITE_SERIES_TIME_ZONE: 'Europe/London',
      VITE_SERIES_END_DATE: '2031-12-18',
      VITE_SERIES_SKIP_DATES: '2031-12-25, 2032-01-01',
      VITE_STORAGE_PROVIDER: 'sharepoint',
      VITE_APP_STORAGE_PREFIX: 'contoso-learning',
      VITE_PUBLIC_APP_URL: 'https://learn.example.com',
      VITE_SEED_SAMPLE_DATA: 'false',
    });
    expect(config).toMatchObject({
      appName: 'Contoso Learning',
      weekday: 2,
      startTime: '13:30',
      endTime: '14:15',
      timeZone: 'Europe/London',
      endDate: '2031-12-18',
      skipDates: ['2031-12-25', '2032-01-01'],
      storageProvider: 'sharepoint',
      storagePrefix: 'contoso-learning',
      publicAppUrl: 'https://learn.example.com',
      seedSampleData: false,
      warnings: [],
    });
  });

  it('falls back to defaults for invalid values and reports them', () => {
    const config = readConfig({
      VITE_SERIES_WEEKDAY: '9',
      VITE_SERIES_TIME_ZONE: 'Mars/Olympus',
      VITE_APP_STORAGE_PREFIX: 'has spaces',
      VITE_PUBLIC_APP_URL: 'http://not-https.example.com',
      VITE_SERIES_START_TIME: '10:00',
      VITE_SERIES_END_TIME: '09:00',
    });
    expect(config.weekday).toBe(DEFAULT_CONFIG.weekday);
    expect(config.timeZone).toBe(DEFAULT_CONFIG.timeZone);
    expect(config.storagePrefix).toBe(DEFAULT_CONFIG.storagePrefix);
    expect(config.publicAppUrl).toBe('');
    expect(config.endTime).toBe('11:00');
    expect(config.warnings.length).toBeGreaterThanOrEqual(5);
  });
});
