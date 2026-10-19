import { useCallback, useState } from "react";
import { App } from "../App.jsx";
import { AppEntrance } from "./AppEntrance.jsx";

// Only the main window loads the opening renderer. HUD and answer windows
// share App's event wiring without downloading or initializing its canvas.
export default function MainSurface() {
  const [welcome, setWelcome] = useState(null);
  const [replay, setReplay] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const blockEntrance = useCallback(() => setBlocked(true), []);
  return <AppEntrance welcomeText={welcome} ready={welcome !== null} replayToken={replay} disabled={blocked}>
    <App onEntranceUnavailable={blockEntrance} onWelcomeChange={setWelcome} onReplayEntrance={() => setReplay((value) => value + 1)} />
  </AppEntrance>;
}
