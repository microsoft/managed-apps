import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { registerConnectors } from "./connectors";
import { createLiveConnectors } from "./connectors/live";
import { createStorage } from "./storage";
import "./index.css";

// Some share links land on `.../index.html`; normalize to `.../` before the
// router mounts so routes match. Query string and hash are preserved.
if (window.location.pathname.endsWith("/index.html")) {
  const newPath = window.location.pathname.replace(/\/index\.html$/, "/");
  window.history.replaceState(null, "", newPath + window.location.search + window.location.hash);
}

registerConnectors(createLiveConnectors());
const storage = createStorage();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App storage={storage} />
  </StrictMode>,
);
