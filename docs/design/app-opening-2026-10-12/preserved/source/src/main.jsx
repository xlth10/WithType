import React from "react";
import { createRoot } from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { App } from "./App.jsx";
import { AppEntrance } from "./ui/AppEntrance.jsx";
import "./styles.css";

const preview = new URLSearchParams(window.location.search);
const surface = window.__TAURI_INTERNALS__ ? getCurrentWindow().label : preview.get("card") ? "answer" : preview.get("overlay") ? "overlay" : "main";
document.documentElement.dataset.surface = surface;

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {surface === "main" ? <AppEntrance><App /></AppEntrance> : <App />}
  </React.StrictMode>,
);
