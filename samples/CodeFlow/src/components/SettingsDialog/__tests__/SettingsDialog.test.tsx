import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { SettingsDialog } from '../SettingsDialog';
import { getSettings, resetSettingsStoreForTests } from '../../../settings/settingsStore';
import { DEFAULT_SETTINGS } from '../../../settings/settings';
import { CODE_FONTS, CODE_FONT_NAMES } from '../../../settings/codeFont';
import {
  MAX_FULL_FILE_LINES,
  NO_FULL_FILE_LINE_LIMIT,
} from '../../../utils/fullFileBudget';

beforeEach(() => {
  resetSettingsStoreForTests();
});

describe('SettingsDialog', () => {
  it('opens on the General tab', () => {
    render(<SettingsDialog onClose={vi.fn()} />);

    expect(screen.getByTestId('settings-dialog')).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeTruthy();
  });

  it('offers the bug swarm easter egg switched off, and turns it on when asked', () => {
    render(<SettingsDialog onClose={vi.fn()} />);

    const toggle = screen.getByRole('checkbox', {
      name: 'Send bugs flying when a comment appears',
    });
    expect((toggle as HTMLInputElement).checked).toBe(false);

    fireEvent.click(toggle);
    expect(getSettings().bugSwarm).toBe(true);
  });

  // Every easter egg is opt-in and lives in one place, so a reviewer can find
  // the lot of them without hunting through Appearance for the one that wanders.
  it('gathers the easter eggs into a single group, all off to begin with', () => {
    render(<SettingsDialog onClose={vi.fn()} />);

    const group = screen.getByRole('group', { name: 'Easter eggs' });
    const toggles = within(group).getAllByRole('checkbox') as HTMLInputElement[];

    expect(toggles.map((t) => t.getAttribute('aria-label'))).toEqual([
      'Send bugs flying when a comment appears',
      'Offer the dogfood theme',
    ]);
    expect(toggles.every((t) => t.checked)).toBe(false);
  });

  it('can be opened directly on another tab', () => {
    render(<SettingsDialog onClose={vi.fn()} initialTab="data" />);

    expect(screen.getByRole('button', { name: 'Export…' })).toBeTruthy();
  });

  it('switches sections when a tab is clicked', () => {
    render(<SettingsDialog onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('tab', { name: 'PRs' }));

    expect(screen.getByRole('radiogroup', { name: 'Default layout' })).toBeTruthy();
    expect(screen.queryByRole('radiogroup', { name: 'Theme' })).toBeNull();
  });

  it('marks only the current tab as selected', () => {
    render(<SettingsDialog onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Data' }));

    expect(screen.getByRole('tab', { name: 'Data' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'General' }).getAttribute('aria-selected')).toBe('false');
  });

  it('persists a change the moment a control is touched', () => {
    render(<SettingsDialog onClose={vi.fn()} initialTab="prs" />);

    fireEvent.click(screen.getByLabelText('Side by side'));

    expect(getSettings().defaultViewMode).toBe('split');
  });

  it('offers the whole-file default switched on, and turns it off when asked', () => {
    render(<SettingsDialog onClose={vi.fn()} initialTab="prs" />);

    const toggle = screen.getByRole('checkbox', { name: 'Show the whole file' });
    expect((toggle as HTMLInputElement).checked).toBe(true);

    fireEvent.click(toggle);

    expect(getSettings().defaultFullFile).toBe(false);
  });

  it('offers source fonts and applies a selection without reopening the PR', () => {
    render(<SettingsDialog onClose={vi.fn()} initialTab="prs" />);

    const font = screen.getByRole('combobox', { name: 'Source code font' });
    expect(font).toHaveValue('default');
    expect(within(font).getAllByRole('option')).toHaveLength(CODE_FONT_NAMES.length);

    fireEvent.change(font, { target: { value: 'consolas' } });

    expect(getSettings().codeFont).toBe('consolas');
    expect(document.documentElement.style.getPropertyValue('--code-font-family'))
      .toBe(CODE_FONTS.consolas.family);

    cleanup();
    render(<SettingsDialog onClose={vi.fn()} initialTab="prs" />);
    expect(screen.getByRole('combobox', { name: 'Source code font' })).toHaveValue('consolas');
  });

  it('disables operator ligatures independently of font and preserves the preview text', () => {
    render(<SettingsDialog onClose={vi.fn()} initialTab="prs" />);

    const preview = screen.getByLabelText('Source code font preview');
    const originalText = preview.textContent;
    expect(originalText).toContain('a != b && a !== b');
    const ligatures = screen.getByRole('checkbox', { name: 'Code ligatures' });
    expect(ligatures).toBeChecked();

    fireEvent.click(ligatures);

    expect(getSettings()).toMatchObject({ codeFont: 'default', codeLigatures: false });
    expect(document.documentElement.style.getPropertyValue('--code-font-ligatures')).toBe('none');
    expect(document.documentElement.style.getPropertyValue('--code-font-features'))
      .toBe('"liga" 0, "clig" 0, "dlig" 0, "hlig" 0, "calt" 0');
    expect(preview.textContent).toBe(originalText);

    fireEvent.change(screen.getByRole('slider', { name: 'Code font size' }), {
      target: { value: '18' },
    });
    expect(preview).toHaveStyle({ fontSize: '18px' });
    expect(getSettings().codeLigatures).toBe(false);

    fireEvent.click(ligatures);
    expect(document.documentElement.style.getPropertyValue('--code-font-ligatures')).toBe('normal');
    expect(document.documentElement.style.getPropertyValue('--code-font-features')).toBe('normal');
  });

  it('lets a reviewer ask for every file to be expanded however long it is', () => {
    render(<SettingsDialog onClose={vi.fn()} initialTab="prs" />);

    const limit = screen.getByRole('combobox', { name: 'Stop expanding past' });
    expect((limit as HTMLSelectElement).value).toBe(String(MAX_FULL_FILE_LINES));

    fireEvent.change(limit, { target: { value: String(NO_FULL_FILE_LINE_LIMIT) } });

    expect(getSettings().fullFileLineLimit).toBe(NO_FULL_FILE_LINE_LIMIT);
  });

  it('greys out the budget while the whole file is not being shown', () => {
    render(<SettingsDialog onClose={vi.fn()} initialTab="prs" />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Show the whole file' }));

    const limit = screen.getByRole('combobox', { name: 'Stop expanding past' });
    expect((limit as HTMLSelectElement).disabled).toBe(true);
  });


  it('offers every theme, and switches to light when picked', () => {
    render(<SettingsDialog onClose={vi.fn()} />);

    for (const label of ['Dark', 'Light', 'Match system']) {
      expect((screen.getByLabelText(label) as HTMLInputElement).disabled).toBe(false);
    }

    fireEvent.click(screen.getByLabelText('Light'));
    expect(getSettings().theme).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    fireEvent.click(screen.getByLabelText('Match system'));
    expect(getSettings().theme).toBe('system');
  });

  it('keeps the dogfood theme out of the picker until it is switched on', () => {
    render(<SettingsDialog onClose={vi.fn()} />);

    expect(screen.queryByLabelText('Dogfood 🐶')).toBeNull();
  });

  // The whole point of the switch is that it is safe to flip: it adds an option,
  // it does not redecorate the app behind your back.
  it('offers the dogfood theme without switching to it', () => {
    render(<SettingsDialog onClose={vi.fn()} />);

    fireEvent.click(screen.getByLabelText('Offer the dogfood theme'));

    expect(getSettings().dogfoodTheme).toBe(true);
    expect(getSettings().theme).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect((screen.getByLabelText('Dogfood 🐶') as HTMLInputElement).checked).toBe(false);
  });

  it('paints the dogfood theme once it is actually picked', () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Offer the dogfood theme'));

    fireEvent.click(screen.getByLabelText('Dogfood 🐶'));

    expect(getSettings().theme).toBe('dogfood');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dogfood');
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  // Shift+Click used to be the only way in. It is gone, and holding Shift must
  // now do nothing surprising — just pick the theme that was clicked.
  it('ignores Shift when a theme is clicked', () => {
    render(<SettingsDialog onClose={vi.fn()} />);

    fireEvent.click(screen.getByLabelText('Light'), { shiftKey: true });

    expect(getSettings().theme).toBe('light');
    expect(screen.queryByLabelText('Dogfood 🐶')).toBeNull();
  });

  it('lists the dogfood theme on later visits once it is on', () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Offer the dogfood theme'));

    cleanup();
    render(<SettingsDialog onClose={vi.fn()} />);

    expect(screen.getByLabelText('Dogfood 🐶')).toBeTruthy();
  });

  it('lets a reviewer take the dogfood theme back off', () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Offer the dogfood theme'));
    fireEvent.click(screen.getByLabelText('Dogfood 🐶'));

    fireEvent.click(screen.getByLabelText('Dark'));

    expect(getSettings().theme).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  // Switching the egg off while wearing dogfood must not strand anyone in a
  // palette the picker no longer offers a way out of.
  it('keeps listing the dogfood theme while it is the one in use', () => {
    render(<SettingsDialog onClose={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Offer the dogfood theme'));
    fireEvent.click(screen.getByLabelText('Dogfood 🐶'));

    fireEvent.click(screen.getByLabelText('Offer the dogfood theme'));

    expect(getSettings().dogfoodTheme).toBe(false);
    expect(getSettings().theme).toBe('dogfood');
    expect(screen.getByLabelText('Dogfood 🐶')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Light'));

    expect(getSettings().theme).toBe('light');
    expect(screen.queryByLabelText('Dogfood 🐶')).toBeNull();
  });






  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<SettingsDialog onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the backdrop is clicked but not the panel itself', () => {
    const onClose = vi.fn();
    const { container } = render(<SettingsDialog onClose={onClose} />);

    fireEvent.mouseDown(screen.getByTestId('settings-dialog'));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(container.querySelector('.set__backdrop') as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('restores the defaults when the reset is confirmed', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<SettingsDialog onClose={vi.fn()} initialTab="prs" />);

    fireEvent.click(screen.getByLabelText('Side by side'));
    expect(getSettings().defaultViewMode).toBe('split');

    fireEvent.click(screen.getByRole('button', { name: 'Reset all to defaults' }));

    expect(getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('leaves settings alone when the reset is cancelled', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<SettingsDialog onClose={vi.fn()} initialTab="prs" />);

    fireEvent.click(screen.getByLabelText('Side by side'));
    fireEvent.click(screen.getByRole('button', { name: 'Reset all to defaults' }));

    expect(getSettings().defaultViewMode).toBe('split');
  });


  it('shows local mode and offers export and import on the Data tab', () => {
    render(<SettingsDialog onClose={vi.fn()} initialTab="data" />);

    expect(screen.getByText(/Local mode: everything is kept in this browser only/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Import…' })).toBeTruthy();
  });

  it('imports a data export and reloads settings from it', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<SettingsDialog onClose={vi.fn()} initialTab="data" />);
    const snapshot = {
      format: 'app-storage-snapshot',
      formatVersion: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      collections: {},
      kv: { prefs: { settings: { ...DEFAULT_SETTINGS, theme: 'light' } } },
    };
    const file = new File([JSON.stringify(snapshot)], 'export.json', { type: 'application/json' });
    fireEvent.change(screen.getByTestId('import-file'), { target: { files: [file] } });

    expect(await screen.findByText('Import complete.')).toBeTruthy();
    expect(getSettings().theme).toBe('light');
    confirm.mockRestore();
  });

  it('rejects a file that is not a data export', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<SettingsDialog onClose={vi.fn()} initialTab="data" />);
    const file = new File(['{"hello":1}'], 'other.json', { type: 'application/json' });
    fireEvent.change(screen.getByTestId('import-file'), { target: { files: [file] } });

    expect(await screen.findByRole('alert')).toHaveTextContent('not a data export');
    confirm.mockRestore();
  });
});
