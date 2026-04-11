/**
 * Production-safe logger. Only logs in development mode.
 * Replace console.error/warn/log with these throughout the app.
 */
const isDev = import.meta.env.DEV;

export const logger = {
  error: (...args: unknown[]) => { if (isDev) console.error(...args); },
  warn: (...args: unknown[]) => { if (isDev) console.warn(...args); },
  log: (...args: unknown[]) => { if (isDev) console.log(...args); },
};
