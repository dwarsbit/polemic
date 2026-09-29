import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { isMac } from "@/lib/platform";
import "./index.css";

// macOS: the window uses the system vibrancy material (see lib.rs and
// the html.mac overrides in index.css).
if (isMac) document.documentElement.classList.add("mac");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
