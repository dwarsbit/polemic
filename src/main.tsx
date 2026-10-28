import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { isMac } from "@/lib/platform";
import "./index.css";

// macOS: the window uses the system vibrancy material (see lib.rs and
// the html.mac overrides in index.css).
if (isMac) document.documentElement.classList.add("mac");

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

// Dev builds only: `?lab` opens the Design Lab (prototypes of the shell,
// settings, typography, menus and copy) instead of the app. The guard
// lets the bundler drop the lab from release builds entirely.
if (import.meta.env.DEV && new URLSearchParams(location.search).has("lab")) {
  void Promise.all([import("./lab/lab.css"), import("./lab/Lab")]).then(([, { Lab }]) =>
    root.render(
      <React.StrictMode>
        <Lab />
      </React.StrictMode>,
    ),
  );
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
