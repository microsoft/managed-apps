import { Settings2 } from "lucide-react";
import { configIssues } from "@/config";

const VARIABLES: Array<[string, string]> = [
  ["VITE_ADO_ORG", "Azure DevOps organization, e.g. contoso"],
  ["VITE_ADO_PROJECT", "Azure DevOps project, e.g. Fabrikam Web"],
  ["VITE_ADO_AREA_PATH", "Optional area path root, e.g. Fabrikam Web\\Team A (defaults to the project)"],
  ["VITE_ADO_AREAS", "Optional sub-areas shown as backlog columns, e.g. Frontend,Backend"],
];

/**
 * First-run screen, shown until an Azure DevOps organization and project are
 * configured. Explains what to set instead of guessing defaults.
 */
export function SetupScreen({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <div className="w95-window mx-auto mt-6 max-w-2xl">
      <div className="w95-titlebar">
        <Settings2 className="h-3.5 w-3.5" />
        <span>Set up Task Manager</span>
      </div>
      <div className="space-y-3 p-3 text-[11px]">
        <p className="text-[12px] font-bold">Connect an Azure DevOps project to get started.</p>
        <p>
          Add these values to <code className="font-mono">.env.local</code> (see{" "}
          <code className="font-mono">.env.example</code>) and restart{" "}
          <code className="font-mono">npm run dev</code>, or enter them for this browser
          in Settings.
        </p>
        <table className="w95-in w-full bg-white text-left">
          <tbody>
            {VARIABLES.map(([name, description]) => (
              <tr key={name} className="border-b border-[#dfdfdf] last:border-0">
                <td className="whitespace-nowrap px-2 py-1 font-mono font-bold">{name}</td>
                <td className="px-2 py-1">{description}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {configIssues.length > 0 && (
          <div className="w95-panel px-2 py-1.5">
            <p className="font-bold text-[#a80000]">Some settings were ignored:</p>
            <ul className="list-inside list-disc">
              {configIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-[#404040]">
          The app also needs the Azure DevOps, Teams and Office 365 Users connectors.
          The setup skill in <code className="font-mono">.github/skills/setup-taskmanager</code>{" "}
          walks through adding them.
        </p>
        <button type="button" className="w95-btn w95-btn--default" onClick={onOpenSettings}>
          <Settings2 className="h-3.5 w-3.5" /> Open settings…
        </button>
      </div>
    </div>
  );
}
