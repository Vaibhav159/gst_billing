import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { applyTheme, storedTheme } from "@/core/device";
import App from "./App";
import "./styles.css";

// the saved theme from the very first paint, so the page never flashes the default first
applyTheme(storedTheme());
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
