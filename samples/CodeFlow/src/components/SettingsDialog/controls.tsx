import { useId, type ReactNode } from 'react';
import type { AppSettings, SettingsPatch } from '../../settings/settings';

/** Props every settings section receives. */
export interface SectionProps {
  settings: AppSettings;
  update: (patch: SettingsPatch) => void;
}

export interface SettingRowProps {
  label: string;
  hint?: string;
  /** Marks a setting that only takes effect the next time a PR is opened. */
  appliesOnNextOpen?: boolean;
  children: ReactNode;
}

/** One labelled setting: description on the left, control on the right. */
export function SettingRow({ label, hint, appliesOnNextOpen, children }: SettingRowProps) {
  return (
    <div className="set__row">
      <div className="set__rowtext">
        <span className="set__label">{label}</span>
        {hint && <span className="set__hint">{hint}</span>}
        {appliesOnNextOpen && (
          <span className="set__note">Applies the next time you open a pull request</span>
        )}
      </div>
      <div className="set__control">{children}</div>
    </div>
  );
}

/** A titled group of related settings. */
export function SettingGroup({ title, children }: { title: string; children: ReactNode }) {
  // `group` rather than a landmark: these are sets of related controls, and a
  // region per group would clutter the landmark list. The heading names it, so
  // assistive tech announces which group a control belongs to.
  const titleId = useId();
  return (
    <section className="set__group" role="group" aria-labelledby={titleId}>
      <h3 className="set__grouptitle" id={titleId}>
        {title}
      </h3>
      {children}
    </section>
  );
}

export interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}

export function Toggle({ checked, onChange, label }: ToggleProps) {
  return (
    <label className="set__toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
      />
      <span className="set__togglelabel">{checked ? 'On' : 'Off'}</span>
    </label>
  );
}
