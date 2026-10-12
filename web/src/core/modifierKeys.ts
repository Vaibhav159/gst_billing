/** Modifier key names as this keyboard shows them. */
const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
export const MOD = MAC ? "⌘" : "Ctrl";
export const ALT = MAC ? "⌥" : "Alt";
