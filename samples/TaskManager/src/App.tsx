import { BrowserRouter, Route, Routes } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { ErrorBoundary } from "@/components/error-boundary";
import { ConfirmDialogProvider } from "@/components/confirm-dialog";
import { queryClient } from "@/lib/query-client";
import { AppShell } from "@/components/app-shell";
import { NotFoundPage } from "@/pages/not-found";
import { routes } from "@/routes";
import { StorageRoot } from "@/storage/core/StorageRoot";
import type { StorageProvider } from "@/storage/core";

/**
 * Router basename: trust Vite's BASE_URL only when the current path actually
 * starts with it; otherwise use the first path segment (the app may be served
 * under a per-app prefix).
 */
function getRouterBasename(): string {
  const buildBase = import.meta.env.BASE_URL.replace(/\/$/, "");
  if (
    buildBase &&
    buildBase.startsWith("/") &&
    (window.location.pathname === buildBase ||
      window.location.pathname.startsWith(buildBase + "/"))
  ) {
    return buildBase;
  }
  const parts = window.location.pathname.split("/").filter(Boolean);
  return parts.length ? `/${parts[0]}/` : "/";
}
const ROUTER_BASENAME = getRouterBasename();

export function App({ storage }: { storage: StorageProvider }) {
  return (
    <ErrorBoundary>
      <StorageRoot provider={storage}>
        <QueryClientProvider client={queryClient}>
          <MotionConfig reducedMotion="user">
            <ConfirmDialogProvider>
              <BrowserRouter basename={ROUTER_BASENAME}>
                <Routes>
                  <Route path="/" element={<AppShell />}>
                    {routes.map((r) =>
                      r.path === "/" ? (
                        <Route key={r.path} index element={r.element} />
                      ) : (
                        <Route key={r.path} path={r.path} element={r.element} />
                      ),
                    )}
                    <Route path="*" element={<NotFoundPage />} />
                  </Route>
                </Routes>
              </BrowserRouter>
            </ConfirmDialogProvider>
          </MotionConfig>
        </QueryClientProvider>
      </StorageRoot>
    </ErrorBoundary>
  );
}
