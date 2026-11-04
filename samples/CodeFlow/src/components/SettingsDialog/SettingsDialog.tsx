import { useCallback, useEffect, useRef, useState } from 'react';
import { useSettings } from '../../settings/useSettings';
import { GeneralSection } from './GeneralSection';
import { PrsSection } from './PrsSection';
import { DataSection } from './DataSection';

export type SettingsTab = 'general' | 'prs' | 'data';

const TABS: { id: SettingsTab; label: string; hint: string }[] = [
  { id: 'general', label: 'General', hint: 'Appearance and app-wide preferences' },
  { id: 'prs', label: 'PRs', hint: 'Defaults applied when you open a pull request' },
  { id: 'data', label: 'Data', hint: 'Where your data is stored; export and import' },
];

export interface SettingsDialogProps {
  onClose: () => void;
  /** Which tab to land on. Defaults to General. */
  initialTab?: SettingsTab;
}

/**
 * Floating settings panel, opened from the gear beside the signed-in user.
 *
 * Changes are applied and persisted the moment a control is touched — there is
 * no Save button, because every setting here is individually reversible and a
 * staged edit would only add a way to lose one.
 */
export function SettingsDialog({ onClose, initialTab = 'general' }: SettingsDialogProps) {
  const { settings, update, reset } = useSettings();
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onBackdrop = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  const onResetAll = useCallback(() => {
    if (window.confirm('Reset every setting to its default?')) reset();
  }, [reset]);

  return (
    <div className="set__backdrop" onMouseDown={onBackdrop}>
      <div
        className="set"
        role="dialog"
        aria-modal="true"
        aria-labelledby="set-title"
        data-testid="settings-dialog"
      >
        <header className="set__head">
          <div>
            <h2 className="set__title" id="set-title">
              Settings
            </h2>
            <p className="set__sub">Saved automatically</p>
          </div>
          <button
            className="set__close"
            onClick={onClose}
            ref={closeRef}
            aria-label="Close settings"
            title="Close"
          >
            ✕
          </button>
        </header>

        <div className="set__body">
          <nav className="set__tabs" role="tablist" aria-label="Settings sections">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                id={`set-tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls={`set-panel-${t.id}`}
                className={`set__tab ${tab === t.id ? 'set__tab--active' : ''}`}
                onClick={() => setTab(t.id)}
                title={t.hint}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div
            className="set__panel"
            role="tabpanel"
            id={`set-panel-${tab}`}
            aria-labelledby={`set-tab-${tab}`}
          >
            {tab === 'general' && (
              <GeneralSection settings={settings} update={update} />
            )}
            {tab === 'prs' && <PrsSection settings={settings} update={update} />}
            {tab === 'data' && <DataSection />}
          </div>
        </div>

        <footer className="set__foot">
          <button className="btn btn--sm" onClick={onResetAll}>
            Reset all to defaults
          </button>
        </footer>
      </div>
    </div>
  );
}
