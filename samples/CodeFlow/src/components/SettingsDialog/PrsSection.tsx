import {
  MAX_SETTINGS_FONT_SIZE,
  MIN_SETTINGS_FONT_SIZE,
} from '../../settings/settings';
import { NO_FULL_FILE_LINE_LIMIT } from '../../utils/fullFileBudget';
import { CODE_FONTS, CODE_FONT_NAMES } from '../../settings/codeFont';
import { SettingGroup, SettingRow, Toggle, type SectionProps } from './controls';

/** Poll cadences offered for an open PR. `0` turns background refresh off. */
const REFRESH_CHOICES = [
  { value: 0, label: 'Off' },
  { value: 15, label: 'Every 15s' },
  { value: 30, label: 'Every 30s' },
  { value: 60, label: 'Every minute' },
  { value: 300, label: 'Every 5 minutes' },
];

/**
 * Lengths at which expanding a file stops happening on its own. `0` never stops,
 * and sits last because it is the choice you go looking for rather than the one
 * you land on.
 */
const FULL_FILE_LIMIT_CHOICES = [
  { value: 500, label: '500 lines' },
  { value: 1000, label: '1,000 lines' },
  { value: 2500, label: '2,500 lines' },
  { value: 5000, label: '5,000 lines' },
  { value: NO_FULL_FILE_LINE_LIMIT, label: 'Never — always expand' },
];

