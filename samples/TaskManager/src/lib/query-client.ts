import { QueryClient } from "@tanstack/react-query";

// Single shared TanStack Query client.
// `staleTime` is finite so live connector/API data refetches (e.g. on window
// focus). For purely in-memory state — sample data that never changes on its
// own — override per-query with `staleTime: Infinity` to avoid pointless refetch.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
    },
  },
});
