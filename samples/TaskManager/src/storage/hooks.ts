import { useMemo } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useCollectionChanges, useStorageProvider } from "./core/hooks";
import type { Collection, CollectionDefinition } from "./core";

/** The app's collection for `definition`, bound to the current storage provider. */
export function useAppCollection<T>(definition: CollectionDefinition<T>): Collection<T> {
  const provider = useStorageProvider();
  return useMemo(() => provider.collection(definition), [provider, definition]);
}

/**
 * Keeps a TanStack Query cache entry in step with a collection: any change (this
 * tab, another tab, or another user on a shared provider) invalidates `queryKey`.
 */
export function useInvalidateOnChange<T>(collection: Collection<T>, queryKey: QueryKey): void {
  const queryClient = useQueryClient();
  useCollectionChanges(collection, () => {
    void queryClient.invalidateQueries({ queryKey });
  });
}
