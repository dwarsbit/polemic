import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { hasTrafficLights } from "@/lib/platform";
import { isWeb } from "@/lib/target";
import "./index.css";

// The macOS desktop app: the window uses the system vibrancy material
// (see lib.rs and the html.mac overrides in index.css).
if (hasTrafficLights) document.documentElement.classList.add("mac");

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

// Dev builds only: `?lab` opens the Design Lab (prototypes of the shell,
// settings, typography, menus and copy) instead of the app. The guard
// lets the bundler drop the lab from release builds entirely.
if (import.meta.env.DEV && new URLSearchParams(location.search).has("lab")) {
  void import("./lab/Lab").then(({ Lab }) =>
    root.render(
      <React.StrictMode>
        <Lab />
      </React.StrictMode>,
    ),
  );
} else if (isWeb) {
  // The browser build shows nothing until it knows who is signed in:
  // signed out goes to the sign-in page.
  void import("./web/start").then(({ startWeb }) => startWeb(root, <App />));
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
