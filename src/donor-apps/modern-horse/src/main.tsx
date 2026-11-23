import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { initAppearance } from "./appearance";
import { hydrateRegistry } from "./live";

initAppearance();

// LIVE WIRING: refresh the demo registry with the real national registry
// before first paint (bounded wait — a slow network still gets the app fast,
// and the background hydration keeps filling in afterwards).
const hydration = hydrateRegistry().catch(() => undefined);
const timeout = new Promise<void>((resolve) => setTimeout(resolve, 1500));
await Promise.race([hydration, timeout]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