export function PrsSection({ settings, update }: SectionProps) {
  const filters = settings.summaryFilters;

  return (
    <>
      <SettingGroup title="Diff viewer">
        <SettingRow
          label="Default layout"
          hint="How the diff is laid out when you open a file."
          appliesOnNextOpen
        >
          <div className="set__radios" role="radiogroup" aria-label="Default layout">
            {(['inline', 'split'] as const).map((mode) => (
              <label key={mode} className="set__radio">
                <input
                  type="radio"
                  name="defaultViewMode"
                  value={mode}
                  checked={settings.defaultViewMode === mode}
                  onChange={() => update({ defaultViewMode: mode })}
                />
                {mode === 'inline' ? 'Inline' : 'Side by side'}
              </label>
            ))}
          </div>
        </SettingRow>

        <SettingRow
          label="Show the whole file"
          hint="Open each file expanded to all of its contents instead of the changed lines alone. The Full file / Diff only button in the diff toolbar changes this same setting, so whichever way you leave it is the way the next file opens."
        >
          <Toggle
            checked={settings.defaultFullFile}
            onChange={(defaultFullFile) => update({ defaultFullFile })}
            label="Show the whole file"
          />
        </SettingRow>

        <SettingRow
          label="Stop expanding past"
          hint="A long file costs a lot to expand and pays it again on every scroll, so past this length the viewer shows the changed lines and waits to be asked. Choose 'Never' to always expand — big files will be slower to open."
        >
          <select
            className="set__select"
            value={settings.fullFileLineLimit}
            onChange={(e) => update({ fullFileLineLimit: Number(e.target.value) })}
            aria-label="Stop expanding past"
            disabled={!settings.defaultFullFile}
          >
            {FULL_FILE_LIMIT_CHOICES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </SettingRow>

        <SettingRow
          label="Source code font"
          hint="Applies immediately to diffs, search results and code snippets. Fonts must be installed on this device; unavailable fonts fall back to monospace."
        >
          <select
            className="set__select"
            value={settings.codeFont}
            onChange={(e) => {
              const codeFont = CODE_FONT_NAMES.find((name) => name === e.target.value);
              if (codeFont) update({ codeFont });
            }}
            aria-label="Source code font"
          >
            {CODE_FONT_NAMES.map((name) => (
              <option key={name} value={name}>
                {CODE_FONTS[name].label}
              </option>
            ))}
          </select>
        </SettingRow>

        <SettingRow
          label="Code ligatures"
          hint="Allow the font to join characters into symbols. Turn off to keep operators such as != and => visually separate. This never changes the source text."
        >
          <Toggle
            checked={settings.codeLigatures}
            onChange={(codeLigatures) => update({ codeLigatures })}
            label="Code ligatures"
          />
        </SettingRow>

        <SettingRow
          label="Code font size"
          hint="The same value the zoom buttons in the diff toolbar change."
        >
          <div className="set__inline">
            <input
              type="range"
              min={MIN_SETTINGS_FONT_SIZE}
              max={MAX_SETTINGS_FONT_SIZE}
              step={1}
              value={settings.defaultFontSize}
              onChange={(e) => update({ defaultFontSize: Number(e.target.value) })}
              aria-label="Code font size"
            />
            <code className="set__mono">{settings.defaultFontSize}px</code>
          </div>
        </SettingRow>

        <pre
          className="set__code-preview"
          aria-label="Source code font preview"
          style={{ fontSize: settings.defaultFontSize }}
        >{'if (a != b && a !== b) => a <= b;\n// 0O 1Il {} [] ()'}</pre>

        <SettingRow
          label="Hide whitespace-only changes"
          hint="Fold away changes that are only line endings, indentation or trailing spaces, so a file whose line endings were rewritten still shows just the real edit. The diff toolbar can override this per file, and the viewer always tells you when something is hidden."
        >
          <Toggle
            checked={settings.ignoreWhitespace}
            onChange={(ignoreWhitespace) => update({ ignoreWhitespace })}
            label="Hide whitespace-only changes"
          />
        </SettingRow>

        <SettingRow
          label="Highlight changed words"
          hint="Mark the words that actually changed within a rewritten line, instead of colouring the whole line. The ∆W button in the diff toolbar can override this per file."
        >
          <Toggle
            checked={settings.wordDiff}
            onChange={(wordDiff) => update({ wordDiff })}
            label="Highlight changed words"
          />
        </SettingRow>

        <SettingRow
          label="Syntax highlighting"
          hint="Colour code by language. Files in a language we don't recognise render plain. Turn this off if the colours compete with the red and green change backgrounds, or if a very large file feels slow."
        >
          <Toggle
            checked={settings.syntaxHighlight}
            onChange={(syntaxHighlight) => update({ syntaxHighlight })}
            label="Syntax highlighting"
          />
        </SettingRow>

        <SettingRow
          label="Preview Markdown files"
          hint="Open .md files as formatted prose rather than raw source, with each paragraph, heading and list item marked as added, removed or rewritten. The toolbar switches back to source per file."
        >
          <Toggle
            checked={settings.markdownPreview}
            onChange={(markdownPreview) => update({ markdownPreview })}
            label="Preview Markdown files"
          />
        </SettingRow>

        <SettingRow
          label="Highlight matching words"
          hint="Select a word in the diff and its other occurrences in the file light up, so you can see where an identifier is used without opening find. Matching is case-sensitive, and pauses while the find widget is open."
        >
          <Toggle
            checked={settings.selectionHighlight}
            onChange={(selectionHighlight) => update({ selectionHighlight })}
            label="Highlight matching words"
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="File list">
        <SettingRow
          label="Hide files you've already seen"
          hint="Start each PR with seen files collapsed out of the list."
          appliesOnNextOpen
        >
          <Toggle
            checked={settings.hideSeenFiles}
            onChange={(hideSeenFiles) => update({ hideSeenFiles })}
            label="Hide files you've already seen"
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Comments">
        <SettingRow
          label="Open the comment summary"
          hint="Whether the bottom panel starts expanded on a PR you haven't opened before."
          appliesOnNextOpen
        >
          <Toggle
            checked={settings.summaryOpenByDefault}
            onChange={(summaryOpenByDefault) => update({ summaryOpenByDefault })}
            label="Open the comment summary"
          />
        </SettingRow>

        <SettingRow
          label="Comment buckets shown"
          hint="Which threads are ticked when the summary first renders."
          appliesOnNextOpen
        >
          <div className="set__checks">
            {(['active', 'resolved', 'closed'] as const).map((key) => (
              <label key={key} className="set__check">
                <input
                  type="checkbox"
                  checked={filters[key]}
                  onChange={(e) =>
                    update({ summaryFilters: { ...filters, [key]: e.target.checked } })
                  }
                />
                {key[0].toUpperCase() + key.slice(1)}
              </label>
            ))}
          </div>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Flagged">
        <SettingRow
          label="Auto-flag PRs you open"
          hint="Flag every open PR you load in the viewer, so it stays in the dashboard's Flagged list. Flags are dropped automatically once a PR is merged or closed."
          appliesOnNextOpen
        >
          <Toggle
            checked={settings.autoFlagOpenedPrs}
            onChange={(autoFlagOpenedPrs) => update({ autoFlagOpenedPrs })}
            label="Auto-flag PRs you open"
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Live updates">
        <SettingRow
          label="Check for new activity"
          hint="How often an open PR re-checks for comments, votes and new pushes."
        >
          <select
            className="set__select"
            value={settings.refreshIntervalSeconds}
            onChange={(e) => update({ refreshIntervalSeconds: Number(e.target.value) })}
            aria-label="Check for new activity"
          >
            {REFRESH_CHOICES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </SettingRow>
      </SettingGroup>
    </>
  );
}
