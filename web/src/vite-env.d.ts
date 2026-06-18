/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Base URL of the demo server when the frontend is deployed away from it (e.g. a tunnel URL).
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
