import React from "react";
import { createRoot } from "react-dom/client";

import { App } from "./ui-app.js";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Missing #root element");
}

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
