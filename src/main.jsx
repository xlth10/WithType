import React from "react";
import { createRoot } from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./styles.css";
import "./ui/paper-theme.css";

const MainSurface = React.lazy(() => import("./ui/MainSurface.jsx"));
const App = React.lazy(() => import("./App.jsx").then(({ App }) => ({ default: App })));

const preview = new URLSearchParams(window.location.search);
const surface = window.__TAURI_INTERNALS__
  ? getCurrentWindow().label
  : preview.get("card") === "1" ? "answer" : preview.get("overlay") ? "overlay" : "main";

document.documentElement.dataset.surface = surface;

function SurfaceLoading() {
  return <main className={surface === "overlay" ? "sr-only" : "page-content"} role="status" aria-live="polite">正在载入…</main>;
}

class SurfaceBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className={surface === "overlay" ? "" : "page-content"} role="alert">
      {surface !== "overlay" && <p>界面未能载入，请重新载入。</p>}
      <button className="button secondary" onClick={() => window.location.reload()}>重新载入</button>
    </main>;
  }
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <SurfaceBoundary>
      <React.Suspense fallback={<SurfaceLoading />}>
        {surface === "main" ? <MainSurface /> : <App />}
      </React.Suspense>
    </SurfaceBoundary>
  </React.StrictMode>,
);
