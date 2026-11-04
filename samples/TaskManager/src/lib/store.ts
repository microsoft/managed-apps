import { create } from "zustand";
import type { ChildWorkItem } from "@/lib/ado";
import type { WorkItem } from "@/lib/work-items-data";

// Global UI state for the work-item details window, shared across tabs. Read it
// with narrow selectors (`useAppStore((s) => s.selectedWorkItemId)`); server data
// belongs to TanStack Query and app data to the storage interface.

interface UiState {
  selectedWorkItemId: string | null;
  selectedWorkItemFallback: WorkItem | null;
  preparedWorkItem: WorkItem | null;
  nestedDetailStack: ChildWorkItem[];
  prepareWorkItem: (item: WorkItem) => void;
  refreshWorkItem: (item: WorkItem) => void;
  openWorkItem: (id: string, fallback?: WorkItem | null) => void;
  closeWorkItem: () => void;
  openNestedWorkItem: (item: ChildWorkItem) => void;
  closeNestedWorkItem: () => void;
}

export const useAppStore = create<UiState>((set) => ({
  selectedWorkItemId: null,
  selectedWorkItemFallback: null,
  preparedWorkItem: null,
  nestedDetailStack: [],
  prepareWorkItem: (item) =>
    set((state) =>
      state.preparedWorkItem === item ? state : { preparedWorkItem: item },
    ),
  refreshWorkItem: (item) =>
    set((state) => ({
      preparedWorkItem:
        state.preparedWorkItem?.id === item.id ? item : state.preparedWorkItem,
      selectedWorkItemFallback:
        state.selectedWorkItemId === item.id ? item : state.selectedWorkItemFallback,
      nestedDetailStack: state.nestedDetailStack.map((nested) =>
        nested.id === item.id ? { ...nested, ...item } : nested,
      ),
    })),
  openWorkItem: (id, fallback = null) =>
    set((state) => ({
      selectedWorkItemId: id,
      selectedWorkItemFallback: fallback,
      preparedWorkItem:
        fallback ??
        (state.preparedWorkItem?.id === id ? state.preparedWorkItem : null),
      nestedDetailStack: [],
    })),
  closeWorkItem: () =>
    set({
      selectedWorkItemId: null,
      selectedWorkItemFallback: null,
      nestedDetailStack: [],
    }),
  openNestedWorkItem: (item) =>
    set((state) => ({
      nestedDetailStack: [...state.nestedDetailStack, item],
    })),
  closeNestedWorkItem: () =>
    set((state) => ({
      nestedDetailStack: state.nestedDetailStack.slice(0, -1),
    })),
}));
