import { Outlet, useLocation } from "react-router-dom";
import { MotionConfig, motion } from "motion/react";
import { Toaster } from "@/components/ui/sonner";

// App shell: the layout frame. Owns the single `min-h-screen`, mounts the
// <Toaster/>, and plays a subtle entrance on each route.
export function AppShell() {
  const { pathname } = useLocation();
  return (
    // The Win95 look relies on its small motion cues, so this app opts out of
    // reduced-motion stripping here (the nearest MotionConfig wins).
    <MotionConfig reducedMotion="never">
      <div className="flex min-h-screen flex-col">
        <main className="flex flex-1 flex-col">
          {/* key on pathname → each route re-mounts and replays the entrance.
              Entrance-only (no AnimatePresence/exit): an exit animation around
              <Outlet/> would animate the NEXT route's content, not the leaving one. */}
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="flex-1"
          >
            <Outlet />
          </motion.div>
        </main>
        <Toaster />
      </div>
    </MotionConfig>
  );
}

export default AppShell;
