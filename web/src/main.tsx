import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { applyTextSize, applyTheme, storedTextSize, storedTheme } from "@/core/device";
import App from "./App";
import "./styles.css";

// the saved theme and text size from the very first paint, so the page never flashes the defaults first
applyTheme(storedTheme());
applyTextSize(storedTextSize());
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
