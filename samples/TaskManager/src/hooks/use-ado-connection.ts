import { useCallback, useMemo } from "react";
import { z } from "zod";
import { DEFAULT_ADO_CONFIG, type AdoConfig } from "@/lib/ado";
import { KV_NAMESPACES } from "@/storage/collections";
import { useKeyValue, useStorageProvider } from "@/storage/core/hooks";

const connectionSchema = z.object({
  organization: z.string(),
  project: z.string(),
  areaRoot: z.string(),
  wiql: z.string(),
});

const CONNECTION_KEY = "adoConnection";

/**
 * The Azure DevOps connection in use: the environment defaults (VITE_ADO_*)
 * unless the user saved an override in Settings, which is kept in this
 * browser's `settings` key/value namespace.
 */
export function useAdoConnection(): {
  config: AdoConfig;
  isConfigured: boolean;
  isOverridden: boolean;
  save: (next: AdoConfig) => void;
  reset: () => void;
} {
  const provider = useStorageProvider();
  const settings = useMemo(() => provider.kv(KV_NAMESPACES.settings), [provider]);
  const [config, setConfig] = useKeyValue(settings, CONNECTION_KEY, connectionSchema, DEFAULT_ADO_CONFIG);

  const save = useCallback(
    (next: AdoConfig) =>
      setConfig({
        organization: next.organization.trim(),
        project: next.project.trim(),
        areaRoot: next.areaRoot.trim(),
        wiql: next.wiql.trim(),
      }),
    [setConfig],
  );
  const reset = useCallback(() => setConfig(undefined), [setConfig]);

  return {
    config,
    isConfigured: config.organization.trim() !== "" && config.project.trim() !== "",
    isOverridden: config !== DEFAULT_ADO_CONFIG,
    save,
    reset,
  };
}
