import { APP_VERSION } from '../../config';
import type { ThemeName } from '../../settings/settings';
import { SettingGroup, SettingRow, Toggle, type SectionProps } from './controls';

/** Themes the app can render. `system` follows the OS appearance. */
const THEMES: { id: ThemeName; label: string }[] = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'system', label: 'Match system' },
];

/** Listed only once the easter egg below has been switched on. */
const DOGFOOD: { id: ThemeName; label: string } = { id: 'dogfood', label: 'Dogfood 🐶' };

export function GeneralSection({ settings, update }: SectionProps) {
  /**
   * Someone already wearing dogfood keeps the option in front of them even with
   * the easter egg off, so switching it off can never strand them in a palette
   * the picker no longer offers a way out of.
   */
  const showDogfood = settings.dogfoodTheme || settings.theme === 'dogfood';
  const themes = showDogfood ? [...THEMES, DOGFOOD] : THEMES;

  return (
    <>
      <SettingGroup title="Appearance">
        <SettingRow
          label="Theme"
          hint="Pick a fixed theme, or let the app follow your operating system's light/dark setting."
        >
          <div className="set__radios" role="radiogroup" aria-label="Theme">
            {themes.map((t) => (
              <label key={t.id} className="set__radio">
                <input
                  type="radio"
                  name="theme"
                  value={t.id}
                  checked={t.id === settings.theme}
                  onChange={() => update({ theme: t.id })}
                />
                {t.label}
              </label>
            ))}
          </div>
        </SettingRow>
      </SettingGroup>


      <SettingGroup title="Easter eggs">
        <SettingRow
          label="Bugs on new comments"
          hint="Send a swarm of insects drifting slowly across the screen whenever a comment appears. Off unless you want it, and always off if your system is set to reduce motion."
        >
          <Toggle
            checked={settings.bugSwarm}
            onChange={(bugSwarm) => update({ bugSwarm })}
            label="Send bugs flying when a comment appears"
          />
        </SettingRow>
        <SettingRow
          label="Dogfood theme"
          hint="Add a fourth, unreasonably pink theme to the picker above. It only puts the option there — you still have to choose it."
        >
          <Toggle
            checked={settings.dogfoodTheme}
            onChange={(dogfoodTheme) => update({ dogfoodTheme })}
            label="Offer the dogfood theme"
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="About">
        <SettingRow label="Version" hint="The build currently running.">
          <code className="set__mono">v{APP_VERSION}</code>
        </SettingRow>
      </SettingGroup>
    </>
  );
}
