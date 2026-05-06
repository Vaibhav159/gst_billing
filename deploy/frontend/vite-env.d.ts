/**
 * Improved Vite env types - replaces src/vite-env.d.ts
 *
 * Adds VITE_API_BASE_URL type for the configurable API base URL.
 */
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
