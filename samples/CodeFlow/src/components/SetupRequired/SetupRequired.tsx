import { config } from '../../config';

/**
 * Shown instead of the app when the GitHub connector hasn't been added yet, so a
 * fresh clone explains what to do rather than failing on its first request.
 */
export function SetupRequired() {
  return (
    <main className="setup-required">
      <h1>{config.appName} needs one more setup step</h1>
      <p>
        This app talks to GitHub through the GitHub connector, which hasn&apos;t been added to
        this copy yet. From the project folder, run:
      </p>
      <pre>
        <code>npx ms app add data-source --connector shared_github --as action</code>
      </pre>
      <p>
        Then run <code>npm run check-setup</code> and restart <code>npm run dev</code>. The full
        setup steps (<code>ms auth login</code>, <code>ms app init</code>, app settings, connector) are in
        the README and in <code>.github/skills/setup-codeflow/SKILL.md</code>.
      </p>
    </main>
  );
}
