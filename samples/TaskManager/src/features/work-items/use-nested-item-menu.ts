import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { CardMenuState } from "@/features/work-items/card-menu";
import type { WorkItemWrites } from "@/features/work-items/use-work-item-writes";
import type { ChildWorkItem } from "@/lib/ado";
/**
 * Opens the menu for a NESTED item shown inside the details window: writes go
 * through `writeChildItem`, then the child/bug queries that own the row refetch.
 */
export function useNestedItemMenu(
  setCardMenu: (menu: CardMenuState | null) => void,
  writeChildItem: WorkItemWrites["writeChildItem"],
) {
  const queryClient = useQueryClient();
  return useCallback(
    (child: ChildWorkItem, x: number, y: number) => {
      setCardMenu({
        id: child.id,
        x,
        y,
        kind: "child",
        item: child,
        childType: child.workItemType,
        onWrite: ({ write, label }) => {
          void (async () => {
            await writeChildItem(child.id, write, label);
            void queryClient.invalidateQueries({ queryKey: ["ado-child-work-items"] });
            void queryClient.invalidateQueries({ queryKey: ["ado-child-counts"] });
            void queryClient.invalidateQueries({ queryKey: ["ado-my-bugs"] });
          })();
        },
      });
    },
    [queryClient, setCardMenu, writeChildItem],
  );
}