import React from "react";
import ReactDOM from "react-dom/client";
import EngineApp from "./app/EngineApp";
import "./index.css";
import "./command-deck.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <EngineApp />
  </React.StrictMode>,
);

// Register the service worker that caches the local-OCR assets for offline use.
// Same-origin only; failures are non-fatal (the app just won't work offline yet).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => { /* offline OCR unavailable until next online load */ });
  });
}
