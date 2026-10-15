import React from "react";
import { createRoot } from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { App } from "./App.jsx";
import { AppEntrance } from "./ui/AppEntrance.jsx";
import "./styles.css";
import "./ui/paper-theme.css";

const preview = new URLSearchParams(window.location.search);
const surface = window.__TAURI_INTERNALS__
  ? getCurrentWindow().label
  : preview.get("card") === "1" ? "answer" : preview.get("overlay") ? "overlay" : "main";

document.documentElement.dataset.surface = surface;

function MainSurface() {
  const [welcome, setWelcome] = React.useState(null);
  const [replay, setReplay] = React.useState(0);
  const [blocked, setBlocked] = React.useState(false);
  const blockEntrance = React.useCallback(() => setBlocked(true), []);
  return <AppEntrance welcomeText={welcome} ready={welcome !== null} replayToken={replay} disabled={blocked}>
    <App onEntranceUnavailable={blockEntrance} onWelcomeChange={setWelcome} onReplayEntrance={() => setReplay((value) => value + 1)} />
  </AppEntrance>;
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {surface === "main" ? <MainSurface /> : <App />}
  </React.StrictMode>,
);
